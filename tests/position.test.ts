import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import {
  START_FEN,
  reconcile,
  validatePosition,
  mapToPlacement,
  fenToMap,
  placementToMap,
  pvSan,
  squareAt,
  playUci,
} from "../src/chess/position";
import type { Detection } from "../src/types";
const detection = (
  placement: string,
  extra: Partial<Detection> = {},
): Detection => ({
  placement,
  method: "dom",
  confidence: 0.9,
  issues: [],
  viewport: { width: 1000, height: 800 },
  url: "https://training.test",
  timestamp: 1,
  ...extra,
});
describe("position reconstruction", () => {
  it("preserves exact starting placement", () =>
    expect(mapToPlacement(fenToMap(START_FEN))).toBe(START_FEN.split(" ")[0]));
  it("asks for hidden metadata rather than guessing", () => {
    const r = reconcile(undefined, detection(START_FEN.split(" ")[0]));
    expect(r.fen).toBeUndefined();
    expect(r.issues.join(" ")).toMatch(/castling/);
    expect(r.issues.join(" ")).toMatch(/turn/);
  });
  it("follows independent moves without relying on a recommended PV", () => {
    const c = new Chess();
    let previous = c.fen();
    for (const move of ["a3", "e5", "f3", "Bc5", "g4", "Qh4#"]) {
      c.move(move);
      const r = reconcile(previous, detection(c.fen().split(" ")[0]));
      expect(r.fen).toBe(c.fen());
      expect(r.move).toBe(move);
      previous = r.fen!;
    }
  });
  it("inherits castling-right changes only from actual legal moves", () => {
    const c = new Chess("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
    const before = c.fen();
    c.move("O-O");
    expect(reconcile(before, detection(c.fen().split(" ")[0])).fen).toBe(
      c.fen(),
    );
  });
  it("recovers a confirmed full FEN after dropped observations", () => {
    const c = new Chess();
    c.move("e4");
    c.move("e5");
    expect(
      reconcile(START_FEN, detection(c.fen().split(" ")[0])).fen,
    ).toBeUndefined();
    expect(reconcile(START_FEN, detection("", { fen: c.fen() })).fen).toBe(
      c.fen(),
    );
  });
  it("does not accept ambiguous recognition", () =>
    expect(
      reconcile(
        START_FEN,
        detection(START_FEN.split(" ")[0], {
          ambiguous: true,
          issues: ["overlap"],
        }),
      ).issues,
    ).toEqual(["overlap"]));
  it("rejects adjacent kings", () =>
    expect(validatePosition("8/8/8/8/8/8/4k3/4K3 w - - 0 1")).toMatch(
      /adjacent/,
    ));
  it("rejects stale castling rights", () =>
    expect(validatePosition("4k3/8/8/8/8/8/8/4K3 w K - 0 1")).toMatch(
      /Castling/,
    ));
  it("rejects impossible en passant", () =>
    expect(validatePosition("4k3/8/8/8/8/8/8/4K3 w - e6 0 1")).toMatch(
      /en passant/,
    ));
  it("rejects a nonmoving king in check", () =>
    expect(validatePosition("4k3/8/8/8/8/8/4R3/4K3 w - - 0 1")).toMatch(
      /just moved/,
    ));
  it("allows correction of incomplete visual placement", () =>
    expect(placementToMap("8/8/8/8/8/8/8/R7").a1).toBe("wr"));
  it("maps orientation independently from the move turn", () => {
    expect(squareAt(7, 0, "w")).toBe("a1");
    expect(squareAt(7, 0, "b")).toBe("h8");
  });
  it("produces SAN variations and validates promotions", () => {
    expect(pvSan(START_FEN, ["e2e4", "e7e5", "g1f3"])).toEqual([
      "1.e4",
      "e5",
      "2.Nf3",
    ]);
    expect(playUci("4k3/P7/8/8/8/8/8/4K3 w - - 0 1", "a7a8n")?.san).toBe(
      "a8=N",
    );
  });
});
