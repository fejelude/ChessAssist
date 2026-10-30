# Chess Assist 1.2 — validation

## Successful checks

- Production TypeScript and Vite/esbuild build, including checks for unused symbols.
- **62 automated tests** covering the existing engine/rules/recognition paths and the new manual workflow.
- Both colors can be entered in Play, independently of the selected playing color. Turns alternate legally. Click and drag interactions work in the component tests.
- Edit allows arbitrary relocation of White and Black pieces, palette additions, erasing, Clear/Starting position, orientation changes without losing edits, and explicit special-rights choices.
- Invalid drafts stay in Edit with feedback. Save/Play commit only a valid FEN, reset the old history, and automatically request analysis. Undo and Reset restore the expected committed state.
- Recognition failure leaves the manual board working with the requested plain-language message. Late recognition messages cannot overwrite a manual move or saved edit.
- The authoritative workspace reducer owns committed FEN, undo history, mode and source ownership together. Invalid FENs cannot be committed.
- Every legal Play update reaches the engine; opponent-turn arrows remain hidden. Obsolete engine results are rejected.
- UI paths cover castling, en passant, underpromotion and Undo through the same board, in addition to retained lower-level rule tests.
- A separate real React-to-Stockfish integration test runs the actual packaged worker JavaScript and WASM in a Node worker/browser-API harness. It verifies White/Black responses, independent moves, Pause/Start and a freshly rebuilt edited position with the old history cleared. It is **not** a Chrome browser test.
- Engine smoke checks execute the actual WASM: legal MultiPV output, mate-in-one detection, cancellation and rapid replacement. Recognition checks locate a rasterized board and classify its pieces with local templates.

## Actual Chromium attempt: blocked

Chrome for Testing 144.0.7559.96 was downloaded and launched with the current extension and Playwright suite. It aborted before a page opened: the host forbids the Unix sockets Chrome needs (`socket(): Operation not permitted`).

No real-browser pass is claimed for side-panel rendering, native drag behavior, toolbar-granted activeTab permission, CSP enforcement, Chrome screenshots, or live webpage synchronization. Node/jsdom component and WASM-harness checks do not establish those claims.

The provided browser suite covers actual extension-page engine analysis, both colors, Play moves, inline Edit, native drag/click, correction, terminal states, source mutations and renderer fixtures. It remains ready to run on a normal desktop or CI host. Also manually check the production manifest's normal toolbar gesture, origin changes, panel close/reopen, and protected-page errors.

## Remaining limits

The screenshot recognizer remains template-based and theme-dependent. The tested default templates identify 29 of 32 pieces at the tested scale with no confidently wrong identities; confirmed templates identify all 32 pieces and 32 empty squares. This does not guarantee arbitrary artwork recognition. Manual analysis is now independent of recognition success.

Pixels alone cannot prove castling rights, en passant or arbitrary midgame turn state. Unknown special rights require an explicit editor choice. Saved edited positions start fresh move clocks and do not reconstruct repetition history.
