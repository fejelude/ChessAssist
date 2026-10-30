import { useMemo, useState, useImperativeHandle, type Ref } from "react";
import type { Color, Square } from "chess.js";
import type {
  Detection,
  Orientation,
  PieceCode,
  PieceMap,
  RecognitionResult,
  Template,
} from "../types";
import { Board, piecePath } from "./Board";
import {
  placementToMap,
  mapToPlacement,
  squareAt,
  validatePosition,
  START_FEN,
} from "../chess/position";
import { X, Eraser, Move, Check } from "lucide-react";
export interface EditorHandle {
  save: () => void;
}
const codes: PieceCode[] = [
  "wk",
  "wq",
  "wr",
  "wb",
  "wn",
  "wp",
  "bk",
  "bq",
  "br",
  "bb",
  "bn",
  "bp",
];
const pieceNames: Record<string, string> = {
  k: "king",
  q: "queen",
  r: "rook",
  b: "bishop",
  n: "knight",
  p: "pawn",
};
export function PositionEditor({
  detection,
  visual,
  snapshot,
  onConfirm,
  onClose,
  embedded = false,
  controller,
}: {
  detection?: Detection;
  visual?: RecognitionResult;
  snapshot?: string;
  embedded?: boolean;
  controller?: Ref<EditorHandle>;
  onConfirm: (
    fen: string,
    orientation: Orientation,
    templates: Template[],
  ) => void;
  onClose: () => void;
}) {
  const [orientation, setOrientation] = useState<Orientation>(
    detection?.orientation || "w",
  );
  const [turn, setTurn] = useState<Color>(detection?.turn || "w");
  const [rights, setRights] = useState(detection?.castling ?? ""),
    [ep, setEp] = useState(detection?.ep ?? "");
  const [brush, setBrush] = useState<PieceCode | "" | null>(null),
    [selected, setSelected] = useState<Square>();
  const [painted, setPainted] = useState<Set<Square>>(new Set());
  const [edits, setEdits] = useState<Partial<Record<Square, PieceCode | "">>>(
      {},
    ),
    [error, setError] = useState("");
  const base = useMemo(() => {
    const map: PieceMap = {};
    if (visual) {
      for (const cell of visual.cells)
        if (cell.code)
          map[squareAt(cell.row, cell.col, orientation)] = cell.code;
    } else {
      const source = placementToMap(
        detection?.placement ||
          detection?.fen?.split(" ")[0] ||
          "8/8/8/8/8/8/8/8",
      );
      for (let r = 0; r < 8; r++)
        for (let c = 0; c < 8; c++) {
          const from = squareAt(r, c, "w");
          const p = source[from];
          if (p)
            map[
              !detection?.orientation && orientation === "b"
                ? squareAt(r, c, "b")
                : from
            ] = p;
        }
    }
    return map;
  }, [detection, visual, orientation]);
  const map = { ...base };
  for (const [square, code] of Object.entries(edits)) {
    if (code) map[square as Square] = code;
    else delete map[square as Square];
  }
  const unknown = (
    visual?.cells
      .filter((c) => !c.empty && !c.code)
      .map((c) => squareAt(c.row, c.col, orientation)) || []
  ).filter((s) => edits[s] === undefined);
  function drag(from: Square, to: Square) {
    setPainted((prev) => {
      const next = new Set(prev);
      next.delete(from);
      next.delete(to);
      return next;
    });
    if (!map[from] || from === to) return;
    setEdits((prev) => ({ ...prev, [from]: "", [to]: map[from]! }));
    setSelected(undefined);
  }
  function click(square: Square) {
    setError("");
    if (brush !== null) {
      setPainted((prev) => new Set([...prev, square]));
      setEdits((prev) => ({ ...prev, [square]: brush }));
      return;
    }
    if (selected && selected !== square) {
      drag(selected, square);
    } else setSelected(map[square] ? square : undefined);
  }
  function save() {
    if (!rights || !ep) {
      setError(
        "Choose castling rights and en passant below, or explicitly choose None.",
      );
      return;
    }
    const fen = `${mapToPlacement(map)} ${turn} ${rights || "-"} ${ep || "-"} 0 1`;
    const invalid = validatePosition(fen);
    if (invalid) {
      setError(
        invalid.startsWith("Castling right")
          ? "Update castling rights below: a required king or rook is not on its starting square."
          : invalid.replace(/^Invalid FEN:\s*/i, ""),
      );
      return;
    }
    if (unknown.length) {
      setError("Add or erase each square marked with “?”.");
      return;
    }
    const templates: Template[] = [];
    for (const cell of visual?.cells || []) {
      const code = map[squareAt(cell.row, cell.col, orientation)];
      if (
        code &&
        !cell.empty &&
        (edits[squareAt(cell.row, cell.col, orientation)] === undefined ||
          painted.has(squareAt(cell.row, cell.col, orientation)))
      )
        templates.push({ code, feature: cell.feature });
    }
    onConfirm(fen, orientation, templates);
  }
  useImperativeHandle(controller, () => ({ save }));
  function clear() {
    const next: Partial<Record<Square, PieceCode | "">> = {};
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) next[squareAt(r, c, "w")] = "";
    setEdits(next);
    setPainted(new Set());
    setSelected(undefined);
    setRights("-");
    setEp("-");
    setError("");
  }
  function resetDraft() {
    const start = placementToMap(START_FEN.split(" ")[0]),
      next: Partial<Record<Square, PieceCode | "">> = {};
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) {
        const square = squareAt(r, c, "w");
        next[square] = start[square] || "";
      }
    setEdits(next);
    setPainted(new Set());
    setSelected(undefined);
    setTurn("w");
    setRights("KQkq");
    setEp("-");
    setError("");
  }
  return (
    <div className={embedded ? "embedded-editor" : "modal-backdrop"}>
      <section
        className={embedded ? "editor" : "modal editor"}
        role={embedded ? "region" : "dialog"}
        aria-modal={embedded ? undefined : true}
        aria-labelledby="correction-title"
      >
        <div className="modal-heading">
          <h2 id="correction-title">Edit position</h2>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label={embedded ? "Cancel edits" : "Close correction"}
          >
            <X size={19} />
          </button>
        </div>
        <p className="muted">
          Drag a piece, or select a piece below and tap a square. Choose the
          eraser to remove one.
        </p>
        {snapshot && visual && (
          <details>
            <summary>View captured board</summary>
            <div className="source-crop">
              <img
                src={snapshot}
                alt="Captured chessboard"
                style={{
                  position: "absolute",
                  width: `${(detection!.viewport.width / visual.bounds.width) * 100}%`,
                  maxWidth: "none",
                  left: `${(-visual.bounds.x / visual.bounds.width) * 100}%`,
                  top: `${(-visual.bounds.y / visual.bounds.height) * 100}%`,
                }}
              />
            </div>
          </details>
        )}
        <Board
          map={map}
          orientation={orientation}
          onSquare={click}
          onMove={drag}
          unknown={unknown}
          selectedSquare={selected}
        />
        <p className="hint">
          {selected
            ? `${selected} selected — tap its destination.`
            : brush === null
              ? "Move pieces"
              : brush === ""
                ? "Tap a square to erase"
                : `Add a ${brush[0] === "w" ? "white" : "black"} ${pieceNames[brush[1]]}`}
        </p>
        <div className="edit-actions">
          <button className="text-button" onClick={clear}>
            Clear board
          </button>
          <button className="text-button" onClick={resetDraft}>
            Starting position
          </button>
        </div>
        <div className="piece-palette">
          <button
            className={brush === null ? "active" : ""}
            aria-label="Move pieces"
            onClick={() => {
              setBrush(null);
              setSelected(undefined);
            }}
          >
            <Move size={18} />
          </button>
          {codes.map((code) => (
            <button
              className={brush === code ? "active" : ""}
              key={code}
              aria-label={`Add ${code[0] === "w" ? "white" : "black"} ${pieceNames[code[1]]}`}
              onClick={() => {
                setBrush(code);
                setSelected(undefined);
              }}
            >
              <img src={piecePath(code)} alt="" />
            </button>
          ))}
          <button
            className={brush === "" ? "active" : ""}
            aria-label="Erase piece"
            onClick={() => setBrush("")}
          >
            <Eraser size={18} />
          </button>
        </div>
        <div className="form-grid">
          <label>
            Whose turn?
            <select
              value={turn}
              onChange={(e) => setTurn(e.target.value as Color)}
            >
              <option value="w">White</option>
              <option value="b">Black</option>
            </select>
          </label>
          <label>
            Board orientation
            <select
              value={orientation}
              onChange={(e) => {
                setOrientation(e.target.value as Orientation);
                setSelected(undefined);
              }}
            >
              <option value="w">White</option>
              <option value="b">Black</option>
            </select>
          </label>
        </div>
        <details
          className="special-moves"
          open={
            !rights || !ep || error.startsWith("Update castling")
              ? true
              : undefined
          }
        >
          <summary>Castling and special moves</summary>
          <p className="hint">
            These cannot be read from the pieces alone. Select only rights still
            available in the game.
          </p>
          <p className="hint">
            {rights
              ? "Castling rights are set."
              : "Castling rights are unknown."}
          </p>
          <button className="secondary" onClick={() => setRights("-")}>
            No castling rights
          </button>
          {(["K", "Q", "k", "q"] as const).map((right, i) => (
            <label className="checkbox-row" key={right}>
              <input
                type="checkbox"
                checked={rights.includes(right)}
                onChange={(e) =>
                  setRights((prev) => {
                    const selected = new Set(prev.replace("-", "").split(""));
                    e.target.checked
                      ? selected.add(right)
                      : selected.delete(right);
                    return (
                      ["K", "Q", "k", "q"]
                        .filter((r) => selected.has(r))
                        .join("") || "-"
                    );
                  })
                }
              />
              {i < 2 ? "White" : "Black"} can castle{" "}
              {i % 2 === 0 ? "kingside" : "queenside"}
            </label>
          ))}
          <label className="setting-label">
            En passant target (or choose None)
            <input
              value={ep}
              onChange={(e) => setEp(e.target.value)}
              placeholder="Unknown"
            />
          </label>
          <button className="secondary" onClick={() => setEp("-")}>
            No en passant
          </button>
        </details>
        {(!detection?.castling || !detection?.ep) && (
          <p className="hint">
            Castling and en passant cannot be determined from a picture alone.
            Choose the actual rights or explicitly select None.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button data-editor-save className="primary full-width" onClick={save}>
          <Check size={17} />
          Save and continue
        </button>
      </section>
    </div>
  );
}
