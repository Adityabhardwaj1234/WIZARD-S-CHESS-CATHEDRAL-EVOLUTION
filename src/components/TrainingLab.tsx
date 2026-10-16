'use client';

/**
 * Training Lab — headless self-play evolution of the evaluation weights.
 *
 * A generation runs in three stages:
 *   1. Perturb the champion parameters (`generateCandidateParams`).
 *   2. Gate the candidate on the mandatory tactical regression suite.
 *   3. Play a balanced candidate-vs-champion match across a pool of
 *      `training.worker.js` instances, then decide promotion.
 *
 * Nothing here touches the DOM or the 3D scene, so the board stays responsive.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  createInitialLearningState,
  evaluatePromotionDecision,
  generateCandidateParams,
  loadLearningState,
  saveLearningState
} from '../learning/learningEngine';

interface GameResult {
  gameIndex: number;
  openingEco: string;
  openingName: string;
  candidateColor: 'w' | 'b';
  winnerColor: 'w' | 'b' | 'draw';
  candidateOutcome: 'win' | 'loss' | 'draw';
  terminationReason: string;
  plies: number;
  totalNodes: number;
  avgDepth: number;
  durationMs: number;
}

interface RegressionResult {
  passedAll: boolean;
  passedCount: number;
  totalCount: number;
  results: { id: string; name: string; bestMoveSan: string | null; passed: boolean }[];
}

interface ParameterChange {
  key: string;
  label: string;
  oldValue: number;
  newValue: number;
  delta: number;
}

interface LearningState {
  experimentName: string;
  currentVersion: string;
  generation: number;
  seed: number;
  totalGamesSimulated: number;
  totalPliesSimulated: number;
  totalNodesSearched: number;
  acceptedCount: number;
  rejectedCount: number;
  inconclusiveCount: number;
  championParams: Record<string, number>;
  checkpoints: {
    version: string;
    generation: number;
    timestamp: string;
    params: Record<string, number>;
    scorePct: number;
    summary: string;
    parameterChanges: ParameterChange[];
  }[];
  generationHistory: {
    generation: number;
    timestamp: string;
    scorePct: number;
    wins: number;
    draws: number;
    losses: number;
    promoted: boolean;
    status: string;
  }[];
  sampleGames: GameResult[];
  lastBatchReport: BatchReport | null;
}

interface BatchReport {
  generation: number;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  scorePct: number;
  stdErrPct: number;
  eloDeltaEst: number;
  status: string;
  promoted: boolean;
  reason: string;
  regressionPassed: boolean;
  regressionSummary: string;
  parameterChanges: ParameterChange[];
  sampleGames: GameResult[];
  durationMs: number;
}

type Phase = 'idle' | 'regression' | 'playing' | 'finished';

const WORKER_POOL_SIZE = 4;

export function TrainingLab() {
  const [state, setState] = useState<LearningState | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [gamesPerWorker, setGamesPerWorker] = useState(3);
  const [error, setError] = useState<string | null>(null);

  const poolRef = useRef<Worker[]>([]);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      setState(loadLearningState() as LearningState);
    } catch (_err) {
      setState(createInitialLearningState() as LearningState);
    }
  }, []);

  const disposePool = useCallback(() => {
    for (const worker of poolRef.current) worker.terminate();
    poolRef.current = [];
  }, []);

  useEffect(() => () => {
    cancelledRef.current = true;
    disposePool();
  }, [disposePool]);

  const runGeneration = useCallback(async () => {
    if (phase === 'regression' || phase === 'playing') return;
    setError(null);
    setPhase('regression');
    cancelledRef.current = false;

    const base = (state ?? (loadLearningState() as LearningState)) as LearningState;
    const startedAt = performance.now();
    const seed = base.seed ?? Math.floor(Date.now() % 2147483647);
    const { candidateParams, parameterChanges } = generateCandidateParams(base.championParams, seed + base.generation);

    try {
      /* ---------------------------------------------- stage 2: regression gate */
      const regressionModule = await import('../learning/learningEngine.js');
      const regression = regressionModule.runTacticalRegressionSuite(candidateParams) as RegressionResult;

      const totalGames = gamesPerWorker * WORKER_POOL_SIZE;
      setProgress({ done: 0, total: totalGames });

      /* ------------------------------------------ stage 3: balanced self-play */
      setPhase('playing');
      const match = await runMatch({
        candidateParams,
        championParams: base.championParams,
        gamesPerWorker,
        onProgress: done => setProgress({ done, total: totalGames })
      });

      if (cancelledRef.current) {
        setPhase('idle');
        return;
      }

      const results = match.results;
      if (match.errors.length > 0) {
        setError(`${match.errors.length} of ${totalGames} simulations failed — first: ${match.errors[0]}`);
      }
      if (results.length === 0) {
        setPhase('idle');
        return;
      }

      const wins = results.filter(r => r.candidateOutcome === 'win').length;
      const draws = results.filter(r => r.candidateOutcome === 'draw').length;
      const losses = results.filter(r => r.candidateOutcome === 'loss').length;

      const decision = evaluatePromotionDecision({ wins, draws, losses, regressionResult: regression });

      const nextGeneration = base.generation + 1;
      const report: BatchReport = {
        generation: nextGeneration,
        games: results.length,
        wins,
        draws,
        losses,
        scorePct: decision.scorePct,
        stdErrPct: decision.stdErrPct,
        eloDeltaEst: decision.eloDeltaEst,
        status: decision.status,
        promoted: decision.promoted,
        reason: decision.reason,
        regressionPassed: regression.passedAll,
        regressionSummary: `${regression.passedCount}/${regression.totalCount} tactical regression tests passed`,
        parameterChanges,
        sampleGames: results.slice(0, 8),
        durationMs: Math.max(1, Math.round(performance.now() - startedAt))
      };

      const nextState: LearningState = {
        ...base,
        generation: nextGeneration,
        totalGamesSimulated: base.totalGamesSimulated + results.length,
        totalPliesSimulated: base.totalPliesSimulated + results.reduce((sum, r) => sum + r.plies, 0),
        totalNodesSearched: base.totalNodesSearched + results.reduce((sum, r) => sum + r.totalNodes, 0),
        acceptedCount: base.acceptedCount + (decision.promoted ? 1 : 0),
        rejectedCount: base.rejectedCount + (decision.promoted ? 0 : decision.status === 'rejected' ? 1 : 0),
        inconclusiveCount: base.inconclusiveCount + (decision.status === 'inconclusive' ? 1 : 0),
        championParams: decision.promoted ? candidateParams : base.championParams,
        currentVersion: decision.promoted ? `v${nextGeneration}` : base.currentVersion,
        checkpoints: decision.promoted
          ? [
              {
                version: `v${nextGeneration}`,
                generation: nextGeneration,
                timestamp: new Date().toISOString(),
                params: candidateParams,
                scorePct: decision.scorePct,
                summary: decision.reason,
                parameterChanges
              },
              ...base.checkpoints
            ]
          : base.checkpoints,
        generationHistory: [
          ...base.generationHistory,
          {
            generation: nextGeneration,
            timestamp: new Date().toISOString(),
            scorePct: decision.scorePct,
            wins,
            draws,
            losses,
            promoted: decision.promoted,
            status: decision.status
          }
        ],
        sampleGames: [...results.slice(0, 8), ...base.sampleGames].slice(0, 24),
        lastBatchReport: report
      };

      saveLearningState(nextState as unknown as Record<string, unknown>);
      setState(nextState);
      setPhase('finished');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Training generation failed.');
      setPhase('idle');
    } finally {
      disposePool();
    }
  }, [disposePool, gamesPerWorker, phase, state]);

  const running = phase === 'regression' || phase === 'playing';

  const telemetry = useMemo(() => {
    if (!state) return [];
    return [
      { label: 'Generation', value: String(state.generation) },
      { label: 'Champion', value: state.currentVersion },
      { label: 'Games simulated', value: state.totalGamesSimulated.toLocaleString() },
      { label: 'Nodes searched', value: state.totalNodesSearched.toLocaleString() },
      { label: 'Promotions', value: String(state.acceptedCount) },
      { label: 'Rejections', value: String(state.rejectedCount) }
    ];
  }, [state]);

  if (!state) {
    return (
      <section className="training-lab-view" aria-label="Headless self-play training laboratory">
        <div className="panel-section">
          <p className="text-muted">Loading the persisted evolution state…</p>
        </div>
      </section>
    );
  }

  return (
    <section className="training-lab-view" aria-label="Headless self-play training laboratory">
      <div className="panel-section">
        <div className="section-header">
          <span>Experimental Learning Engine</span>
          <span>{WORKER_POOL_SIZE} headless workers</span>
        </div>
        <p className="honest-disclaimer">
          Each generation perturbs roughly half the evaluation parameters, gates the candidate on the
          mandatory tactical regression suite, then plays a balanced candidate-vs-champion match. A candidate
          is only promoted above 52% with a positive win margin.
        </p>

        <div className="control-row">
          <label className="field">
            <span>Games per worker — {gamesPerWorker * WORKER_POOL_SIZE} total</span>
            <input
              type="range"
              min={1}
              max={8}
              step={1}
              value={gamesPerWorker}
              disabled={running}
              onChange={e => setGamesPerWorker(Number(e.target.value))}
            />
          </label>
          <button type="button" className="nav-btn primary" onClick={runGeneration} disabled={running}>
            {running ? 'Running generation…' : '▶ Run next generation'}
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => {
              cancelledRef.current = true;
              disposePool();
              setPhase('idle');
            }}
            disabled={!running}
          >
            ■ Stop
          </button>
        </div>

        {running && (
          <p className="text-muted" aria-live="polite">
            {phase === 'regression' ? 'Running tactical regression suite…' : `Simulating games ${progress.done}/${progress.total}…`}
          </p>
        )}
        {error && <p className="engine-error">{error}</p>}
      </div>

      <div className="telemetry-grid">
        {telemetry.map(item => (
          <div key={item.label} className="metric-box">
            <span className="metric-label">{item.label}</span>
            <span className="metric-value">{item.value}</span>
          </div>
        ))}
      </div>

      {state.lastBatchReport && (
        <div className="panel-section">
          <div className="section-header">
            <span>Generation {state.lastBatchReport.generation} Report</span>
            <span data-status={state.lastBatchReport.status}>{state.lastBatchReport.status}</span>
          </div>
          <div className="report-grid">
            <div className="metric-box">
              <span className="metric-label">Score</span>
              <span className="metric-value">{state.lastBatchReport.scorePct}%</span>
            </div>
            <div className="metric-box">
              <span className="metric-label">W / D / L</span>
              <span className="metric-value">
                {state.lastBatchReport.wins} / {state.lastBatchReport.draws} / {state.lastBatchReport.losses}
              </span>
            </div>
            <div className="metric-box">
              <span className="metric-label">Est. Elo Δ</span>
              <span className="metric-value">{state.lastBatchReport.eloDeltaEst}</span>
            </div>
            <div className="metric-box">
              <span className="metric-label">Duration</span>
              <span className="metric-value">{(state.lastBatchReport.durationMs / 1000).toFixed(1)}s</span>
            </div>
          </div>
          <p className={state.lastBatchReport.promoted ? 'report-promoted' : 'text-muted'}>{state.lastBatchReport.reason}</p>
          <p className="text-muted">Regression gate: {state.lastBatchReport.regressionSummary}</p>
        </div>
      )}

      {state.lastBatchReport && state.lastBatchReport.parameterChanges.length > 0 && (
        <div className="panel-section">
          <div className="section-header">
            <span>Parameter Mutations</span>
            <span>{state.lastBatchReport.parameterChanges.length} changed</span>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Parameter</th>
                <th scope="col">Before</th>
                <th scope="col">After</th>
                <th scope="col">Δ</th>
              </tr>
            </thead>
            <tbody>
              {state.lastBatchReport.parameterChanges.map(change => (
                <tr key={change.key}>
                  <td>{change.label}</td>
                  <td>{change.oldValue}</td>
                  <td>{change.newValue}</td>
                  <td>{change.delta > 0 ? `+${change.delta}` : change.delta}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="panel-section">
        <div className="section-header">
          <span>Generation History</span>
          <span>{state.generationHistory.length} recorded</span>
        </div>
        {state.generationHistory.length === 0 ? (
          <p className="text-muted">No generations run yet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Gen</th>
                <th scope="col">Score</th>
                <th scope="col">W / D / L</th>
                <th scope="col">Outcome</th>
              </tr>
            </thead>
            <tbody>
              {[...state.generationHistory].reverse().map(entry => (
                <tr key={`${entry.generation}-${entry.timestamp}`}>
                  <td>{entry.generation}</td>
                  <td>{entry.scorePct}%</td>
                  <td>
                    {entry.wins} / {entry.draws} / {entry.losses}
                  </td>
                  <td data-status={entry.promoted ? 'promoted' : entry.status}>{entry.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

/* --------------------------------------------------------------------------
 * Match runner
 * -------------------------------------------------------------------------- */

interface RunMatchArgs {
  candidateParams: Record<string, number>;
  championParams: Record<string, number>;
  gamesPerWorker: number;
  onProgress: (done: number) => void;
}

interface MatchOutcome {
  results: GameResult[];
  errors: string[];
}

function runMatch({ candidateParams, championParams, gamesPerWorker, onProgress }: RunMatchArgs): Promise<MatchOutcome> {
  return new Promise<MatchOutcome>((resolve, reject) => {
    const collected: GameResult[] = [];
    const errors: string[] = [];
    const total = gamesPerWorker * WORKER_POOL_SIZE;
    let pending = total;

    let pool: Worker[];
    try {
      pool = Array.from({ length: WORKER_POOL_SIZE }, () =>
        new Worker(new URL('../workers/training.worker.js', import.meta.url))
      );
    } catch (err) {
      reject(err instanceof Error ? err.message : 'Could not start training workers.');
      return;
    }

    const settle = () => {
      for (const worker of pool) worker.terminate();
      resolve({ results: collected, errors });
    };

    const completeOne = () => {
      pending -= 1;
      onProgress(collected.length + errors.length);
      if (pending <= 0) settle();
    };

    pool.forEach((worker, workerIndex) => {
      worker.onmessage = (event: MessageEvent) => {
        const msg = event.data as { type: string; gameResult?: GameResult; error?: string };
        if (msg.type === 'GAME_COMPLETE' && msg.gameResult) {
          collected.push(msg.gameResult);
          completeOne();
        } else if (msg.type === 'GAME_ERROR') {
          // Surface the failure instead of silently shrinking the match.
          errors.push(String(msg.error ?? 'unknown simulation error'));
          completeOne();
        }
      };
      worker.onerror = () => {
        errors.push(`worker ${workerIndex} crashed`);
        completeOne();
      };

      for (let i = 0; i < gamesPerWorker; i++) {
        const gameIndex = workerIndex * gamesPerWorker + i;
        worker.postMessage({
          type: 'RUN_GAME',
          workerId: workerIndex,
          taskId: gameIndex,
          config: {
            gameIndex,
            // Alternate colours so the match is balanced regardless of worker count.
            candidateColor: gameIndex % 2 === 0 ? 'w' : 'b',
            candidateParams,
            championParams,
            maxDepth: 2,
            timeLimitMs: 20,
            maxPlies: 72,
            seed: 101 + gameIndex * 31
          }
        });
      }
    });
  });
}