import type { Color, PieceSymbol, Square } from "chess.js";
export type PieceCode = `${Color}${PieceSymbol}`;
export type Orientation = "w" | "b";
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Detection {
  placement?: string;
  fen?: string;
  orientation?: Orientation;
  playerColor?: Color;
  turn?: Color;
  castling?: string;
  ep?: string;
  halfmove?: number;
  fullmove?: number;
  method: "fen" | "dom" | "visual";
  confidence: number;
  issues: string[];
  bounds?: Bounds;
  viewport: { width: number; height: number };
  url: string;
  timestamp: number;
  ambiguous?: boolean;
}
export interface Candidate {
  rank: number;
  depth: number;
  cp?: number;
  mate?: number;
  bound?: string;
  pv: string[];
  nodes: number;
  time: number;
  nps: number;
}
export interface SearchResult {
  id: number;
  fen: string;
  lines: Candidate[];
  finished: boolean;
}
export interface Settings {
  preset: "fast" | "balanced" | "deep" | "infinite";
  depth: number;
  time: number;
  multiPV: number;
  hash: number;
  autoSync: boolean;
  visualPolling: boolean;
  playerColor: Color | "";
  orientation: Orientation;
  authorized: boolean;
}
export const defaults: Settings = {
  preset: "balanced",
  depth: 20,
  time: 3000,
  multiPV: 3,
  hash: 32,
  autoSync: true,
  visualPolling: false,
  playerColor: "",
  orientation: "w",
  authorized: false,
};
export type PieceMap = Partial<Record<Square, PieceCode>>;
export interface VisualCell {
  row: number;
  col: number;
  feature: number[];
  empty: boolean;
  code?: PieceCode;
  confidence: number;
}
export interface Template {
  code: PieceCode;
  feature: number[];
}
export interface RecognitionResult {
  bounds: Bounds;
  cells: VisualCell[];
  confidence: number;
  issues: string[];
}
