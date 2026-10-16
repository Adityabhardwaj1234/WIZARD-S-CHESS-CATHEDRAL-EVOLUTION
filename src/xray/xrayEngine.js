/**
 * X-RAY: Tactical Awareness Intelligence Engine (Layers A–F)
 * Layer A: Attack Map (White/Black/Contested control & per-square attacker/defender inspector)
 * Layer B: Vulnerable & Overloaded Pieces (hanging, negative SEE, overloaded defenders)
 * Layer C: King Safety & Check Threats (check vectors, candidate checks, exposed king zone)
 * Layer D: Tactical Motifs Detector (Pins, Forks/Double Attacks, Skewers, Discovered Batteries)
 * Layer E: Future Prediction Arrows & Dual-Engine Comparison (Cathedral Ultra vs Experimental)
 * Layer F: Before-You-Move Blunder & Tactical Warning Analyser
 */

import {
  ChessGame,
  FILES,
  RANKS,
  sq88ToAlgebraic,
  algebraicTo88,
  SEE_PIECE_VALUES,
  BISHOP_OFFSETS,
  ROOK_OFFSETS
} from '../game/ChessGame.js';

const PIECE_LABELS = {
  p: 'Pawn',
  n: 'Knight',
  b: 'Bishop',
  r: 'Rook',
  q: 'Queen',
  k: 'King'
};

/**
 * Computes Layers A, B, C, and D directly from the authoritative ChessGame state.
 */
