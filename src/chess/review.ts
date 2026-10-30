import type { Candidate } from "../types";
import { whiteScore } from "../engine/uci";
export function assessMove(
  before: string,
  after: string,
  baseline: Candidate,
  current: Candidate,
): string {
  if (baseline.mate !== undefined || current.mate !== undefined)
    return "Forced-mate evaluation · inspect the current continuation";
  const sign = before.split(" ")[1] === "w" ? 1 : -1;
  const loss = Math.max(
    0,
    (whiteScore(baseline, before) - whiteScore(current, after)) * sign,
  );
  return `${loss >= 200 ? "Blunder" : loss >= 100 ? "Mistake" : loss >= 50 ? "Inaccuracy" : "Good continuation"} · ${(loss / 100).toFixed(2)} pawn evaluation loss`;
}
