// @vitest-environment jsdom
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { Chess } from "chess.js";
const start = new Chess().fen();
let listener: any;
let navigate: any;
let activate: any;
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
      query: async () => [
        { id: 1, windowId: 10, url: "https://practice.test/board" },
      ],
      onActivated: {
        addListener: (fn: any) => {
          activate = fn;
        },
        removeListener: () => {},
      },
      onUpdated: {
        addListener: (fn: any) => {
          navigate = fn;
        },
        removeListener: () => {},
      },
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

it("publishes the unchanged board when explicitly reconnecting", async () => {
  const { SourceBridge } = await import("../src/extension/bridge");
  const s = new SourceBridge(),
    positions: string[] = [];
  s.onPosition = (fen) => positions.push(fen);
  try {
    await s.start();
    s.stop();
    await s.start();
    expect(positions).toEqual([start, start]);
  } finally {
    s.dispose();
  }
});
it("honors explicit no-castling metadata in a starting-looking position", async () => {
  const { resolveSource } = await import("../src/extension/bridge");
  const r = resolveSource(undefined, {
    ...detection(),
    fen: undefined,
    placement: start.split(" ")[0],
    castling: "-",
    ep: "-",
  } as any);
  expect(r.fen).toBeUndefined();
  expect(r.issues.join(" ")).toContain("turn");
});

it("invalidates on reload before accepting any further source messages", async () => {
  const { SourceBridge } = await import("../src/extension/bridge");
  const s = new SourceBridge(),
    invalidate = vi.fn(),
    positions = vi.fn();
  s.onInvalidate = invalidate;
  s.onPosition = positions;
  try {
    await s.start();
    invalidate.mockClear();
    positions.mockClear();
    navigate(1, { status: "loading" });
    expect(invalidate).toHaveBeenCalledOnce();
    expect(s.lastFen).toBeUndefined();
    listener(
      { type: "CA_DETECTION", detection: detection() },
      { tab: { id: 1 } },
    );
    expect(positions).not.toHaveBeenCalled();
    navigate(1, { status: "complete" });
    await vi.waitFor(() => expect(positions).toHaveBeenCalledOnce());
  } finally {
    s.dispose();
  }
});
it("ignores activation events from another Chrome window and iframe detections", async () => {
  const { SourceBridge } = await import("../src/extension/bridge");
  const s = new SourceBridge(),
    positions = vi.fn();
  s.onPosition = positions;
  const query = vi.spyOn(chrome.tabs, "query");
  try {
    await s.start();
    query.mockClear();
    positions.mockClear();
    activate({ windowId: 20 });
    listener(
      { type: "CA_DETECTION", detection: detection() },
      { tab: { id: 1 }, frameId: 4 },
    );
    expect(query).not.toHaveBeenCalled();
    expect(positions).not.toHaveBeenCalled();
  } finally {
    s.dispose();
    query.mockRestore();
  }
});
it("ignores an obsolete heartbeat rejection after a new connection starts", async () => {
  const { SourceBridge } = await import("../src/extension/bridge");
  const s = new SourceBridge(),
    problems = vi.fn();
  s.onProblem = problems;
  let rejectPing: (error: Error) => void = () => {};
  const original = chrome.runtime.sendMessage;
  let first = true;
  (chrome.runtime as any).sendMessage = (m: any) => {
    if (m.type === "CA_MONITOR" && first) {
      first = false;
      return new Promise((_r, reject) => {
        rejectPing = reject;
      });
    }
    return original(m);
  };
  try {
    await s.start();
    await s.start();
    rejectPing(new Error("old port"));
    await Promise.resolve();
    await Promise.resolve();
    expect(problems).not.toHaveBeenCalled();
  } finally {
    s.dispose();
  }
});
it("stops obsolete worker errors from invalidating a newer DOM position", async () => {
  const { SourceBridge } = await import("../src/extension/bridge");
  const s = new SourceBridge(),
    problems = vi.fn();
  s.onProblem = problems;
  try {
    await s.start();
    listener(
      { type: "CA_DETECTION", detection: { ...detection(), fen: undefined } },
      { tab: { id: 1 } },
    );
    await new Promise((r) => setTimeout(r, 0));
    const c = new Chess();
    c.move("e4");
    listener(
      { type: "CA_DETECTION", detection: detection(c.fen()) },
      { tab: { id: 1 } },
    );
    workers[0].onerror({ message: "obsolete" });
    expect(s.lastFen).toBe(c.fen());
    expect(problems).not.toHaveBeenCalled();
  } finally {
    s.dispose();
  }
});

it("falls back when a visual worker never responds and cancels its watchdog on stop", async () => {
  vi.useFakeTimers();
  const { SourceBridge } = await import("../src/extension/bridge");
  const s = new SourceBridge(),
    problems = vi.fn();
  s.onProblem = problems;
  try {
    await s.start();
    listener(
      { type: "CA_DETECTION", detection: { ...detection(), fen: undefined } },
      { tab: { id: 1 } },
    );
    await vi.advanceTimersByTimeAsync(1000);
    expect(workers).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(12000);
    expect(problems).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("timed out"),
      }),
    );
    s.stop();
    problems.mockClear();
    await vi.advanceTimersByTimeAsync(40000);
    expect(problems).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    s.dispose();
    vi.useRealTimers();
  }
});

it("persists confirmed piece-style templates for their source origin", async () => {
  const { SourceBridge } = await import("../src/extension/bridge");
  const s = new SourceBridge(),
    save = vi.spyOn(chrome.storage.local, "set");
  try {
    await s.start();
    const templates = [{ code: "wk" as const, feature: Array(578).fill(0) }];
    s.confirm(start, "w", templates);
    expect(save).toHaveBeenCalledWith({
      "templates:https://practice.test": templates,
    });
  } finally {
    s.dispose();
    save.mockRestore();
  }
});
