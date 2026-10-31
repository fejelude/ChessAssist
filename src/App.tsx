import { useEffect, useRef, useState, useReducer } from "react";
import { Chess, type Color, type Square, type PieceSymbol } from "chess.js";
import {
  Settings2,
  Pause,
  Play,
  RefreshCw,
  X,
  Undo2,
  LoaderCircle,
} from "lucide-react";
import { Board } from "./ui/Board";
import { workspaceReducer, initialWorkspace } from "./chess/workspace";
import { PositionEditor, type EditorHandle } from "./ui/PositionEditor";
import { Engine } from "./engine/uci";
import {
  defaults,
  type Detection,
  type Template,
  type Candidate,
} from "./types";
import {
  START_FEN,
  terminalMessage,
  validatePosition,
  playUci,
} from "./chess/position";
import {
  SourceBridge,
  isExtension,
  type SourceProblem,
} from "./extension/bridge";
import "./style.css";
const pieceNames: Record<string, string> = {
  p: "Pawn",
  n: "Knight",
  b: "Bishop",
  r: "Rook",
  q: "Queen",
  k: "King",
};
const title = (c: Color) => (c === "w" ? "White" : "Black");
export default function App() {
  const [workspace, dispatch] = useReducer(workspaceReducer, initialWorkspace);
  const { fen, history, manual: practice } = workspace;
  const editor = workspace.mode === "edit";
  const editorController = useRef<EditorHandle>(null);
  const regionRequest = useRef(false);
  const [color, setColor] = useState<Color>("w");
  const [running, setRunning] = useState(true),
    [valid, setValid] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);
  const [loaded, setLoaded] = useState(false),
    [line, setLine] = useState<Candidate>(),
    [status, setStatus] = useState("Finding the board…");
  const [error, setError] = useState(""),
    [problem, setProblem] = useState<SourceProblem>(),
    [menu, setMenu] = useState(false);
  const [promotion, setPromotion] = useState<{ from: Square; to: Square }>();
  const [polling, setPolling] = useState(false),
    [budget, setBudget] = useState(1800),
    [retry, setRetry] = useState(0);
  const [importText, setImportText] = useState(""),
    [importError, setImportError] = useState("");
  const engine = useRef<Engine>(null),
    source = useRef<SourceBridge>(null);
  const state = useRef({ fen, color, running, practice, valid, editor });
  state.current = {
    fen,
    color,
    running: running && panelOpen,
    practice,
    valid,
    editor,
  };
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const terminal = terminalMessage(fen),
    turn = new Chess(fen).turn();
  const recommendation =
    valid && running && !editor && turn === color && !terminal
      ? line
      : undefined;
  const notation = recommendation
    ? playUci(fen, recommendation.pv[0])?.san
    : undefined;
  const description = recommendation
    ? (() => {
        try {
          const c = new Chess(fen),
            m = c.move({
              from: recommendation.pv[0].slice(0, 2),
              to: recommendation.pv[0].slice(2, 4),
              promotion: recommendation.pv[0][4],
            });
          return m.isKingsideCastle()
            ? "Castle kingside"
            : m.isQueensideCastle()
              ? "Castle queenside"
              : `${pieceNames[m.piece]} ${m.to}`;
        } catch {
          return "";
        }
      })()
    : "";
  function invalidate() {
    state.current.valid = false;
    setValid(false);
    setLine(undefined);
    engine.current?.cancel();
  }
  function position(
    next: string,
    local: boolean,
    kind: "replace" | "move" = "replace",
  ) {
    state.current = {
      ...state.current,
      fen: next,
      practice: local,
      valid: true,
    };
    dispatch(
      kind === "move"
        ? { type: "move", fen: next }
        : { type: "replace", fen: next, manual: local },
    );
    setValid(true);
    setLine(undefined);
    setError("");
    setProblem(undefined);
  }
  function engineSettings() {
    return {
      ...defaults,
      playerColor: color,
      multiPV: 1,
      time: budget,
      depth: 24,
      authorized: true,
    };
  }
  useEffect(() => {
    let alive = true;
    const e = new Engine(),
      s = new SourceBridge();
    engine.current = e;
    source.current = s;
    e.onStatus = (message) => {
      if (alive) setStatus(message);
    };
    e.onError = (message) => {
      if (alive) {
        setError(message);
        setLine(undefined);
      }
    };
    e.onResult = (result) => {
      const c = state.current;
      if (
        !alive ||
        !c.running ||
        !c.valid ||
        c.editor ||
        result.fen !== c.fen ||
        new Chess(c.fen).turn() !== c.color
      )
        return;
      const best = result.lines.find((l) => l.rank === 1);
      if (!best || !playUci(c.fen, best.pv[0])) return;
      setLine(best);
      setStatus(result.finished ? "Ready" : "Thinking…");
      setError("");
    };
    s.onInvalidate = () => {
      if (!state.current.practice) invalidate();
    };
    s.onPosition = (next) => {
      if (!state.current.practice) {
        if (state.current.valid && state.current.fen === next) {
          setProblem(undefined);
          return;
        }
        position(next, false);
      }
    };
    s.onProblem = (p) => {
      if (!state.current.practice) {
        source.current?.stop();
        position(state.current.fen, true);
        setProblem({
          ...p,
          message: "Board not detected. You can enter the position manually.",
        });
        setStatus("Manual board ready");
      }
    };
    s.onStatus = (message) => {
      if (!state.current.practice) setStatus(message);
    };
    const read = isExtension
      ? chrome.storage.local.get("simpleSettings").then((r) => r.simpleSettings)
      : Promise.resolve().then(() =>
          JSON.parse(localStorage.getItem("simpleSettings") || "null"),
        );
    void read
      .catch(() => null)
      .then((saved) => {
        if (!alive) return;
        if (saved?.color === "w" || saved?.color === "b") {
          state.current.color = saved.color;
          setColor(saved.color);
        }
        if ([800, 1800, 5000].includes(saved?.budget)) setBudget(saved.budget);
        if (saved?.polling === true) setPolling(true);
        setLoaded(true);
      });
    const stop = () => {
      e.cancel();
      s.stop();
    };
    window.addEventListener("pagehide", stop);
    // Side-panel visibility can report hidden despite being open. Analysis is
    // governed by explicit Start/Pause and the panel lifecycle, never hidden.
    return () => {
      alive = false;
      clearTimeout(timer.current);
      window.removeEventListener("pagehide", stop);
      e.dispose();
      s.dispose();
    };
  }, []);
  useEffect(() => {
    if (!isExtension) return;
    type PanelEvent = {
      addListener: (fn: (info: { windowId: number }) => void) => void;
      removeListener: (fn: (info: { windowId: number }) => void) => void;
    };
    const api = chrome.sidePanel as unknown as {
      onOpened?: PanelEvent;
      onClosed?: PanelEvent;
    };
    let windowId: number | undefined;
    void chrome.windows
      .getCurrent()
      .then((w) => {
        windowId = w.id;
      })
      .catch(() => {});
    const opened = (info: { windowId: number }) => {
      if (info.windowId === windowId) setPanelOpen(true);
    };
    const closed = (info: { windowId: number }) => {
      if (info.windowId === windowId) {
        state.current.running = false;
        engine.current?.cancel();
        source.current?.stop();
        setPanelOpen(false);
        setLine(undefined);
      }
    };
    api.onOpened?.addListener(opened);
    api.onClosed?.addListener(closed);
    return () => {
      api.onOpened?.removeListener(opened);
      api.onClosed?.removeListener(closed);
    };
  }, []);
  useEffect(() => {
    if (loaded) {
      const saved = { color, budget, polling };
      void Promise.resolve()
        .then(() => {
          if (isExtension)
            return chrome.storage.local.set({ simpleSettings: saved });
          localStorage.setItem("simpleSettings", JSON.stringify(saved));
        })
        .catch(() => {});
    }
  }, [loaded, color, budget, polling]);
  useEffect(() => {
    if (!loaded || !running || !panelOpen || editor) {
      source.current?.stop();
      return;
    }
    if (!practice) {
      void source.current?.start(polling, regionRequest.current);
      regionRequest.current = false;
    }
    return () => source.current?.stop();
  }, [loaded, running, panelOpen, practice, polling, editor, retry]);
  useEffect(() => {
    engine.current?.cancel();
    setLine(undefined);
    clearTimeout(timer.current);
    if (!loaded || !running || !panelOpen || !valid || editor || terminal)
      return;
    setError("");
    setStatus("Thinking…");
    timer.current = setTimeout(() => {
      void engine.current?.analyze(fen, engineSettings()).catch((e) => {
        if (state.current.fen === fen) {
          setError(e.message);
          setLine(undefined);
        }
      });
    }, 180);
    return () => {
      clearTimeout(timer.current);
      engine.current?.cancel();
    };
  }, [
    loaded,
    fen,
    color,
    running,
    panelOpen,
    valid,
    editor,
    budget,
    retry,
    turn,
    terminal,
    practice,
  ]);
  function changeColor(next: Color) {
    state.current.color = next;
    setLine(undefined);
    engine.current?.cancel();
    setColor(next);
  }
  function toggle() {
    const next = !running;
    state.current.running = next;
    setRunning(next);
    setLine(undefined);
    if (!next) {
      engine.current?.cancel();
      source.current?.stop();
    } else {
      setError("");
      engine.current?.reset();
    }
  }
  function move(from: Square, to: Square, promote?: PieceSymbol) {
    const c = new Chess(fen),
      moves = c
        .moves({ verbose: true })
        .filter((m) => m.from === from && m.to === to);
    if (!moves.length) return;
    if (moves.some((m) => m.promotion) && !promote) {
      setPromotion({ from, to });
      return;
    }
    try {
      c.move({ from, to, promotion: promote });
      engine.current?.cancel();
      source.current?.stop();
      const next = c.fen();
      position(next, true, "move");
      setPromotion(undefined);
    } catch {
      setError("That move is not legal. Try a different square.");
    }
  }
  function usePractice() {
    source.current?.stop();
    position(START_FEN, true);
    setMenu(false);
  }
  function reconnect() {
    engine.current?.reset();
    setLine(undefined);
    setError("");
    if (!practice) invalidate();
    setRetry((n) => n + 1);
  }
  function setEditor(next: boolean) {
    state.current.editor = next;
    state.current.practice = true;
    engine.current?.cancel();
    source.current?.stop();
    setLine(undefined);
    if (!next) {
      state.current.valid = true;
      setValid(true);
      setError("");
    }
    dispatch({ type: next ? "edit" : "play" });
  }
  function openCorrection() {
    setEditor(true);
    setMenu(false);
  }
  function undo() {
    if (editor || history.length < 2) return;
    source.current?.stop();
    engine.current?.cancel();
    state.current = {
      ...state.current,
      fen: history[history.length - 2],
      practice: true,
      valid: true,
    };
    dispatch({ type: "undo" });
    setValid(true);
    setLine(undefined);
    setProblem(undefined);
    setError("");
  }
  function reset() {
    source.current?.stop();
    engine.current?.cancel();
    state.current.editor = false;
    position(START_FEN, true);
    setPromotion(undefined);
  }
  function connect(region = false) {
    regionRequest.current = region;
    if (editor) return;
    source.current?.stop();
    engine.current?.cancel();
    invalidate();
    setProblem(undefined);
    setError("");
    state.current.practice = false;
    dispatch({ type: "attach" });
    setRetry((n) => n + 1);
    setMenu(false);
  }
  const correctionDetection: Detection = problem?.detection || {
    fen,
    placement: fen.split(" ")[0],
    turn,
    orientation: color,
    castling: fen.split(" ")[2],
    ep: fen.split(" ")[3],
    halfmove: +fen.split(" ")[4],
    fullmove: +fen.split(" ")[5],
    method: "fen",
    confidence: 1,
    issues: [],
    viewport: { width: 1, height: 1 },
    url: "",
    timestamp: 0,
  };
  function corrected(next: string, orientation: Color, templates: Template[]) {
    if (templates.length) source.current?.confirm(next, orientation, templates);
    source.current?.stop();
    engine.current?.cancel();
    state.current.editor = false;
    position(next, true);
    setPromotion(undefined);
  }
  const statusText = !running
    ? "Paused"
    : editor
      ? "Editing position — analysis paused"
      : problem
        ? problem.message
        : !valid
          ? "Finding the board…"
          : terminal || turn !== color
            ? terminal || `Waiting for ${title(turn)}’s move`
            : recommendation
              ? "Your move"
              : status;
  const evalText =
    recommendation?.mate !== undefined
      ? `${recommendation.mate > 0 ? "You can force mate" : "Mate threat"} in ${Math.abs(recommendation.mate)}`
      : recommendation?.cp !== undefined
        ? `${recommendation.cp > 0 ? "+" : ""}${(recommendation.cp / 100).toFixed(2)} for ${title(color)}`
        : "";
  return (
    <main className="app simple-app">
      <header className="simple-header">
        <div className="brand-mark">♞</div>
        <div>
          <h1>Chess Assist</h1>
          <p>{practice ? "Practice board" : "Webpage assistant"}</p>
        </div>
        <button
          className="icon-button"
          aria-label="Open menu"
          onClick={() => setMenu(true)}
        >
          <Settings2 size={19} />
        </button>
      </header>
      <section className="color-picker" aria-label="Playing color">
        <span>Playing as</span>
        <div>
          {(["w", "b"] as Color[]).map((c) => (
            <button
              key={c}
              className={color === c ? "active" : ""}
              onClick={() => changeColor(c)}
              aria-pressed={color === c}
            >
              <i className={`color-disc ${c === "w" ? "white" : "black"}`} />
              {title(c)}
            </button>
          ))}
        </div>
      </section>
      <section className="recommendation" aria-live="polite">
        <span className="eyebrow">
          {recommendation
            ? "RECOMMENDED MOVE"
            : editor
              ? "EDIT POSITION"
              : !running
                ? "ANALYSIS PAUSED"
                : terminal
                  ? "POSITION COMPLETE"
                  : valid && turn !== color
                    ? "OPPONENT’S TURN"
                    : "READY TO HELP"}
        </span>
        <div className="simple-move">
          {notation ||
            (editor
              ? "Edit freely"
              : !running
                ? "Paused"
                : terminal
                  ? "Game over"
                  : valid && turn !== color
                    ? "Waiting"
                    : error
                      ? "Try again"
                      : valid
                        ? "Thinking…"
                        : "Connect a board")}
        </div>
        {description && (
          <p className="move-description">
            {description}
            <span>{evalText}</span>
          </p>
        )}
        <p className="simple-status">
          {running &&
            !editor &&
            valid &&
            turn === color &&
            !recommendation &&
            !error &&
            !terminal && <LoaderCircle size={13} className="spin" />}
          {error || statusText}
        </p>
      </section>
      <nav className="mode-tabs manual-modes" aria-label="Board mode">
        <button
          className={!editor ? "active" : ""}
          onClick={() =>
            editor
              ? editorController.current?.save()
              : !practice || !valid
                ? position(fen, true)
                : undefined
          }
        >
          Play
        </button>
        <button className={editor ? "active" : ""} onClick={openCorrection}>
          Edit
        </button>
      </nav>
      {editor ? (
        <PositionEditor
          embedded
          controller={editorController}
          detection={correctionDetection}
          visual={problem?.visual}
          snapshot={problem?.snapshot}
          onClose={() => setEditor(false)}
          onConfirm={corrected}
        />
      ) : (
        <Board
          fen={fen}
          orientation={color}
          onMove={move}
          arrow={recommendation?.pv[0]}
        />
      )}
      <div className="manual-history">
        <button
          className="text-button"
          onClick={undo}
          disabled={editor || history.length < 2}
        >
          <Undo2 size={15} />
          Undo
        </button>
        <span>{editor ? "Edit any piece" : `${title(turn)} to move`}</span>
        <button className="text-button" onClick={reset}>
          Reset
        </button>
      </div>
      <p className="board-note">
        {editor
          ? "Move either color freely. Save a valid position to analyze."
          : practice
            ? "Manual board · Enter legal moves for either side."
            : `Webpage position · ${title(turn)} to move`}
      </p>
      <div className="simple-controls">
        <button className="primary" onClick={toggle}>
          {running ? <Pause size={16} /> : <Play size={16} />}
          {running ? "Pause" : "Start"}
        </button>
        {(problem || error) && (
          <button
            className="secondary"
            onClick={error ? reconnect : openCorrection}
          >
            {error ? <RefreshCw size={15} /> : null}
            {error ? "Retry" : "Correct Position"}
          </button>
        )}
      </div>
      <button
        className="text-button centered"
        disabled={editor}
        onClick={() => connect()}
      >
        Select Board on Webpage
      </button>
      {(!practice || problem) && (
        <button
          className="text-button centered"
          disabled={editor}
          onClick={() => connect(true)}
        >
          Choose board region
        </button>
      )}
      <footer className="simple-footer">
        <p>Automatic analysis · Moves stay under your control</p>
        <p className="creator-credit">
          This system was created and designed by{" "}
          <a
            href="https://github.com/fejelude"
            target="_blank"
            rel="noopener noreferrer"
          >
            fejelude
          </a>
        </p>
      </footer>
      {menu && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="menu-title"
          >
            <div className="modal-heading">
              <h2 id="menu-title">Options</h2>
              <button
                className="icon-button"
                aria-label="Close menu"
                onClick={() => setMenu(false)}
              >
                <X size={18} />
              </button>
            </div>
            <p className="muted">
              For analysis and practice where engine assistance is allowed.
              Website and Chrome restrictions still apply.
            </p>
            <div className="menu-actions">
              <button className="secondary" onClick={usePractice}>
                Practice board
              </button>
              <button
                className="secondary"
                onClick={() => {
                  setMenu(false);
                  openCorrection();
                }}
              >
                Correct Position
              </button>
              <button
                className="secondary"
                onClick={() => {
                  setMenu(false);
                  connect();
                }}
              >
                Reconnect to webpage
              </button>
              <button
                className="secondary"
                disabled={history.length < 2}
                onClick={() => {
                  undo();
                  setMenu(false);
                }}
              >
                <Undo2 size={14} />
                Undo last move
              </button>
            </div>
            <label className="setting-label">
              Thinking time
              <select
                value={budget}
                onChange={(e) => setBudget(+e.target.value)}
              >
                <option value={800}>Quick</option>
                <option value={1800}>Balanced</option>
                <option value={5000}>Thorough</option>
              </select>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={polling}
                onChange={(e) => setPolling(e.target.checked)}
              />
              Check canvas/image boards every 2.5 seconds
            </label>
            <details>
              <summary>Load a saved position</summary>
              <p className="hint">
                Optional: paste a complete FEN from another analysis board.
              </p>
              <textarea
                aria-label="Saved FEN"
                rows={3}
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
              />
              {importError && <p className="error">{importError}</p>}
              <button
                className="secondary"
                onClick={() => {
                  const text = importText.trim(),
                    invalid = validatePosition(text);
                  if (invalid) {
                    setImportError(invalid);
                    return;
                  }
                  position(new Chess(text).fen(), true);
                  setMenu(false);
                  setImportError("");
                }}
              >
                Load position
              </button>
            </details>
          </section>
        </div>
      )}
      {promotion && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Choose promotion"
          >
            <div className="modal-heading">
              <h2>Promote your pawn</h2>
              <button
                className="icon-button"
                aria-label="Cancel promotion"
                onClick={() => setPromotion(undefined)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="promotion-choices">
              {(["q", "r", "b", "n"] as PieceSymbol[]).map((p) => (
                <button
                  className="secondary"
                  key={p}
                  onClick={() => move(promotion.from, promotion.to, p)}
                >
                  {pieceNames[p]}
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
