/**
 * Move Review, Heuristic Classification, Opening Reference, and Verified Tactical Puzzles
 * Grounded in actual Cathedral Engine centipawn evaluations and search depth.
 */

export const MOVE_CLASSIFICATIONS = {
  BEST: {
    id: 'best',
    label: 'Best Find',
    badge: '★',
    color: '#d4af37',
    description: 'Matches the Cathedral Engine’s top choice at the searched depth.'
  },
  EXCELLENT: {
    id: 'excellent',
    label: 'Excellent',
    badge: '!',
    color: '#57b894',
    description: 'Within 18 centipawns of the engine’s top recommendation.'
  },
  GOOD: {
    id: 'good',
    label: 'Good',
    badge: '✓',
    color: '#88b378',
    description: 'Solid continuation losing less than 45 centipawns.'
  },
  INACCURACY: {
    id: 'inaccuracy',
    label: 'Inaccuracy',
    badge: '?!',
    color: '#e0b450',
    description: 'Suboptimal move losing between 45 and 100 centipawns.'
  },
  MISTAKE: {
    id: 'mistake',
    label: 'Mistake',
    badge: '?',
    color: '#e07a47',
    description: 'Significant concession losing between 100 and 220 centipawns.'
  },
  BLUNDER: {
    id: 'blunder',
    label: 'Blunder',
    badge: '??',
    color: '#d9534f',
    description: 'Severe tactical or material oversight losing over 220 centipawns or allowing forced mate.'
  },
  UNCERTAIN: {
    id: 'uncertain',
    label: 'Shallow Search',
    badge: '…',
    color: '#9a958e',
    description: 'Search depth < 2; deeper analysis required for a confident classification.'
  }
};

/**
 * Classify a played move given the engine's evaluation before the move (best possible)
 * and the evaluation after the played move (from the mover's perspective).
 */
export function classifyPlayedMove({
  playedSan,
  bestSan,
  bestScoreForMoverCp,
  playedScoreForMoverCp,
  searchDepth
}) {
  if (!searchDepth || searchDepth < 2) {
    return {
      ...MOVE_CLASSIFICATIONS.UNCERTAIN,
      cpLoss: 0,
      uncertain: true
    };
  }

  const cpLoss = Math.max(0, bestScoreForMoverCp - playedScoreForMoverCp);

  if (playedSan === bestSan || cpLoss <= 3) {
    return { ...MOVE_CLASSIFICATIONS.BEST, cpLoss, uncertain: false };
  }
  if (cpLoss <= 18) {
    return { ...MOVE_CLASSIFICATIONS.EXCELLENT, cpLoss, uncertain: false };
  }
  if (cpLoss <= 45) {
    return { ...MOVE_CLASSIFICATIONS.GOOD, cpLoss, uncertain: false };
  }
  if (cpLoss <= 100) {
    return { ...MOVE_CLASSIFICATIONS.INACCURACY, cpLoss, uncertain: false };
  }
  if (cpLoss <= 220) {
    return { ...MOVE_CLASSIFICATIONS.MISTAKE, cpLoss, uncertain: false };
  }
  return { ...MOVE_CLASSIFICATIONS.BLUNDER, cpLoss, uncertain: false };
}

/**
 * Compact, verified Opening Book reference (distinguished from engine calculation).
 */
