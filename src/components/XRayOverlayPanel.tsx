'use client';

/**
 * Analysis & X-Ray — tactical awareness layers over the live position.
 *
 * Layers A–E drive the 3D overlays in the same render pass; layer F is an
 * on-demand check of the move you just played, because it costs two extra
 * searches and should not run on every ply.
 */

import { useCallback, useMemo, useRef, useState } from 'react';

import { useSession } from '../context/CathedralSession';
import { createGame, evalWhite, xray as xrayApi, type BeforeMoveWarning, type VerboseMove } from '../lib/cathedral';
import { loadLearningState } from '../learning/learningEngine';

interface WarningEngine {
  search(fen: string, options: Record<string, unknown>): {
    bestMoveSan: string | null;
    scoreSideToMoveCp: number;
    scoreWhiteCp: number;
    mateIn: unknown;
    pv: string[];
    depth: number;
  };
}

export function XRayOverlayPanel() {
  const { snapshot, moveMeta, xrayLayers, setXrayLayer, gameHandle, lastHumanMove } = useSession();
  const [checking, setChecking] = useState(false);
  const [warning, setWarning] = useState<BeforeMoveWarning | null>(null);
  const [warningError, setWarningError] = useState<string | null>(null);
  const engineRef = useRef<WarningEngine | null>(null);

  const analysis = useMemo(() => {
    const game = gameHandle.current;
    if (!game) return null;
    try {
      return xrayApi.computeXRayAnalysis(game);
    } catch (_err) {
      return null;
    }
  }, [gameHandle, snapshot.fen]);

  const championEval = useMemo(() => {
    const game = gameHandle.current;
    if (!game || typeof window === 'undefined') return null;
    try {
      const state = loadLearningState() as { championParams?: Record<string, number> };
      if (!state.championParams) return null;
      return {
        learned: evalWhite(game, state.championParams),
        handcrafted: evalWhite(game, null)
      };
    } catch (_err) {
      return null;
    }
  }, [gameHandle, snapshot.fen]);

  const lastMeta = moveMeta.length > 0 ? moveMeta[moveMeta.length - 1] : null;

  const runBlunderCheck = useCallback(async () => {
    // Reviews the human's move, not the overall last move — after an engine
    // reply the latter is always the engine's own move, which is never a mistake.
    const last = lastHumanMove;
    if (!last || !last.before) return;

    setChecking(true);
    setWarningError(null);
    setWarning(null);

    try {
      if (!engineRef.current) {
        const mod = await import('../engine/CathedralEngine.js');
        engineRef.current = new mod.CathedralEngine(1 << 14) as unknown as WarningEngine;
      }

      // `evaluateBeforeMoveWarning` expects the position *before* the candidate
      // move — it clones it, measures the baseline, then plays the move itself.
      const preMove = createGame(last.before);
      const verbose = preMove.moves({ verbose: true });
      const candidate = (Array.isArray(verbose) ? (verbose as VerboseMove[]) : []).find(m => m.san === last.san);
      if (!candidate) {
        setWarningError(`Could not reconstruct ${last.san} from the recorded position.`);
        return;
      }

      const result = xrayApi.evaluateBeforeMoveWarning(preMove, candidate, engineRef.current);
      setWarning(result);
      if (!result) {
        setWarningError('No warning: the position offers no forcing refutation worth flagging.');
      }
    } catch (err) {
      setWarningError(err instanceof Error ? err.message : 'Blunder check failed.');
    } finally {
      setChecking(false);
    }
  }, [lastHumanMove]);

  const layers: { key: keyof typeof xrayLayers; label: string }[] = [
    { key: 'enabled', label: 'Layer A: Attack Map (White / Black / Contested)' },
    { key: 'vulnerable', label: 'Layer B: Vulnerable & Overloaded Pieces (SEE)' },
    { key: 'kingSafety', label: 'Layer C: King Safety & Check Threats' },
    { key: 'motifs', label: 'Layer D: Pins, Forks, Skewers & Discovered Attacks' },
    { key: 'prediction', label: 'Layer E: Engine Prediction Arrow' }
  ];

  return (
    <section className="xray-panel" aria-label="X-Ray tactical awareness and dual-engine comparator">
      <div className="panel-section">
        <div className="section-header">
          <span>X-RAY: Tactical Awareness Layers</span>
          <span>{snapshot.sanHistory.length} ply analysed</span>
        </div>

        <div className="layer-toggles">
          {layers.map(layer => (
            <label key={layer.key}>
              <input
                type="checkbox"
                checked={xrayLayers[layer.key]}
                onChange={e => setXrayLayer({ [layer.key]: e.target.checked })}
              />
              {layer.label}
            </label>
          ))}
        </div>

        <p className="honest-disclaimer">
          Overlays are drawn in the 3D board while you are on the Play view. This panel reports the same
          analysis as text.
        </p>
      </div>

      <div className="xray-grid">
        <div className="panel-section">
          <div className="section-header">
            <span>Tactical Motifs</span>
            <span>{analysis?.motifs.length ?? 0} found</span>
          </div>
          {!analysis || analysis.motifs.length === 0 ? (
            <p className="text-muted">No pins, forks, skewers or discovered attacks in this position.</p>
          ) : (
            <ul className="motif-list">
              {analysis.motifs.slice(0, 12).map((motif, i) => (
                <li key={`${motif.type}-${motif.square}-${i}`}>
                  <span className="motif-type" data-color={motif.color}>
                    {motif.type}
                  </span>
                  <span className="motif-text">{motif.description}</span>
                  <span className="motif-confidence">{motif.confidence}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel-section">
          <div className="section-header">
            <span>Vulnerable Pieces</span>
            <span>{analysis?.vulnerablePieces.length ?? 0} flagged</span>
          </div>
          {!analysis || analysis.vulnerablePieces.length === 0 ? (
            <p className="text-muted">No piece is currently attacked more often than it is defended.</p>
          ) : (
            <ul className="vulnerable-list">
              {analysis.vulnerablePieces.slice(0, 10).map(piece => (
                <li key={piece.square} data-severity={piece.severity}>
                  <span className="vuln-square">{piece.square}</span>
                  <span className="vuln-text">{piece.description}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel-section">
          <div className="section-header">
            <span>King Safety</span>
            <span>{analysis?.kingSafety.whiteInCheck || analysis?.kingSafety.blackInCheck ? 'Check' : 'Stable'}</span>
          </div>
          <ul className="king-safety-list">
            <li>
              White king: {analysis?.kingSafety.whiteInCheck ? 'in check' : 'not attacked'}
            </li>
            <li>
              Black king: {analysis?.kingSafety.blackInCheck ? 'in check' : 'not attacked'}
            </li>
            {analysis?.kingSafety.candidateChecks.map((check, i) => (
              <li key={`${check.square}-${i}`}>{check.description}</li>
            ))}
          </ul>
        </div>

        <div className="panel-section">
          <div className="section-header">
            <span>Layer F: Blunder Check</span>
            <span>Two extra searches</span>
          </div>
          <button type="button" className="nav-btn primary" onClick={runBlunderCheck} disabled={checking || !lastHumanMove}>
            {checking ? 'Analysing…' : 'Check my last move'}
          </button>
          {lastMeta && (
            <p className="text-muted">
              Last move: <strong>{lastMeta.san}</strong>
              {lastMeta.classification
                ? ` — ${lastMeta.classification.label} (${lastMeta.classification.cpLoss} cp)`
                : ''}
            </p>
          )}
          {lastHumanMove && (
            <p className="text-muted">
              Reviewing your move <strong>{lastHumanMove.san}</strong> from the position before it was played.
            </p>
          )}
          {warning && (
            <div className="warning-card" data-severity={warning.severity}>
              <strong>{warning.title}</strong>
              <p>{warning.message}</p>
              <p className="text-muted">
                Refutation: {warning.refutationLine.join(' ')}
                {warning.recommendedMove ? ` · engine preferred ${warning.recommendedMove}` : ''}
              </p>
            </div>
          )}
          {warningError && <p className="text-muted">{warningError}</p>}
        </div>
      </div>

      <div className="panel-section">
        <div className="section-header">
          <span>Dual-Engine X-Ray Comparator</span>
          <span>Static evaluation, no search</span>
        </div>
        {championEval ? (
          <div className="comparator-grid">
            <div className="metric-box">
              <span className="metric-label">Cathedral handcrafted</span>
              <span className="metric-value">{(championEval.handcrafted / 100).toFixed(2)}</span>
            </div>
            <div className="metric-box">
              <span className="metric-label">Learning champion weights</span>
              <span className="metric-value">{(championEval.learned / 100).toFixed(2)}</span>
            </div>
            <div className="metric-box">
              <span className="metric-label">Divergence</span>
              <span className="metric-value">
                {((championEval.learned - championEval.handcrafted) / 100).toFixed(2)}
              </span>
            </div>
          </div>
        ) : (
          <p className="text-muted">No champion weights have been persisted yet.</p>
        )}
        <p className="honest-disclaimer">
          This compares the two static evaluation functions on the current position only. It is not a
          strength measurement — a real match must be run in the Training Lab.
        </p>
      </div>
    </section>
  );
}