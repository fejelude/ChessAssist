import { useEffect, useState } from "react";
import { Chess, type Square } from "chess.js";
import type { Orientation, PieceCode, PieceMap } from "../types";
import { coords, fenToMap, squareAt } from "../chess/position";

export const piecePath = (code: PieceCode) =>
  `pieces/${code[0]}${code[1].toUpperCase()}.svg`;
export function Board({
  fen,
  map: custom,
  orientation,
  onMove,
  onSquare,
  arrow,
  unknown = [],
  lastMove,
  selectedSquare,
}: {
  fen?: string;
  map?: PieceMap;
  orientation: Orientation;
  onMove?: (from: Square, to: Square) => void;
  onSquare?: (square: Square) => void;
  arrow?: string;
  unknown?: Square[];
  lastMove?: string;
  selectedSquare?: Square;
}) {
  const [selected, setSelected] = useState<Square>();
  useEffect(() => setSelected(undefined), [fen, orientation]);
  const chess = fen ? new Chess(fen) : undefined,
    map = custom || (fen ? fenToMap(fen) : {});
  const legal =
    selected && chess
      ? chess.moves({ square: selected, verbose: true }).map((m) => m.to)
      : [];
  const [sx, sy] = arrow ? coords(arrow.slice(0, 2), orientation) : [0, 0],
    [ex, ey] = arrow ? coords(arrow.slice(2, 4), orientation) : [0, 0];
  function select(square: Square) {
    if (onSquare) {
      onSquare(square);
      return;
    }
    if (!onMove) return;
    if (selected && selected !== square && legal.includes(square)) {
      onMove(selected, square);
      setSelected(undefined);
    } else
      setSelected(
        selected === square
          ? undefined
          : chess?.get(square)?.color === chess?.turn()
            ? square
            : undefined,
      );
  }
  return (
    <div className="board-shell">
      <div
        className="chessboard"
        role="grid"
        aria-label="Interactive analysis chessboard"
      >
        {Array.from({ length: 64 }, (_, i) => {
          const r = Math.floor(i / 8),
            c = i % 8,
            sq = squareAt(r, c, orientation),
            piece = map[sq];
          return (
            <button
              type="button"
              role="gridcell"
              key={sq}
              aria-label={`${sq}${piece ? ` ${piece[0] === "w" ? "white" : "black"} ${{ k: "king", q: "queen", r: "rook", b: "bishop", n: "knight", p: "pawn" }[piece[1]]}` : " empty"}`}
              aria-selected={(selectedSquare || selected) === sq}
              className={`square ${(r + c) % 2 ? "dark" : "light"} ${(selectedSquare || selected) === sq ? "selected" : ""} ${arrow?.includes(sq) ? "recommended" : ""} ${lastMove?.includes(sq) ? "last-move" : ""} ${unknown.includes(sq) ? "uncertain" : ""}`}
              onClick={() => select(sq)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const from = e.dataTransfer.getData("text/plain") as Square;
                if (/^[a-h][1-8]$/.test(from)) onMove?.(from, sq);
                setSelected(undefined);
              }}
            >
              {c === 0 && <span className="rank-label">{sq[1]}</span>}
              {r === 7 && <span className="file-label">{sq[0]}</span>}
              {piece && (
                <img
                  className="piece"
                  src={piecePath(piece)}
                  alt=""
                  draggable={
                    Boolean(onMove) && (!chess || piece[0] === chess.turn())
                  }
                  onDragEnd={() => setSelected(undefined)}
                  onDragStart={(e) => {
                    if (chess && piece[0] !== chess.turn()) {
                      e.preventDefault();
                      return;
                    }
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", sq);
                    setSelected(sq);
                  }}
                />
              )}
              {legal.includes(sq) && (
                <span className={piece ? "capture-ring" : "legal-dot"} />
              )}
              {unknown.includes(sq) && <span className="unknown-mark">?</span>}
            </button>
          );
        })}
        {arrow && (
          <svg
            className="move-arrow"
            viewBox="0 0 800 800"
            aria-label={`Suggested move ${arrow.slice(0, 2)} to ${arrow.slice(2, 4)}`}
          >
            <defs>
              <marker
                id="arrow-head"
                markerWidth="3"
                markerHeight="3"
                refX="2.1"
                refY="1.5"
                orient="auto"
              >
                <path d="M0,0 L3,1.5 L0,3 Z" fill="#e0ad53" />
              </marker>
            </defs>
            <line
              x1={sx * 100 + 50}
              y1={sy * 100 + 50}
              x2={ex * 100 + 50}
              y2={ey * 100 + 50}
              stroke="#e0ad53"
              strokeWidth="17"
              strokeLinecap="round"
              opacity=".9"
              markerEnd="url(#arrow-head)"
            />
          </svg>
        )}
      </div>
    </div>
  );
}
