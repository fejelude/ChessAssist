import type {
  Detection,
  Bounds,
  PieceCode,
  PieceMap,
  Orientation,
} from "../types";
import { mapToPlacement, squareAt } from "../chess/position";
import type { Square } from "chess.js";

const unicode: Record<string, PieceCode> = {
  "♔": "wk",
  "♕": "wq",
  "♖": "wr",
  "♗": "wb",
  "♘": "wn",
  "♙": "wp",
  "♚": "bk",
  "♛": "bq",
  "♜": "br",
  "♝": "bb",
  "♞": "bn",
  "♟": "bp",
};
const names: Record<string, string> = {
  king: "k",
  queen: "q",
  rook: "r",
  bishop: "b",
  knight: "n",
  pawn: "p",
};
export function pieceCode(el: Element): PieceCode | undefined {
  const label = [
    el.getAttribute("data-piece"),
    el.getAttribute("aria-label"),
    el.getAttribute("alt"),
    el.getAttribute("title"),
    el.getAttribute("class"),
    el.getAttribute("href"),
    el.getAttribute("src")?.split("/").pop(),
  ]
    .filter(Boolean)
    .join(" ");
  const char = el.textContent?.trim();
  if (char && char.length <= 2 && unicode[char]) return unicode[char];
  const code = label.match(/(?:^|[\s_\-/])([wb])([kqrbnp])(?:[\s_.\-/]|$)/i);
  if (code) return (code[1].toLowerCase() + code[2].toLowerCase()) as PieceCode;
  const reverse = label.match(/(?:^|[\s_\-/])([kqrbnp])([wb])(?:[\s_.\-/]|$)/i);
  if (reverse)
    return (reverse[2].toLowerCase() + reverse[1].toLowerCase()) as PieceCode;
  const color = /\bwhite\b/i.test(label)
    ? "w"
    : /\bblack\b/i.test(label)
      ? "b"
      : undefined;
  const type = Object.keys(names).find((n) =>
    new RegExp(`\\b${n}\\b`, "i").test(label),
  );
  if (color && type) return `${color}${names[type]}` as PieceCode;
}
function bounds(el: Element): Bounds {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}
function visible(el: Element) {
  const b = bounds(el);
  return (
    b.width >= 140 &&
    b.height >= 140 &&
    b.x >= -2 &&
    b.y >= -2 &&
    b.x + b.width <= innerWidth + 2 &&
    b.y + b.height <= innerHeight + 2 &&
    Math.abs(b.width / b.height - 1) < 0.08 &&
    getComputedStyle(el).visibility !== "hidden"
  );
}
function allElements(root: Document | ShadowRoot | Element): Element[] {
  const output: Element[] = [];
  for (const el of Array.from(root.querySelectorAll("*")).slice(0, 16000)) {
    output.push(el);
    if (el.shadowRoot) output.push(...allElements(el.shadowRoot));
    if (output.length >= 20000) break;
  }
  return output;
}
function orientation(
  el: Element,
  pieces: { el: Element; code: PieceCode }[],
  b: Bounds,
): Orientation | undefined {
  const hint = `${el.getAttribute("data-orientation") || ""} ${el.getAttribute("orientation") || ""} ${el.getAttribute("class") || ""}`;
  if (/\b(black|flipped|orientation-black)\b/i.test(hint)) return "b";
  if (/\b(white|orientation-white)\b/i.test(hint)) return "w";
  // Prefer explicit square coordinates over assumptions about piece locations.
  for (const p of pieces) {
    const square =
      `${p.el.getAttribute("data-square") || ""} ${p.el.getAttribute("aria-label") || ""}`.match(
        /\b([a-h][1-8])\b/,
      );
    if (!square) continue;
    const r = bounds(p.el),
      c = Math.floor((r.x + r.width / 2 - b.x) / (b.width / 8)),
      row = Math.floor((r.y + r.height / 2 - b.y) / (b.height / 8));
    if (squareAt(row, c, "w") === square[1]) return "w";
    if (squareAt(row, c, "b") === square[1]) return "b";
  }
  const labels = Array.from(
    el.querySelectorAll(
      '[class*="coord"], [class*="label"], text, [data-square]',
    ),
  ).filter((e) => /^[a-h18]$/.test(e.textContent?.trim() || ""));
  const a = labels.find((e) => e.textContent?.trim() === "a");
  if (a) return bounds(a).x < b.x + b.width / 2 ? "w" : "b";
}
export function detectDocument(manual?: Bounds): {
  detection?: Detection;
  target?: Element;
  candidates: Bounds[];
} {
  const all = allElements(document),
    base = {
      viewport: { width: innerWidth, height: innerHeight },
      url: location.origin,
      timestamp: Date.now(),
    };
  let roots = all.filter((el) => {
    if (manual) {
      const r = bounds(el);
      return (
        visible(el) &&
        Math.abs(r.x - manual.x) < 8 &&
        Math.abs(r.y - manual.y) < 8 &&
        Math.abs(r.width - manual.width) < 16
      );
    }
    const desc = `${el.tagName} ${el.getAttribute("class") || ""} ${el.getAttribute("id") || ""} ${el.getAttribute("role") || ""}`;
    return (
      (el.hasAttribute("data-fen") ||
        el.hasAttribute("fen") ||
        el.hasAttribute("data-board") ||
        /board|(^|\s)grid(\s|$)/i.test(desc) ||
        /^(CANVAS|SVG|IMG)$/.test(el.tagName)) &&
      visible(el)
    );
  });
  // Discover unlabeled HTML grids by their 64 square children.
  for (const el of all)
    if (el.children.length === 64 && visible(el) && !roots.includes(el))
      roots.push(el);
  const proposals = roots
    .map((root) => {
      const rect = bounds(root),
        nodes = allElements(root),
        pieces: { el: Element; code: PieceCode }[] = [];
      for (const el of nodes) {
        const code = pieceCode(el),
          r = bounds(el);
        if (
          !code ||
          r.width <= 2 ||
          r.height <= 2 ||
          r.width > rect.width * 0.21 ||
          r.height > rect.height * 0.21
        )
          continue;
        if (
          r.x < rect.x - 3 ||
          r.y < rect.y - 3 ||
          r.x + r.width > rect.x + rect.width + 3 ||
          r.y + r.height > rect.y + rect.height + 3
        )
          continue;
        if (pieces.some((p) => p.el.contains(el))) continue;
        pieces.push({ el, code });
      }
      const unknown = nodes.filter((el) => {
        if (
          !(
            /(?:^|\s)piece(?:\s|$)/i.test(el.getAttribute("class") || "") ||
            el.hasAttribute("data-piece")
          )
        )
          return false;
        const r = bounds(el);
        return (
          r.width > 2 &&
          r.height > 2 &&
          r.width < rect.width * 0.21 &&
          r.height < rect.height * 0.21 &&
          !pieces.some(
            (p) => p.el === el || el.contains(p.el) || p.el.contains(el),
          )
        );
      }).length;
      const fen =
        root.getAttribute("data-fen") || root.getAttribute("fen") || undefined;
      return {
        root,
        rect,
        pieces,
        unknown,
        fen,
        score: fen
          ? 100
          : pieces.length + (/board/i.test(root.tagName) ? 2 : 0),
      };
    })
    .sort((a, b) => b.score - a.score || a.rect.width - b.rect.width);
  const unique = proposals.filter(
    (p, i) =>
      !proposals
        .slice(0, i)
        .some(
          (q) =>
            Math.abs(p.rect.x - q.rect.x) < 15 &&
            Math.abs(p.rect.y - q.rect.y) < 15 &&
            Math.abs(p.rect.width - q.rect.width) < 30,
        ),
  );
  const best = unique[0];
  if (!best) return { candidates: [] };
  if (
    !manual &&
    unique[1] &&
    unique[1].score > 3 &&
    best.score < unique[1].score + 4
  )
    return {
      detection: {
        ...base,
        method: "dom",
        confidence: 0,
        issues: ["Multiple boards found. Use Select region to choose one."],
        ambiguous: true,
      },
      candidates: unique.map((x) => x.rect),
    };
  const { root, rect, pieces, unknown, fen } = best;
  const orient = orientation(root, pieces, rect);
  const attr = (name: string) => root.getAttribute(`data-${name}`) || undefined;
  const rawTurn = attr("turn") || attr("side-to-move");
  const turn = /^(w|white)$/i.test(rawTurn || "")
    ? "w"
    : /^(b|black)$/i.test(rawTurn || "")
      ? "b"
      : undefined;
  const player = attr("player-color");
  const metadata = {
    turn,
    playerColor: player === "w" || player === "b" ? player : undefined,
    orientation: orient,
    castling: attr("castling"),
    ep: attr("en-passant"),
    bounds: rect,
  } as const;
  if (fen && fen.trim().split(/\s+/).length === 6)
    return {
      detection: {
        ...base,
        ...metadata,
        fen: fen.trim(),
        method: "fen",
        confidence: 1,
        issues: [],
      },
      target: root,
      candidates: unique.map((x) => x.rect),
    };
  const map: PieceMap = {},
    issues: string[] = [];
  let collisions = false;
  for (const p of pieces) {
    const r = bounds(p.el),
      row = Math.floor((r.y + r.height / 2 - rect.y) / (rect.height / 8)),
      col = Math.floor((r.x + r.width / 2 - rect.x) / (rect.width / 8));
    if (row < 0 || row > 7 || col < 0 || col > 7) continue;
    const direct =
      `${p.el.getAttribute("data-square") || ""} ${p.el.getAttribute("aria-label") || ""}`.match(
        /\b([a-h][1-8])\b/,
      )?.[1] as Square | undefined;
    const sq = direct || squareAt(row, col, orient || "w");
    if (map[sq] && map[sq] !== p.code) collisions = true;
    map[sq] = p.code;
  }
  const count = Object.keys(map).length;
  if (!orient)
    issues.push(
      "Board orientation needs confirmation. White-bottom is a preview only.",
    );
  if (collisions)
    issues.push(
      "Overlapping pieces found. Wait for animations to finish or correct the board.",
    );
  if (count < 2) issues.push("This board needs visual recognition.");
  if (unknown)
    issues.push(
      `${unknown} piece elements could not be identified. Trying visual recognition is safer than analyzing an incomplete board.`,
    );
  return {
    detection: {
      ...base,
      ...metadata,
      placement: count >= 2 && !unknown ? mapToPlacement(map) : undefined,
      method: "dom",
      confidence: collisions ? 0.3 : count >= 2 && !unknown ? 0.9 : 0,
      issues,
      ambiguous: collisions,
    },
    target: root,
    candidates: unique.map((x) => x.rect),
  };
}
