# Wizard's Chess — Cathedral Evolution

> *Every move echoes through eternity.*

A complete 3D browser chess platform set inside a procedural Gothic cathedral, built on the original
mathematical **Cathedral Engine**. Next.js 15 (App Router + Turbopack), React 18, Three.js r128, and a
hand-written orthodox rules engine. Everything runs locally in the browser — no server, no account, no
network calls, no external engine binary.

---

## Quick start

```bash
npm install
npm run dev      # Turbopack dev server on http://localhost:3000
npm test         # 22 automated rules / perft / engine / analysis tests
npm run build    # production build
npm start        # serve the production build
```

Requires Node.js 18.18+ and a browser with WebGL (a non-3D fallback keeps the match playable without it).

---

## Features

### Play

- **3D Gothic cathedral board** — procedural vaulted architecture, marble and obsidian sculpted pieces,
  capture shatter effects, orbit/zoom camera, board flip, and coordinates.
- **Cathedral Engine** — iterative deepening with aspiration windows, Negamax alpha-beta with PVS,
  quiescence search, null-move pruning, Zobrist transposition table, LMR, check and 7th-rank
  extensions, and Multi-PV. Seven strength presets from *Apprentice* to *ULTRA*, plus *Experimental*.
- **Runs off the UI thread** — searches execute in a Web Worker. If a Worker cannot be created the client
  transparently falls back to the main thread rather than failing.
- **Chess clock** — six time controls with drift-compensated `performance.now()` timing and increment.
- **Move review** — every move is classified (Best / Excellent / Good / Inaccuracy / Mistake / Blunder)
  using centipawn loss against the engine's own evaluation, with no extra searches required.
- **Keyboard and non-3D play** — SAN entry and a full legal-move list, so the match is completely playable
  without the canvas.
- **Promotion picker, undo, resign, and live game-over resolution** (checkmate, stalemate, threefold
  repetition, fifty-move rule, insufficient material).

### Analysis & X-Ray

Six tactical awareness layers, rendered in 3D and reported as text:

| Layer | Content |
| --- | --- |
| A | Attack map — White / Black / contested control per square |
| B | Vulnerable and overloaded pieces via static exchange evaluation |
| C | King safety and candidate checks |
| D | Pins, forks, skewers and discovered attacks |
| E | Engine prediction arrow on the principal variation |
| F | On-demand blunder check of the move you just played |

Plus a dual-engine comparator contrasting the handcrafted evaluation against the weights evolved in the
Training Lab.

### Training Lab

Headless self-play evolution of the evaluation parameters across a pool of four Web Workers. Each
generation perturbs roughly half the parameters within their bounds, gates the candidate on an
eight-position mandatory tactical regression suite, plays a balanced candidate-vs-champion match, and only
promotes above 52% with a positive win margin. Promoted weights become the *Experimental* engine's
evaluation and are persisted to `localStorage`.

### Game Library

Locally persisted archive (capped at 60 records) with search, mode filtering, PGN export, deletion, and
shareable URLs encoded into the URL fragment (`#cathedral=…`) — no backend required.

---

## Keyboard shortcuts

`H` home · `P` play · `X` analysis · `T` training · `L` library · `S` settings

Shortcuts are suppressed while typing in a field so move entry keeps working.

---

## Architecture

