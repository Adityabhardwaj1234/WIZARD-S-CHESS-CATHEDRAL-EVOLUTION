/**
 * Cathedral Typed Boundary
 *
 * The rules engine, clock and analysis helpers are plain JavaScript modules.
 * This file is the single place where they are cast into explicit TypeScript
 * shapes, so every component above this line gets real types instead of `any`.
 * Nothing here contains logic — it only describes the contract.
 */

import { ChessGame as ChessGameImpl, DEFAULT_FEN } from '../game/ChessGame.js';
import { GameClock as GameClockImpl, TIME_CONTROL_PRESETS } from '../game/gameClock.js';
import { classifyPlayedMove, detectOpening, extractBlunderPuzzlesFromTimeline } from '../analysis/moveReview.js';
import { computeXRayAnalysis, evaluateBeforeMoveWarning } from '../xray/xrayEngine.js';
import { evaluateForSideToMove, evaluatePositionWhite } from '../engine/evaluation.js';

export type PlayerColor = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';

export interface RawMove {
  from: number;
  to: number;
  color: PlayerColor;
  piece: PieceType;
  flags: string;
  promotion?: string;
  captured?: string;
}

export interface VerboseMove {
  color: PlayerColor;
  from: string;
  to: string;
  flags: string;
  piece: PieceType;
  captured?: string;
  promotion?: string;
  san: string;
  lan: string;
  before?: string;
  after?: string;
}

export interface BoardCell {
  square: string;
  type: PieceType;
  color: PlayerColor;
}

export interface OpeningEntry {
  eco: string;
  name: string;
  moves: string[];
}

export interface MoveClassification {
  id: string;
  label: string;
  badge: string;
  color: string;
  description: string;
  cpLoss: number;
  uncertain: boolean;
}

export interface XRayAttacker {
  square: string;
  type: PieceType;
  color: PlayerColor;
  value: number;
}

export interface XRaySquareInfo {
  square: string;
  whiteAttackers: XRayAttacker[];
  blackAttackers: XRayAttacker[];
  whiteCount: number;
  blackCount: number;
  netControl: number;
  control: 'white' | 'black' | 'contested' | 'neutral';
}

export interface XRayVulnerablePiece {
  square: string;
  type: PieceType;
  color: PlayerColor;
  severity: 'low' | 'medium' | 'high';
  attackers: number;
  defenders: number;
  netPressure: number;
  description: string;
}

export interface XRayMotif {
  type: 'Pin' | 'Fork' | 'Skewer' | 'Discovered';
  confidence: 'Confirmed' | 'Possible';
  color: PlayerColor;
  square: string;
  attackerSquare?: string;
  targetSquares: string[];
  description: string;
}

export interface XRayAnalysis {
  attackMap: Record<string, XRaySquareInfo>;
  vulnerablePieces: XRayVulnerablePiece[];
  kingSafety: {
    whiteInCheck: boolean;
    blackInCheck: boolean;
    candidateChecks: { square: string; color: PlayerColor; san: string; description: string }[];
    exposedKingZones: string[];
  };
  motifs: XRayMotif[];
}

export interface BeforeMoveWarning {
  severity: 'critical' | 'warning' | 'notice';
  title: string;
  message: string;
  refutationLine: string[];
  recommendedMove: string | null;
  cpDrop: number;
}

export interface ClockState {
  enabled: boolean;
  presetId: string;
  w: number;
  b: number;
  activeSide: PlayerColor | null;
  timedOutSide: PlayerColor | null;
}

export interface CathedralGame {
  hashHistory: string[];
  load(fen: string, options?: Record<string, unknown>): unknown;
  reset(): void;
  fen(): string;
  turn(): PlayerColor;
  board(): (BoardCell | null)[][];
  in_check(): boolean;
  isCheckmate(): boolean;
  isStalemate(): boolean;
  isInsufficientMaterial(): boolean;
  isThreefoldRepetition(): boolean;
  isDraw(): boolean;
  isGameOver(): boolean;
  moves(options?: { square?: string; verbose?: boolean }): VerboseMove[] | string[];
  move(moveInput: string | { from: string | number; to: string | number; promotion?: string }): VerboseMove | null;
  undo(): VerboseMove | null;
  history(options?: { verbose?: boolean }): VerboseMove[] | string[];
  pgn(options?: Record<string, unknown>): string;
  load_pgn(pgn: string): boolean;
}

