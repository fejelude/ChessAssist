import { describe, it, expect, vi } from "vitest";
import {
  Engine,
  parseInfo,
  scoreText,
  whiteScore,
  type EngineWorker,
} from "../src/engine/uci";
import { defaults } from "../src/types";
import { START_FEN, playUci } from "../src/chess/position";
class FakeWorker implements EngineWorker {
  commands: string[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  postMessage(s: string) {
    this.commands.push(s);
    if (s === "uci") queueMicrotask(() => this.emit("uciok"));
    if (s === "isready") queueMicrotask(() => this.emit("readyok"));
  }
  terminate() {}
  emit(s: string) {
    this.onmessage?.({ data: s } as MessageEvent);
  }
}
const info =
  "info depth 15 seldepth 19 multipv 1 score cp 37 nodes 18001 nps 36002 time 500 pv e2e4 e7e5 g1f3";
describe("UCI lifecycle", () => {
  it("parses real UCI metrics and signed mate scores", () => {
    expect(parseInfo(info)).toMatchObject({
      depth: 15,
      rank: 1,
      cp: 37,
      nodes: 18001,
      time: 500,
    });
    expect(parseInfo("info depth 7 score mate -3 pv e2e4")).toMatchObject({
      mate: -3,
    });
  });
  it("converts evaluation to White perspective", () => {
    const line = parseInfo(info)!;
    const black = playUci(START_FEN, "e2e4")!.fen;
    expect(whiteScore(line, black)).toBe(-37);
    expect(scoreText(line, black)).toBe("-0.37");
  });
  it("rejects late info from cancelled searches and coalesces rapid updates", async () => {
    const worker = new FakeWorker(),
      engine = new Engine(() => worker),
      results: any[] = [];
    engine.onResult = (r) => results.push(r);
    await engine.analyze(START_FEN, defaults);
    worker.emit(info);
    expect(results).toHaveLength(1);
    const second = playUci(START_FEN, "e2e4")!.fen,
      third = playUci(START_FEN, "d2d4")!.fen;
    await engine.analyze(second, defaults);
    await engine.analyze(third, defaults);
    worker.emit(info);
    expect(results).toHaveLength(1);
    expect(worker.commands.filter((c) => c === "stop")).toHaveLength(1);
    expect(
      worker.commands.filter((c) => c.startsWith("position ")),
    ).toHaveLength(1);
    worker.emit("bestmove e2e4");
    expect(worker.commands.filter((c) => c.startsWith("position "))).toEqual([
      `position fen ${START_FEN}`,
      `position fen ${third}`,
    ]);
    worker.emit("info depth 9 multipv 1 score cp -5 nodes 100 time 10 pv d7d5");
    worker.emit("bestmove d7d5");
    expect(results.at(-1)).toMatchObject({ fen: third, finished: true });
    engine.dispose();
  });
  it("cancels pending work while the WASM worker is starting", async () => {
    const worker = new FakeWorker(),
      engine = new Engine(() => worker);
    const pending = engine.analyze(START_FEN, defaults);
    engine.cancel();
    await pending;
    expect(worker.commands.some((c) => c.startsWith("go "))).toBe(false);
    engine.dispose();
  });
  it("sends bounded CPU and memory options, and supports infinite mode", async () => {
    const worker = new FakeWorker(),
      engine = new Engine(() => worker);
    await engine.analyze(START_FEN, {
      ...defaults,
      preset: "infinite",
      hash: 9999,
      multiPV: 10,
    });
    expect(worker.commands).toContain("go infinite");
    expect(worker.commands).toContain("setoption name Hash value 128");
    expect(worker.commands).toContain("setoption name MultiPV value 3");
    engine.dispose();
  });
});

describe("engine recovery", () => {
  it("turns a bestmove-only response into a visible legal result", async () => {
    const w = new FakeWorker(),
      e = new Engine(() => w),
      r: any[] = [];
    e.onResult = (x) => r.push(x);
    await e.analyze(START_FEN, defaults);
    w.emit("bestmove e2e4");
    expect(r.at(-1).lines[0].pv).toEqual(["e2e4"]);
    e.dispose();
  });
  it("recovers from a synchronous worker construction failure", async () => {
    let tries = 0;
    const w = new FakeWorker(),
      e = new Engine(() => {
        if (!tries++) throw Error("load failed");
        return w;
      });
    await e.analyze(START_FEN, defaults);
    expect(tries).toBe(2);
    expect(w.commands.some((c) => c.startsWith("go "))).toBe(true);
    e.dispose();
  });
  it("surfaces a short error when both startup attempts fail", async () => {
    const e = new Engine(() => {
        throw Error("missing WASM");
      }),
      errors: string[] = [];
    e.onError = (m) => errors.push(m);
    await e.analyze(START_FEN, defaults);
    expect(errors.join(" ")).toContain("Retry");
    e.dispose();
  });
  it("rejects an invalid FEN before starting the engine", async () => {
    let created = 0;
    const e = new Engine(() => {
      created++;
      return new FakeWorker();
    });
    await expect(e.analyze("invalid", defaults)).rejects.toThrow(
      "Check the position",
    );
    expect(created).toBe(0);
    e.dispose();
  });
  it("does not accept illegal root moves from the engine", async () => {
    const w = new FakeWorker(),
      e = new Engine(() => w),
      r: any[] = [];
    e.onResult = (x) => r.push(x);
    await e.analyze(START_FEN, defaults);
    w.emit("info depth 12 score cp 5 pv a1a8");
    expect(r).toHaveLength(0);
    w.emit("bestmove e2e4");
    expect(r.at(-1).lines[0].pv[0]).toBe("e2e4");
    e.dispose();
  });
});

describe("request watchdogs", () => {
  it("restarts a stalled cancellation for the latest position", async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    const e = new Engine(() => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
    try {
      await e.analyze(START_FEN, defaults);
      const next = playUci(START_FEN, "e2e4")!.fen;
      await e.analyze(next, defaults);
      await vi.advanceTimersByTimeAsync(2600);
      expect(workers).toHaveLength(2);
      expect(workers[1].commands).toContain(`position fen ${next}`);
    } finally {
      e.dispose();
      vi.useRealTimers();
    }
  });
  it("reports a failed search after one automatic retry, without waiting forever", async () => {
    vi.useFakeTimers();
    const e = new Engine(() => new FakeWorker()),
      errors: string[] = [];
    e.onError = (x) => errors.push(x);
    try {
      await e.analyze(START_FEN, { ...defaults, time: 100 });
      await vi.advanceTimersByTimeAsync(10300);
      expect(errors.join(" ")).toContain("Retry");
    } finally {
      e.dispose();
      vi.useRealTimers();
    }
  });
});