```
src/
  app/
    layout.tsx           Root layout + metadata; loads the global stylesheet
    page.tsx             App shell, view routing, keyboard shortcuts
    icon.svg             Favicon
  components/
    TopNavbar.tsx        Primary navigation
    HomeDashboard.tsx    Control centre with real archive/training telemetry
    PlayView.tsx         Live match: board, clock, engine readout, move entry
    CathedralBoard.tsx   Imperative Three.js host (React owns nothing in the canvas)
    XRayOverlayPanel.tsx Tactical layers + blunder check + dual-engine comparator
    TrainingLab.tsx      Self-play generation runner and history
    GameLibrary.tsx      Saved archive browser
    SettingsView.tsx     Engine, clock and presentation preferences
  context/
    CathedralSession.tsx Single source of truth: game, clock, worker, settings, archive
  lib/
    cathedral.ts         Typed boundary for the JS rules/clock/analysis modules
    scene.ts             Typed boundary + WebGL-guarded loader for the 3D scene
    engineClient.ts      Worker-backed engine client with main-thread fallback
    options.ts           Difficulty and quality options derived from engine presets
    sound.ts             WebAudio cue synthesiser (no audio assets)
  game/
    ChessGame.js         Orthodox FIDE rules, 0x88 board, SAN/FEN/PGN, Perft
    gameClock.js         Drift-compensated chess clock
  engine/
    CathedralEngine.js   Iterative deepening Negamax / PVS / Quiescence / LMR / Multi-PV
    evaluation.js        Phase-tapered centipawn evaluation and explainable commentary
    moveOrdering.js      TT, promotions, MVV-LVA, killer moves, history
    positionHash.js      Incremental 64-bit Zobrist hashing
    transpositionTable.js Bounded TT with mate-distance normalisation
  learning/
    learningEngine.js    Parameter perturbation, regression suite, self-play, promotion
  xray/
    xrayEngine.js        Attack maps, vulnerabilities, motifs, before-move warnings
  analysis/
    moveReview.js        Move classification, ECO opening book, verified puzzles
  persistence/
    storage.js           Settings and saved-game archive (localStorage)
  sharing/
    shareUrl.js          URL-fragment game encoding and validation
  scene/
    CathedralScene.js    Procedural cathedral, board, pieces, animations, X-Ray overlays
  workers/
    engine.worker.js     Search worker
    training.worker.js   Self-play simulation worker
  styles/
    global.css           Gothic stone-and-gold theme
  tests/
    suite.test.js        Rules, perft, engine tactics, analysis, sharing, coordinates
```

### Design notes

**One typed boundary.** `src/game`, `src/engine`, `src/analysis`, `src/xray` and `src/scene` are plain
JavaScript. `src/lib/cathedral.ts` and `src/lib/scene.ts` cast them into explicit TypeScript shapes exactly
once, so every component above those files gets real types instead of `any`.

**Mutable engine, immutable snapshot.** `ChessGame` and `GameClock` are stateful classes and live in refs.
`CathedralSession` rebuilds an immutable snapshot after each mutation, so React stays predictable while the
engine keeps its internal state.

**Free classification.** When the engine finishes searching a position, that position's evaluation becomes
the baseline for the move that led into it. Because the app searches both the player's position (for the
eval bar and the hint) and its own reply, every move can be classified without a single additional search.

**Graceful degradation.** No WebGL → the board explains itself and the match continues via move entry.
No Worker → the engine runs on the main thread. No `localStorage` → defaults, with settings and archive
operations failing silently rather than throwing.

**Accessibility.** Semantic landmarks and ARIA labels throughout, visible `:focus-visible` rings, a
`prefers-reduced-motion` guard, keyboard navigation, and a full keyboard-only play path.

---

## Testing

```bash
npm test
```

22 tests via the Node.js built-in test runner, covering:

- Board setup, legal move generation, castling, en passant, promotion, check and pin legality
- **Perft** — initial position to depth 3 (8,902 nodes) and Kiwipete to depth 2 (2,039 nodes)
- Terminal states: checkmate, stalemate, threefold repetition, fifty-move rule, insufficient material
- PGN and FEN round-tripping
- Cathedral Engine: legal move selection, mate-in-1, mate-in-2, and checkmate defence
- Transposition table isolation and board restoration across searches
- Cathedral Ultra: null-move pruning, aspiration windows, SEE discrimination
- X-Ray detection of attack maps, pins, forks and blunder warnings
- Learning engine: bounded perturbation, regression gating, promotion decisions
- URL sharing, clock formatting, and 3D coordinate mapping

---

## Dependencies and licences

- **Three.js `0.128.0`** — MIT. 3D rendering.
- **Next.js `15.x`**, **React `18.x`** — MIT. Application framework.
- **Cathedral Engine, evaluation, procedural assets and UI** — original implementation, MIT.

No external neural networks, downloaded model weights, or Stockfish binaries are used. All engines,
evaluation and saved games are local to the browser.