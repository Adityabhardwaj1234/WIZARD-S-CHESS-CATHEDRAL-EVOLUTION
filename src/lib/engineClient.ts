/**
 * Engine Client
 *
 * Wraps `src/workers/engine.worker.js` so the Cathedral Engine search never runs
 * on the UI / Three.js render thread. If the Worker cannot be constructed (older
 * browser, blocked blob URL, bundler that cannot emit a worker chunk) we fall
 * back to running the exact same `CathedralEngine` on the main thread so the app
 * degrades in smoothness rather than breaking outright.
 */

export type PlayerColor = 'w' | 'b';

export interface EngineMateDistance {
  movesForSideToMove: number;
  movesForOpponent: number;
  totalPlies: number;
  sideToMoveInMatingPosition: PlayerColor;
}

export interface EngineCandidate {
  san: string;
  lan: string;
  from: string;
  to: string;
  scoreWhiteCp: number;
  scoreSideToMoveCp: number;
  mateIn: EngineMateDistance | null;
  pv: string[];
}

export interface EngineProgress {
  engineMode: string;
  depth: number;
  nodes: number;
  nps: number;
  elapsedMs: number;
  bestMoveSan: string;
  bestMoveLan: string;
  scoreSideToMoveCp: number;
  scoreWhiteCp: number;
  mateIn: EngineMateDistance | null;
  pv: string[];
  candidates: EngineCandidate[];
}

export interface EngineResult {
  engineMode: string;
  bestMove: { from: string; to: string; promotion?: string; san: string; lan: string } | null;
  bestMoveSan: string | null;
  bestMoveLan: string | null;
  scoreSideToMoveCp: number;
  scoreWhiteCp: number;
  mateIn: EngineMateDistance | null;
  depth: number;
  nodes: number;
  qNodes: number;
  nps: number;
  elapsedMs: number;
  pv: string[];
  pvLan: string[];
  candidates: EngineCandidate[];
  stopReason: string;
  explanation: unknown;
}

export interface EngineSearchOptions {
  difficulty?: string;
  maxDepth?: number;
  timeLimitMs?: number;
  nodeLimit?: number;
  multiPv?: number;
  hashHistory?: string[];
  evalParams?: Record<string, number> | null;
}

export interface EngineHandlers {
  onProgress?: (progress: EngineProgress) => void;
  onResult?: (result: EngineResult) => void;
  onError?: (message: string) => void;
}

export interface EngineClient {
  readonly mode: 'worker' | 'main-thread';
  search(fen: string, options: EngineSearchOptions, handlers: EngineHandlers): void;
  requestStop(): void;
  dispose(): void;
}

let requestCounter = 0;

/* --------------------------------------------------------------------------
 * Worker-backed implementation
 * -------------------------------------------------------------------------- */

function createWorkerClient(worker: Worker): EngineClient {
  let activeRequestId: number | null = null;
  let handlers: EngineHandlers | null = null;

  const clearPending = (): EngineHandlers | null => {
    const pending = handlers;
    handlers = null;
    activeRequestId = null;
    return pending;
  };

  worker.onmessage = (event: MessageEvent) => {
    const msg = event.data as
      | { type: string; requestId?: number; progress?: EngineProgress; result?: EngineResult; error?: string }
      | undefined;
    if (!msg || typeof msg.type !== 'string') return;
    if (activeRequestId !== null && msg.requestId !== activeRequestId) return;

    if (msg.type === 'PROGRESS') {
      handlers?.onProgress?.(msg.progress as EngineProgress);
    } else if (msg.type === 'RESULT') {
      clearPending()?.onResult?.(msg.result as EngineResult);
    } else if (msg.type === 'ERROR') {
      clearPending()?.onError?.(String(msg.error ?? 'Engine search failed'));
    }
  };

  worker.onerror = () => {
    clearPending()?.onError?.('Engine worker crashed');
  };

  return {
    mode: 'worker',
    search(fen, options, nextHandlers) {
      if (activeRequestId !== null) worker.postMessage({ type: 'STOP' });
      activeRequestId = ++requestCounter;
      handlers = nextHandlers;
      worker.postMessage({
        type: 'SEARCH',
        requestId: activeRequestId,
        fen,
        options: {
          difficulty: options.difficulty,
          maxDepth: options.maxDepth,
          timeLimitMs: options.timeLimitMs,
          nodeLimit: options.nodeLimit,
          multiPv: options.multiPv,
          evalParams: options.evalParams ?? null,
          hashHistory: options.hashHistory
        }
      });
    },
    requestStop() {
      if (activeRequestId !== null) worker.postMessage({ type: 'STOP' });
    },
    dispose() {
      clearPending();
      worker.terminate();
    }
  };
}

/* --------------------------------------------------------------------------
 * Main-thread fallback implementation
 * -------------------------------------------------------------------------- */

interface EngineInstance {
  search(fen: string, options: Record<string, unknown>): EngineResult;
  requestStop(): void;
}

function createMainThreadClient(): EngineClient {
  let enginePromise: Promise<EngineInstance> | null = null;
  let cancelled = false;

  const getEngine = async (): Promise<EngineInstance> => {
    if (!enginePromise) {
      enginePromise = import('../engine/CathedralEngine.js').then(mod => new mod.CathedralEngine() as unknown as EngineInstance);
    }
    return enginePromise;
  };

  return {
    mode: 'main-thread',
    search(fen, options, handlers) {
      cancelled = false;
      const requestId = ++requestCounter;
      // Yield a frame so the caller can paint its "thinking" state before the
      // synchronous search blocks the thread.
      void Promise.resolve().then(async () => {
        try {
          const engine = await getEngine();
          if (cancelled || requestId !== requestCounter) return;
          const result = engine.search(fen, {
            difficulty: options.difficulty,
            maxDepth: options.maxDepth,
            timeLimitMs: options.timeLimitMs,
            nodeLimit: options.nodeLimit,
            multiPv: options.multiPv,
            evalParams: options.evalParams ?? null,
            hashHistory: options.hashHistory,
            onProgress: (p: EngineProgress) => {
              if (!cancelled && requestId === requestCounter) handlers.onProgress?.(p);
            }
          });
          if (!cancelled && requestId === requestCounter) handlers.onResult?.(result);
        } catch (err) {
          if (!cancelled && requestId === requestCounter) {
            handlers.onError?.(err instanceof Error ? err.message : 'Engine search failed');
          }
        }
      });
    },
    requestStop() {
      cancelled = true;
    },
    dispose() {
      cancelled = true;
      enginePromise = null;
    }
  };
}

/* --------------------------------------------------------------------------
 * Factory
 * -------------------------------------------------------------------------- */

export function createEngineClient(): EngineClient {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') {
    return createMainThreadClient();
  }
  try {
    const worker = new Worker(new URL('../workers/engine.worker.js', import.meta.url));
    return createWorkerClient(worker);
  } catch (_err) {
    return createMainThreadClient();
  }
}