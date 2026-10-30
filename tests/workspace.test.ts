import { describe, it, expect } from "vitest";
import { Chess } from "chess.js";
import { workspaceReducer, initialWorkspace } from "../src/chess/workspace";
import { START_FEN } from "../src/chess/position";
describe("authoritative workspace state", () => {
  it("starts with a playable manual position independent of source detection", () => {
    expect(initialWorkspace.manual).toBe(true);
    expect(initialWorkspace.fen).toBe(START_FEN);
  });
  it("keeps FEN and undo history together for alternating moves of either color", () => {
    const c = new Chess();
    let s = initialWorkspace;
    for (const m of ["e4", "e5", "Nf3", "Nc6"]) {
      c.move(m);
      s = workspaceReducer(s, { type: "move", fen: c.fen() });
      expect(s.fen).toBe(s.history.at(-1));
    }
    const old = s.history.at(-2);
    s = workspaceReducer(s, { type: "undo" });
    expect(s.fen).toBe(old);
  });
  it("resets move history when an edited position is committed", () => {
    const c = new Chess();
    c.move("e4");
    let s = workspaceReducer(initialWorkspace, { type: "move", fen: c.fen() });
    s = workspaceReducer(s, { type: "edit" });
    s = workspaceReducer(s, { type: "replace", fen: START_FEN, manual: true });
    expect(s.history).toEqual([START_FEN]);
    expect(workspaceReducer(s, { type: "undo" })).toBe(s);
  });
  it("locks manual control on Edit and only attaches on an explicit action", () => {
    const linked = workspaceReducer(initialWorkspace, { type: "attach" });
    expect(linked.manual).toBe(false);
    expect(workspaceReducer(linked, { type: "edit" }).manual).toBe(true);
  });
  it("never commits an invalid edited FEN", () => {
    expect(() =>
      workspaceReducer(initialWorkspace, {
        type: "replace",
        fen: "invalid",
        manual: true,
      }),
    ).toThrow();
    expect(initialWorkspace.fen).toBe(START_FEN);
  });
});
