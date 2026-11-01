import { Chess } from "chess.js";
import { validatePosition } from "../chess/position";
import { selectTrainingMove, strengthProfile } from "./legit";
import {
  defaults,
  type Candidate,
  type SearchResult,
  type Settings,
} from "../types";
export function parseInfo(line: string): Candidate | undefined {
  if (!line.startsWith("info ") || !line.includes(" pv ")) return;
  const value = (key: string) =>
    Number(line.match(new RegExp(`(?:^| )${key} (\\d+)`))?.[1] || 0);
  const score = line.match(
    / score (cp|mate) (-?\d+)(?: (lowerbound|upperbound))?/,
  );
  if (!score) return;
  return {
    rank: value("multipv") || 1,
    depth: value("depth"),
    cp: score[1] === "cp" ? +score[2] : undefined,
    mate: score[1] === "mate" ? +score[2] : undefined,
    bound: score[3],
    pv: line.split(" pv ")[1].trim().split(/\s+/),
    nodes: value("nodes"),
    time: value("time"),
    nps: value("nps"),
  };
}
export interface EngineWorker {
  postMessage(data: string): void;
  terminate(): void;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}
interface Request {
  id: number;
  fen: string;
  settings: Settings;
  attempt: number;
}
export class Engine {
  private worker?: EngineWorker;
  private ready?: Promise<void>;
  private resolveReady?: () => void;
  private rejectReady?: (e: Error) => void;
  private generation = 0;
  private serial = 0;
  private active?: {
    request: Request;
    lines: Map<number, Candidate>;
    candidateCount: number;
    completedLines?: Candidate[];
  };
  private pending?: Request;
  private stopping = false;
  private startupTimer?: ReturnType<typeof setTimeout>;
  private searchTimer?: ReturnType<typeof setTimeout>;
  private stopTimer?: ReturnType<typeof setTimeout>;
  private cache = new Map<string, Candidate[]>();
  onResult: (r: SearchResult) => void = () => {};
  onStatus: (s: string) => void = () => {};
  onError: (message: string) => void = () => {};
  constructor(
    private factory: () => EngineWorker = () =>
      new Worker(
        new URL("engine/stockfish.js", document.baseURI).href,
      ) as unknown as EngineWorker,
  ) {}
  private key(fen: string, s: Settings) {
    return JSON.stringify([fen, s.preset, s.depth, s.time, s.multiPV, s.hash]);
  }
  load(): Promise<void> {
    if (this.ready) return this.ready;
    this.onStatus("Loading engine…");
    const ready = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.ready = ready;
    const generation = ++this.generation;
    try {
      this.worker = this.factory();
      this.worker.onmessage = (e) => {
        if (generation === this.generation)
          String(e.data)
            .split("\n")
            .forEach((line) => this.receive(line.trim()));
      };
      this.worker.onerror = (e) => {
        if (generation === this.generation)
          this.failure(new Error(e.message || "The engine could not load."));
      };
      this.startupTimer = setTimeout(
        () => this.failure(new Error("The engine took too long to load.")),
        12000,
      );
      this.worker.postMessage("uci");
    } catch (e) {
      this.failure(e as Error);
    }
    // Keep a local promise: a synchronous worker failure clears this.ready.
    return ready;
  }
  private destroy() {
    ++this.generation;
    clearTimeout(this.startupTimer);
    clearTimeout(this.searchTimer);
    clearTimeout(this.stopTimer);
    this.worker?.terminate();
    this.worker = undefined;
    this.ready = undefined;
    this.resolveReady = undefined;
    this.rejectReady = undefined;
    this.active = undefined;
    this.stopping = false;
  }
  private failure(error: Error) {
    const reject = this.rejectReady,
      request = this.pending || this.active?.request;
    this.destroy();
    this.pending = undefined;
    if (reject) reject(error);
    else if (request && request.id === this.serial)
      void this.recover(request, error);
    else this.onStatus("Engine ready");
  }
  private async recover(request: Request, error: Error) {
    if (request.id !== this.serial) return;
    if (request.attempt >= 1) {
      this.onStatus("Engine needs a retry");
      this.onError(
        "Could not analyze this position. Choose Retry to restart the engine.",
      );
      return;
    }
    request.attempt++;
    this.onStatus("Restarting engine…");
    this.destroy();
    this.pending = request;
    try {
      await this.ensure(request);
    } catch (e) {
      if (request.id === this.serial) {
        this.destroy();
        this.pending = undefined;
        this.onStatus("Engine needs a retry");
        this.onError(
          `Could not start the engine. Choose Retry. (${(e as Error).message || error.message})`,
        );
      }
    }
  }
  private async ensure(request: Request) {
    await this.load();
    if (request.id !== this.serial) return;
    if (this.active) {
      if (!this.stopping) this.stop();
    } else this.startPending();
  }
  async analyze(fen: string, settings: Settings): Promise<number> {
    const invalid = validatePosition(fen);
    if (invalid) throw new Error(`Check the position: ${invalid}`);
    const bounded = (
      value: number,
      min: number,
      max: number,
      fallback: number,
    ) =>
      Number.isFinite(value)
        ? Math.max(min, Math.min(max, Math.round(value)))
        : fallback;
    settings = {
      ...settings,
      hash: bounded(settings.hash, 8, 128, defaults.hash),
      multiPV: bounded(settings.multiPV, 1, 3, defaults.multiPV),
      depth: bounded(settings.depth, 1, 60, defaults.depth),
      time: bounded(settings.time, 100, 120000, defaults.time),
    };
    const id = ++this.serial,
      request = { id, fen, settings: { ...settings }, attempt: 0 };
    this.pending = request;
    // Training choices are sampled anew, never replayed from analysis cache.
    const cached = strengthProfile(settings)
      ? undefined
      : this.cache.get(this.key(fen, settings));
    if (cached) {
      this.pending = undefined;
      if (this.active && !this.stopping) this.stop();
      queueMicrotask(() => {
        if (id === this.serial) {
          this.onResult({ id, fen, lines: cached, finished: true });
          this.onStatus("Ready");
        }
      });
      return id;
    }
    try {
      await this.ensure(request);
    } catch (e) {
      await this.recover(request, e as Error);
    }
    return id;
  }
  private stop() {
    if (!this.active || this.stopping) return;
    this.stopping = true;
    clearTimeout(this.searchTimer);
    this.worker?.postMessage("stop");
    this.stopTimer = setTimeout(
      () => this.failure(new Error("The previous engine search did not stop.")),
      2500,
    );
  }
  private legal(fen: string, move: string) {
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) return false;
    try {
      new Chess(fen).move({
        from: move.slice(0, 2),
        to: move.slice(2, 4),
        promotion: move[4],
      });
      return true;
    } catch {
      return false;
    }
  }
  private receive(line: string) {
    if (line === "uciok") {
      this.worker?.postMessage("isready");
      return;
    }
    if (line === "readyok") {
      clearTimeout(this.startupTimer);
      const resolve = this.resolveReady;
      this.resolveReady = undefined;
      this.rejectReady = undefined;
      resolve?.();
      this.onStatus("Engine ready");
      return;
    }
    if (line.startsWith("bestmove")) {
      clearTimeout(this.searchTimer);
      clearTimeout(this.stopTimer);
      const active = this.active,
        wasStopping = this.stopping;
      this.active = undefined;
      this.stopping = false;
      if (active && !wasStopping && active.request.id === this.serial) {
        const { id, fen, settings } = active.request;
        let lines = [...active.lines.values()].sort((a, b) => a.rank - b.rank);
        const move = line.split(/\s+/)[1];
        const profile = strengthProfile(settings);
        if (profile) {
          // A completed older frame must not hide a mate that the final
          // bestmove has since proved (including a newly discovered forced loss).
          const finalMate = lines.find(
            (l) => l.pv[0] === move && l.mate !== undefined && !l.bound,
          );
          lines = selectTrainingMove(
            fen,
            finalMate ? [finalMate] : (active.completedLines ?? []),
            profile,
          );
        }
        // Some valid UCI searches only emit bestmove; make that visible too.
        if (!lines.length && this.legal(fen, move))
          lines = [
            { rank: 1, depth: 0, pv: [move], nodes: 0, time: 0, nps: 0 },
          ];
        if (!lines.length) {
          void this.recover(
            active.request,
            new Error("The engine returned no legal move."),
          );
          return;
        }
        if (!profile && settings.preset !== "infinite") {
          this.cache.set(this.key(fen, settings), lines);
          if (this.cache.size > 32)
            this.cache.delete(this.cache.keys().next().value!);
        }
        this.onResult({ id, fen, lines, finished: true });
      }
      if (this.pending) this.startPending();
      else this.onStatus("Ready");
      return;
    }
    if (
      this.active &&
      !this.stopping &&
      this.active.request.id === this.serial
    ) {
      const info = parseInfo(line),
        { id, fen } = this.active.request;
      if (info && this.legal(fen, info.pv[0])) {
        this.active.lines.set(info.rank, info);
        if (strengthProfile(this.active.request.settings)) {
          const lines = [...this.active.lines.values()];
          if (
            lines.length === this.active.candidateCount &&
            lines.every((l) => l.depth === info.depth && !l.bound)
          )
            this.active.completedLines = lines.sort((a, b) => a.rank - b.rank);
          return;
        }
        this.onResult({
          id,
          fen,
          lines: [...this.active.lines.values()].sort(
            (a, b) => a.rank - b.rank,
          ),
          finished: false,
        });
      }
    }
  }
  private startPending() {
    const request = this.pending;
    this.pending = undefined;
    if (!request || request.id !== this.serial || !this.worker) return;
    const s = request.settings;
    const profile = strengthProfile(s);
    const candidateCount = profile
      ? Math.min(profile.candidates, new Chess(request.fen).moves().length)
      : Math.max(1, Math.min(3, s.multiPV));
    this.active = { request, lines: new Map(), candidateCount };
    this.worker.postMessage(
      `setoption name Hash value ${Math.max(8, Math.min(128, s.hash))}`,
    );
    this.worker.postMessage(`setoption name MultiPV value ${candidateCount}`);
    // Prevent deeper analysis or stronger presets from supplying cached
    // tactical knowledge to a weaker training search at this position.
    if (profile) this.worker.postMessage("setoption name Clear Hash");
    this.worker.postMessage(`position fen ${request.fen}`);
    const ms = Math.max(100, Math.min(120000, s.time)),
      depth = profile?.depth ?? Math.max(1, Math.min(60, s.depth));
    this.worker.postMessage(
      `go ${profile ? `depth ${depth} nodes ${profile.nodes} movetime ${ms}` : s.preset === "infinite" ? "infinite" : `depth ${depth} movetime ${ms}`}`,
    );
    this.onStatus("Thinking…");
    if (profile || s.preset !== "infinite")
      this.searchTimer = setTimeout(
        () => this.failure(new Error("The engine did not finish this search.")),
        ms + 5000,
      );
  }
  cancel() {
    ++this.serial;
    this.pending = undefined;
    this.stop();
  }
  reset() {
    this.cancel();
    const reject = this.rejectReady;
    this.destroy();
    reject?.(new Error("Analysis was restarted."));
    this.cache.clear();
  }
  dispose() {
    this.reset();
  }
}
export function whiteScore(line: Candidate, fen: string): number {
  const sign = fen.split(" ")[1] === "w" ? 1 : -1;
  return (
    (line.mate !== undefined
      ? line.mate > 0
        ? 10000
        : -10000
      : line.cp || 0) * sign
  );
}
export function scoreText(line: Candidate, fen: string): string {
  if (line.mate !== undefined) {
    const white = whiteScore(line, fen) > 0;
    return `${white ? "+" : "−"}M${Math.abs(line.mate)}`;
  }
  const score = whiteScore(line, fen) / 100;
  return `${score > 0 ? "+" : ""}${score.toFixed(2)}`;
}