export function computeXRayAnalysis(game) {
  const attackMap = {}; // sqAlg -> { whiteAttackers: [], blackAttackers: [], control: 'white'|'black'|'contested'|'neutral', netControl: number }
  const vulnerablePieces = []; // Layer B
  const kingSafety = {
    whiteInCheck: game.isKingAttacked('w'),
    blackInCheck: game.isKingAttacked('b'),
    candidateChecks: [],
    exposedKingZones: []
  }; // Layer C
  const motifs = []; // Layer D: { type: 'Pin'|'Fork'|'Skewer'|'Discovered', confidence: 'Confirmed'|'Possible', square, targetSquares, description, color }

  // 1. Layer A: Compute full 64-square Attack Map
  const whiteProtectedTargets = new Map(); // defenderSqAlg -> [guardedPieceSqAlg...]
  const blackProtectedTargets = new Map();

  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq88 = (r << 4) | f;
      const sqAlg = FILES[f] + RANKS[r];
      const wAtt = game.getAttackersOfSquare(sq88, 'w');
      const bAtt = game.getAttackersOfSquare(sq88, 'b');

      let control = 'neutral';
      if (wAtt.length > 0 && bAtt.length === 0) control = 'white';
      else if (bAtt.length > 0 && wAtt.length === 0) control = 'black';
      else if (wAtt.length > 0 && bAtt.length > 0) control = 'contested';

      attackMap[sqAlg] = {
        square: sqAlg,
        whiteAttackers: wAtt,
        blackAttackers: bAtt,
        whiteCount: wAtt.length,
        blackCount: bAtt.length,
        netControl: wAtt.length - bAtt.length,
        control
      };

      const occupant = game.board88[sq88];
      if (occupant && occupant.type !== 'k') {
        if (occupant.color === 'w' && bAtt.length > 0) {
          for (const d of wAtt) {
            if (!whiteProtectedTargets.has(d.square)) whiteProtectedTargets.set(d.square, []);
            whiteProtectedTargets.get(d.square).push(sqAlg);
          }
        } else if (occupant.color === 'b' && wAtt.length > 0) {
          for (const d of bAtt) {
            if (!blackProtectedTargets.has(d.square)) blackProtectedTargets.set(d.square, []);
            blackProtectedTargets.get(d.square).push(sqAlg);
          }
        }
      }
    }
  }

  // 2. Layer B: Vulnerable & Overloaded Pieces
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq88 = (r << 4) | f;
      const sqAlg = FILES[f] + RANKS[r];
      const piece = game.board88[sq88];
      if (!piece || piece.type === 'k') continue;

      const info = attackMap[sqAlg];
      const enemyAttackers = piece.color === 'w' ? info.blackAttackers : info.whiteAttackers;
      const ourDefenders = piece.color === 'w' ? info.whiteAttackers : info.blackAttackers;
      const pieceVal = SEE_PIECE_VALUES[piece.type] || 100;

      if (enemyAttackers.length > 0) {
        const minEnemyVal = enemyAttackers[0].value;
        if (ourDefenders.length === 0) {
          vulnerablePieces.push({
            square: sqAlg,
            piece: piece.type,
            color: piece.color,
            status: 'hanging',
            severity: 'high',
            reason: `${piece.color === 'w' ? 'White' : 'Black'} ${PIECE_LABELS[piece.type]} on ${sqAlg} is attacked by ${enemyAttackers[0].square} and completely undefended.`
          });
        } else if (minEnemyVal < pieceVal) {
          vulnerablePieces.push({
            square: sqAlg,
            piece: piece.type,
            color: piece.color,
            status: 'unfavorable_exchange',
            severity: 'high',
            reason: `${piece.color === 'w' ? 'White' : 'Black'} ${PIECE_LABELS[piece.type]} (${pieceVal} cp) on ${sqAlg} is attacked by a lower-value ${PIECE_LABELS[enemyAttackers[0].type]} (${minEnemyVal} cp) from ${enemyAttackers[0].square}.`
          });
        } else if (enemyAttackers.length > ourDefenders.length) {
          vulnerablePieces.push({
            square: sqAlg,
            piece: piece.type,
            color: piece.color,
            status: 'outnumbered_defense',
            severity: 'medium',
            reason: `${piece.color === 'w' ? 'White' : 'Black'} ${PIECE_LABELS[piece.type]} on ${sqAlg} has ${enemyAttackers.length} attackers vs ${ourDefenders.length} defenders.`
          });
        }
      }

      // Check if this piece is an overloaded defender guarding >= 2 attacked friendly pieces
      const guardedMap = piece.color === 'w' ? whiteProtectedTargets : blackProtectedTargets;
      const guardedList = guardedMap.get(sqAlg) || [];
      if (guardedList.length >= 2) {
        vulnerablePieces.push({
          square: sqAlg,
          piece: piece.type,
          color: piece.color,
          status: 'overloaded',
          severity: 'medium',
          reason: `${piece.color === 'w' ? 'White' : 'Black'} ${PIECE_LABELS[piece.type]} on ${sqAlg} is overloaded defending both ${guardedList.slice(0, 2).join(' and ')}.`
        });
      }
    }
  }

  // 3. Layer C: King Safety & Candidate Checks
  const allLegalVerbose = game.moves({ verbose: true });
  for (const mv of allLegalVerbose) {
    if (mv.san.includes('+') || mv.san.includes('#')) {
      kingSafety.candidateChecks.push({
        from: mv.from,
        to: mv.to,
        san: mv.san,
        piece: mv.piece,
        color: mv.color
      });
    }
  }

  for (const side of ['w', 'b']) {
    const kSq = game.kingSq[side];
    if (kSq === -1) continue;
    const kr = kSq >> 4;
    const kf = kSq & 7;
    const enemy = side === 'w' ? 'b' : 'w';
    for (let dr = -1; dr <= 1; dr++) {
      for (let df = -1; df <= 1; df++) {
        if (dr === 0 && df === 0) continue;
        const nr = kr + dr;
        const nf = kf + df;
        if (nr < 0 || nr > 7 || nf < 0 || nf > 7) continue;
        const sqAlg = FILES[nf] + RANKS[nr];
        const att = enemy === 'w' ? attackMap[sqAlg].whiteAttackers : attackMap[sqAlg].blackAttackers;
        if (att.length > 0) {
          kingSafety.exposedKingZones.push({
            square: sqAlg,
            defendingKingSide: side,
            attackersCount: att.length
          });
        }
      }
    }
  }

  // 4. Layer D: Detect Pins, Skewers, and Active Forks
  // 4a. Pins & Skewers along sliding rays from Bishops, Rooks, Queens
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq88 = (r << 4) | f;
      const p = game.board88[sq88];
      if (!p || (p.type !== 'b' && p.type !== 'r' && p.type !== 'q')) continue;

      const dirs =
        p.type === 'b'
          ? BISHOP_OFFSETS
          : p.type === 'r'
          ? ROOK_OFFSETS
          : [...BISHOP_OFFSETS, ...ROOK_OFFSETS];

      const enemy = p.color === 'w' ? 'b' : 'w';
      const pSqAlg = sq88ToAlgebraic(sq88);

      for (const step of dirs) {
        let cur = sq88 + step;
        let firstHit = null;
        let secondHit = null;
        while (!(cur & 0x88)) {
          const occ = game.board88[cur];
          if (occ) {
            if (!firstHit) {
              firstHit = { sq88: cur, sqAlg: sq88ToAlgebraic(cur), ...occ };
            } else {
              secondHit = { sq88: cur, sqAlg: sq88ToAlgebraic(cur), ...occ };
              break;
            }
          }
          cur += step;
        }

        if (firstHit && secondHit) {
          // Absolute or Relative Pin: firstHit and secondHit are both enemy pieces, and secondHit is higher value (or King)
          if (firstHit.color === enemy && secondHit.color === enemy) {
            const v1 = SEE_PIECE_VALUES[firstHit.type] || 100;
            const v2 = SEE_PIECE_VALUES[secondHit.type] || 100;
            if (secondHit.type === 'k' || v2 > v1) {
              const pinKind = secondHit.type === 'k' ? 'Absolute Pin' : 'Relative Pin';
              motifs.push({
                type: 'Pin',
                confidence: 'Confirmed',
                color: p.color,
                square: firstHit.sqAlg,
                attackerSquare: pSqAlg,
                targetSquares: [firstHit.sqAlg, secondHit.sqAlg],
                description: `${pinKind}: ${p.color === 'w' ? 'White' : 'Black'} ${PIECE_LABELS[p.type]} on ${pSqAlg} pins ${PIECE_LABELS[firstHit.type]} on ${firstHit.sqAlg} to ${PIECE_LABELS[secondHit.type]} on ${secondHit.sqAlg}.`
              });
            } else if (v1 > v2 && (firstHit.type === 'k' || firstHit.type === 'q' || firstHit.type === 'r')) {
              motifs.push({
                type: 'Skewer',
                confidence: 'Confirmed',
                color: p.color,
                square: firstHit.sqAlg,
                attackerSquare: pSqAlg,
                targetSquares: [firstHit.sqAlg, secondHit.sqAlg],
                description: `Skewer: ${p.color === 'w' ? 'White' : 'Black'} ${PIECE_LABELS[p.type]} on ${pSqAlg} skewers ${PIECE_LABELS[firstHit.type]} on ${firstHit.sqAlg} in front of ${PIECE_LABELS[secondHit.type]} on ${secondHit.sqAlg}.`
              });
            }
          } else if (firstHit.color === p.color && secondHit.color === enemy && (secondHit.type === 'k' || secondHit.type === 'q')) {
            // Discovered attack battery: our own piece on firstHit masks our slider on pSqAlg from enemy King/Queen on secondHit
            motifs.push({
              type: 'Discovered Battery',
              confidence: 'Possible',
              color: p.color,
              square: firstHit.sqAlg,
              attackerSquare: pSqAlg,
              targetSquares: [firstHit.sqAlg, secondHit.sqAlg],
              description: `Discovered Attack Battery: Moving ${PIECE_LABELS[firstHit.type]} from ${firstHit.sqAlg} unmasks ${PIECE_LABELS[p.type]} on ${pSqAlg} toward ${PIECE_LABELS[secondHit.type]} on ${secondHit.sqAlg}.`
            });
          }
        }
      }
    }
  }

  // 4b. Active Forks (a piece simultaneously attacking >= 2 valuable or undefended enemy pieces)
  const attackerToEnemyTargets = new Map(); // attackerSqAlg -> { piece, color, targets: [] }
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq88 = (r << 4) | f;
      const targetPiece = game.board88[sq88];
      if (!targetPiece) continue;
      const targetSqAlg = FILES[f] + RANKS[r];
      const info = attackMap[targetSqAlg];
      const enemyAttackers = targetPiece.color === 'w' ? info.blackAttackers : info.whiteAttackers;
      const ourDefenders = targetPiece.color === 'w' ? info.whiteAttackers : info.blackAttackers;
      const targetVal = SEE_PIECE_VALUES[targetPiece.type] || 100;

      for (const att of enemyAttackers) {
        const attVal = att.value;
        // Count as a fork target if target is King, higher value than attacker, or undefended
        if (targetPiece.type === 'k' || targetVal > attVal || ourDefenders.length === 0) {
          if (!attackerToEnemyTargets.has(att.square)) {
            attackerToEnemyTargets.set(att.square, {
              square: att.square,
              type: att.type,
              color: att.color,
              targets: []
            });
          }
          attackerToEnemyTargets.get(att.square).targets.push({
            square: targetSqAlg,
            type: targetPiece.type
          });
        }
      }
    }
  }

  for (const [, forkInfo] of attackerToEnemyTargets.entries()) {
    if (forkInfo.targets.length >= 2) {
      const tNames = forkInfo.targets.map(t => `${PIECE_LABELS[t.type]} on ${t.square}`).join(' & ');
      motifs.push({
        type: 'Fork',
        confidence: 'Confirmed',
        color: forkInfo.color,
        square: forkInfo.square,
        attackerSquare: forkInfo.square,
        targetSquares: forkInfo.targets.map(t => t.square),
        description: `Active Fork: ${forkInfo.color === 'w' ? 'White' : 'Black'} ${PIECE_LABELS[forkInfo.type]} on ${forkInfo.square} simultaneously attacks ${tNames}.`
      });
    }
  }

  return {
    attackMap,
    vulnerablePieces,
    kingSafety,
    motifs
  };
}

