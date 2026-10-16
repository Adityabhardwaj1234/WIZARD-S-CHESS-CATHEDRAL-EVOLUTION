'use client';

/**
 * Cathedral Session
 *
 * Single source of truth for the live match: the rules engine instance, the
 * clock, the search worker, the player's selection, persisted settings and the
 * saved-game archive. Every panel (Play, Analysis, Library, Settings) reads from
 * here, so navigating between views never destroys the game in progress.
 *
 * `ChessGame` and `GameClock` are mutable class instances, so they live in refs.
 * React state holds an immutable snapshot that is rebuilt after every mutation.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';

import { createEngineClient, type EngineClient, type EngineProgress, type EngineResult } from '../lib/engineClient';
import { playCue, setSoundEnabled } from '../lib/sound';
import {
  DEFAULT_START_FEN,
  allLegalMoves,
  createClock,
  createGame,
  describeGameOver,
  findKingSquare,
  legalMovesFrom,
  moveReview,
  type CathedralGame,
  type CathedralGameClock,
  type ClockState,
  type MoveClassification,
  type OpeningEntry,
  type PlayerColor,
  type VerboseMove
} from '../lib/cathedral';
import { loadLearningState } from '../learning/learningEngine';
import { DEFAULT_SETTINGS, deleteGameFromArchive, loadGameArchive, loadSettings, saveGameToArchive, saveSettings } from '../persistence/storage';

export type PlayMode = 'engine' | 'two-player';
export type VisualQuality = 'low' | 'medium' | 'high';

/** The six top-level destinations driven by the primary navigation. */
export type PrimaryView = 'home' | 'play' | 'analysis' | 'training' | 'library' | 'settings';

export interface Settings {
  difficulty: string;
  searchTimeMs: number;
  showLegalMoves: boolean;
  showMoveHints: boolean;
  showCoordinates: boolean;
  soundEnabled: boolean;
  animationsEnabled: boolean;
  reducedMotion: boolean;
  visualQuality: VisualQuality;
  timeControl: string;
}

export interface MoveMeta {
  san: string;
  byPlayer: PlayerColor;
  classification: MoveClassification | null;
}

export interface ArchivedGame {
  id: string;
  title: string;
  pgn: string;
  startFen: string;
  fen: string;
  result: string;
  difficulty: string;
  mode: PlayMode;
  humanColor: PlayerColor;
  moveCount: number;
  createdAt: string;
}

export interface TerminalState {
  label: string;
  loser: PlayerColor | null;
  draw: boolean;
}

export interface SessionSnapshot {
  fen: string;
  startFen: string;
  turn: PlayerColor;
  sanHistory: string[];
  moveCount: number;
  lastMove: VerboseMove | null;
  checkSquare: string | null;
  inCheck: boolean;
}

export interface XRayLayerConfig {
  enabled: boolean;
  attackMap: boolean;
  vulnerable: boolean;
  kingSafety: boolean;
  motifs: boolean;
  prediction: boolean;
}

export const DEFAULT_XRAY_LAYERS: XRayLayerConfig = {
  enabled: true,
  attackMap: true,
  vulnerable: true,
  kingSafety: true,
  motifs: true,
  prediction: true
};

type SearchReason = 'seed' | 'reply' | 'analysis';

interface BaselineEvaluation {
  fen: string;
  whiteCp: number;
  depth: number;
  bestSan: string | null;
  pv: string[];
}

export interface SessionApi {
  mounted: boolean;
  transport: 'worker' | 'main-thread' | 'pending';

  /**
   * Stable handle to the live, mutable rules-engine instance. Identity never
   * changes, so imperative consumers (the Three.js scene) can read the current
   * position without being re-created on every move.
   */
  gameHandle: { current: CathedralGame | null };

  settings: Settings;
  updateSettings: (patch: Partial<Settings>) => void;

  snapshot: SessionSnapshot;
  opening: OpeningEntry | null;
  moveMeta: MoveMeta[];
  terminal: TerminalState | null;

  selectedSquare: string | null;
  selectionMoves: VerboseMove[];
  clickSquare: (square: string) => void;
  clearSelection: () => void;

