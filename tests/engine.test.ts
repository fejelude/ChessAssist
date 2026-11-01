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
import { strengthProfile } from "../src/engine/legit";
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

it("uses finite integer limits when settings contain non-finite values", async () => {
  const worker = new FakeWorker(),
    engine = new Engine(() => worker);
  try {
    await engine.analyze(START_FEN, {
      ...defaults,
      hash: NaN,
      multiPV: Infinity,
      depth: NaN,
      time: NaN,
    });
    expect(worker.commands).toContain("setoption name Hash value 32");
    expect(worker.commands).toContain("setoption name MultiPV value 3");
    expect(worker.commands).toContain("go depth 20 movetime 3000");
  } finally {
    engine.dispose();
  }
});

describe("Legit request isolation", () => {
  const legit = {
    ...defaults,
    configuration: "legit" as const,
    playingStrength: "elite-gm" as const,
  };
  function frame(w: FakeWorker, depth: number) {
    for (const [i, move] of ["e2e4", "d2d4", "g1f3", "c2c4"].entries())
      w.emit(
        `info depth ${depth} multipv ${i + 1} score cp ${30 - i} nodes 100 time 10 pv ${move}`,
      );
  }
  it("uses the last complete MultiPV iteration and never streams a transient perfect move", async () => {
    const w = new FakeWorker(),
      e = new Engine(() => w),
      results: any[] = [];
    e.onResult = (r) => results.push(r);
    try {
      await e.analyze(START_FEN, legit);
      frame(w, 8);
      // A new iteration was cut off before its other candidates completed.
      w.emit("info depth 9 multipv 1 score cp 999 nodes 101 time 11 pv a2a3");
      expect(results).toHaveLength(0);
      w.emit("bestmove a2a3");
      expect(results).toHaveLength(1);
      expect(results[0].lines[0].depth).toBe(8);
      expect(results[0].lines[0].pv[0]).not.toBe("a2a3");
      expect(results[0].finished).toBe(true);
    } finally {
      e.dispose();
    }
  });
  it("coalesces same-position preset changes, discards old results, bypasses training cache and restores Stockfish options", async () => {
    const w = new FakeWorker(),
      e = new Engine(() => w),
      results: any[] = [];
    e.onResult = (r) => results.push(r);
    try {
      await e.analyze(START_FEN, defaults);
      await e.analyze(START_FEN, { ...legit, playingStrength: "beginner" });
      const latest = await e.analyze(START_FEN, legit);
      w.emit(info);
      w.emit("bestmove e2e4");
      expect(results).toHaveLength(0);
      const p = strengthProfile(legit)!;
      expect(w.commands.at(-1)).toBe(
        `go depth ${p.depth} nodes ${p.nodes} movetime ${defaults.time}`,
      );
      frame(w, 8);
      w.emit("bestmove e2e4");
      expect(results.at(-1).id).toBe(latest);
      const searches = w.commands.filter((c) => c.startsWith("go ")).length;
      await e.analyze(START_FEN, legit);
      expect(w.commands.filter((c) => c.startsWith("go "))).toHaveLength(
        searches + 1,
      );
      frame(w, 8);
      w.emit("bestmove e2e4");
      await e.analyze(START_FEN, defaults);
      expect(w.commands.slice(-4)).toEqual([
        `setoption name Hash value ${defaults.hash}`,
        `setoption name MultiPV value ${defaults.multiPV}`,
        `position fen ${START_FEN}`,
        `go depth ${defaults.depth} movetime ${defaults.time}`,
      ]);
    } finally {
      e.dispose();
    }
  });
});
