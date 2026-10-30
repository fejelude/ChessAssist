# Chess Assist

A Chrome extension for local chess analysis with Stockfish WASM, a manual position editor, optional webpage board recognition, and PGN review.

**[Download Chess Assist 1.2.0](https://github.com/fejelude/ChessAssist/releases/download/v1.2.0/ChessAssist-1.2.0.zip)** · [All releases](https://github.com/fejelude/ChessAssist/releases)

## Install in Chrome

1. Download the ZIP above and extract it into a permanent folder.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked**, then select the extracted **ChessAssist/dist** folder.
4. Pin **Chess Assist** using Chrome's Extensions menu, then click its toolbar icon.
5. Disable an older Chess Assist copy if you have one installed.

No build or Node.js installation is required. Keep the extracted folder in place. Use engine assistance only in training, analysis, or other environments where it is permitted.

If you use GitHub's **Code → Download ZIP** instead, extract that archive and select its **dist** folder. GitHub hosts the code and downloads; each user installs the extension in their own Chrome browser.

Source code, compiled extension files, GPL license, third-party notices, and the corresponding Stockfish source and network are included. See the build instructions below to modify the extension.

---

# Chess Assist 1.2 — manual analysis first

This update improves the existing extension's board and state handling. The Stockfish 19 WASM binary, board artwork, legal-move library and recognition algorithms are retained.

## Install or update

1. Extract the ZIP into a permanent folder.
2. Open `chrome://extensions` in desktop Chrome.
3. Disable the old Chess Assist entry so two copies do not run together.
4. Enable **Developer mode**, choose **Load unpacked**, and select the new **ChessAssist/dist** folder.
5. Open Chess Assist. Its manual starting board is usable immediately, even with no chess webpage open.

Node.js is not needed to install the compiled extension. Use engine assistance only where allowed; Chrome and website restrictions remain in force.

## The two board modes

**Play** follows normal chess rules. Click a piece and its destination, or drag it. You can enter moves for White and Black, regardless of your selected playing color. The side to move controls legality, so turns alternate correctly. Castling, en passant and all four promotions are supported. **Undo** restores the previous FEN including its turn and special rights. **Reset** returns to the standard starting position with a fresh history.

**Edit** is an inline position editor. Move any piece to any square, add pieces from the palette, or erase them. Both colors are unrestricted. **Clear board** empties the draft; **Starting position** fills it with a standard setup. Choose the next side to move and the board orientation. Click **Save and continue**, or the **Play** tab, to validate and commit the draft. **Cancel edits** returns to the previous committed position.

A draft with missing kings, adjacent kings, illegal checks or inconsistent special rights stays in Edit and shows feedback. Stockfish never receives an invalid draft. Saving an edited position replaces the committed position, resets the move history, and starts a fresh halfmove/fullmove clock of 0/1. Previous undo entries no longer apply and are removed.

Castling and en passant appear under **Castling and special moves**. If those details are unknown in a recognized board, they remain unknown until you choose actual rights or explicitly select **No castling rights** / **No en passant**. They are not silently replaced with “none.” A deliberate Clear or Starting position action sets the appropriate known rights for that setup.

## Playing color and automatic analysis

**Playing as White / Black** controls the viewing perspective and which side receives visible recommendations. It does not restrict manual piece manipulation. Play mode follows the actual side to move; Edit mode ignores move legality until you save.

Every valid committed Play position is sent to the engine automatically after a short debounce. Old requests are cancelled and late results rejected. Recommendations and arrows are shown when the selected playing color has the turn; the opponent's turn is clearly labeled. You can enter the opponent's move yourself, then receive the updated response. If you change your selected color, the same position is evaluated from that side's perspective.

Start/Pause controls computation. There is no repeated Analyze button or consent checkbox. Retry restarts the worker after a visible engine error. Checkmate, stalemate, insufficient material and the fifty-move rule hide obsolete recommendations. Standard chess is supported; Chess960 and repetition claims based on unknown FEN history are not.

## Optional webpage detection

**Select Board on Webpage** is optional. It attempts to connect to a visible board on the active tab. **Choose board region** opens a drag selector if you want to identify the board yourself. On a newly accessed origin, Chrome may require clicking the extension toolbar icon on that page to grant temporary tab access.

If recognition fails, the extension says **“Board not detected. You can enter the position manually.”** The current internal position remains available. You can play, edit and analyze normally; errors do not repeatedly interrupt you.

Manual moves, Edit, Undo and Reset take manual control and stop source monitoring. A late recognition result cannot replace them. **Only explicitly reconnecting** permits webpage synchronization again. Pressing Play while a source connection is pending also returns to the known internal board. The extension never moves pieces on the external page.

The existing detector uses generic FEN attributes, DOM/CSS piece labels and geometry, SVG and open shadow roots, plus local screenshots for canvas, images and WebGL. It has no website selector or hostname compatibility list. Recognition is not guaranteed for arbitrary artwork, perspective/3D boards, occlusion, closed shadow roots, inaccessible frames or animations. Unknown artwork can require manual correction. Chrome protected pages and the Web Store are inaccessible. Local file pages require Chrome's **Allow access to file URLs** setting, or can be served over localhost.

## State and reliability

`src/chess/workspace.ts` owns the committed FEN, move history, Play/Edit mode and manual/webpage ownership together. The displayed Play board, current turn and engine request all read that committed FEN. Edit is explicitly a paused draft; its Save validates before replacing the committed state. The existing engine manager retains timeouts, one automatic restart, cancellation acknowledgement handling, legality checks and a bounded cache.

No runtime code or position data is downloaded/uploaded. The production permissions remain `activeTab`, `scripting`, `storage` and `sidePanel`, without permanent host permissions. Settings and existing recognition templates are stored locally. The default build uses **Stockfish.js 19.0.1 Lite single-thread WASM**; its compact network is weaker than full Stockfish.

## Build and checks

Requires Node.js 22.12+.

```bash
npm ci
npm run build
npm test
npm run test:engine
npm run test:vision
npx playwright install chromium
npm run test:browser
npm run package
```

Set `CHROME_PATH=/absolute/path/to/chrome` for a preinstalled Chrome for Testing executable. The browser suite uses a temporary test manifest with host access for controlled localhost automation; that permission is absent from the distributed manifest.

The full engine build remains available through `CHESS_ASSIST_ENGINE=full npm run build` (set the equivalent environment variable first in PowerShell). It produces a substantially larger extension.

See **TESTING.md** for actual results. This delivery does not claim a real Chrome pass: Chromium startup was attempted but the host blocks the Unix sockets it requires.

For renderer checks after `npm ci`, run `python3 -m http.server 8080` and open `http://localhost:8080/fixtures/training.html`. The fixture switches between HTML, open Shadow DOM, SVG, canvas, image and WebGL. Disable **Expose full FEN** to exercise recognition rather than metadata extraction.

The code is GPL-3.0-or-later. Preserve **LICENSE**, **THIRD_PARTY_NOTICES.md**, the engine source archive and the exact embedded Lite network in `vendor/` when redistributing. The included engine binaries are unchanged; package checksums are regenerated.
