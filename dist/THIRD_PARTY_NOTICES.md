# Third-party notices

## Stockfish / Stockfish.js

Stockfish is copyright the Stockfish developers and contributors. Stockfish.js is the WebAssembly port maintained by Nathan Rugg and contributors, including Chess.com. Licensed under GNU GPL version 3. The complete license is included in `LICENSE` and `dist/engine/COPYING.txt`.

- Upstream source: https://github.com/nmrugg/stockfish.js
- Exact release used: **v19.0.1**, commit **0d5dd7944f88c817c07a26bc4fb1905d5f9c46d6**.
- Exact npm dependency: **stockfish@19.0.1**.
- Default binary input files: `bin/stockfish-19-lite-single.js` and `bin/stockfish-19-lite-single.wasm`. The build copies them unchanged as `dist/engine/stockfish.js` and `stockfish.wasm` so the same loader path supports either engine flavor. SHA-256 hashes are generated in `SHA256SUMS.txt`.
- Corresponding upstream source: `vendor/stockfish-js-v19.0.1-source.tar.gz`.
- Default Lite NNUE network: `vendor/nn-61e7af4bb97d.nnue`; SHA-256 `61e7af4bb97d51eeeb25d322916f86513b5cd3a827ce189c98c6e31946f99e5b`. The file was recovered unchanged from the binary’s embedded WASM data segments and verified against its identifying hash. The upstream network download script and network license/provenance are in the source tree and official Stockfish networks project: https://github.com/official-stockfish/networks.

To rebuild the engine itself, extract the source archive, place the included Lite network in that tree’s `src/` directory, install the Emscripten version requested by upstream `build.js`, install that tree’s dependencies, and run `node build.js --single-threaded --lite -f`. Refer to that source release’s README and build scripts for compiler requirements. The extension’s ordinary build uses the pinned prebuilt npm engine and does not require an Emscripten toolchain. The optional Full build uses the corresponding full network from the pinned package; keep the matching upstream network when redistributing a full-engine build.

## Chess piece artwork

The Cburnett chess piece set is by **Cburnett**, with upstream contributions/optimizations. The included optimized SVG copies were obtained from https://github.com/lichess-org/lila/tree/master/public/piece/cburnett and are unchanged here. These artworks are available under GPL version 2 or later among their offered licenses; this distribution selects GPL-3.0-or-later. A primary artwork/licensing record is https://commons.wikimedia.org/wiki/File:Chess_nlt45.svg. The supplied `LICENSE` covers the selected GPL version. Attribution does not imply endorsement.

## Runtime libraries

- **chess.js 1.4.0** — copyright Jeff Hlywa and contributors, BSD-2-Clause. https://github.com/jhlywa/chess.js
- **React / React DOM 19.2.0** — copyright Meta Platforms, Inc. and affiliates, MIT. https://github.com/facebook/react
- **Lucide React 0.468.0** — copyright Lucide contributors, ISC. https://github.com/lucide-icons/lucide

Copies of these licenses are in `licenses/` and included in the compiled extension’s `licenses/` directory. Build/test dependencies retain their own licenses in npm packages and are not bundled into the runtime extension. `package-lock.json` records the dependency graph for reproducible installation.
