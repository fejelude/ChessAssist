import { Chess, validateFen, type Color, type Square } from "chess.js";
import type { Detection, Orientation, PieceMap } from "../types";

export const START_FEN = new Chess().fen();
export function squareAt(
  row: number,
  col: number,
  orientation: Orientation,
): Square {
  return `${"abcdefgh"[orientation === "w" ? col : 7 - col]}${orientation === "w" ? 8 - row : row + 1}` as Square;
}
export function coords(
  square: string,
  orientation: Orientation,
): [number, number] {
  const file = square.charCodeAt(0) - 97,
    rank = Number(square[1]);
  return orientation === "w" ? [file, 8 - rank] : [7 - file, rank - 1];
}
export function mapToPlacement(map: PieceMap): string {
  return Array.from({ length: 8 }, (_, r) => {
    let row = "",
      empty = 0;
    for (let c = 0; c < 8; c++) {
      const p = map[squareAt(r, c, "w")];
      if (!p) {
        empty++;
        continue;
      }
      if (empty) {
        row += empty;
        empty = 0;
      }
      row += p[0] === "w" ? p[1].toUpperCase() : p[1];
    }
    return row + (empty || "");
  }).join("/");
}
export function fenToMap(fen: string): PieceMap {
  const chess = new Chess(fen),
    map: PieceMap = {};
  for (const row of chess.board())
    for (const p of row) if (p) map[p.square] = `${p.color}${p.type}`;
  return map;
}
/** Parse placement without requiring both kings, for correction of incomplete recognition. */
export function placementToMap(placement: string): PieceMap {
  const map: PieceMap = {};
  const rows = placement.split("/");
  if (rows.length !== 8) return map;
  rows.forEach((row, r) => {
    let c = 0;
    for (const ch of row) {
      if (/[1-8]/.test(ch)) {
        c += +ch;
        continue;
      }
      if (/[kqrbnp]/i.test(ch) && c < 8) {
        map[squareAt(r, c, "w")] =
          `${ch === ch.toUpperCase() ? "w" : "b"}${ch.toLowerCase()}` as import("../types").PieceCode;
      }
      c++;
    }
  });
  return map;
}
export function validatePosition(fen: string): string | undefined {
  fen = fen.trim().replace(/\s+/g, " ");
  const v = validateFen(fen);
  if (!v.ok) return v.error;
  const fields = fen.split(" ");
  if (
    !/^\d+$/.test(fields[4]) ||
    !/^[1-9]\d*$/.test(fields[5]) ||
    !Number.isSafeInteger(Number(fields[4])) ||
    !Number.isSafeInteger(Number(fields[5]))
  )
    return "FEN move counters must be non-negative integers (fullmove starts at 1).";
  if (
    fields[2] !== "-" &&
    (!/^[KQkq]+$/.test(fields[2]) ||
      new Set(fields[2]).size !== fields[2].length)
  )
    return "Castling rights must list each available right once, or use '-'.";
  try {
    const chess = new Chess(fen),
      map = fenToMap(fen);
    const pieces = Object.values(map);
    if (pieces.length > 32) return "More than 32 pieces were recognized.";
    for (const color of ["w", "b"] as Color[]) {
      if (pieces.filter((p) => p[0] === color).length > 16)
        return "A side has more than 16 pieces.";
      if (pieces.filter((p) => p === `${color}p`).length > 8)
        return "A side has more than eight pawns.";
    }
    const wk = Object.keys(map).find((s) => map[s as Square] === "wk")!;
    const bk = Object.keys(map).find((s) => map[s as Square] === "bk")!;
    if (
      Math.abs(wk.charCodeAt(0) - bk.charCodeAt(0)) <= 1 &&
      Math.abs(+wk[1] - +bk[1]) <= 1
    )
      return "The kings cannot be adjacent.";
    const other: Color = chess.turn() === "w" ? "b" : "w";
    const otherKing = (other === "w" ? wk : bk) as Square;
    if (chess.isAttacked(otherKing, chess.turn()))
      return "The side that just moved has left its king in check. Check the turn or piece recognition.";
    const rights = fen.split(" ")[2];
    const expected: Record<string, [Square, string, Square, string]> = {
      K: ["e1", "wk", "h1", "wr"],
      Q: ["e1", "wk", "a1", "wr"],
      k: ["e8", "bk", "h8", "br"],
      q: ["e8", "bk", "a8", "br"],
    };
    for (const r of rights === "-" ? [] : rights) {
      const [k, kc, rook, rc] = expected[r];
      if (map[k] !== kc || map[rook] !== rc)
        return `Castling right ${r} conflicts with the king or rook position.`;
    }
    const ep = fen.split(" ")[3];
    if (ep !== "-") {
      const rank = +ep[1],
        pawnSquare =
          `${ep[0]}${rank + (chess.turn() === "w" ? -1 : 1)}` as Square;
      if (map[ep as Square] || map[pawnSquare] !== `${other}p`)
        return "The en passant target does not match a just-advanced pawn.";
    }
  } catch (e) {
    return (e as Error).message;
  }
}
/** Use actual source placement, never a previous engine PV. Only an unambiguous legal
 * successor may inherit hidden FEN metadata from a previously confirmed position. */
