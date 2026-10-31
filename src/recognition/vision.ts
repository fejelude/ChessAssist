import type { Bounds, RecognitionResult, Template, VisualCell } from "../types";
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}
const dist = (a: number[], b: number[]) =>
  Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0));
const median = (a: number[]) =>
  a.sort((x, y) => x - y)[Math.floor(a.length / 2)];
function rgb(im: Pixels, x: number, y: number): number[] {
  const i =
    (Math.max(0, Math.min(im.height - 1, Math.round(y))) * im.width +
      Math.max(0, Math.min(im.width - 1, Math.round(x)))) *
    4;
  return [im.data[i], im.data[i + 1], im.data[i + 2]];
}
function runs(
  im: Pixels,
  fixed: number,
  vertical = false,
): { start: number; length: number; color: number[] }[] {
  const out: { start: number; length: number; color: number[] }[] = [];
  let start = 0,
    color = rgb(im, vertical ? fixed : 0, vertical ? 0 : fixed);
  for (let p = 1; p < (vertical ? im.height : im.width); p++) {
    const c = rgb(im, vertical ? fixed : p, vertical ? p : fixed);
    if (dist(c, color) > 22) {
      if (p - start >= 12) out.push({ start, length: p - start, color });
      start = p;
      color = c;
    }
  }
  return out;
}
export function checkerScore(im: Pixels, b: Bounds): number {
  if (
    b.x < 0 ||
    b.y < 0 ||
    b.x + b.width > im.width + 2 ||
    b.y + b.height > im.height + 2
  )
    return 0;
  const groups: number[][][] = [[], []];
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const colors = [
        [0.09, 0.09],
        [0.91, 0.09],
        [0.09, 0.91],
        [0.91, 0.91],
      ].map(([x, y]) =>
        rgb(im, b.x + ((c + x) * b.width) / 8, b.y + ((r + y) * b.height) / 8),
      );
      groups[(r + c) % 2].push(
        [0, 1, 2].map((k) => median(colors.map((v) => v[k]))),
      );
    }
  const means = groups.map((g) =>
    [0, 1, 2].map((k) => median(g.map((v) => v[k]))),
  );
  if (dist(means[0], means[1]) < 22) return 0;
  return (
    groups
      .flatMap((g, i) => g.map((v) => (dist(v, means[i]) < 40 ? 1 : 0)))
      .reduce<number>((s, v) => s + v, 0) / 64
  );
}
/** Axis-aligned checkerboard finder. Does not claim to recognize perspective boards. */
export function locateBoard(im: Pixels): Bounds | undefined {
  const found: { b: Bounds; score: number }[] = [];
  for (let y = 2; y < im.height; y += 6) {
    const line = runs(im, y);
    for (let i = 0; i < line.length - 5; i++) {
      const group = line.slice(i, i + 6),
        size = median(group.map((r) => r.length));
      if (
        size < 16 ||
        size * 8 > Math.min(im.width, im.height) + 2 ||
        group.some(
          (r, j) =>
            Math.abs(r.length - size) > size * 0.08 ||
            (j > 0 &&
              Math.abs(r.start - (group[j - 1].start + group[j - 1].length)) >
                2),
        )
      )
        continue;
      for (let offset = 0; offset < 3; offset++) {
        const x = group[0].start - offset * size;
        if (x < 0 || x + 8 * size > im.width) continue;
        const col = runs(im, x + size * 0.07, true);
        for (const run of col) {
          if (Math.abs(run.length - size) > size * 0.09) continue;
          for (let j = 0; j < 8; j++) {
            const top = run.start - j * size;
            if (y < top || y > top + 8 * size) continue;
            const b = { x, y: top, width: size * 8, height: size * 8 };
            if (
              found.some(
                (f) =>
                  Math.abs(f.b.x - x) < 4 &&
                  Math.abs(f.b.y - top) < 4 &&
                  Math.abs(f.b.width - b.width) < 8,
              )
            )
              continue;
            const score = checkerScore(im, b);
            if (score > 0.87) found.push({ b, score });
          }
        }
      }
    }
    if (found.length > 12) break;
  }
  found.sort((a, b) => b.score - a.score || b.b.width - a.b.width);
  if (
    found
      .slice(1)
      .some(
        (f) =>
          f.score >= found[0].score - 0.02 &&
          (Math.abs(f.b.x - found[0].b.x) > found[0].b.width * 0.5 ||
            Math.abs(f.b.y - found[0].b.y) > found[0].b.height * 0.5),
      )
  )
    return;
  return found[0]?.b;
}
export function cellFeature(
  im: Pixels,
  b: Bounds,
  row: number,
  col: number,
): { feature: number[]; empty: boolean } {
  const x = b.x + (col * b.width) / 8,
    y = b.y + (row * b.height) / 8,
    w = b.width / 8,
    h = b.height / 8;
  const corners = [
    [0.07, 0.07],
    [0.93, 0.07],
    [0.07, 0.93],
    [0.93, 0.93],
  ].map(([a, d]) => rgb(im, x + w * a, y + h * d));
  const bg = [0, 1, 2].map((k) => median(corners.map((c) => c[k])));
  const n = 40,
    mask: number[] = [],
    lum: number[] = [];
  let minX = n,
    minY = n,
    maxX = 0,
    maxY = 0,
    count = 0;
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      const color = rgb(im, x + ((c + 0.5) * w) / n, y + ((r + 0.5) * h) / n);
      const fg =
        c > 2 && c < n - 3 && r > 1 && r < n - 2 && dist(color, bg) > 45;
      mask.push(fg ? 1 : 0);
      lum.push((color[0] + color[1] + color[2]) / 765);
      if (fg) {
        count++;
        minX = Math.min(minX, c);
        maxX = Math.max(maxX, c);
        minY = Math.min(minY, r);
        maxY = Math.max(maxY, r);
      }
    }
  if (count < 22) return { feature: Array(578).fill(0), empty: true };
  const feature: number[] = [];
  for (let r = 0; r < 24; r++)
    for (let c = 0; c < 24; c++) {
      const sx = Math.round(minX + (c * (maxX - minX)) / 23),
        sy = Math.round(minY + (r * (maxY - minY)) / 23);
      // A small spatial average makes the descriptor less sensitive to raster
      // antialiasing and a one-pixel difference in the board's rendered size.
      let total = 0,
        samples = 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const px = sx + dx,
            py = sy + dy;
          if (px < 0 || px >= n || py < 0 || py >= n) continue;
          const at = py * n + px;
          total += mask[at] * (0.65 + 0.35 * lum[at]);
          samples++;
        }
      feature.push(total / samples);
    }
  feature.push(
    (maxX - minX) / (maxY - minY + 1),
    lum.reduce((s, v, i) => s + v * mask[i], 0) / count,
  );
  return { feature, empty: false };
}
export function similarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let error = 0;
  for (let i = 0; i < 576; i++) error += (a[i] - b[i]) ** 2;
  return Math.max(
    0,
    1 -
      Math.sqrt(error / 576) -
      Math.abs(a[576] - b[576]) * 0.08 -
      Math.abs(a[577] - b[577]) * 0.12,
  );
}
export function recognize(
  im: Pixels,
  b: Bounds,
  templates: Template[],
): RecognitionResult {
  if (
    ![b.x, b.y, b.width, b.height].every(Number.isFinite) ||
    b.width < 8 ||
    b.height < 8 ||
    b.x < -2 ||
    b.y < -2 ||
    b.x + b.width > im.width + 2 ||
    b.y + b.height > im.height + 2
  )
    throw new Error(
      "The board region is outside the screenshot. Select the board again.",
    );
  const cells: VisualCell[] = [];
  for (let row = 0; row < 8; row++)
    for (let col = 0; col < 8; col++) {
      const f = cellFeature(im, b, row, col);
      if (f.empty) {
        cells.push({ row, col, ...f, confidence: 0.95 });
        continue;
      }
      const bestByCode = new Map<string, { t: Template; s: number }>();
      for (const t of templates) {
        const s = similarity(f.feature, t.feature);
        if (s > (bestByCode.get(t.code)?.s || 0))
          bestByCode.set(t.code, { t, s });
      }
      const scores = [...bestByCode.values()].sort((a, b) => b.s - a.s),
        best = scores[0],
        margin = best ? best.s - (scores[1]?.s || 0) : 0;
      const certain = best && best.s > 0.88 && margin > 0.035;
      cells.push({
        row,
        col,
        ...f,
        code: certain ? best.t.code : undefined,
        confidence: best ? Math.min(best.s, margin / 0.08) : 0,
      });
    }
  const unknown = cells.filter((c) => !c.empty && !c.code).length;
  return {
    bounds: b,
    cells,
    confidence: Math.min(...cells.map((c) => c.confidence)),
    issues: unknown
      ? [
          `${unknown} occupied square${unknown === 1 ? "" : "s"} need piece labels. Calibrate the piece style or correct the board.`,
        ]
      : [],
  };
}