export interface CathedralGameClock {
  configure(presetId: string): void;
  start(side: PlayerColor): void;
  switchTurn(completedSide: PlayerColor): void;
  stop(): void;
  getState(): ClockState;
}

interface EngineLike {
  search(fen: string, options: Record<string, unknown>): {
    bestMoveSan: string | null;
    scoreWhiteCp: number;
    mateIn: unknown;
    pv: string[];
    depth: number;
  };
}

const GameCtor = ChessGameImpl as unknown as new (fen?: string) => CathedralGame;
const ClockCtor = GameClockImpl as unknown as new (
  presetId?: string,
  onTick?: ((state: ClockState) => void) | null,
  onTimeout?: ((side: PlayerColor) => void) | null
) => CathedralGameClock;

const reviewApi = {
  classifyPlayedMove: classifyPlayedMove as unknown as (args: {
    playedSan: string;
    bestSan: string | null;
    bestScoreForMoverCp: number;
    playedScoreForMoverCp: number;
    searchDepth: number;
  }) => MoveClassification,
  detectOpening: detectOpening as unknown as (sanHistory: string[]) => OpeningEntry | null,
  extractBlunderPuzzlesFromTimeline: extractBlunderPuzzlesFromTimeline as unknown as (
    timeline: { moveVerbose: { san: string; before: string }; classification: MoveClassification; bestSan?: string }[]
  ) => { id: string; title: string; theme: string; difficulty: string; fen: string; playedBadMove: string; solutionSan: string[]; explanation: string }[]
};

const xrayApi = {
  computeXRayAnalysis: computeXRayAnalysis as unknown as (game: CathedralGame) => XRayAnalysis,
  evaluateBeforeMoveWarning: evaluateBeforeMoveWarning as unknown as (
    game: CathedralGame,
    candidate: VerboseMove,
    engine: EngineLike
  ) => BeforeMoveWarning | null
};

export const DEFAULT_START_FEN = DEFAULT_FEN as string;
export const CLOCK_PRESETS = TIME_CONTROL_PRESETS as Record<
  string,
  { id: string; label: string; initialMs: number; incrementMs: number }
>;
export const moveReview = reviewApi;
export const xray = xrayApi;

export function createGame(fen: string = DEFAULT_FEN): CathedralGame {
  return new GameCtor(fen);
}

export function createClock(
  presetId: string,
  onTick: ((state: ClockState) => void) | null,
  onTimeout: ((side: PlayerColor) => void) | null
): CathedralGameClock {
  return new ClockCtor(presetId, onTick, onTimeout);
}

/** Synchronous, search-free evaluation from the side-to-move's perspective. */
export function quickEval(game: CathedralGame): number {
  return (evaluateForSideToMove as unknown as (g: CathedralGame) => number)(game);
}

/** Synchronous, search-free evaluation from White's perspective, with optional weights. */
export function evalWhite(game: CathedralGame, customParams: Record<string, number> | null = null): number {
  return (
    evaluatePositionWhite as unknown as (g: CathedralGame, detailed: boolean, params: Record<string, number> | null) => number
  )(game, false, customParams);
}

/** Finds the king square for a colour on the current board. */
export function findKingSquare(game: CathedralGame, color: PlayerColor): string | null {
  for (const row of game.board()) {
    for (const cell of row) {
      if (cell && cell.color === color && cell.type === 'k') return cell.square;
    }
  }
  return null;
}

/** Human-readable terminal reason, or null when the game is still live. */
export function describeGameOver(game: CathedralGame): string | null {
  if (!game.isGameOver()) return null;
  if (game.isCheckmate()) {
    return game.turn() === 'w' ? 'Checkmate — Black wins (1–0)' : 'Checkmate — White wins (0–1)';
  }
  if (game.isStalemate()) return 'Stalemate — draw (½–½)';
  if (game.isThreefoldRepetition()) return 'Draw by threefold repetition (½–½)';
  if (game.isInsufficientMaterial()) return 'Draw by insufficient material (½–½)';
  return 'Draw by fifty-move rule (½–½)';
}

/** Reads verbose legal moves for a square, or [] when the square is not selectable. */
export function legalMovesFrom(game: CathedralGame, square: string): VerboseMove[] {
  if (!square) return [];
  const moves = game.moves({ square, verbose: true });
  return Array.isArray(moves) ? (moves as VerboseMove[]) : [];
}

export function allLegalMoves(game: CathedralGame): VerboseMove[] {
  const moves = game.moves({ verbose: true });
  return Array.isArray(moves) ? (moves as VerboseMove[]) : [];
}