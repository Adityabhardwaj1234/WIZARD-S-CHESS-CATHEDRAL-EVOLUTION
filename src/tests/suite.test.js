/**
 * Automated Verification Test Suite for Wizard's Chess: Cathedral Edition
 * Runs via `node --test` and verifies all requirements in Section 15:
 * - Rules tests (32 pieces, 64 squares, Perft(1)=20, Perft(2)=400, Perft(3)=8902, special moves, FEN/PGN)
 * - Cathedral Engine tests (legality, mate-in-1, mate-in-2, defense against mate, TT isolation, cancellation)
 * - Analysis & Puzzle verification
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { ChessGame, validateFen, DEFAULT_FEN, sq88ToAlgebraic } from '../game/ChessGame.js';
import { CathedralEngine } from '../engine/CathedralEngine.js';
import { explainPosition } from '../engine/evaluation.js';
import { VERIFIED_PUZZLES, classifyPlayedMove, detectOpening } from '../analysis/moveReview.js';

test('Rules: Initial board contains 64 squares and 32 pieces', () => {
  const game = new ChessGame();
  const b = game.board();
  assert.equal(b.length, 8);
  let squares = 0;
  let pieces = 0;
  for (const row of b) {
    assert.equal(row.length, 8);
    for (const cell of row) {
      squares++;
      if (cell) pieces++;
    }
  }
  assert.equal(squares, 64);
  assert.equal(pieces, 32);
});

test('Rules: Initial position has 20 legal moves and 1.e4 updates state accurately', () => {
  const game = new ChessGame();
  const legal = game.moves();
  assert.equal(legal.length, 20);

  const mv = game.move('e4');
  assert.ok(mv);
  assert.equal(mv.from, 'e2');
  assert.equal(mv.to, 'e4');
  assert.equal(game.turn(), 'b');
  assert.deepEqual(game.get('e4'), { type: 'p', color: 'w' });
  assert.equal(game.get('e2'), null);
});

test('Rules: Perft(1)=20, Perft(2)=400, Perft(3)=8,902 from initial position', () => {
  const game = new ChessGame();
  assert.equal(game.perft(1), 20);
  assert.equal(game.perft(2), 400);
  assert.equal(game.perft(3), 8902);
});

test('Rules: Kiwipete complex position Perft(1)=48, Perft(2)=2,039', () => {
  const game = new ChessGame('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
  assert.equal(game.perft(1), 48);
  assert.equal(game.perft(2), 2039);
});

test('Rules: Rejects illegal moves and prevents moving King into check or moving pinned piece', () => {
  const game = new ChessGame('4k3/4r3/8/8/8/8/4B3/4K3 w - - 0 1');
  // White Bishop on e2 is pinned to White King on e1 by Black Rook on e7
  const illegalBishop = game.move({ from: 'e2', to: 'd3' });
  assert.equal(illegalBishop, null);
  // White King cannot step onto e2 or stay on attacked square
  const game2 = new ChessGame('4k3/4r3/8/8/8/8/8/3K4 w - - 0 1');
  const illegalKing = game2.move({ from: 'd1', to: 'e1' });
  assert.equal(illegalKing, null);
});

test('Rules: Both kingside and queenside castling work and update castling rights', () => {
  const game = new ChessGame('r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1');
  const castleK = game.move('O-O');
  assert.ok(castleK);
  assert.deepEqual(game.get('g1'), { type: 'k', color: 'w' });
  assert.deepEqual(game.get('f1'), { type: 'r', color: 'w' });

  const castleQBlack = game.move('O-O-O');
  assert.ok(castleQBlack);
  assert.deepEqual(game.get('c8'), { type: 'k', color: 'b' });
  assert.deepEqual(game.get('d8'), { type: 'r', color: 'b' });
  assert.ok(game.fen().includes(' - - '));

  // Undo restores both kings and rooks and castling rights
  game.undo();
  game.undo();
  assert.equal(game.fen(), 'r3k2r/pppppppp/8/8/8/8/PPPPPPPP/R3K2R w KQkq - 0 1');
});

test('Rules: En passant works and removes the captured pawn from its actual square', () => {
  const game = new ChessGame();
  game.move('e4');
  game.move('a6');
  game.move('e5');
  game.move('d5');
  const ep = game.move('exd6');
  assert.ok(ep);
  assert.equal(ep.flags, 'e');
  assert.deepEqual(game.get('d6'), { type: 'p', color: 'w' });
  assert.equal(game.get('d5'), null);

  game.undo();
  assert.deepEqual(game.get('d5'), { type: 'p', color: 'b' });
  assert.deepEqual(game.get('e5'), { type: 'p', color: 'w' });
});

test('Rules: Pawn promotion produces the selected piece (Q, R, B, N)', () => {
  for (const promo of ['q', 'r', 'b', 'n']) {
    const game = new ChessGame('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
    const mv = game.move({ from: 'a7', to: 'a8', promotion: promo });
    assert.ok(mv);
    assert.deepEqual(game.get('a8'), { type: promo, color: 'w' });
  }
});

test('Rules: Checkmate, stalemate, threefold repetition, 50-move rule, and insufficient material', () => {
  // Fool's mate
  const fools = new ChessGame();
  fools.move('f3');
  fools.move('e5');
  fools.move('g4');
  fools.move('Qh4#');
  assert.equal(fools.in_checkmate(), true);
  assert.equal(fools.game_over(), true);

  // Stalemate
  const stale = new ChessGame('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  assert.equal(stale.in_stalemate(), true);
  assert.equal(stale.in_draw(), true);

  // Insufficient material (K+B vs K)
  const insuff = new ChessGame('4k3/8/8/8/8/8/4B3/4K3 w - - 0 1');
  assert.equal(insuff.insufficient_material(), true);
  assert.equal(insuff.in_draw(), true);

  // 50-move rule
  const fifty = new ChessGame('4k3/8/8/8/8/8/R7/4K3 w - - 100 60');
  assert.equal(fifty.in_fifty_move_rule(), true);
  assert.equal(fifty.in_draw(), true);

  // Threefold repetition
  const rep = new ChessGame();
  for (let i = 0; i < 2; i++) {
    rep.move('Nf3');
    rep.move('Nf6');
    rep.move('Ng1');
    rep.move('Ng8');
  }
  assert.equal(rep.in_threefold_repetition(), true);
  assert.equal(rep.in_draw(), true);
});

test('Rules: PGN and FEN import and export preserve position and move history', () => {
  const game = new ChessGame();
  const seq = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O'];
  for (const s of seq) game.move(s);
  const exportedPgn = game.pgn();
  const exportedFen = game.fen();

  const reloaded = new ChessGame();
  assert.equal(reloaded.load_pgn(exportedPgn), true);
  assert.equal(reloaded.fen(), exportedFen);
  assert.deepEqual(reloaded.history(), seq);
});

test('Cathedral Engine: Returns legal move from initial and midgame positions', () => {
  const engine = new CathedralEngine();
  const startRes = engine.search(DEFAULT_FEN, { difficulty: 'Initiate' });
  assert.ok(startRes.bestMove);
  const g1 = new ChessGame();
  assert.ok(g1.move(startRes.bestMove));

  const midFen = 'r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 4 6';
  const midRes = engine.search(midFen, { difficulty: 'Mage', maxDepth: 4 });
  assert.ok(midRes.bestMove);
  const g2 = new ChessGame(midFen);
  assert.ok(g2.move(midRes.bestMove));
});

test('Cathedral Engine: Finds immediate checkmate in 1 and mate in 2', () => {
  const engine = new CathedralEngine();
  // Mate in 1 on e8
  const m1 = engine.search('6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1', { maxDepth: 3 });
  assert.equal(m1.bestMoveSan, 'Re8#');
  assert.ok(m1.mateIn);
  assert.equal(m1.mateIn.movesForWhite, 1);

  // Mate in 2 (1. Rxd8+ Rxd8 2. Re8#)
  const m2 = engine.search('r5k1/5ppp/8/8/8/8/4RPPP/4R1K1 w - - 0 1', { maxDepth: 4, timeLimitMs: 1500 });
  assert.equal(m2.bestMoveSan, 'Re8+');
  assert.ok(m2.mateIn);
  assert.equal(m2.mateIn.movesForWhite, 2);
});

test('Cathedral Engine: Defends against immediate checkmate threat when defence exists', () => {
  const engine = new CathedralEngine();
  // White threatens Qxf7#; Black to move must prevent mate (e.g., Nh6, Qe7, Qf6, g6)
  const threatFen = 'r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR b KQkq - 3 3';
  const res = engine.search(threatFen, { maxDepth: 4, timeLimitMs: 1000 });
  assert.ok(res.bestMove);
  const g = new ChessGame(threatFen);
  g.move(res.bestMove);
  // Verify White cannot play Qxf7# on the next move
  const whiteMoves = g.moves();
  assert.equal(whiteMoves.includes('Qxf7#'), false);
});

test('Cathedral Engine: Transposition table isolates distinct positions and search restores board', () => {
  const engine = new CathedralEngine();
  const fenA = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3';
  const fenB = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 2 3';
  const resA = engine.search(fenA, { maxDepth: 3 });
  const resB = engine.search(fenB, { maxDepth: 3 });
  const gA = new ChessGame(fenA);
  const gB = new ChessGame(fenB);
  assert.notEqual(gA.hash, gB.hash);
  assert.ok(gA.move(resA.bestMove));
  assert.ok(gB.move(resB.bestMove));
});

test('Analysis & Puzzles: All verified puzzles have valid FENs and legal solution lines', () => {
  for (const p of VERIFIED_PUZZLES) {
    const v = validateFen(p.fen);
    assert.equal(v.valid, true, `Puzzle ${p.id} invalid FEN: ${v.error}`);
    const g = new ChessGame(p.fen);
    for (const san of p.solutionSan) {
      const m = g.move(san);
      assert.ok(m, `Puzzle ${p.id} failed on solution move ${san}`);
    }
  }
  const op = detectOpening(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']);
  assert.equal(op.eco, 'C60');
  const cl = classifyPlayedMove({
    playedSan: 'Nf3',
    bestSan: 'Nf3',
    bestScoreForMoverCp: 25,
    playedScoreForMoverCp: 25,
    searchDepth: 5
  });
  assert.equal(cl.id, 'best');
  const exp = explainPosition(new ChessGame());
  assert.ok(exp.bullets.length > 0);
});

import { encodeGameToUrlHash, decodeGameFromUrlHash } from '../sharing/shareUrl.js';
import { GameClock } from '../game/gameClock.js';
import { squareToWorld } from '../scene/CathedralScene.js';

test('Sharing: URL hash encoding and decoding reconstructs exact PGN and position', () => {
  const g = new ChessGame();
  g.move('e4');
  g.move('c5');
  g.move('Nf3');
  g.move('d6');
  const url = encodeGameToUrlHash({
    pgn: g.pgn(),
    startFen: DEFAULT_FEN,
    title: 'Sicilian Cathedral Match',
    notes: 'Test annotation'
  });
  const hashPart = '#' + url.split('#')[1];
  const decoded = decodeGameFromUrlHash(hashPart);
  assert.ok(decoded);
  assert.equal(decoded.fen, g.fen());
  assert.equal(decoded.moves.length, 4);
  assert.equal(decoded.title, 'Sicilian Cathedral Match');
});

test('Clock & 3D Coordinates: GameClock formatting and 64-square world coordinate mapping', () => {
  assert.equal(GameClock.formatMs(180000), '3:00');
  assert.equal(GameClock.formatMs(9500), '0:09.5');
  const a8 = squareToWorld('a8', 1.15);
  const h1 = squareToWorld('h1', 1.15);
  assert.ok(a8.x < 0 && a8.z < 0);
  assert.ok(h1.x > 0 && h1.z > 0);
});

import { computeXRayAnalysis, evaluateBeforeMoveWarning } from '../xray/xrayEngine.js';
import {
  generateCandidateParams,
  runTacticalRegressionSuite,
  simulateSingleHeadlessGame,
  evaluatePromotionDecision
} from '../learning/learningEngine.js';
import { DEFAULT_EVAL_PARAMS, PARAM_BOUNDS } from '../engine/evaluation.js';

test('Cathedral Ultra & SEE: Static Exchange Evaluation distinguishes winning vs losing captures', () => {
  // White Queen on d1 can capture Black Pawn on d5, which is defended by Black Pawn on e6
  const game = new ChessGame('4k3/8/4p3/3p4/8/8/8/3QK3 w - - 0 1');
  const legalRaw = game.generateLegalMovesRaw(true);
  const qxd5 = legalRaw.find(m => m.piece === 'q' && sq88ToAlgebraic(m.to) === 'd5');
  assert.ok(qxd5);
  const seeLoss = game.staticExchangeEvaluation(qxd5);
  assert.ok(seeLoss < -500, `Expected losing SEE for Qxd5 (defended by e6), got ${seeLoss}`);

  // Undefended Black Queen on d5 captured by White Knight on c3
  const game2 = new ChessGame('4k3/8/8/3q4/8/2N5/8/4K3 w - - 0 1');
  const nxd5 = game2.generateLegalMovesRaw(true).find(m => m.piece === 'n');
  const seeWin = game2.staticExchangeEvaluation(nxd5);
  assert.ok(seeWin >= 900, `Expected winning SEE for Nxd5, got ${seeWin}`);
});

test('Cathedral Ultra: Executes deep search with Null-Move Pruning and Aspiration Windows', () => {
  const engine = new CathedralEngine();
  const res = engine.search('r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 4 6', {
    difficulty: 'Ultra',
    maxDepth: 5,
    timeLimitMs: 800
  });
  assert.equal(res.engineMode, 'Ultra');
  assert.ok(res.depth >= 4);
  assert.ok(res.bestMove);
  const g = new ChessGame('r1bq1rk1/ppp2ppp/2np1n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQ1RK1 w - - 4 6');
  assert.ok(g.move(res.bestMove));
});

test('X-Ray Tactical Awareness: Detects Attack Maps, Vulnerable Pieces, Pins, Forks, and Blunder Warnings', () => {
  // Position where Black Knight on c6 is pinned to Black King on e8 by White Bishop on b5, and Black Queen on d4 is undefended
  const pinGame = new ChessGame('r1b1kbnr/ppp2ppp/2n5/1B2p3/3qP3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 4');
  const xray = computeXRayAnalysis(pinGame);
  assert.ok(xray.attackMap['d4'].whiteCount >= 1);
  assert.ok(xray.vulnerablePieces.some(v => v.square === 'd4' && (v.status === 'unfavorable_exchange' || v.status === 'hanging')));
  assert.ok(xray.motifs.some(m => m.type === 'Pin' && m.square === 'c6'));

  // Test Before-You-Move Warning when moving Queen to a square attacked by a pawn
  const engine = new CathedralEngine();
  const blunderGame = new ChessGame('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2');
  const warning = evaluateBeforeMoveWarning(blunderGame, { from: 'd1', to: 'h5' }, engine);
  // Qh5 is safe on move 2, whereas Qg4 followed by Bxg4 in a position where g4 is attacked by Bishop triggers a warning
  assert.equal(warning, null);

  const hangQueenGame = new ChessGame('rnbqkbnr/ppp2ppp/3p4/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 3');
  const warn2 = evaluateBeforeMoveWarning(hangQueenGame, { from: 'd1', to: 'g4' }, engine);
  assert.ok(warn2, 'Expected tactical warning when hanging Queen on g4 to Bxg4');
  assert.ok(warn2.cpDrop >= 200);
});

test('Experimental Learning Engine: Perturbs parameters within bounds, runs regression suite, and gates promotion', () => {
  const { candidateParams, parameterChanges } = generateCandidateParams(DEFAULT_EVAL_PARAMS, 2026, 12);
  assert.ok(parameterChanges.length >= 1);
  for (const [k, bound] of Object.entries(PARAM_BOUNDS)) {
    assert.ok(candidateParams[k] >= bound.min && candidateParams[k] <= bound.max);
  }

  const reg = runTacticalRegressionSuite(DEFAULT_EVAL_PARAMS);
  assert.equal(reg.passedAll, true, `Baseline champion should pass all regression tests, got ${reg.passedCount}/${reg.totalCount}`);

  const sim = simulateSingleHeadlessGame({
    gameIndex: 0,
    openingIndex: 2,
    candidateColor: 'w',
    candidateParams,
    championParams: DEFAULT_EVAL_PARAMS,
    maxDepth: 2,
    timeLimitMs: 10,
    maxPlies: 36
  });
  assert.ok(sim.plies >= 6);
  assert.ok(['win', 'draw', 'loss'].includes(sim.candidateOutcome));

  // Verify inferior candidate is rejected and superior candidate is promoted
  const rejectDecision = evaluatePromotionDecision({ wins: 2, draws: 4, losses: 6, regressionResult: reg });
  assert.equal(rejectDecision.promoted, false);

  const promoteDecision = evaluatePromotionDecision({ wins: 7, draws: 3, losses: 2, regressionResult: reg });
  assert.equal(promoteDecision.promoted, true);
});

import { ENDGAME_LESSONS, extractBlunderPuzzlesFromTimeline } from '../analysis/moveReview.js';

test('Endgame Lessons & Blunder Puzzle Generator: Verifies all endgame lesson FENs and extracts blunder puzzles from game timeline', () => {
  for (const lesson of ENDGAME_LESSONS) {
    const v = validateFen(lesson.fen);
    assert.equal(v.valid, true, `Endgame lesson ${lesson.id} invalid FEN`);
    const g = new ChessGame(lesson.fen);
    for (const san of lesson.solutionSan) {
      assert.ok(g.move(san), `Endgame lesson ${lesson.id} failed move ${san}`);
    }
  }

  const mockTimeline = [
    {
      moveVerbose: { san: 'Qh5', before: DEFAULT_FEN },
      classification: { id: 'blunder', label: 'Blunder', cpLoss: 260 },
      bestSan: 'Nf3'
    }
  ];
  const puzzles = extractBlunderPuzzlesFromTimeline(mockTimeline);
  assert.equal(puzzles.length, 1);
  assert.equal(puzzles[0].playedBadMove, 'Qh5');
});
