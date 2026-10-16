'use client';

/**
 * Play — the live match view.
 *
 * Combines the 3D sanctuary board, the clock, the engine readout and a complete
 * non-3D control surface (SAN entry + legal-move list) so the match stays fully
 * playable when WebGL is unavailable or the player prefers the keyboard.
 */

import { useEffect, useMemo, useState } from 'react';

import { CathedralBoard } from './CathedralBoard';
import { useSession, type MoveMeta } from '../context/CathedralSession';
import { allLegalMoves, type VerboseMove } from '../lib/cathedral';
import { DIFFICULTY_OPTIONS } from '../lib/options';

const PIECE_GLYPHS: Record<string, string> = {
  q: '♕', r: '♖', b: '♗', n: '♘', k: '♔', p: '♙'
};

function evalLabel(cp: number | null): string {
  if (cp === null) return '—';
  if (Math.abs(cp) >= 29000) return cp > 0 ? 'M' : '-M';
  const pawns = cp / 100;
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(2)}`;
}

export function PlayView() {
  const session = useSession();
  const {
    snapshot, moveMeta, opening, terminal, mode, setMode, humanColor, setHumanColor,
    settings, updateSettings, clockLabel, engineThinking, engineProgress, engineError,
    bestLine, bestLineEval, hintMove, requestHint, clearHint, undoMove, newGame, resign,
    pendingPromotion, resolvePromotion, cancelPromotion, transport
  } = session;

  const [sanEntry, setSanEntry] = useState('');
  const [legalMoves, setLegalMoves] = useState<VerboseMove[]>([]);

  const game = session.gameHandle;

  // Legal moves are only enumerated when the human is on move and the game is live.
  useEffect(() => {
    const live = game.current;
    if (!live) return;
    const humansTurn = mode === 'two-player' || live.turn() === humanColor;
    if (!humansTurn || live.isGameOver() || terminal) {
      setLegalMoves([]);
      return;
    }
    setLegalMoves(allLegalMoves(live));
  }, [game, humanColor, mode, snapshot.fen, terminal]);

  const submitSan = () => {
    if (session.playSan(sanEntry)) setSanEntry('');
  };

  const movePairs = useMemo(() => {
    const pairs: { number: number; white: string; black: string; meta: [MoveMeta | undefined, MoveMeta | undefined] }[] = [];
    for (let i = 0; i < snapshot.sanHistory.length; i += 2) {
      pairs.push({
        number: i / 2 + 1,
        white: snapshot.sanHistory[i],
        black: snapshot.sanHistory[i + 1] ?? '',
        meta: [moveMeta[i], moveMeta[i + 1]]
      });
    }
    return pairs;
  }, [snapshot.sanHistory, moveMeta]);

  const showEngineLine = settings.showMoveHints && bestLine.length > 0;

  return (
    <section className="play-view" aria-label="Live match — Cathedral board, clock and engine readout">
      <div className="play-layout">
        {/* ------------------------------------------------------- board side */}
        <div className="play-board-column">
          <div className="panel-section board-panel">
            <div className="section-header">
              <span>{opening ? `${opening.eco} · ${opening.name}` : 'Sanctuary Board'}</span>
              <span>{mode === 'engine' ? `You play ${humanColor === 'w' ? 'White' : 'Black'}` : 'Local two-player'}</span>
            </div>

            <div className="board-hud">
              <div className="clock-chip" data-active={clockLabel('w') !== '∞' && snapshot.turn === 'w' && !terminal}>
                <span className="clock-side">White</span>
                <span className="clock-value">{clockLabel('w')}</span>
              </div>
              <div className="turn-indicator" aria-live="polite">
                {terminal ? terminal.label : snapshot.inCheck ? `${snapshot.turn === 'w' ? 'White' : 'Black'} is in check` : `${snapshot.turn === 'w' ? 'White' : 'Black'} to move`}
              </div>
              <div className="clock-chip" data-active={snapshot.turn === 'b' && !terminal}>
                <span className="clock-side">Black</span>
                <span className="clock-value">{clockLabel('b')}</span>
              </div>
            </div>

            <CathedralBoard />

            {pendingPromotion && (
              <div className="promotion-picker" role="dialog" aria-label="Choose promotion piece">
                <span className="text-muted">Promote to</span>
                <div className="promotion-options">
                  {(['q', 'r', 'b', 'n'] as const).map(piece => (
                    <button key={piece} type="button" className="icon-btn" onClick={() => resolvePromotion(piece)}>
                      {PIECE_GLYPHS[piece]}
                    </button>
                  ))}
                </div>
                <button type="button" className="icon-btn" onClick={cancelPromotion}>
                  Cancel
                </button>
              </div>
            )}
          </div>

          <div className="panel-section">
            <div className="section-header">
              <span>Match Controls</span>
              <span>{transport === 'main-thread' ? 'Engine on main thread (fallback)' : `Engine worker${transport === 'pending' ? '' : ' active'}`}</span>
            </div>
            <div className="control-row">
              <button type="button" className="nav-btn primary" onClick={newGame}>New Game</button>
              <button type="button" className="icon-btn" onClick={undoMove} disabled={snapshot.moveCount === 0}>↶ Undo</button>
              <button type="button" className="icon-btn" onClick={requestHint} disabled={mode !== 'engine'}>💡 Hint</button>
              {hintMove && (
                <button type="button" className="icon-btn" onClick={clearHint}>Hide hint</button>
              )}
              <button type="button" className="icon-btn" onClick={session.saveCurrentGame}>⛁ Save</button>
              <button type="button" className="icon-btn" onClick={resign} disabled={!session.resignable}>⚑ Resign</button>
            </div>

            <div className="control-row">
              <label className="field">
                <span>Mode</span>
                <select value={mode} onChange={e => setMode(e.target.value as typeof mode)}>
                  <option value="engine">Play vs Cathedral Engine</option>
                  <option value="two-player">Local two-player</option>
                </select>
              </label>
              <label className="field">
                <span>Your colour</span>
                <select
                  value={humanColor}
                  disabled={mode === 'two-player'}
                  onChange={e => setHumanColor(e.target.value as typeof humanColor)}
                >
                  <option value="w">White</option>
                  <option value="b">Black</option>
                </select>
              </label>
              <label className="field">
                <span>Engine strength</span>
                <select value={settings.difficulty} onChange={e => updateSettings({ difficulty: e.target.value })}>
                  {DIFFICULTY_OPTIONS.map(option => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>

            {terminal && (
              <div className="terminal-banner" role="status">
                <strong>{terminal.label}</strong>
                <button type="button" className="nav-btn primary" onClick={newGame}>Play again</button>
              </div>
            )}
          </div>
        </div>

        {/* -------------------------------------------------------- side rail */}
        <div className="play-rail">
          <div className="panel-section">
            <div className="section-header">
              <span>Cathedral Engine</span>
              <span>{engineThinking ? 'Searching…' : 'Idle'}</span>
            </div>

            <div className="eval-readout">
              <span className="eval-label">Eval (White)</span>
              <span className="eval-value">
                {evalLabel(engineProgress?.scoreWhiteCp ?? bestLineEval)}
              </span>
            </div>

            {engineThinking && engineProgress && (
              <p className="text-muted">
                depth {engineProgress.depth} · {engineProgress.nodes.toLocaleString()} nodes ·{' '}
                {engineProgress.nps.toLocaleString()} nps
                {engineProgress.bestMoveSan ? ` · best ${engineProgress.bestMoveSan}` : ''}
              </p>
            )}

            {engineError && <p className="engine-error">{engineError}</p>}

            {showEngineLine && (
              <div className="pv-line">
                <span className="text-muted">Principal variation</span>
                <span className="pv-moves">{bestLine.join(' ')}</span>
              </div>
            )}

            {!showEngineLine && !engineThinking && (
              <p className="honest-disclaimer">
                Enable “Show engine line” in Settings to see the principal variation while you think.
              </p>
            )}
          </div>

          <div className="panel-section">
            <div className="section-header">
              <span>Move History</span>
              <span>{snapshot.moveCount} ply</span>
            </div>

            {movePairs.length === 0 ? (
              <p className="text-muted">No moves yet. Play a move on the board to begin.</p>
            ) : (
              <ol className="move-list">
                {movePairs.map(pair => (
                  <li key={pair.number} className="move-row">
                    <span className="move-number">{pair.number}.</span>
                    <span className="move-cell">
                      {pair.white}
                      {pair.meta[0]?.classification && (
                        <em className="move-badge" style={{ color: pair.meta[0].classification.color }}>
                          {pair.meta[0].classification.badge}
                        </em>
                      )}
                    </span>
                    <span className="move-cell">
                      {pair.black}
                      {pair.meta[1]?.classification && (
                        <em className="move-badge" style={{ color: pair.meta[1].classification.color }}>
                          {pair.meta[1].classification.badge}
                        </em>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="panel-section">
            <div className="section-header">
              <span>Move Entry</span>
              <span>Keyboard / no-WebGL fallback</span>
            </div>
            <div className="control-row">
              <input
                className="san-input"
                value={sanEntry}
                placeholder="e4, Nf3, O-O…"
                onChange={e => setSanEntry(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') submitSan();
                }}
                disabled={mode === 'engine' && snapshot.turn !== humanColor}
                aria-label="Enter a move in SAN"
              />
              <button type="button" className="icon-btn" onClick={submitSan} disabled={!sanEntry.trim()}>Play</button>
            </div>

            {legalMoves.length > 0 && (
              <details className="legal-move-details">
                <summary>Legal moves ({legalMoves.length})</summary>
                <div className="legal-move-grid">
                  {legalMoves.map(move => (
                    <button key={move.lan} type="button" className="icon-btn" onClick={() => session.playMove(move)}>
                      {move.san}
                    </button>
                  ))}
                </div>
              </details>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}