  /** Plays a legal move object through the normal commit path (clock, cues, meta). */
  playMove: (move: VerboseMove) => boolean;
  /** Plays a move by SAN or LAN; returns false when it is not legal here. */
  playSan: (san: string) => boolean;

  pendingPromotion: { from: string; to: string; color: PlayerColor } | null;
  resolvePromotion: (piece: 'q' | 'r' | 'b' | 'n') => void;
  cancelPromotion: () => void;

  mode: PlayMode;
  setMode: (mode: PlayMode) => void;
  humanColor: PlayerColor;
  setHumanColor: (color: PlayerColor) => void;

  boardFlipped: boolean;
  flipBoard: () => void;

  newGame: () => void;
  undoMove: () => void;
  resign: () => void;
  hintMove: VerboseMove | null;
  requestHint: () => void;
  clearHint: () => void;
  resignable: boolean;

  /**
   * The most recent move played by the human side (every move in two-player
   * mode). The blunder checker reviews this rather than the overall last move,
   * which after an engine reply would always be the engine's own move.
   */
  lastHumanMove: VerboseMove | null;

  clock: ClockState;
  clockLabel: (side: PlayerColor) => string;

  engineThinking: boolean;
  engineProgress: EngineProgress | null;
  engineResult: EngineResult | null;
  engineError: string | null;
  bestLine: string[];
  bestLineEval: number | null;
  stopEngine: () => void;

  xrayLayers: XRayLayerConfig;
  setXrayLayer: (patch: Partial<XRayLayerConfig>) => void;

  archive: ArchivedGame[];
  sessionGameId: string | null;
  saveCurrentGame: () => void;
  openArchivedGame: (record: ArchivedGame) => boolean;
  removeArchivedGame: (id: string) => void;
  refreshArchive: () => void;
}

const SessionContext = createContext<SessionApi | null>(null);

const IDLE_CLOCK: ClockState = {
  enabled: false,
  presetId: 'untimed',
  w: 0,
  b: 0,
  activeSide: null,
  timedOutSide: null
};

function buildSnapshot(game: CathedralGame, startFen: string): SessionSnapshot {
  const sanHistory = game.history() as string[];
  const verbose = game.history({ verbose: true }) as VerboseMove[];
  const turn = game.turn();
  const inCheck = game.in_check();
  return {
    fen: game.fen(),
    startFen,
    turn,
    sanHistory,
    moveCount: sanHistory.length,
    lastMove: verbose.length > 0 ? verbose[verbose.length - 1] : null,
    checkSquare: inCheck ? findKingSquare(game, turn) : null,
    inCheck
  };
}

