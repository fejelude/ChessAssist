import { build } from "vite";
import { build as bundle } from "esbuild";
import { copyFileSync, mkdirSync, cpSync } from "node:fs";
await build();
await bundle({
  entryPoints: ["src/extension/background.ts"],
  bundle: true,
  format: "esm",
  outfile: "dist/background.js",
  target: "chrome116",
  sourcemap: true,
});
await bundle({
  entryPoints: ["src/extension/content.ts"],
  bundle: true,
  format: "iife",
  outfile: "dist/content.js",
  target: "chrome116",
  sourcemap: true,
});
mkdirSync("dist/engine", { recursive: true });
const flavor =
  process.env.CHESS_ASSIST_ENGINE === "full" ? "single" : "lite-single";
for (const ext of ["js", "wasm"]) {
  const name = `stockfish-19-${flavor}.${ext}`;
  copyFileSync(
    `node_modules/stockfish/bin/${name}`,
    `dist/engine/stockfish.${ext}`,
  );
}
copyFileSync("node_modules/stockfish/Copying.txt", "dist/engine/COPYING.txt");
cpSync("licenses", "dist/licenses", { recursive: true });
copyFileSync("THIRD_PARTY_NOTICES.md", "dist/THIRD_PARTY_NOTICES.md");
console.log(
  "Built extension with bundled Stockfish WASM. Load dist/ in Chrome.",
);
