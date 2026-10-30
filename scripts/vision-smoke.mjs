import { createRequire } from "node:module";
import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
let sharp;
try {
  sharp = require("sharp");
} catch {
  sharp = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + "/sharp");
}
const temp = await mkdtemp(join(tmpdir(), "chess-assist-vision-"));
await build({
  entryPoints: ["src/recognition/vision.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  outfile: join(temp, "vision.mjs"),
});
const { cellFeature, recognize, locateBoard, similarity } = await import(
  join(temp, "vision.mjs")
);
const templates = [];
for (const color of "wb")
  for (const type of "kqrbnp") {
    const code = color + type,
      svg = await readFile(`public/pieces/${color}${type.toUpperCase()}.svg`);
    for (const background of ["#deded0", "#7a927d"]) {
      const data = await sharp({
        create: { width: 80, height: 80, channels: 4, background },
      })
        .composite([
          { input: await sharp(svg).resize(80, 80).png().toBuffer() },
        ])
        .raw()
        .toBuffer();
      templates.push({
        code,
        feature: cellFeature(
          { width: 80, height: 80, data },
          { x: 0, y: 0, width: 640, height: 640 },
          0,
          0,
        ).feature,
      });
    }
  }
const width = 640,
  height = 620,
  bounds = { x: 80, y: 64, width: 480, height: 480 },
  composites = [];
const map = [];
const rows = [
  "rnbqkbnr",
  "pppppppp",
  "........",
  "........",
  "........",
  "........",
  "PPPPPPPP",
  "RNBQKBNR",
];
for (let r = 0; r < 8; r++)
  for (let c = 0; c < 8; c++) {
    const background = (r + c) % 2 ? "#7a927d" : "#deded0",
      ch = rows[r][c];
    const square = sharp({
      create: { width: 60, height: 60, channels: 4, background },
    });
    if (ch !== ".") {
      const code = (ch === ch.toUpperCase() ? "w" : "b") + ch.toLowerCase();
      map.push({ r, c, code });
      square.composite([
        {
          input: await sharp(
            `public/pieces/${code[0]}${code[1].toUpperCase()}.svg`,
          )
            .resize(60, 60)
            .png()
            .toBuffer(),
        },
      ]);
    }
    composites.push({
      input: await square.png().toBuffer(),
      left: 80 + c * 60,
      top: 64 + r * 60,
    });
  }
const pixels = await sharp({
  create: { width, height, channels: 4, background: "#111713" },
})
  .composite(composites)
  .raw()
  .toBuffer();
const image = { width, height, data: pixels };
const found = locateBoard(image);
assert.ok(found, "Locates board with rendered SVG pieces");
assert.ok(Math.abs(found.x - bounds.x) < 2 && Math.abs(found.y - bounds.y) < 2);
const initial = recognize(image, bounds, templates);
if (process.env.VISION_DEBUG) {
  for (const p of map.slice(0, 8)) {
    const f = initial.cells[p.r * 8 + p.c].feature;
    console.log(
      p.code,
      templates
        .map((t) => [t.code, similarity(f, t.feature)])
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6),
    );
  }
}
const known = initial.cells.filter((c) => c.code);
assert.ok(
  known.length >= 24,
  "Default artwork recognition must be useful before calibration",
);
for (const cell of known)
  assert.equal(
    cell.code,
    map.find((p) => p.r === cell.row && p.c === cell.col)?.code,
    "No high-confidence incorrect identities",
  );
const learned = map.map((p) => ({
  code: p.code,
  feature: initial.cells[p.r * 8 + p.c].feature,
}));
const calibrated = recognize(image, bounds, [...templates, ...learned]);
assert.equal(calibrated.cells.filter((c) => c.code).length, 32);
assert.equal(calibrated.cells.filter((c) => c.empty).length, 32);
assert.equal(calibrated.issues.length, 0);
const report = {
  passed: true,
  checks: [
    "Automatic checkerboard location from rasterized SVG artwork.",
    "Default templates have no confidently incorrect piece labels.",
    "Learned piece-style templates correctly identify 32 pieces and 32 empty squares.",
  ],
  defaultRecognized: known.length,
  calibratedRecognized: 32,
  runtime:
    "Rasterized SVG pixels with sharp; actual vision algorithms, no browser capture.",
};
await mkdir("test-results", { recursive: true });
await writeFile(
  "test-results/vision-report.json",
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
