# Legit playing strength

Legit is an optional practice/analysis configuration of the **existing bundled
Stockfish.js 19.0.1 Lite WASM engine**, not another engine or neural network.
Stockfish remains the default. Open Options → Configuration → Legit · Practice
to reveal Playing Strength. Default Legit has no rating claim; a named preset
or a custom target (400–3000) is optional. Custom edits apply on blur or Enter.

**Calibration status: provisional.** The displayed numbers are approximate,
FIDE-style training targets, not measured FIDE playing strengths. The labels do
not award titles or imply certified ratings. Behavioral tests, engine tests and
browser integration tests do not establish human equivalence. In particular,
this implementation cannot honestly claim to reproduce an IM's or GM's thinking.

## Research and design rationale

Sources reviewed on 1 November 2026. The findings below guide the design; the
numeric parameter values are engineering hypotheses, not results reported by
these papers. No research establishes a universal calculation depth, mistake
frequency or playing style for each 100-point FIDE band.

1. **Pattern recognition and useful candidates.** Reingold, Charness, Pomplun
   and Stampe (2001), [Visual span in expert chess players](https://www.cs.umb.edu/~marc/pubs/reingold_et_al_psysci2001.pdf),
   found a perceptual advantage for experts in structured chess positions that
   did not generalize in the same way to random configurations. Familiar
   relationships between pieces help experts recognize plausible continuations.
   Their study includes Canadian-rated groups; those ratings are not FIDE
   calibration data. Design inference: retain positional evaluation and give
   stronger profiles more recognition of development, king safety and loose
   pieces. Small hand-coded priors are only an approximation of this knowledge.

2. **GM and IM decisions are selective, not uniform exhaustive search.**
   Connors, Burns and Campitelli (2011), [Expertise in complex decision making](https://pubmed.ncbi.nlm.nih.gov/21981829/),
   compared six GMs, five IMs, six Experts and five Class A players using
   think-aloud tasks. GM/IM groups searched faster than the other groups; the
   findings also supported pattern recognition accounts. This does not justify
   assigning a literal fixed number of human plies to a title. Design inference:
   stronger profiles combine more search resources with tighter candidate
   discrimination. The engine's depth is a resource ceiling, not a claim about
   how many moves an actual person can calculate. Elite profiles allow close
   positional alternatives and do not require selecting the top line every time.

3. **Human errors depend on the position.** Anderson, Kleinberg and Mullainathan
   (2016), [Assessing Human Error Against a Benchmark of Perfection](https://www.microsoft.com/en-us/research/publication/assessing-human-error/),
   studied millions of games and solved tablebase positions. Features of the
   decision's difficulty were more predictive of mistakes than skill or time
   alone. Design inference: use evaluation gaps to concentrate choices when a
   necessary move is clearly better, and permit alternatives when the position
   is ambiguous. A constant random-blunder rate would miss this dependence.
   Our evaluation-gap proxy is not the paper's trained error predictor.

4. **Weaker Stockfish is not automatically a human model.** McIlroy-Young et al.
   (2020), [Aligning Superhuman AI with Human Behavior](https://www.cs.utoronto.ca/~ashton/pubs/maia-kdd2020.pdf),
   showed that depth-limited Stockfish did not match rating-specific human moves
   as well as models trained for that task. Maia used human game data; this PR
   does not include Maia, its weights, or a substitute neural engine. Its online
   rating bins must not be relabelled as FIDE ratings. Design inference: combine
   resource limits with positional priors and candidate weighting, and describe
   this honestly as a heuristic. Demonstrating human style ultimately needs
   held-out human move data, not just matching an average centipawn loss.

5. **Engine Elo is a separate scale.** The [official Stockfish UCI documentation](https://official-stockfish.github.io/docs/stockfish-wiki/UCI-Protocol-and-Stockfish-Commands.html#uci-elo)
   describes UCI_Elo as calibrated at 120s+1s against CCRL 40/4. Its
   [FAQ](https://official-stockfish.github.io/docs/stockfish-wiki/Stockfish-FAQ.html#the-elo-rating-of-stockfish)
   explains the dependence of ratings on opponents, time controls and test
   conditions. This browser's short searches and Lite network are different
   conditions. No UCI_Elo-to-FIDE conversion is made. Legit does not set
   UCI_Elo, UCI_LimitStrength or Skill Level, so switching back cannot leave a
   hidden strength limiter active.

6. **Title names are descriptive targets only.** The [FIDE Handbook](https://handbook.fide.com/)
   lists formal title regulations and [direct-title rules](https://handbook.fide.com/chapter/B01DirectTitles2026).
   Titles have qualification/award requirements beyond merely choosing a rating
   interval and can persist when a player's current rating changes. “Super GM”
   is an informal label. The dropdown follows the requested training bands,
   rather than claiming these bands classify every actual titled player.

## Strength profiles

Search limits, breadth and the distribution of candidate evaluation loss vary
together. The following values are **not empirically established FIDE mappings**.
They are centralized in `src/engine/legit.ts` for subsequent calibration.

| Selection            | Displayed target | Resource depth ceiling | Node ceiling |   Candidates | Temperature (cp) | Loss ceiling (cp) |
| -------------------- | ---------------- | ---------------------: | -----------: | -----------: | ---------------: | ----------------: |
| Default Legit        | No rating        |                      9 |       30,000 |            8 |               32 |               120 |
| Beginner             | Below 1200       |                      3 |        1,500 |           16 |              140 |               500 |
| Intermediate         | 1200–1599        |                      5 |        5,000 |           12 |               85 |               300 |
| Club Player          | 1600–1799        |                      7 |       15,000 |           10 |               50 |               180 |
| Advanced             | 1800–1999        |                      9 |       30,000 |            8 |               32 |               120 |
| Expert               | 2000–2199        |                     11 |       60,000 |            7 |               22 |                85 |
| Candidate Master     | 2200–2299        |                     12 |       90,000 |            6 |               16 |                65 |
| FIDE Master          | 2300–2399        |                     13 |      120,000 |            5 |               12 |                50 |
| International Master | 2400–2499        |                     14 |      160,000 |            5 |                9 |                40 |
| Grandmaster          | 2500–2699        |                     16 |      240,000 |            4 |                6 |                30 |
| Elite Grandmaster    | 2700+            |                     18 |      360,000 |            4 |                4 |                20 |
| Custom               | 400–3000         |           Interpolated | Interpolated | Interpolated |     Interpolated |      Interpolated |

Custom values interpolate between anchors, including endpoints at 400 and 3000.
Positional awareness increases with the target. For beginners, salient captures
and checks have a modest attraction; stronger profiles give more weight to
development, castling and avoiding loose pieces. The main positional evaluator
remains Stockfish's existing NNUE, not a new handcrafted chess engine.

Selection uses weights proportional to
`exp((candidateScore - bestScore + positionalPrior) / temperature)` among
candidates within the profile's loss ceiling. A larger gap reduces the chance
of missing a clear move. This is not a fixed probability of making an error.
The loss ceiling is relative to the completed shallow search; deeper analysis
can reveal a larger mistake. Higher profiles can still miss tactics outside
their search. Recognition of a winning mate overrides sampling. Losing mates
are avoided when a finite alternative exists; if all moves lose by mate, the
longest reported resistance is preferred. These choices intentionally simplify
human behavior and can make even the beginner tactically stronger than its label.

The number of candidates is bounded by the number of legal moves. Only legal,
exact evaluations from a complete, equally deep MultiPV iteration are compared.
An incomplete final iteration cannot replace the last complete set. If the
worker provides no scored line, its legal bestmove remains a safe fallback.
All published training results are final and retain the selected move's own
PV and evaluation, rather than displaying a different move with the best score.

## Compatibility and switching

- The base commit has no earlier Legit setting or Thinking Time Balance control.
  This change adds only the configuration selector and its dependent controls;
  the existing Thinking time dropdown (Quick/Balanced/Thorough) is retained with
  the same values and behavior.
- Legit searches stop at whichever of depth, nodes or that existing time budget
  is reached first. Device speed and the budget can change achieved depth and
  strength. There are no artificial delays or changes to timing behavior.
- All requests use the same Engine/worker lifecycle. Switching settings cancels
  the prior request, coalesces rapid changes and restarts analysis on the exact
  current FEN. Board position, clocks encoded in FEN, castling/en-passant rights,
  playing color, undo history and editor state are not reset. Paused analysis
  stays paused until resumed; editing still suspends analysis.
- Legit starts with a clear transposition table so previous deep analysis cannot
  supply hidden knowledge to a weaker profile. Training choices bypass the
  result cache. Stockfish searches keep their original commands and cache.
- Settings extend the existing `simpleSettings` record in Chrome local storage
  (localStorage in development). Old records remain Stockfish. Unknown presets,
  malformed records and invalid custom values fall back safely. Custom settings
  and the selected preset survive switching out of Legit and reopening the app.
- No board detection, permissions, move execution, third-party runtime assets,
  external services or engine downloads are added or changed. Like the original
  application, the manual board requires the user to enter both sides' moves.

## Verification and calibration protocol

Run `npm run build`, `npm test`, `npm run test:engine`, and
`npm run test:browser` (optionally set `CHROME_PATH`). Existing CI runs these.

The regression suite checks settings migration, custom bounds/interpolation,
candidate variation and decreasing expected loss on a controlled candidate set,
mate handling, both colors, castling, en passant and promotion. It checks
request isolation, incomplete MultiPV iterations, cache bypass, restoring
Stockfish, persistence and preserving moves/history during setting changes.
The real WASM smoke benchmark exercises all twelve selections on three
positions and independently evaluates selected child positions. It writes
`test-results/engine-report.json`. Its reference-loss numbers are noisy
diagnostics from a small sample, **not a strength estimate or human-style test**.
The Chrome test exercises actual MV3 storage, engine integration and reopening
an extension page, and saves a settings screenshot.

Before claiming that these targets have measured FIDE equivalence:

1. Freeze the engine/network, hardware class, time budget and protocol. Test
   Quick, Balanced and Thorough separately. Cover openings, tactical and quiet
   middlegames, endgames, both colors and unfamiliar positions.
2. Obtain consented/appropriately licensed human game or practice data tied to
   actual FIDE ratings and time controls. Online-platform Elo alone cannot anchor
   this scale. Hold out complete players/games to avoid fitting and evaluating
   on the same moves. Include sufficient actual IM/GM/elite examples.
3. Compare held-out move agreement, candidate-rank and evaluation-loss
   distributions, missed tactical motifs, positional choices and variation by
   position difficulty. Fit parameters on training data only. Do not force every
   player in a title band into a single uniform style.
4. Run balanced-color, varied-opening matches against consenting rated humans
   or an independently FIDE-anchored opponent pool. Use enough games for the
   prespecified confidence interval; a few wins, self-play or engine Elo alone
   do not validate a FIDE rating. Estimate strength with uncertainty, check
   ordering across adjacent presets and evaluate results on held-out games.
5. Publish the dataset/protocol, sample sizes, error intervals and failures.
   Retune the centralized parameters if needed. Until then retain the
   provisional wording, particularly for beginner and elite targets.

No rated-human calibration experiment or human-trained move predictor is
included in this PR. This scoped implementation provides functional controls,
a transparent heuristic and reproducible behavioral checks, not a certified
human simulation.
