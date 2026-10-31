# Chess Assist 1.2.1 — repository review and validation

Review dates: October 31–November 1, 2026. Base commit: `18c75632ede128f974670978eb0bb55fc3f0c5ee`.

## Scope and confirmed problems

The review covered the background/service-worker relay, content script and lifecycle, source bridge, DOM and screenshot recognition, UCI engine manager, chess position/workspace logic, React board/editor/settings, Manifest V3 configuration, build and packaging scripts, existing tests, and bundled engine/license assets.

| Problem                                                                                                                                         | Change and verification                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reconnecting to an unchanged board suppressed its first position and could leave the UI waiting indefinitely.                                   | Reset the connection signature; reconnect regression test.                                                                                                                       |
| Navigation/reload left old source state eligible until completion; stale heartbeat/worker errors could invalidate newer work.                   | Invalidate on navigation start, clear source history, and gate async callbacks by session/generation; bridge lifecycle tests.                                                    |
| Board hosts with their own open shadow root had no readable descendants; observers missed in-place shadow mutations.                            | Traverse and observe open roots, discover newly attached roots, and observe ancestor replacement; DOM/content tests.                                                             |
| The 64-child discovery strategy could escape a manually chosen region.                                                                          | Apply the region restriction to every discovery strategy; regression test.                                                                                                       |
| Malformed FEN attributes outranked a readable board; bare SVG candidates were missed; identical overlapping pieces were silently collapsed.     | Validate FEN before scoring, use lowercase local names, and flag all collisions; DOM regressions.                                                                                |
| Continuous mutations could postpone recognition indefinitely, while unchanged FENs generated redundant messages.                                | Use a bounded scan deadline and deduplicate readable positions. Preserve repeated screenshot requests for canvas/WebGL; content tests.                                           |
| Stopping while selecting left an overlay/Escape listener or delayed scan alive.                                                                 | Cancel selector work and remove monitoring listeners, observers, timers and pending captures; content lifecycle tests. Escape reports cancellation to restore manual analysis.   |
| Explicit rights and move clocks could be ignored when piece placement was unchanged.                                                            | Match all available metadata before inheriting history; starting-position shortcut applies only with no explicit special metadata. Position/bridge tests.                        |
| A stalled visual worker could leave the UI waiting; stale screenshot bounds could sample outside the capture.                                   | Add a 12-second watchdog and bounds validation; bridge/vision tests. Vertically stacked competing boards now remain ambiguous.                                                   |
| Closing one controller stopped another controller watching the same tab.                                                                        | Reference-count panel bindings; background test. Screenshot responses also reject a tab switch or navigation during capture.                                                     |
| Corrupt settings could crash startup or generate invalid UCI limits.                                                                            | Recover from JSON/storage errors, validate saved options and normalize finite engine limits; UI/engine tests.                                                                    |
| Cancelling Edit during a pending connection left the committed board invalid; FEN-only corrections lost turn/rights; calibration was discarded. | Restore manual validity on cancel, initialize metadata from full FEN, and pass saved correction templates to the source bridge. UI regressions plus bridge persistence coverage. |
| Package filename was fixed to 1.2.0.                                                                                                            | Derive it from package.json; rebuild/version 1.2.1 and validate the archive and checksums.                                                                                       |

## Development dependency audit

The initial `npm audit` found four affected development packages: Vitest, @vitest/mocker, tinypool and Sharp (including high/critical advisories). Vitest is updated to 5.0.5 and Sharp to 0.35.5 with a regenerated lockfile. Runtime dependency versions are unchanged. The final `npm audit --json` reports **zero vulnerabilities**, and all 98 tests pass under Vitest 5.0.5.

The browser CI run also reproduced a relay bug: requests from this extension’s own page in a Chrome tab were rejected as content-script requests. The sender check now accepts the extension’s own origin while continuing to block webpage content scripts. A regression test failed before this fix and passes afterward.

## Local checks

- Original baseline: **62 tests passed**, production build passed.
- Eight added regression cases were run against the original source and failed before their fixes.
- Updated suite: **98 tests passed** across 10 files, including the real React-to-packaged-Stockfish WASM integration test. The build, engine smoke check, vision smoke check and package/checksum verification also passed.
- `npm run build`: TypeScript checks and production Vite/esbuild output.
- `npm run test:engine`: real WASM MultiPV, legal root moves, mate in one, cancellation and rapid position replacement.
- `npm run test:vision`: raster board location; 29/32 default-template piece labels with no confidently wrong identities; 32/32 piece labels and 32 empty cells with confirmed templates.
- `npm run package`: installable dist, source and notices; ZIP integrity and SHA256SUMS verification.
- `git diff --check`: whitespace validation.

The production manifest retains `activeTab`, `scripting`, `storage`, `sidePanel`, the existing local WASM CSP, and no permanent host permissions. Stockfish binaries, neural network, artwork and third-party licenses are retained.

## Chromium CI results

[GitHub Actions run 3](https://github.com/fejelude/ChessAssist/actions/runs/41221401561) passed the complete workflow for commit `d3a4b6c54972bd262bc504b0641b6e13e4ff3ae8`: production build, 98 tests, real WASM and vision smoke checks, Chromium browser suite, and packaging.

The browser report records **21 successful checks and no UI/CSP errors**: packaged Stockfish under the MV3 CSP; both colors; native drag/click editing; pause/resume, correction, promotion and terminal states; source mutations; open Shadow DOM; reload and same-origin navigation; selection cancellation; all six renderer fixtures; and screenshot worker execution. The requested creator footer and direct profile URL also pass browser assertions. Separate rendered previews at 320 px and 420 px show the footer fits without horizontal overflow.

The actual canvas screenshot returned 64 squares and 22 identified pieces, with correction requested for uncertain pieces. This is a successful safe fallback, not a claim of complete recognition for that screenshot. The 29/32 and 32/32 results above refer to the separate raster/template smoke check.

## Browser verification limits

The Playwright Chrome for Testing download returned an empty/truncated archive on this host. A separately obtained Chromium 153 headless-shell executable launched, but the extension service worker never appeared (30-second timeout); that executable does not establish a Chrome extension pass. **No full local Chrome pass is claimed.**

The expanded `npm run test:browser` suite and `.github/workflows/validate.yml` are provided for full Chromium: packaged worker under MV3 CSP, legal manual moves, native drag/drop, correction, underpromotion, terminal states, content synchronization, in-place Shadow DOM changes, same-tab reload/navigation, cancelled selection, renderer fixtures, and screenshot recognition. This suite was expanded here but could not complete locally. The successful CI run above provides real-browser evidence separately from the local runtime.

The browser harness uses a temporary manifest with host access to automate controlled localhost fixtures. It does not verify production toolbar-granted `activeTab` access. A desktop smoke check is still needed for toolbar opening, granting/revoking access across origins, native side-panel close/reopen, protected pages, and file-URL opt-in. Unit/jsdom tests cannot establish these browser behaviors.

## Remaining limits

Recognition remains template-based and cannot guarantee arbitrary websites, artwork, perspective/3D boards, occlusion, closed shadow roots or inaccessible frames. Unknown images require correction. DOM geometry still requires an axis-aligned board that fits the viewport. Pixels do not prove arbitrary midgame turn state, castling or en passant rights. Saved edited positions reset clocks and do not reconstruct repetition history. The retained review helper is not exposed as a PGN-import UI in the current app.