export function reconcile(
  previousFen: string | undefined,
  detection: Detection,
): { fen?: string; move?: string; issues: string[] } {
  if (detection.ambiguous) return { issues: detection.issues };
  if (detection.fen) {
    const error = validatePosition(detection.fen);
    if (error) return { issues: [error] };
    const fen = new Chess(detection.fen).fen();
    if (previousFen && previousFen !== fen) {
      const previous = new Chess(previousFen);
      for (const m of previous.moves({ verbose: true })) {
        previous.move(m);
        const match = previous.fen() === fen;
        previous.undo();
        if (match) return { fen, move: m.san, issues: [] };
      }
    }
    return { fen, issues: [] };
  }
  if (!detection.placement)
    return {
      issues: [
        "No reliable piece placement found. Select the board region or enter a FEN.",
      ],
    };
  if (previousFen) {
    const chess = new Chess(previousFen);
    const matchesMetadata = (fen: string) => {
      const parts = fen.split(" ");
      return (
        (!detection.turn || detection.turn === parts[1]) &&
        (detection.castling === undefined || detection.castling === parts[2]) &&
        (detection.ep === undefined || detection.ep === parts[3]) &&
        (detection.halfmove === undefined ||
          detection.halfmove === Number(parts[4])) &&
        (detection.fullmove === undefined ||
          detection.fullmove === Number(parts[5]))
      );
    };
    if (
      chess.fen().split(" ")[0] === detection.placement &&
      matchesMetadata(chess.fen())
    )
      return { fen: previousFen, issues: [] };
    const matches: { fen: string; move: string }[] = [];
    for (const move of chess.moves({ verbose: true })) {
      chess.move(move);
      if (
        chess.fen().split(" ")[0] === detection.placement &&
        matchesMetadata(chess.fen())
      )
        matches.push({ fen: chess.fen(), move: move.san });
      chess.undo();
    }
    if (matches.length === 1) return { ...matches[0], issues: [] };
  }
  const missing: string[] = [];
  if (!detection.orientation) missing.push("Confirm board orientation.");
  if (!detection.turn) missing.push("Confirm whose turn it is.");
  if (detection.castling === undefined)
    missing.push("Confirm castling rights.");
  if (detection.ep === undefined)
    missing.push("Confirm the en passant square (or none).");
  if (missing.length) return { issues: missing };
  const fen = `${detection.placement} ${detection.turn} ${detection.castling || "-"} ${detection.ep || "-"} ${detection.halfmove ?? 0} ${detection.fullmove ?? 1}`;
  const error = validatePosition(fen);
  return error ? { issues: [error] } : { fen, issues: [] };
}
export function playUci(
  fen: string,
  uci: string,
): { fen: string; san: string } | undefined {
  try {
    const c = new Chess(fen);
    const m = c.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci[4],
    });
    return { fen: c.fen(), san: m.san };
  } catch {
    return undefined;
  }
}
export function pvSan(fen: string, moves: string[]): string[] {
  const c = new Chess(fen),
    result: string[] = [];
  for (const m of moves) {
    try {
      const prefix =
        c.turn() === "w"
          ? `${c.moveNumber()}.`
          : result.length
            ? ""
            : `${c.moveNumber()}…`;
      result.push(
        `${prefix}${c.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] }).san}`,
      );
    } catch {
      break;
    }
  }
  return result;
}
export function terminalMessage(fen: string): string | undefined {
  const c = new Chess(fen);
  if (c.isCheckmate())
    return `Checkmate · ${c.turn() === "w" ? "Black" : "White"} wins`;
  if (c.isStalemate()) return "Draw · stalemate";
  if (c.isInsufficientMaterial()) return "Draw · insufficient material";
  if (c.isDrawByFiftyMoves()) return "Draw · fifty-move rule";
}