function newId(): string {
  return `gm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/** Reads the champion evaluation weights produced by the Training Lab. */
function loadChampionParams(): Record<string, number> | null {
  if (typeof window === 'undefined') return null;
  try {
    const state = loadLearningState() as { championParams?: Record<string, number> };
    return state?.championParams ?? null;
  } catch (_err) {
    return null;
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  /* ----------------------------------------------------------------- refs */
  const gameRef = useRef<CathedralGame | null>(null);
  if (gameRef.current === null) gameRef.current = createGame();

  const clockRef = useRef<CathedralGameClock | null>(null);
  const engineRef = useRef<EngineClient | null>(null);
  const startFenRef = useRef<string>(DEFAULT_START_FEN);
  const sessionIdRef = useRef<string>(newId());
  const moveMetaRef = useRef<MoveMeta[]>([]);
  const baselineRef = useRef<BaselineEvaluation | null>(null);
  const searchTokenRef = useRef(0);
  const thinkingRef = useRef(false);
  const terminalRef = useRef<TerminalState | null>(null);
  const userMovedRef = useRef(false);
  const lastHumanMoveRef = useRef<VerboseMove | null>(null);
  const modeRef = useRef<PlayMode>('engine');
  const humanColorRef = useRef<PlayerColor>('w');

  /* ---------------------------------------------------------------- state */
  const [mounted, setMounted] = useState(false);
  const [transport, setTransport] = useState<SessionApi['transport']>('pending');
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS as Settings);
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(() => buildSnapshot(gameRef.current!, startFenRef.current));
  const [moveMeta, setMoveMeta] = useState<MoveMeta[]>([]);
  const [terminal, setTerminal] = useState<TerminalState | null>(null);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [selectionMoves, setSelectionMoves] = useState<VerboseMove[]>([]);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: string; to: string; color: PlayerColor } | null>(null);
  const [mode, setMode] = useState<PlayMode>('engine');
  const [humanColor, setHumanColor] = useState<PlayerColor>('w');
  const [boardFlipped, setBoardFlipped] = useState(false);
  const [clock, setClock] = useState<ClockState>(IDLE_CLOCK);
  const [engineThinking, setEngineThinking] = useState(false);
  const [engineProgress, setEngineProgress] = useState<EngineProgress | null>(null);
  const [engineResult, setEngineResult] = useState<EngineResult | null>(null);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [bestLine, setBestLine] = useState<string[]>([]);
  const [bestLineEval, setBestLineEval] = useState<number | null>(null);
  const [hintMove, setHintMove] = useState<VerboseMove | null>(null);
  const [lastHumanMove, setLastHumanMove] = useState<VerboseMove | null>(null);
  const [xrayLayers, setXrayLayers] = useState<XRayLayerConfig>(DEFAULT_XRAY_LAYERS);
  const [archive, setArchive] = useState<ArchivedGame[]>([]);
  const [sessionGameId, setSessionGameId] = useState<string | null>(null);

  /* -------------------------------------------------------------- helpers */
  const refresh = useCallback(() => {
    setSnapshot(buildSnapshot(gameRef.current!, startFenRef.current));
    setMoveMeta([...moveMetaRef.current]);
  }, []);

  const refreshArchive = useCallback(() => {
    setArchive(loadGameArchive() as ArchivedGame[]);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedSquare(null);
    setSelectionMoves([]);
  }, []);

  const stopEngine = useCallback(() => {
    searchTokenRef.current += 1;
    thinkingRef.current = false;
    engineRef.current?.requestStop();
    setEngineThinking(false);
  }, []);

  const resetTerminal = useCallback(() => {
    terminalRef.current = null;
    setTerminal(null);
  }, []);

  const clearLastHumanMove = useCallback(() => {
    lastHumanMoveRef.current = null;
    setLastHumanMove(null);
  }, []);

  /* ----------------------------------------------------- move classification */
  const applyClassification = useCallback((searchedFen: string, result: EngineResult) => {
    const baseline = baselineRef.current;
    const meta = moveMetaRef.current;
    const lastIndex = meta.length - 1;

    if (baseline && lastIndex >= 0 && meta[lastIndex].classification === null) {
      const played = meta[lastIndex];
      const moverIsWhite = played.byPlayer === 'w';
      const bestForMover = moverIsWhite ? baseline.whiteCp : -baseline.whiteCp;
      const playedForMover = moverIsWhite ? result.scoreWhiteCp : -result.scoreWhiteCp;
      const classification = moveReview.classifyPlayedMove({
        playedSan: played.san,
        bestSan: null,
        bestScoreForMoverCp: bestForMover,
        playedScoreForMoverCp: playedForMover,
        searchDepth: baseline.depth
      });
      moveMetaRef.current = meta.map((m, i) => (i === lastIndex ? { ...m, classification } : m));
      setMoveMeta([...moveMetaRef.current]);
    }

    baselineRef.current = {
      fen: searchedFen,
      whiteCp: result.scoreWhiteCp,
      depth: result.depth,
      bestSan: result.bestMoveSan,
      pv: result.pv ?? []
    };
  }, []);

  /* --------------------------------------------------------- clock control */
  const handClockTo = useCallback((nextSide: PlayerColor) => {
    const clockInstance = clockRef.current;
    if (!clockInstance) return;
    clockInstance.start(nextSide);
    setClock(clockInstance.getState());
  }, []);

  /* ---------------------------------------------------------------- search */
  const runSearch = useCallback(
    (reason: SearchReason) => {
      const engine = engineRef.current;
      if (!engine) return;

      const liveGame = gameRef.current!;
      if (liveGame.isGameOver() || terminalRef.current) return;

      // A previous search may still be in flight (e.g. the player moved while the
      // analysis search was running). Cancel it so the worker is free immediately.
      if (thinkingRef.current) {
        searchTokenRef.current += 1;
        engine.requestStop();
        thinkingRef.current = false;
      }

      const fen = liveGame.fen();
      const token = ++searchTokenRef.current;
      thinkingRef.current = true;
      setEngineThinking(true);
      setEngineError(null);
      setEngineProgress(null);

      const evalParams = settings.difficulty === 'Experimental' ? loadChampionParams() : null;

      engine.search(
        fen,
        {
          difficulty: settings.difficulty,
          timeLimitMs: settings.searchTimeMs,
          hashHistory: liveGame.hashHistory,
          evalParams
        },
        {
          onProgress: progress => {
            if (token !== searchTokenRef.current) return;
            setEngineProgress(progress);
          },
          onResult: result => {
            if (token !== searchTokenRef.current) return;
            thinkingRef.current = false;
            setEngineThinking(false);
            setEngineProgress(null);
            setEngineResult(result);
            applyClassification(fen, result);

            if (reason === 'reply' && result.bestMoveSan) {
              const applied = liveGame.move(result.bestMoveSan);
              if (!applied) {
                resetTerminal();
                return;
              }
              moveMetaRef.current = [
                ...moveMetaRef.current,
                { san: applied.san, byPlayer: applied.color, classification: null }
              ];
              handClockTo(applied.color === 'w' ? 'b' : 'w');
              playCue(applied.captured ? 'capture' : 'move');
              refresh();
              if (liveGame.in_check()) playCue('check');
              if (liveGame.isGameOver()) {
                playCue('gameover');
                const label = describeGameOver(liveGame);
                const loser: PlayerColor = liveGame.turn();
                terminalRef.current = { label: label ?? 'Game over', loser, draw: loser === null };
                setTerminal(terminalRef.current);
              }
            } else {
              setBestLine(result.pv ?? []);
              setBestLineEval(result.scoreWhiteCp);
            }
          },
          onError: message => {
            if (token !== searchTokenRef.current) return;
            thinkingRef.current = false;
            setEngineThinking(false);
            setEngineError(message);
          }
        }
      );
    },
    [applyClassification, handClockTo, refresh, settings.difficulty, settings.searchTimeMs]
  );

  /* --------------------------------------------------------- move committing */
  const commitMove = useCallback(
    (move: VerboseMove) => {
      const liveGame = gameRef.current!;
      const applied = liveGame.move(move);
      if (!applied) {
        playCue('illegal');
        return false;
      }

      moveMetaRef.current = [
        ...moveMetaRef.current,
        { san: applied.san, byPlayer: applied.color, classification: null }
      ];

      const playedByHuman = modeRef.current === 'two-player' || applied.color === humanColorRef.current;
      if (playedByHuman) {
        lastHumanMoveRef.current = applied;
        setLastHumanMove(applied);
      }

      setHintMove(null);
      clearSelection();
      setPendingPromotion(null);
      handClockTo(applied.color === 'w' ? 'b' : 'w');

      playCue(applied.captured ? 'capture' : applied.promotion ? 'promote' : 'move');
      refresh();

      if (liveGame.in_check()) playCue('check');
      if (liveGame.isGameOver()) {
        playCue('gameover');
        const label = describeGameOver(liveGame);
        const loser: PlayerColor = liveGame.turn();
        terminalRef.current = { label: label ?? 'Game over', loser, draw: label?.includes('½') ?? false };
        setTerminal(terminalRef.current);
      }
      return true;
    },
    [clearSelection, handClockTo, refresh]
  );

  /* --------------------------------------------------------------- actions */
  const newGame = useCallback(() => {
    const liveGame = gameRef.current!;
    stopEngine();
    liveGame.load(DEFAULT_START_FEN);
    startFenRef.current = DEFAULT_START_FEN;
    sessionIdRef.current = newId();
    moveMetaRef.current = [];
    baselineRef.current = null;
    userMovedRef.current = false;

    setSessionGameId(null);
    setMoveMeta([]);
    setHintMove(null);
    clearLastHumanMove();
    setEngineResult(null);
    setEngineProgress(null);
    setEngineError(null);
    setBestLine([]);
    setBestLineEval(null);
    resetTerminal();
    clearSelection();
    setPendingPromotion(null);
    refresh();

    if (clockRef.current) {
      clockRef.current.configure(settings.timeControl);
      setClock(clockRef.current.getState());
      clockRef.current.start('w');
    }

    if (mode === 'engine') runSearch('seed');
  }, [clearLastHumanMove, clearSelection, mode, refresh, resetTerminal, runSearch, settings.timeControl, stopEngine]);

  const undoMove = useCallback(() => {
    const liveGame = gameRef.current!;
    if (liveGame.history().length === 0) return;

    stopEngine();
    const steps = mode === 'engine' ? 2 : 1;
    for (let i = 0; i < steps; i++) {
      if (liveGame.history().length === 0) break;
      liveGame.undo();
      if (moveMetaRef.current.length > 0) moveMetaRef.current = moveMetaRef.current.slice(0, -1);
    }

    baselineRef.current = null;
    userMovedRef.current = false;
    setHintMove(null);
    clearLastHumanMove();
    setEngineResult(null);
    setEngineProgress(null);
    setBestLine([]);
    setBestLineEval(null);
    resetTerminal();
    clearSelection();
    setPendingPromotion(null);

    if (clockRef.current) {
      clockRef.current.configure(settings.timeControl);
      setClock(clockRef.current.getState());
      clockRef.current.start(liveGame.turn());
    }
    refresh();
  }, [clearLastHumanMove, clearSelection, mode, refresh, resetTerminal, settings.timeControl, stopEngine]);

  const resign = useCallback(() => {
    const liveGame = gameRef.current!;
    if (terminalRef.current) return;
    stopEngine();

    const loser: PlayerColor = mode === 'engine' ? humanColor : liveGame.turn();
    const winner = loser === 'w' ? 'Black' : 'White';
    terminalRef.current = {
      label: `${loser === 'w' ? 'White' : 'Black'} resigned — ${winner} wins`,
      loser,
      draw: false
    };
    setTerminal(terminalRef.current);
    clockRef.current?.stop();
    playCue('gameover');
  }, [humanColor, mode, stopEngine]);

  const requestHint = useCallback(() => {
    const liveGame = gameRef.current!;
    const baseline = baselineRef.current;
    if (!baseline || baseline.fen !== liveGame.fen() || !baseline.bestSan) return;
    const match = allLegalMoves(liveGame).find(m => m.san === baseline.bestSan);
    if (match) setHintMove(match);
  }, []);

  const clearHint = useCallback(() => setHintMove(null), []);

  const flipBoard = useCallback(() => setBoardFlipped(prev => !prev), []);

  const clickSquare = useCallback(
    (square: string) => {
      const liveGame = gameRef.current!;
      if (!square || pendingPromotion) return;
      if (liveGame.isGameOver() || terminalRef.current) return;
      if (mode === 'engine' && liveGame.turn() !== humanColor) return;

      // 1. A destination square for the current selection commits the move.
      if (selectedSquare) {
        const target = selectionMoves.find(m => m.to === square);
        if (target) {
          if (target.promotion) {
            setPendingPromotion({ from: selectedSquare, to: square, color: target.color });
            return;
          }
          commitMove(target);
          return;
        }
      }

      // 2. Otherwise select one of our own movable pieces.
      const ownMoves = legalMovesFrom(liveGame, square);
      if (ownMoves.length > 0) {
        setSelectedSquare(square);
        setSelectionMoves(ownMoves);
        playCue('select');
        return;
      }

      clearSelection();
    },
    [clearSelection, commitMove, humanColor, mode, pendingPromotion, selectedSquare, selectionMoves]
  );

  const resolvePromotion = useCallback(
    (piece: 'q' | 'r' | 'b' | 'n') => {
      if (!pendingPromotion) return;
      const base = selectionMoves.find(m => m.to === pendingPromotion.to);
      if (!base) {
        setPendingPromotion(null);
        return;
      }
      commitMove({ ...base, promotion: piece });
    },
    [commitMove, pendingPromotion, selectionMoves]
  );

  const cancelPromotion = useCallback(() => setPendingPromotion(null), []);

  const playMove = useCallback(
    (move: VerboseMove) => {
      if (terminalRef.current || gameRef.current!.isGameOver()) return false;
      return commitMove(move);
    },
    [commitMove]
  );

  const playSan = useCallback(
    (san: string) => {
      const liveGame = gameRef.current!;
      const text = san.trim().replace(/[+#!?]+$/g, '');
      if (!text) return false;
      const match = allLegalMoves(liveGame).find(m => m.san === text || m.lan === text);
      if (!match) {
        playCue('illegal');
        return false;
      }
      return commitMove(match);
    },
    [commitMove]
  );

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const setXrayLayer = useCallback((patch: Partial<XRayLayerConfig>) => {
    setXrayLayers(prev => ({ ...prev, ...patch }));
  }, []);

  /* --------------------------------------------------------------- archive */
  const saveCurrentGame = useCallback(() => {
    const liveGame = gameRef.current!;
    const record: ArchivedGame = {
      id: sessionIdRef.current,
      title: `${mode === 'engine' ? `vs ${settings.difficulty}` : 'Two Player'} · ${liveGame.history().length} ply`,
      pgn: liveGame.pgn(),
      startFen: startFenRef.current,
      fen: liveGame.fen(),
      result: terminalRef.current?.label ?? 'In progress',
      difficulty: settings.difficulty,
      mode,
      humanColor,
      moveCount: liveGame.history().length,
      createdAt: new Date().toISOString()
    };
    saveGameToArchive(record);
    setSessionGameId(record.id);
    refreshArchive();
  }, [humanColor, mode, refreshArchive, settings.difficulty]);

  const openArchivedGame = useCallback(
    (record: ArchivedGame) => {
      const liveGame = gameRef.current!;
      stopEngine();

      const target = record.startFen || DEFAULT_START_FEN;
      const result = liveGame.load(target) as { ok?: boolean } | undefined;
      if (!result || result.ok === false) return false;
      if (record.pgn) liveGame.load_pgn(record.pgn);

      startFenRef.current = target;
      sessionIdRef.current = record.id;
      moveMetaRef.current = [];
      baselineRef.current = null;
      userMovedRef.current = false;

      setSessionGameId(record.id);
      setHintMove(null);
      clearLastHumanMove();
      setEngineResult(null);
      setEngineProgress(null);
      setBestLine([]);
      setBestLineEval(null);
      resetTerminal();
      clearSelection();
      setPendingPromotion(null);

      if (clockRef.current) {
        clockRef.current.configure(settings.timeControl);
        setClock(clockRef.current.getState());
      }
      refresh();

      const label = describeGameOver(liveGame);
      if (label) {
        terminalRef.current = { label, loser: liveGame.turn(), draw: label.includes('½') };
        setTerminal(terminalRef.current);
      }
      return true;
    },
    [clearLastHumanMove, clearSelection, refresh, resetTerminal, settings.timeControl, stopEngine]
  );

  const removeArchivedGame = useCallback(
    (id: string) => {
      deleteGameFromArchive(id);
      setSessionGameId(prev => (prev === id ? null : prev));
      refreshArchive();
    },
    [refreshArchive]
  );

  /* ------------------------------------------------------- mount-time wiring */
  useEffect(() => {
    setMounted(true);

    const loaded = loadSettings() as Settings;
    setSettings(loaded);
    setSoundEnabled(loaded.soundEnabled);
    setArchive(loadGameArchive() as ArchivedGame[]);

    const clockInstance = createClock(
      loaded.timeControl,
      state => setClock(state),
      side => {
        if (terminalRef.current) return;
        const winner = side === 'w' ? 'Black' : 'White';
        terminalRef.current = {
          label: `${side === 'w' ? 'White' : 'Black'} flagged on time — ${winner} wins`,
          loser: side,
          draw: false
        };
        setTerminal(terminalRef.current);
        thinkingRef.current = false;
        setEngineThinking(false);
        playCue('gameover');
      }
    );
    clockRef.current = clockInstance;
    setClock(clockInstance.getState());

    const client = createEngineClient();
    engineRef.current = client;
    setTransport(client.mode);
  }, []);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    humanColorRef.current = humanColor;
  }, [humanColor]);

  useEffect(() => {
    setSoundEnabled(settings.soundEnabled);
  }, [settings.soundEnabled]);

  // Restart the clock cleanly whenever the time control changes mid-game.
  useEffect(() => {
    if (!mounted || !clockRef.current) return;
    clockRef.current.configure(settings.timeControl);
    setClock(clockRef.current.getState());
  }, [mounted, settings.timeControl]);

  useEffect(
    () => () => {
      stopEngine();
      engineRef.current?.dispose();
      clockRef.current?.stop();
    },
    [stopEngine]
  );

  /* -------------------------------------------- engine turn + analysis line */
  const searchEpoch = `${snapshot.fen}|${mode}|${humanColor}|${settings.difficulty}|${settings.searchTimeMs}|${mounted}`;

  useEffect(() => {
    if (!mounted) return;
    const liveGame = gameRef.current!;
    if (liveGame.isGameOver() || terminalRef.current) return;
    if (mode !== 'engine') return;

    const engineToMove = liveGame.turn() !== humanColor;
    userMovedRef.current = !engineToMove;
    runSearch(engineToMove ? 'reply' : 'analysis');
    // Keyed on a composed epoch so the search fires only when the position or the
    // engine configuration actually changes — never on unrelated renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchEpoch]);

  /* ---------------------------------------------------------------- derived */
  const opening = useMemo(() => moveReview.detectOpening(snapshot.sanHistory), [snapshot.sanHistory]);

  const clockLabel = useCallback(
    (side: PlayerColor) => (clock.enabled ? formatClock(side === 'w' ? clock.w : clock.b) : '∞'),
    [clock]
  );

  const resignable = !terminal && snapshot.moveCount > 0;

  const api = useMemo<SessionApi>(
    () => ({
      mounted,
      transport,
      gameHandle: gameRef,
      settings,
      updateSettings,
      snapshot,
      opening,
      moveMeta,
      terminal,
      selectedSquare,
      selectionMoves,
      clickSquare,
      clearSelection,
      playMove,
      playSan,
      pendingPromotion,
      resolvePromotion,
      cancelPromotion,
      mode,
      setMode,
      humanColor,
      setHumanColor,
      boardFlipped,
      flipBoard,
      newGame,
      undoMove,
      resign,
      hintMove,
      requestHint,
      clearHint,
      resignable,
      lastHumanMove,
      clock,
      clockLabel,
      engineThinking,
      engineProgress,
      engineResult,
      engineError,
      bestLine,
      bestLineEval,
      stopEngine,
      xrayLayers,
      setXrayLayer,
      archive,
      sessionGameId,
      saveCurrentGame,
      openArchivedGame,
      removeArchivedGame,
      refreshArchive
    }),
    [
      archive, bestLine, bestLineEval, boardFlipped, cancelPromotion, clearHint, clearLastHumanMove, clearSelection, clickSquare,
      clock, clockLabel, engineError, engineProgress, engineResult, engineThinking, hintMove, humanColor, lastHumanMove,
      mode, mounted, moveMeta, newGame, openArchivedGame, opening, pendingPromotion, playMove, playSan, refreshArchive,
      removeArchivedGame, requestHint, resign, resignable, resolvePromotion, saveCurrentGame, selectedSquare, selectionMoves,
      sessionGameId, settings, snapshot, stopEngine, terminal, transport, undoMove, updateSettings, xrayLayers
    ]
  );

  return <SessionContext.Provider value={api}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionApi {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>');
  return ctx;
}