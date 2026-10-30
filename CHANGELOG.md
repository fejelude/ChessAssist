# 1.2.0

Manual analysis now works from startup without a chess webpage. The existing board gains visible Play/Edit modes and Undo/Reset. Play permits each legal side in turn regardless of the selected playing color; Edit permits arbitrary relocation, palette addition/removal, Clear and Starting position.

A single workspace reducer owns the committed FEN, history, mode and manual/source ownership. Manual moves and edits stop synchronization until explicitly reconnected. Failed recognition preserves a working manual board. Edit validates before commit, clears obsolete history, and requires explicit choices for unknown castling or en passant. Every valid committed position is automatically analyzed; arrows remain limited to the selected side's actual turn.

62 tests pass, including real UI-to-WASM edited-position analysis. Actual Chrome startup was attempted but blocked by host socket restrictions; browser integration remains unverified.

# 1.1.0

Simplified the existing extension to playing color, a single recommendation and arrow, and Start/Pause. Removed repeated permission confirmation and the technical dashboard.

Automatic analysis now respects the selected color and actual side to move. The UI no longer blocks analysis on `document.hidden`. Worker readiness, cancellation and search watchdogs, one automatic restart, visible Retry, bestmove-only fallback, legality checks, and a bounded cache address blank/stuck analysis paths. Duplicate observations no longer clear a valid result without triggering another search.

Reused the engine binaries, rules, board, and recognition algorithms. Added a focused source bridge, automatic source connection, a smaller correction editor, and plain-language special-move controls. Source changes and independent manual moves invalidate old suggestions. Advanced options are moved to the menu.

48 tests pass, including a real React-to-WASM integration harness. Real Chromium launch was attempted but blocked by the host's socket restriction; browser integration remains explicitly unverified.
