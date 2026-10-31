// @vitest-environment jsdom
import { beforeEach, describe, it, expect } from "vitest";
import { detectDocument, pieceCode } from "../src/recognition/dom";
import { START_FEN } from "../src/chess/position";
const rect = (x: number, y: number, width: number, height = width) =>
  ({
    x,
    y,
    width,
    height,
    left: x,
    top: y,
    right: x + width,
    bottom: y + height,
    toJSON() {},
  }) as DOMRect;
function board(orientation = "white", offset = 20) {
  const root = document.createElement("div");
  root.className = "board";
  root.setAttribute("data-orientation", orientation);
  root.getBoundingClientRect = () => rect(offset, 20, 480);
  document.body.append(root);
  const rows = START_FEN.split(" ")[0].split("/");
  for (let r = 0; r < 8; r++) {
    let c = 0;
    for (const ch of rows[r]) {
      if (/[1-8]/.test(ch)) {
        c += +ch;
        continue;
      }
      const code = (ch === ch.toUpperCase() ? "w" : "b") + ch.toLowerCase(),
        el = document.createElement("div");
      el.className = `piece ${code}`;
      const col = c++;
      el.getBoundingClientRect = () =>
        rect(
          offset + (orientation === "white" ? col : 7 - col) * 60,
          20 + (orientation === "white" ? r : 7 - r) * 60,
          60,
        );
      root.append(el);
    }
  }
  return root;
}
beforeEach(() => {
  document.body.replaceChildren();
});
describe("generic DOM recognition", () => {
  it("recognizes CSS piece codes and unicode", () => {
    const el = document.createElement("div");
    el.className = "piece white knight";
    expect(pieceCode(el)).toBe("wn");
    el.className = "";
    el.textContent = "♟";
    expect(pieceCode(el)).toBe("bp");
  });
  it("reconstructs an HTML board by geometry", () => {
    board();
    const r = detectDocument().detection!;
    expect(r.placement).toBe(START_FEN.split(" ")[0]);
    expect(r.turn).toBeUndefined();
    expect(r.castling).toBeUndefined();
  });
  it("handles black-bottom geometry without changing player color or turn", () => {
    board("black");
    const r = detectDocument().detection!;
    expect(r.placement).toBe(START_FEN.split(" ")[0]);
    expect(r.orientation).toBe("b");
    expect(r.playerColor).toBeUndefined();
  });
  it("accepts an explicit full FEN as a separate strategy", () => {
    const b = board();
    b.setAttribute("data-fen", START_FEN);
    expect(detectDocument().detection?.fen).toBe(START_FEN);
  });
  it("does not silently analyze unknown piece elements", () => {
    const root = board();
    root.children[0].setAttribute("class", "piece mystery");
    expect(detectDocument().detection?.placement).toBeUndefined();
    expect(detectDocument().detection?.issues.join(" ")).toMatch(/could not/);
  });
  it("finds open shadow-root boards", () => {
    const b = board(),
      host = document.createElement("div");
    document.body.append(host);
    host.attachShadow({ mode: "open" }).append(b);
    expect(detectDocument().detection?.placement).toBe(START_FEN.split(" ")[0]);
  });
  it("requests board selection when multiple boards have equal confidence", () => {
    board();
    board("white", 530);
    expect(detectDocument().detection?.ambiguous).toBe(true);
  });
});

it("keeps manual selection inside the chosen region even beside an unlabeled grid", () => {
  const root = board();
  // This board also qualifies for the generic 64-child strategy.
  while (root.children.length < 64) root.append(document.createElement("span"));
  expect(
    detectDocument({ x: 530, y: 20, width: 160, height: 160 }).target,
  ).toBeUndefined();
});
it("reads pieces hosted directly in a board's open shadow root", () => {
  const root = board();
  root.attachShadow({ mode: "open" }).append(...Array.from(root.children));
  expect(detectDocument().detection?.placement).toBe(START_FEN.split(" ")[0]);
});
it("does not let malformed FEN metadata outrank a real board", () => {
  board();
  const decoy = document.createElement("div");
  decoy.setAttribute("data-fen", "this is not a valid fen");
  decoy.getBoundingClientRect = () => rect(530, 20, 160);
  document.body.append(decoy);
  expect(detectDocument().detection?.placement).toBe(START_FEN.split(" ")[0]);
});
it("treats duplicate same-color pieces on one square as an animation collision", () => {
  const root = board(),
    first = root.firstElementChild!;
  const clone = first.cloneNode(true) as Element;
  clone.getBoundingClientRect = first.getBoundingClientRect;
  root.append(clone);
  expect(detectDocument().detection?.ambiguous).toBe(true);
});
it("recognizes an unlabeled SVG as a visual candidate", () => {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.getBoundingClientRect = () => rect(20, 20, 480);
  document.body.append(svg);
  expect(detectDocument().target).toBe(svg);
});
