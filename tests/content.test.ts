// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { START_FEN } from "../src/chess/position";

let listener: (message: any, sender: any, respond: any) => void;
let root: HTMLElement;
let scan: ReturnType<typeof vi.fn>;
let send: ReturnType<typeof vi.fn>;
function message(type: string, extra = {}) {
  const respond = vi.fn();
  listener({ type, ...extra }, {}, respond);
  return respond.mock.calls[0]?.[0];
}
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  document.body.replaceChildren();
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
  root = document.createElement("div");
  document.body.append(root);
  scan = vi.fn(() => ({
    target: root,
    candidates: [],
    detection: {
      fen: START_FEN,
      method: "fen",
      confidence: 1,
      issues: [],
      viewport: { width: 800, height: 800 },
      url: "https://practice.test",
      timestamp: Date.now(),
    },
  }));
  vi.doMock("../src/recognition/dom", async () => ({
    ...(await vi.importActual<typeof import("../src/recognition/dom")>(
      "../src/recognition/dom",
    )),
    detectDocument: scan,
  }));
  send = vi.fn().mockResolvedValue({});
  vi.stubGlobal("chrome", {
    runtime: {
      sendMessage: send,
      onMessage: {
        addListener: (fn: typeof listener) => {
          listener = fn;
        },
      },
    },
  });
  delete (globalThis as any).__chessAssist;
  await import("../src/extension/content");
  message("CA_SCAN");
});
afterEach(() => {
  message("CA_STOP");
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.doUnmock("../src/recognition/dom");
  delete (globalThis as any).__chessAssist;
});
it("monitors mutations inside a board's open shadow root", async () => {
  const shadow = root.attachShadow({ mode: "open" });
  const piece = document.createElement("span");
  shadow.append(piece);
  message("CA_MONITOR");
  piece.setAttribute("data-piece", "wp");
  await vi.advanceTimersByTimeAsync(500);
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({ type: "CA_DETECTION" }),
  );
});
it("discovers a shadow root attached after monitoring starts", async () => {
  message("CA_MONITOR");
  root.attachShadow({ mode: "open" }).append(document.createElement("span"));
  await vi.advanceTimersByTimeAsync(2500);
  expect(scan).toHaveBeenCalledTimes(2);
});
it("deduplicates unchanged full FEN observations", async () => {
  message("CA_MONITOR");
  document.dispatchEvent(new Event("pointerup"));
  await vi.advanceTimersByTimeAsync(500);
  document.dispatchEvent(new Event("pointerup"));
  await vi.advanceTimersByTimeAsync(500);
  expect(scan).toHaveBeenCalledTimes(3);
  expect(send).toHaveBeenCalledTimes(1);
});
it("does not starve detection under continuous mutations", async () => {
  message("CA_MONITOR");
  for (let i = 0; i < 12; i++) {
    root.setAttribute("data-turn", i % 2 ? "w" : "b");
    await vi.advanceTimersByTimeAsync(100);
  }
  expect(scan.mock.calls.length).toBeGreaterThanOrEqual(3);
});
it("refreshes on visibility restoration and stops all work after disconnect", async () => {
  message("CA_MONITOR");
  message("CA_MONITOR");
  expect(vi.getTimerCount()).toBe(1);
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(500);
  expect(scan).toHaveBeenCalledTimes(2);
  message("CA_SELECT");
  expect(
    document.getElementById("chess-assist-region-selector"),
  ).not.toBeNull();
  message("CA_STOP");
  expect(document.getElementById("chess-assist-region-selector")).toBeNull();
  root.setAttribute("data-turn", "b");
  document.dispatchEvent(new Event("pointerup"));
  await vi.advanceTimersByTimeAsync(40000);
  expect(scan).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});
it("cancels delayed region scans when manual control takes over", () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    frames.push(cb);
    return frames.length;
  });
  message("CA_SELECT");
  const overlay = document.getElementById("chess-assist-region-selector")!;
  overlay.setPointerCapture = vi.fn();
  overlay.dispatchEvent(
    new MouseEvent("pointerdown", { clientX: 10, clientY: 10 }),
  );
  overlay.dispatchEvent(
    new MouseEvent("pointermove", { clientX: 300, clientY: 300 }),
  );
  overlay.dispatchEvent(
    new MouseEvent("pointerup", { clientX: 300, clientY: 300 }),
  );
  message("CA_STOP");
  while (frames.length) frames.shift()!(0);
  expect(scan).toHaveBeenCalledTimes(1);
  expect(send).not.toHaveBeenCalled();
});
it("reports selection cancellation and removes the Escape listener", () => {
  message("CA_SELECT");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(send).toHaveBeenCalledWith({ type: "CA_SELECTION_CANCELLED" });
  expect(document.getElementById("chess-assist-region-selector")).toBeNull();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(send).toHaveBeenCalledTimes(1);
});

it("keeps capturing canvas updates when the DOM metadata is unchanged", async () => {
  scan.mockImplementation(
    () =>
      ({
        target: root,
        candidates: [],
        detection: {
          method: "visual",
          confidence: 0,
          issues: [],
          viewport: { width: 800, height: 800 },
          url: "https://practice.test",
          timestamp: Date.now(),
        },
      }) as any,
  );
  message("CA_SCAN");
  message("CA_MONITOR", { visualPolling: true });
  await vi.advanceTimersByTimeAsync(5000);
  expect(send).toHaveBeenCalledTimes(2);
});
