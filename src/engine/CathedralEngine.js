/**
 * Cathedral Engine & Cathedral Ultra — Original Mathematical Search Engine
 * Implements:
 * - Iterative Deepening with Aspiration Windows
 * - Negamax with Alpha-Beta Pruning & Principal Variation Search (PVS)
 * - Null-Move Pruning (R=2 with non-pawn material Zugzwang safeguard)
 * - Quiescence Search with Stand-Pat, Delta Pruning, and SEE Bad-Capture Pruning
 * - Zobrist Transposition Table with Mate-Distance Normalization
 * - Move Ordering (TT, Promotions, SEE/MVV-LVA, Killer, Countermove, History)
 * - Check Extensions, 7th-Rank Pawn Push Extensions & Late Move Reductions (LMR)
 * - Support for Parameterized Evaluation (Experimental Learning Engine)
 */

import { ChessGame, sq88ToAlgebraic } from '../game/ChessGame.js';
import {
  evaluateForSideToMove,
  PIECE_VALUES_MG,
  explainPosition,
  DEFAULT_EVAL_PARAMS
} from './evaluation.js';
import {
  TranspositionTable,
  TT_EXACT,
  TT_LOWER,
  TT_UPPER,
  MATE_SCORE,
  MATE_THRESHOLD,
  scoreFromTT,
  encodeMoveKey
} from './transpositionTable.js';
import { MoveOrderer, MAX_PLY } from './moveOrdering.js';

export const DIFFICULTY_PRESETS = {
  Apprentice: {
    name: 'Apprentice',
    label: 'Apprentice · Novice Sanctuary',
    maxDepth: 2,
    timeLimitMs: 180,
    nodeLimit: 1200,
    randomnessCp: 55,
    useUltraSearch: false,
    description: 'Shallow tactical horizon (depth 2) with slight positional variance.'
  },
  Initiate: {
    name: 'Initiate',
    label: 'Initiate · Club Tactician',
    maxDepth: 3,
    timeLimitMs: 350,
    nodeLimit: 8000,
    randomnessCp: 18,
    useUltraSearch: false,
    description: 'Solid 3-ply tactical search with quiescence capture resolution.'
  },
  Mage: {
    name: 'Mage',
    label: 'Mage · Balanced Cathedral',
    maxDepth: 5,
    timeLimitMs: 850,
    nodeLimit: 55000,
    randomnessCp: 0,
    useUltraSearch: true,
    description: '5-ply iterative deepening search with full positional & tactical evaluation.'
  },
  Archmage: {
    name: 'Archmage',
    label: 'Archmage · Master Tactician',
    maxDepth: 7,
    timeLimitMs: 1600,
    nodeLimit: 180000,
    randomnessCp: 0,
    useUltraSearch: true,
    description: 'Deep iterative search with PVS, transposition tables, killer & history heuristics.'
  },
  Ultra: {
    name: 'Ultra',
    label: 'ULTRA · Maximum Search',
    maxDepth: 9,
    timeLimitMs: 2400,
    nodeLimit: 450000,
    randomnessCp: 0,
    useUltraSearch: true,
    description: 'Maximum strength non-neural engine with Null-Move Pruning, SEE, Aspiration Windows, and Countermoves.'
  },
  Experimental: {
    name: 'Experimental',
    label: 'EXPERIMENTAL · Self-Improving Research Mode',
    maxDepth: 6,
    timeLimitMs: 1200,
    nodeLimit: 140000,
    randomnessCp: 0,
    useUltraSearch: true,
    description: 'Uses evaluation parameters evolved through headless self-play in the Training Lab.'
  },
  Analysis: {
    name: 'Analysis',
    label: 'Analysis · Multi-PV Deep Review',
    maxDepth: 8,
    timeLimitMs: 2500,
    nodeLimit: 380000,
    randomnessCp: 0,
    useUltraSearch: true,
    description: 'Uncompromised multi-candidate deep search for position review and X-Ray forecasting.'
  }
};