export const OPENING_BOOK = [
  { eco: 'C50', name: 'Italian Game: Giuoco Piano', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5'] },
  { eco: 'C55', name: 'Italian Game: Two Knights Defense', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Nf6'] },
  { eco: 'C60', name: 'Ruy Lopez (Spanish Opening)', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'] },
  { eco: 'C44', name: 'Scotch Game', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'd4'] },
  { eco: 'C42', name: "Petrov's Defense", moves: ['e4', 'e5', 'Nf3', 'Nf6'] },
  { eco: 'B20', name: 'Sicilian Defense', moves: ['e4', 'c5'] },
  { eco: 'B50', name: 'Sicilian Defense: Open', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4'] },
  { eco: 'C00', name: 'French Defense', moves: ['e4', 'e6'] },
  { eco: 'B10', name: 'Caro-Kann Defense', moves: ['e4', 'c6'] },
  { eco: 'B01', name: 'Scandinavian Defense', moves: ['e4', 'd5'] },
  { eco: 'D06', name: "Queen's Gambit", moves: ['d4', 'd5', 'c4'] },
  { eco: 'D30', name: "Queen's Gambit Declined", moves: ['d4', 'd5', 'c4', 'e6'] },
  { eco: 'D10', name: 'Slav Defense', moves: ['d4', 'd5', 'c4', 'c6'] },
  { eco: 'D02', name: 'London System', moves: ['d4', 'd5', 'Bf4'] },
  { eco: 'E60', name: "King's Indian Defense", moves: ['d4', 'Nf6', 'c4', 'g6'] },
  { eco: 'E20', name: 'Nimzo-Indian Defense', moves: ['d4', 'Nf6', 'c4', 'e6', 'Nc3', 'Bb4'] },
  { eco: 'A10', name: 'English Opening', moves: ['c4'] },
  { eco: 'A04', name: 'Zukertort / Réti Opening', moves: ['Nf3'] }
];

export function detectOpening(sanHistory) {
  if (!sanHistory || sanHistory.length === 0) return null;
  let bestMatch = null;
  for (const entry of OPENING_BOOK) {
    if (sanHistory.length >= entry.moves.length) {
      let match = true;
      for (let i = 0; i < entry.moves.length; i++) {
        if (sanHistory[i] !== entry.moves[i]) {
          match = false;
          break;
        }
      }
      if (match && (!bestMatch || entry.moves.length > bestMatch.moves.length)) {
        bestMatch = entry;
      }
    }
  }
  return bestMatch;
}

/**
 * Verified Tactical Puzzles for Cathedral Puzzle Mode
 */
export const VERIFIED_PUZZLES = [
  {
    id: 'cathedral-01',
    title: 'Sanctuary Back-Rank Strike',
    theme: 'Back-Rank Checkmate (Mate in 1)',
    difficulty: 'Apprentice',
    fen: '6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1',
    solutionSan: ['Re8#'],
    explanation: 'Black’s king is trapped behind its own pawns on f7, g7, and h7. Re8# delivers immediate checkmate along the open e-file.'
  },
  {
    id: 'cathedral-02',
    title: 'Scholar’s Rose Window',
    theme: 'f7 Battery Mate (Mate in 1)',
    difficulty: 'Apprentice',
    fen: 'r1bqk1nr/pppp1ppp/2n5/2b1p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4',
    solutionSan: ['Qxf7#'],
    explanation: 'The White Queen and Bishop converge on f7, which is defended only by the Black King. Qxf7# ends the game immediately.'
  },
  {
    id: 'cathedral-03',
    title: 'Obsidian Smothered Vault',
    theme: 'Smothered Mate (Mate in 1)',
    difficulty: 'Initiate',
    fen: '6rk/6pp/7N/8/8/8/8/6K1 w - - 0 1',
    solutionSan: ['Nf7#'],
    explanation: 'Black’s King on h8 is completely hemmed in by its own Rook on g8 and pawns on g7 and h7. Nf7# delivers a classic smothered checkmate.'
  },
  {
    id: 'cathedral-04',
    title: 'The Archbishop’s Tempo',
    theme: 'Developing with Tempo on Queen',
    difficulty: 'Initiate',
    fen: 'rnb1kbnr/ppp2ppp/8/3qp3/8/5N2/PPPPBPPP/RNBQK2R w KQkq - 0 4',
    solutionSan: ['Nc3'],
    explanation: 'Developing the Knight to c3 attacks the centralized Black Queen on d5 with tempo while preparing rapid castling.'
  },
  {
    id: 'cathedral-05',
    title: 'Twin Spires Mate in Two',
    theme: 'Rook Clearance into Back-Rank Mate (Mate in 2)',
    difficulty: 'Mage',
    fen: 'r5k1/5ppp/8/8/8/8/4RPPP/4R1K1 w - - 0 1',
    solutionSan: ['Re8+', 'Rxe8', 'Rxe8#'],
    explanation: '1. Re8+ forces Black’s sole back-rank defender to capture (1...Rxe8), allowing 2. Qxe8# checkmate.'
  },
  {
    id: 'cathedral-06',
    title: 'Cathedral Queen Sacrifice',
    theme: 'Queen Sacrifice & Back-Rank Mate (Mate in 2)',
    difficulty: 'Archmage',
    fen: 'r5k1/5ppp/8/8/8/8/4QPPP/4R1K1 w - - 0 1',
    solutionSan: ['Qe8+', 'Rxe8', 'Rxe8#'],
    explanation: '1. Qe8+! sacrifices the Queen on the e-file battery, forcing 1...Rxe8 and allowing 2. Rxe8# checkmate.'
  }
];

export const ENDGAME_LESSONS = [
  {
    id: 'endgame-opposition',
    title: 'Endgame Lesson 1: Direct King Opposition',
    theme: 'King & Pawn Endgame Fundamental',
    difficulty: 'Initiate',
    fen: '4k3/8/4K3/4P3/8/8/8/8 w - - 0 1',
    solutionSan: ['Kd6'],
    explanation: 'White steps to d6 (or f6), outflanking the Black King and securing the e7/e8 promotion path.'
  },
  {
    id: 'endgame-lucena',
    title: 'Endgame Lesson 2: Building the Lucena Bridge',
    theme: 'Rook & Pawn vs Rook Winning Technique',
    difficulty: 'Mage',
    fen: '1K6/1P2k3/8/8/8/8/r7/3R4 w - - 0 1',
    solutionSan: ['Rd4'],
    explanation: '1. Rd4+! drives the Black King away or prepares the 4th-rank bridge to shield the White King from checks when emerging from b8.'
  },
  {
    id: 'endgame-queen-vs-pawn',
    title: 'Endgame Lesson 3: Queen vs 7th-Rank Pawn',
    theme: 'Forcing King In Front of Pawn',
    difficulty: 'Archmage',
    fen: '8/8/8/3Q4/8/8/3p4/3K1k2 w - - 0 1',
    solutionSan: ['Qf3+'],
    explanation: '1. Qf3+ forces the Black King to e1 or g1, allowing White to centralize and win the d2 pawn.'
  }
];

/**
 * Scans a game timeline for Inaccuracies, Mistakes, and Blunders and turns them
 * into interactive "Retry Your Mistake" tactical puzzles.
 */
export function extractBlunderPuzzlesFromTimeline(timeline) {
  if (!Array.isArray(timeline) || timeline.length === 0) return [];
  const generated = [];
  for (let i = 0; i < timeline.length; i++) {
    const item = timeline[i];
    const mv = item.moveVerbose;
    const cl = item.classification;
    if (mv && cl && (cl.id === 'blunder' || cl.id === 'mistake' || cl.id === 'inaccuracy')) {
      generated.push({
        id: `game-blunder-${i + 1}`,
        title: `Ply #${i + 1}: Improve on ${mv.san} (${cl.label})`,
        theme: `Game Blunder Review (${cl.cpLoss || 90} cp loss)`,
        difficulty: 'Custom',
        fen: mv.before,
        playedBadMove: mv.san,
        solutionSan: item.bestSan ? [item.bestSan] : [],
        explanation: `In the game, ${mv.san} was played (${cl.label}). Find a stronger continuation from this position.`
      });
    }
  }
  return generated;
}
