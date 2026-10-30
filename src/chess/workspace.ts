import { Chess } from "chess.js";
import { START_FEN, validatePosition } from "./position";
export interface Workspace {
  fen: string;
  history: string[];
  manual: boolean;
  mode: "play" | "edit";
}
export type WorkspaceAction =
  | { type: "replace"; fen: string; manual: boolean }
  | { type: "move"; fen: string }
  | { type: "undo" }
  | { type: "reset" }
  | { type: "edit" }
  | { type: "play" }
  | { type: "attach" };
export const initialWorkspace: Workspace = {
  fen: START_FEN,
  history: [START_FEN],
  manual: true,
  mode: "play",
};
/** The displayed Play board, turn, undo stack and engine all read this FEN.
 * Editing is a paused draft; only a validated Save replaces the position. */
export function workspaceReducer(
  state: Workspace,
  action: WorkspaceAction,
): Workspace {
  switch (action.type) {
    case "replace":
    case "move": {
      const invalid = validatePosition(action.fen);
      if (invalid) throw new Error(invalid);
      const fen = new Chess(action.fen).fen();
      if (action.type === "replace")
        return { fen, history: [fen], manual: action.manual, mode: "play" };
      return {
        fen,
        history: state.manual ? [...state.history, fen] : [state.fen, fen],
        manual: true,
        mode: "play",
      };
    }
    case "undo": {
      if (state.history.length < 2) return state;
      const history = state.history.slice(0, -1);
      return {
        ...state,
        fen: history[history.length - 1],
        history,
        manual: true,
        mode: "play",
      };
    }
    case "reset":
      return { ...initialWorkspace, history: [START_FEN] };
    case "edit":
      return { ...state, manual: true, mode: "edit" };
    case "play":
      return { ...state, manual: true, mode: "play" };
    case "attach":
      return { ...state, manual: false, mode: "play" };
  }
}