export class CathedralEngine {
  constructor(ttSize = 1 << 17) {
    this.tt = new TranspositionTable(ttSize);
    this.orderer = new MoveOrderer();
    this.nodes = 0;
    this.qNodes = 0;
    this.startTime = 0;
    this.timeLimitMs = 1000;
    this.nodeLimit = 100000;
    this.aborted = false;
    this.stopReason = 'completed';
    this.stopRequested = false;
    this.evalParams = null;
    this.useUltraSearch = true;
    this.rootHistoryLen = 1;
  }

  clearCache() {
    this.tt.clear();
    this.orderer.clear();
  }

  requestStop() {
    this.stopRequested = true;
  }

  checkLimits() {
    if (this.stopRequested) {
      this.aborted = true;
      this.stopReason = 'user_cancelled';
      return true;
    }
    if (this.activeRootDepth <= 1) return false;
    if (this.nodes + this.qNodes >= this.nodeLimit) {
      this.aborted = true;
      this.stopReason = 'node_limit';
      return true;
    }
    if (((this.nodes + this.qNodes) & 63) === 0) {
      if (performance.now() - this.startTime >= this.timeLimitMs) {
        this.aborted = true;
        this.stopReason = 'time_limit';
        return true;
      }
    }
    return false;
  }

  quiescence(game, alpha, beta, ply) {
    if (this.checkLimits()) return 0;
    this.qNodes++;

    if (game.in_fifty_move_rule() || game.isSearchRepetition(this.rootHistoryLen) || game.insufficient_material()) {
      return 0;
    }

    const inCheck = game.in_check();
    let standPat = 0;

    if (!inCheck) {
      standPat = evaluateForSideToMove(game, this.evalParams);
      if (standPat >= beta) return beta;
      if (standPat > alpha) alpha = standPat;
    }

    if (ply >= this.maxQuiescencePly) {
      return inCheck ? evaluateForSideToMove(game, this.evalParams) : standPat;
    }

    const moves = game.generatePseudoMoves(!inCheck);
    this.orderer.scoreMoves(moves, 0, ply, null, null);

    let legalCount = 0;
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];

      if (!inCheck && !m.promotion && m.captured) {
        const victimVal = PIECE_VALUES_MG[m.captured] || 100;
        if (standPat + victimVal + 185 < alpha) continue;
        const attackerVal = PIECE_VALUES_MG[m.piece] || 100;
        if (attackerVal > victimVal && game.staticExchangeEvaluation(m) < 0) continue;
      }

      if (!game.makeMoveRaw(m)) continue;
      legalCount++;
      const score = -this.quiescence(game, -beta, -alpha, ply + 1);
      game.unmakeMoveRaw();

