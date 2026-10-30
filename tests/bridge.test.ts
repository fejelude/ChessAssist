// @vitest-environment jsdom
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { Chess } from "chess.js";
const start = new Chess().fen();
let listener: any;
let workers: any[] = [];
const detection = (fen = start) => ({
  fen,
  method: "fen",
  confidence: 1,
  issues: [],
  orientation: "w",
  viewport: { width: 800, height: 800 },
  url: "https://practice.test",
  timestamp: Date.now(),
});
beforeEach(() => {
  vi.resetModules();
  workers = [];
  vi.doMock("../src/recognition/templates", () => ({
    defaultTemplates: async () => [],
  }));
  vi.stubGlobal("chrome", {
    runtime: {
      id: "qa",
      onMessage: {
        addListener: (fn: any) => (listener = fn),
        removeListener: () => {},
      },
      connect: () => ({ postMessage: () => {}, disconnect: () => {} }),
      sendMessage: async (m: any) =>
        m.type === "CA_SCAN"
          ? { ok: true, detection: detection() }
          : m.type === "CA_CAPTURE"
            ? { ok: true, url: "data:image/png;base64," }
            : { ok: true },
    },
    tabs: {
      query: async () => [{ id: 1, url: "https://practice.test/board" }],
      onActivated: { addListener: () => {}, removeListener: () => {} },
      onUpdated: { addListener: () => {}, removeListener: () => {} },
    },
    storage: { local: { get: async () => ({}), set: async () => {} } },
  });
  vi.stubGlobal(
    "Worker",
    class {
      onmessage: any;
      onerror: any;
      messages: any[] = [];
      constructor() {
        workers.push(this);
      }
      postMessage(m: any) {
        this.messages.push(m);
      }
      terminate() {}
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock("../src/recognition/templates");
});
it("connects automatically and reconciles actual source moves without duplicate notifications", async () => {
  const { SourceBridge } = await import("../src/extension/bridge");
  const s = new SourceBridge(),
    positions: string[] = [];
  s.onPosition = (fen) => positions.push(fen);
  try {
    await s.start();
    expect(positions).toEqual([start]);
    const c = new Chess();
    c.move("d4");
    listener(
      { type: "CA_DETECTION", detection: detection(c.fen()) },
      { tab: { id: 1 } },
    );
    expect(positions.at(-1)).toBe(c.fen());
    listener(
      { type: "CA_DETECTION", detection: detection(c.fen()) },
      { tab: { id: 1 } },
    );
    expect(positions).toHaveLength(2);
  } finally {
    s.dispose();
  }
});
it("does not let a delayed image result overwrite a newer DOM position", async () => {
  const { SourceBridge } = await import("../src/extension/bridge");
  const s = new SourceBridge(),
    positions: string[] = [];
  s.onPosition = (fen) => positions.push(fen);
  try {
    await s.start();
    listener(
      {
        type: "CA_DETECTION",
        detection: {
          ...detection(),
          fen: undefined,
          placement: undefined,
          method: "visual",
        },
      },
      { tab: { id: 1 } },
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(workers).toHaveLength(1);
    const pending = workers[0].messages[0];
    const c = new Chess();
    c.move("e4");
    listener(
      { type: "CA_DETECTION", detection: detection(c.fen()) },
      { tab: { id: 1 } },
    );
    workers[0].onmessage({ data: { id: pending.id, error: "obsolete" } });
    expect(s.lastFen).toBe(c.fen());
    expect(positions.at(-1)).toBe(c.fen());
  } finally {
    s.dispose();
  }
});
it("does not invent a midgame turn or castling rights when metadata is absent", async () => {
  const { resolveSource } = await import("../src/extension/bridge");
  const c = new Chess();
  c.move("e4");
  const d = {
    ...detection(),
    fen: undefined,
    placement: c.fen().split(" ")[0],
  };
  const r = resolveSource(undefined, d as any);
  expect(r.fen).toBeUndefined();
  expect(r.issues.join(" ")).toContain("turn");
  expect(
    resolveSource(undefined, { ...d, placement: start.split(" ")[0] } as any)
      .fen,
  ).toBe(start);
});
