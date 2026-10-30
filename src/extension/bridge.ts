import type {
  Detection,
  Orientation,
  RecognitionResult,
  Template,
  PieceMap,
} from "../types";
import {
  START_FEN,
  mapToPlacement,
  placementToMap,
  reconcile,
  squareAt,
} from "../chess/position";
import { defaultTemplates } from "../recognition/templates";
export const isExtension =
  typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
export interface SourceProblem {
  message: string;
  detection?: Detection;
  visual?: RecognitionResult;
  snapshot?: string;
}
export function resolveSource(previous: string | undefined, d: Detection) {
  if (
    !d.ambiguous &&
    d.placement === START_FEN.split(" ")[0] &&
    d.orientation &&
    !d.turn &&
    !previous
  )
    return { fen: START_FEN, issues: [] };
  return reconcile(previous, d);
}
export class SourceBridge {
  private tab?: number;
  private origin = "";
  private url = "";
  private polling = false;
  private generation = 0;
  private session = 0;
  private connecting = false;
  private stopped = true;
  private port?: chrome.runtime.Port;
  private heartbeat?: ReturnType<typeof setInterval>;
  private worker?: Worker;
  private templates: Template[] = [];
  private learned: Template[] = [];
  private lastSignature = "";
  private captureTime = 0;
  private orientation?: Orientation;
  private pending?: { id: number; d: Detection; url: string };
  lastFen?: string;
  lastDetection?: Detection;
  lastVisual?: RecognitionResult;
  lastSnapshot?: string;
  onPosition: (fen: string, d: Detection) => void = () => {};
  onProblem: (p: SourceProblem) => void = () => {};
  onStatus: (s: string) => void = () => {};
  onInvalidate: () => void = () => {};
  private receive = (message: any, sender: chrome.runtime.MessageSender) => {
    if (
      !this.stopped &&
      !this.connecting &&
      sender.tab?.id === this.tab &&
      message.type === "CA_DETECTION"
    )
      void this.process(message.detection);
  };
  private activation = () => {
    if (!this.stopped) void this.start();
  };
  private navigation = (id: number, change: { status?: string }) => {
    if (!this.stopped && id === this.tab && change.status === "complete")
      void this.start();
  };
  constructor() {
    if (isExtension) {
      chrome.runtime.onMessage.addListener(this.receive);
      chrome.tabs.onActivated.addListener(this.activation);
      chrome.tabs.onUpdated.addListener(this.navigation);
    }
    void defaultTemplates()
      .then((t) => {
        this.templates = t;
      })
      .catch(() => {});
  }
  private async call(type: string, extra = {}) {
    const response = await chrome.runtime.sendMessage({
      type,
      tabId: this.tab,
      ...extra,
    });
    if (!response?.ok)
      throw new Error(
        response?.error || "The webpage did not respond. Try reconnecting.",
      );
    return response;
  }
  async start(polling = this.polling, region = false) {
    this.polling = polling;
    this.stop();
    this.stopped = false;
    this.connecting = true;
    const id = ++this.session;
    if (!isExtension) {
      this.onProblem({
        message:
          "Open Chess Assist from its Chrome toolbar icon to read a webpage. Or choose Practice board in the menu.",
      });
      return;
    }
    try {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (id !== this.session) return;
      if (!tab?.id) throw new Error("Open a webpage with a chessboard first.");
      if (tab.id !== this.tab || tab.url !== this.url) {
        this.lastFen = undefined;
        this.orientation = undefined;
        this.lastSignature = "";
        this.lastDetection = undefined;
        this.lastVisual = undefined;
        this.lastSnapshot = undefined;
        this.onInvalidate();
      }
      this.tab = tab.id;
      this.url = tab.url || "";
      this.origin = tab.url ? new URL(tab.url).origin : "";
      const stored = (
        await chrome.storage.local.get(`templates:${this.origin}`)
      )[`templates:${this.origin}`];
      this.learned = Array.isArray(stored) ? (stored as Template[]) : [];
      if (id !== this.session) return;
      this.port = chrome.runtime.connect({ name: "chess-assist-panel" });
      this.port.postMessage({ type: "BIND", tabId: this.tab });
      this.onStatus("Finding the board…");
      const response = await this.call(region ? "CA_SELECT" : "CA_SCAN");
      if (id !== this.session) return;
      this.connecting = false;
      if (region) this.onStatus("Drag around the board on the webpage.");
      else await this.process(response.detection);
      if (this.stopped) return;
      const ping = () => {
        void this.call("CA_MONITOR", { visualPolling: polling }).catch((e) => {
          if (!this.stopped) this.onProblem({ message: e.message });
        });
      };
      ping();
      this.heartbeat = setInterval(ping, 10000);
    } catch (e) {
      if (id === this.session && !this.stopped)
        this.onProblem({ message: (e as Error).message });
    }
  }
  async select() {
    try {
      await this.call("CA_SELECT");
      this.onStatus("Drag around the board on the webpage.");
    } catch (e) {
      this.onProblem({ message: (e as Error).message });
    }
  }
  private async process(input: Detection) {
    if (this.stopped) return;
    ++this.generation;
    let d = { ...input };
    if (!d.orientation && this.orientation) {
      if (d.placement && this.orientation === "b") {
        const map = placementToMap(d.placement),
          rotated: PieceMap = {};
        for (let r = 0; r < 8; r++)
          for (let c = 0; c < 8; c++) {
            const p = map[squareAt(r, c, "w")];
            if (p) rotated[squareAt(r, c, "b")] = p;
          }
        d.placement = mapToPlacement(rotated);
      }
      d.orientation = this.orientation;
    }
    if (d.fen || d.placement || d.ambiguous) {
      this.accept(d);
      return;
    }
    const id = this.generation;
    const delay = 850 - (Date.now() - this.captureTime);
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    if (this.stopped || id !== this.generation) return;
    try {
      this.captureTime = Date.now();
      const response = await this.call("CA_CAPTURE");
      if (id !== this.generation) return;
      this.pending = { id, d, url: response.url };
      if (!this.worker) {
        this.worker = new Worker(
          new URL("../recognition/vision.worker.ts", import.meta.url),
          { type: "module" },
        );
        this.worker.onmessage = (e) => {
          const pending = this.pending;
          if (
            !pending ||
            this.stopped ||
            pending.id !== e.data.id ||
            pending.id !== this.generation
          )
            return;
          if (e.data.error) {
            this.onInvalidate();
            this.lastDetection = pending.d;
            this.onProblem({
              message:
                "Could not read the board. Choose Select board or Correct Position.",
              detection: pending.d,
            });
            return;
          }
          const visual = e.data.result as RecognitionResult,
            map: PieceMap = {};
          for (const cell of visual.cells)
            if (cell.code)
              map[squareAt(cell.row, cell.col, pending.d.orientation || "w")] =
                cell.code;
          this.accept(
            {
              ...pending.d,
              bounds: visual.bounds,
              method: "visual",
              placement: mapToPlacement(map),
              ambiguous: visual.issues.length > 0,
              issues: visual.issues,
            },
            visual,
            pending.url,
          );
        };
        this.worker.onerror = () => {
          this.onInvalidate();
          this.onProblem({
            message:
              "Could not read this board image. Correct the position or reconnect.",
          });
          this.worker?.terminate();
          this.worker = undefined;
        };
      }
      this.worker.postMessage({
        id,
        url: response.url,
        bounds: d.bounds,
        viewport: d.viewport,
        templates: [...this.templates, ...this.learned],
      });
    } catch (e) {
      if (id === this.generation && !this.stopped) {
        this.onInvalidate();
        this.onProblem({ message: (e as Error).message });
      }
    }
  }
  private accept(d: Detection, visual?: RecognitionResult, snapshot?: string) {
    const signature = JSON.stringify([
      d.fen,
      d.placement,
      d.turn,
      d.orientation,
      d.castling,
      d.ep,
      d.ambiguous,
    ]);
    this.lastDetection = d;
    this.lastVisual = visual;
    this.lastSnapshot = snapshot;
    if (signature === this.lastSignature) return;
    this.lastSignature = signature;
    const resolved = resolveSource(this.lastFen, d);
    if (resolved.fen) {
      if (resolved.fen !== this.lastFen) this.onInvalidate();
      this.lastFen = resolved.fen;
      this.onPosition(resolved.fen, d);
    } else {
      this.onInvalidate();
      this.onProblem({
        message: d.ambiguous
          ? "Some pieces are unclear. Choose Correct Position."
          : "Check the pieces and whose turn it is in Correct Position.",
        detection: d,
        visual,
        snapshot,
      });
    }
  }
  confirm(fen: string, orientation: Orientation, templates: Template[]) {
    ++this.generation;
    this.orientation = orientation;
    this.lastFen = fen;
    this.lastSignature = "";
    this.lastDetection = {
      ...this.lastDetection!,
      fen,
      placement: fen.split(" ")[0],
      orientation,
      turn: fen.split(" ")[1] as "w" | "b",
      castling: fen.split(" ")[2],
      ep: fen.split(" ")[3],
      issues: [],
      ambiguous: false,
    };
    if (isExtension && templates.length) {
      this.learned = [...this.learned, ...templates].slice(-192);
      void chrome.storage.local
        .set({ [`templates:${this.origin}`]: this.learned })
        .catch(() => {});
    }
  }
  stop() {
    ++this.session;
    this.connecting = false;
    this.stopped = true;
    ++this.generation;
    clearInterval(this.heartbeat);
    this.port?.disconnect();
    this.port = undefined;
    this.worker?.terminate();
    this.worker = undefined;
  }
  dispose() {
    this.stop();
    if (isExtension) {
      chrome.runtime.onMessage.removeListener(this.receive);
      chrome.tabs.onActivated.removeListener(this.activation);
      chrome.tabs.onUpdated.removeListener(this.navigation);
    }
  }
}