      if (this.aborted) return 0;

      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }

    if (inCheck && legalCount === 0) return -MATE_SCORE + ply;
    return alpha;
  }

  negamax(game, depth, alpha, beta, ply, isPvNode, allowNullMove = true, prevMove = null) {
    if (this.checkLimits()) return 0;

    if (ply > 0) {
      if (game.in_fifty_move_rule() || game.isSearchRepetition(this.rootHistoryLen) || game.insufficient_material()) {
        return 0;
      }
      const mateAlpha = Math.max(alpha, -MATE_SCORE + ply);
      const mateBeta = Math.min(beta, MATE_SCORE - ply - 1);
      if (mateAlpha >= mateBeta) return mateAlpha;
    }

    const inCheck = game.in_check();
    if (inCheck && ply < MAX_PLY - 2) {
      depth++;
    }

    if (depth <= 0 || ply >= MAX_PLY - 1) {
      return this.quiescence(game, alpha, beta, ply);
    }

    this.nodes++;
    const origAlpha = alpha;
    const hash = game.hash;

    const ttEntry = this.tt.probe(hash);
    let ttBestMoveKey = 0;
    if (ttEntry) {
      ttBestMoveKey = ttEntry.bestMoveKey;
      if (!isPvNode && ttEntry.depth >= depth) {
        const ttScore = scoreFromTT(ttEntry.score, ply);
        if (ttEntry.bound === TT_EXACT) return ttScore;
        if (ttEntry.bound === TT_LOWER && ttScore >= beta) return ttScore;
        if (ttEntry.bound === TT_UPPER && ttScore <= alpha) return ttScore;
      }
    }

    // Null-Move Pruning (Cathedral Ultra / Archmage / Mage) with Zugzwang guard
    if (
      this.useUltraSearch &&
      allowNullMove &&
      !isPvNode &&
      !inCheck &&
      depth >= 3 &&
      Math.abs(beta) < MATE_THRESHOLD &&
      game.hasNonPawnMaterial(game.stm)
    ) {
      const staticEval = evaluateForSideToMove(game, this.evalParams);
      if (staticEval >= beta) {
        const R = depth >= 6 ? 3 : 2;
        game.makeNullMove();
        const nullScore = -this.negamax(game, depth - 1 - R, -beta, -beta + 1, ply + 1, false, false, null);
        game.unmakeNullMove();
        if (this.aborted) return 0;
        if (nullScore >= beta && Math.abs(nullScore) < MATE_THRESHOLD) {
          return beta;
        }
      }
    }

    const moves = game.generatePseudoMoves(false);
    this.orderer.scoreMoves(moves, ttBestMoveKey, ply, (this.useUltraSearch && depth >= 3) ? game : null, prevMove);

    let bestScore = -Infinity;
    let bestMove = null;
    let legalMovesCount = 0;

    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      if (!game.makeMoveRaw(m)) continue;
      legalMovesCount++;
      if (!bestMove) bestMove = m;

      let score;
      if (legalMovesCount === 1) {
        score = -this.negamax(game, depth - 1, -beta, -alpha, ply + 1, isPvNode, true, m);
      } else {
        let reduction = 0;
        const givesCheck = game.in_check();
        const isSeventhRankPawnPush =
          m.piece === 'p' && ((m.color === 'w' && (m.to >> 4) === 1) || (m.color === 'b' && (m.to >> 4) === 6));

        if (
          depth >= 3 &&
          i >= 3 &&
          !inCheck &&
          !givesCheck &&
          !isSeventhRankPawnPush &&
          !m.captured &&
          !m.promotion
        ) {
          reduction = i >= 8 && depth >= 5 ? 2 : 1;
        }

        score = -this.negamax(
          game,
          depth - 1 - reduction,
          -alpha - 1,
          -alpha,
          ply + 1,
          false,
          true,
          m
        );

        if (reduction > 0 && score > alpha) {
          score = -this.negamax(game, depth - 1, -alpha - 1, -alpha, ply + 1, false, true, m);
        }

        if (isPvNode && score > alpha && score < beta) {
          score = -this.negamax(game, depth - 1, -beta, -alpha, ply + 1, true, true, m);
        }
      }

      game.unmakeMoveRaw();

      if (this.aborted) return 0;

      if (score > bestScore) {
        bestScore = score;
        bestMove = m;
        if (score > alpha) {
          alpha = score;
          if (alpha >= beta) {
            this.orderer.recordKiller(ply, m);
            this.orderer.recordCounterMove(prevMove, m);
            this.orderer.recordHistory(m, depth);
            break;
          }
        }
      }
    }

    if (legalMovesCount === 0) {
      return inCheck ? -MATE_SCORE + ply : 0;
    }

    const bound =
      bestScore <= origAlpha ? TT_UPPER : bestScore >= beta ? TT_LOWER : TT_EXACT;
    this.tt.store(hash, depth, bestScore, bound, bestMove, ply);

    return bestScore;
  }

  extractPvSan(game, firstMoveRaw, maxLen = 8) {
    const pvSan = [];
    const pvLan = [];
    const madeCount = [];

    const allRoot = game.generateLegalMovesRaw(false);
    pvSan.push(game.moveToSan(firstMoveRaw, allRoot));
    pvLan.push(
      sq88ToAlgebraic(firstMoveRaw.from) +
        sq88ToAlgebraic(firstMoveRaw.to) +
        (firstMoveRaw.promotion || '')
    );

    game.makeMoveRaw(firstMoveRaw);
    madeCount.push(firstMoveRaw);

    const seenHashes = new Set([game.hash]);

    for (let d = 1; d < maxLen; d++) {
      const entry = this.tt.probe(game.hash);
      if (!entry || !entry.bestMoveKey) break;
      const legals = game.generateLegalMovesRaw(false);
      let nextMove = null;
      for (let i = 0; i < legals.length; i++) {
        if (encodeMoveKey(legals[i]) === entry.bestMoveKey) {
          nextMove = legals[i];
          break;
        }
      }
      if (!nextMove) break;
      pvSan.push(game.moveToSan(nextMove, legals));
      pvLan.push(
        sq88ToAlgebraic(nextMove.from) +
          sq88ToAlgebraic(nextMove.to) +
          (nextMove.promotion || '')
      );
      game.makeMoveRaw(nextMove);
      madeCount.push(nextMove);
      if (seenHashes.has(game.hash)) break;
      seenHashes.add(game.hash);
    }

    while (madeCount.length > 0) {
      game.unmakeMoveRaw();
      madeCount.pop();
    }

    return { pvSan, pvLan };
  }

  search(fen, options = {}) {
    const modeName = options.difficulty || 'Mage';
    const preset = DIFFICULTY_PRESETS[modeName] || DIFFICULTY_PRESETS.Mage;
    const maxDepth = options.maxDepth || preset.maxDepth;
    this.timeLimitMs = options.timeLimitMs || preset.timeLimitMs;
    this.nodeLimit = options.nodeLimit || preset.nodeLimit;
    this.evalParams = options.evalParams || null;
    this.useUltraSearch = preset.useUltraSearch !== false;
    this.maxQuiescencePly = options.fastSelfPlay ? maxDepth + 4 : Math.min(MAX_PLY - 1, maxDepth + 10);
    const multiPvCount = options.multiPv || 1;
    const onProgress = options.onProgress || null;

    const game = new ChessGame(fen);
    if (options.hashHistory && Array.isArray(options.hashHistory)) {
      game.hashHistory = [...options.hashHistory];
    } else if (options.historyMoves && Array.isArray(options.historyMoves) && options.startFen) {
      const replayGame = new ChessGame(options.startFen);
      for (const san of options.historyMoves) {
        replayGame.move(san);
      }
      if (replayGame.fen() === game.fen()) {
        game.hashHistory = [...replayGame.hashHistory];
      }
    }
    this.rootHistoryLen = game.hashHistory.length;

    const rootMoves = game.generateLegalMovesRaw(false);
    if (rootMoves.length === 0) {
      return {
        engineMode: modeName,
        bestMove: null,
        bestMoveSan: null,
        scoreSideToMoveCp: game.in_check() ? -MATE_SCORE : 0,
        scoreWhiteCp: game.in_check() ? (game.turn() === 'w' ? -MATE_SCORE : MATE_SCORE) : 0,
        mateIn: game.in_check() ? 0 : null,
        depth: 0,
        nodes: 0,
        nps: 0,
        elapsedMs: 0,
        pv: [],
        pvLan: [],
        candidates: [],
        stopReason: 'terminal',
        explanation: explainPosition(game, this.evalParams)
      };
    }

    this.nodes = 0;
    this.qNodes = 0;
    this.aborted = false;
    this.stopRequested = false;
    this.stopReason = 'completed_max_depth';
    this.startTime = performance.now();
    this.tt.newSearch();
    this.orderer.decayHistory();

    let completedDepth = 0;
    let bestRootMove = rootMoves[0];
    let bestScoreStm = evaluateForSideToMove(game, this.evalParams);
    let candidateResults = [];

    const effectiveMaxDepth = rootMoves.length === 1 ? Math.min(maxDepth, 2) : maxDepth;

    for (let currentDepth = 1; currentDepth <= effectiveMaxDepth; currentDepth++) {
      this.activeRootDepth = currentDepth;
      this.aborted = false;

      if (candidateResults.length > 0) {
        const orderMap = new Map(
          candidateResults.map((c, idx) => [encodeMoveKey(c.raw), 1000000 - idx * 1000])
        );
        rootMoves.sort(
          (a, b) => (orderMap.get(encodeMoveKey(b)) || 0) - (orderMap.get(encodeMoveKey(a)) || 0)
        );
      } else {
        const rootTt = this.tt.probe(game.hash);
        this.orderer.scoreMoves(rootMoves, rootTt ? rootTt.bestMoveKey : 0, 0, game, null);
      }

      const iterationCandidates = [];
      let alpha = -MATE_SCORE - 100;
      let beta = MATE_SCORE + 100;

      // Aspiration window for single-PV Ultra searches at depth >= 4
      if (this.useUltraSearch && multiPvCount === 1 && currentDepth >= 4 && Math.abs(bestScoreStm) < MATE_THRESHOLD) {
        alpha = bestScoreStm - 45;
        beta = bestScoreStm + 45;
      }

      for (let i = 0; i < rootMoves.length; i++) {
        const m = rootMoves[i];
        game.makeMoveRaw(m);

        let score;
        if (i < multiPvCount || i === 0) {
          score = -this.negamax(game, currentDepth - 1, -beta, -alpha, 1, true, true, m);
          // Re-search with full window if Aspiration window failed low or high
          if (!this.aborted && (score <= alpha || score >= beta)) {
            alpha = -MATE_SCORE - 100;
            beta = MATE_SCORE + 100;
            score = -this.negamax(game, currentDepth - 1, -beta, -alpha, 1, true, true, m);
          }
        } else {
          score = -this.negamax(game, currentDepth - 1, -alpha - 1, -alpha, 1, false, true, m);
          if (!this.aborted && score > alpha) {
            score = -this.negamax(game, currentDepth - 1, -beta, -alpha, 1, true, true, m);
          } else {
            score = alpha - 1 - i;
          }
        }

        game.unmakeMoveRaw();

        if (this.aborted) break;

        const whiteScore = game.turn() === 'w' ? score : -score;
        const mateIn = this.computeMateDistance(score, game.turn());
        const fromAlg = sq88ToAlgebraic(m.from);
        const toAlg = sq88ToAlgebraic(m.to);

        iterationCandidates.push({
          raw: m,
          from: fromAlg,
          to: toAlg,
          promotion: m.promotion || undefined,
          san: null,
          lan: fromAlg + toAlg + (m.promotion || ''),
          scoreSideToMoveCp: score,
          scoreWhiteCp: whiteScore,
          mateIn,
          pv: [],
          pvLan: []
        });

        if (i >= multiPvCount - 1 && score > alpha) {
          alpha = score;
        }
      }

      if (!this.aborted || completedDepth === 0) {
        if (iterationCandidates.length > 0) {
          iterationCandidates.sort((a, b) => b.scoreSideToMoveCp - a.scoreSideToMoveCp);
          const topCount = options.fastSelfPlay ? 1 : Math.min(iterationCandidates.length, Math.max(multiPvCount, 3));
          for (let k = 0; k < topCount; k++) {
            const c = iterationCandidates[k];
            const { pvSan, pvLan } = this.extractPvSan(game, c.raw, options.fastSelfPlay ? 2 : Math.min(currentDepth + 2, 8));
            c.san = pvSan[0];
            c.pv = pvSan;
            c.pvLan = pvLan;
          }
          candidateResults = iterationCandidates;
          bestRootMove = candidateResults[0].raw;
          bestScoreStm = candidateResults[0].scoreSideToMoveCp;
          completedDepth = currentDepth;
          this.tt.store(game.hash, currentDepth, bestScoreStm, TT_EXACT, bestRootMove, 0);
        }
      }

      const elapsedMs = Math.max(1, Math.round(performance.now() - this.startTime));
      const totalNodes = this.nodes + this.qNodes;
      const nps = Math.round((totalNodes * 1000) / elapsedMs);

      if (onProgress && candidateResults.length > 0) {
        const top = candidateResults[0];
        onProgress({
          engineMode: modeName,
          depth: completedDepth,
          nodes: totalNodes,
          nps,
          elapsedMs,
          bestMoveSan: top.san,
          bestMoveLan: top.lan,
          scoreSideToMoveCp: top.scoreSideToMoveCp,
          scoreWhiteCp: top.scoreWhiteCp,
          mateIn: top.mateIn,
          pv: top.pv,
          candidates: candidateResults.slice(0, multiPvCount)
        });
      }

      if (this.aborted) break;
      if (Math.abs(bestScoreStm) > MATE_THRESHOLD) {
        const pliesToMate = MATE_SCORE - Math.abs(bestScoreStm);
        if (pliesToMate <= currentDepth) {
          this.stopReason = 'mate_found';
          break;
        }
      }
    }

    let chosenCandidate = candidateResults[0];
    if (
      preset.randomnessCp > 0 &&
      candidateResults.length > 1 &&
      Math.abs(candidateResults[0].scoreSideToMoveCp) < MATE_THRESHOLD
    ) {
      const viable = candidateResults.filter(
        c => candidateResults[0].scoreSideToMoveCp - c.scoreSideToMoveCp <= preset.randomnessCp
      );
      if (viable.length > 1) {
        const pickIdx = Number(game.hash & 0xffffn) % viable.length;
        chosenCandidate = viable[pickIdx];
        if (!chosenCandidate.san) {
          const { pvSan, pvLan } = this.extractPvSan(game, chosenCandidate.raw, 4);
          chosenCandidate.san = pvSan[0];
          chosenCandidate.pv = pvSan;
          chosenCandidate.pvLan = pvLan;
        }
      }
    }

    const elapsedMs = Math.max(1, Math.round(performance.now() - this.startTime));
    const totalNodes = this.nodes + this.qNodes;
    const nps = Math.round((totalNodes * 1000) / elapsedMs);

    return {
      engineMode: modeName,
      bestMove: {
        from: chosenCandidate.from,
        to: chosenCandidate.to,
        promotion: chosenCandidate.promotion,
        san: chosenCandidate.san,
        lan: chosenCandidate.lan
      },
      bestMoveSan: chosenCandidate.san,
      bestMoveLan: chosenCandidate.lan,
      scoreSideToMoveCp: chosenCandidate.scoreSideToMoveCp,
      scoreWhiteCp: chosenCandidate.scoreWhiteCp,
      mateIn: chosenCandidate.mateIn,
      depth: completedDepth,
      nodes: totalNodes,
      qNodes: this.qNodes,
      nps,
      elapsedMs,
      pv: chosenCandidate.pv,
      pvLan: chosenCandidate.pvLan,
      candidates: candidateResults.slice(0, Math.max(multiPvCount, 3)).map(c => ({
        san: c.san,
        lan: c.lan,
        from: c.from,
        to: c.to,
        scoreWhiteCp: c.scoreWhiteCp,
        scoreSideToMoveCp: c.scoreSideToMoveCp,
        mateIn: c.mateIn,
        pv: c.pv
      })),
      stopReason: this.stopReason,
      explanation: options.fastSelfPlay ? null : explainPosition(game, this.evalParams)
    };
  }

  computeMateDistance(scoreStm, stm) {
    if (Math.abs(scoreStm) <= MATE_THRESHOLD) return null;
    const plies = MATE_SCORE - Math.abs(scoreStm);
    const fullMoves = Math.max(1, Math.ceil(plies / 2));
    const sign = scoreStm > 0 ? 1 : -1;
    const whiteSign = stm === 'w' ? sign : -sign;
    return {
      movesForSideToMove: sign * fullMoves,
      movesForWhite: whiteSign * fullMoves,
      plies
    };
  }
}