/**
 * Layer F: Before-You-Move Tactical Warning Analyser
 * Evaluates a candidate human move before it is committed to warn if it allows
 * immediate mate, loses significant material, or walks into a forcing check/capture.
 */
export function evaluateBeforeMoveWarning(game, candidateMoveObj, engineInstance) {
  const testGame = new ChessGame(game.fen());
  const legalBefore = testGame.moves({ verbose: true });
  if (legalBefore.length <= 1) return null; // Forced move needs no warning

  // Fast 3-ply baseline evaluation before the move
  const baselineRes = engineInstance.search(testGame.fen(), {
    difficulty: 'Initiate',
    maxDepth: 3,
    timeLimitMs: 140,
    nodeLimit: 3500
  });

  const moverColor = testGame.turn();
  const moved = testGame.move(candidateMoveObj);
  if (!moved) return null;

  // Evaluate opponent's strongest reply after the candidate move
  const replyRes = engineInstance.search(testGame.fen(), {
    difficulty: 'Initiate',
    maxDepth: 3,
    timeLimitMs: 140,
    nodeLimit: 3500
  });

  const bestScoreForMover = baselineRes.scoreSideToMoveCp;
  const scoreAfterPlayedForMover = -replyRes.scoreSideToMoveCp;
  const cpDrop = bestScoreForMover - scoreAfterPlayedForMover;

  // Check if opponent now has forced mate
  if (replyRes.mateIn && replyRes.mateIn.movesForSideToMove > 0) {
    return {
      severity: 'critical',
      title: 'Critical Tactical Warning — Allows Forced Checkmate',
      message: `Playing ${moved.san} allows ${moverColor === 'w' ? 'Black' : 'White'} to force checkmate in ${replyRes.mateIn.movesForSideToMove} move(s) starting with ${replyRes.bestMoveSan}.`,
      refutationLine: replyRes.pv || [replyRes.bestMoveSan],
      recommendedMove: baselineRes.bestMoveSan,
      cpDrop
    };
  }

  if (cpDrop >= 145 && moved.san !== baselineRes.bestMoveSan) {
    const reasonText =
      replyRes.bestMoveSan && replyRes.bestMoveSan.includes('x')
        ? `allows a material-winning capture (${replyRes.bestMoveSan})`
        : replyRes.bestMoveSan && replyRes.bestMoveSan.includes('+')
        ? `exposes your King to a forcing check (${replyRes.bestMoveSan})`
        : `concedes ${(cpDrop / 100).toFixed(2)} pawns of tactical advantage after ${replyRes.bestMoveSan}`;

    return {
      severity: cpDrop >= 240 ? 'high' : 'medium',
      title: cpDrop >= 240 ? 'Blunder Warning' : 'Tactical Inaccuracy Warning',
      message: `Playing ${moved.san} ${reasonText}. Cathedral Engine recommends ${baselineRes.bestMoveSan} instead.`,
      refutationLine: replyRes.pv || [replyRes.bestMoveSan],
      recommendedMove: baselineRes.bestMoveSan,
      cpDrop
    };
  }

  return null;
}
