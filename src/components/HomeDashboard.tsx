'use client';

/**
 * Home — the sanctuary control centre.
 * Telemetry is derived from the locally persisted archive and training state, so
 * every number shown reflects real games played in this browser.
 */

import { useEffect, useMemo, useState } from 'react';

import { useSession, type PrimaryView } from '../context/CathedralSession';
import { loadLearningState } from '../learning/learningEngine';

interface LearningSummary {
  generation: number;
  championVersion: string;
  gamesSimulated: number;
}

export function HomeDashboard({ onNavigate }: { onNavigate: (view: PrimaryView) => void }) {
  const { snapshot, mode, humanColor, settings, archive, terminal, mounted } = useSession();
  const [learning, setLearning] = useState<LearningSummary | null>(null);

  useEffect(() => {
    if (!mounted) return;
    try {
      const state = loadLearningState() as {
        generation: number;
        currentVersion: string;
        totalGamesSimulated: number;
      };
      setLearning({
        generation: state.generation,
        championVersion: state.currentVersion,
        gamesSimulated: state.totalGamesSimulated
      });
    } catch (_err) {
      setLearning(null);
    }
  }, [mounted, archive.length]);

  const record = useMemo(
    () => ({
      played: archive.length,
      finished: archive.filter(g => g.result !== 'In progress').length,
      plies: archive.reduce((sum, g) => sum + g.moveCount, 0),
      checkmates: archive.filter(g => g.result.startsWith('Checkmate')).length
    }),
    [archive]
  );

  const live = snapshot.moveCount > 0;

  return (
    <section className="home-dashboard" aria-label="Sanctuary control centre and career dashboard">
      <div className="dashboard-grid">
        <div className="panel-section">
          <div className="section-header">
            <span>Continue Playing</span>
            {live ? <span className="badge-gold">Live Session</span> : <span>No active match</span>}
          </div>
          <p className="text-muted">
            {live
              ? `${snapshot.moveCount} ply played · ${snapshot.turn === 'w' ? 'White' : 'Black'} to move${
                  terminal ? ` · ${terminal.label}` : ''
                }`
              : 'Start a consecrated encounter below. The board, clock and engine are always in sync.'}
          </p>
          <button type="button" className="nav-btn primary" onClick={() => onNavigate('play')}>
            {live ? '⚔ Resume Live Sanctuary Match' : '⚔ Enter the Sanctuary'}
          </button>
        </div>

        <div className="panel-section">
          <div className="section-header">
            <span>Start a New Game</span>
            <span>Choose Engine Mode</span>
          </div>
          <div className="launch-grid">
            <button type="button" className="icon-btn" onClick={() => onNavigate('play')}>
              ♔ Cathedral Engine ({settings.difficulty})
            </button>
            <button type="button" className="icon-btn" onClick={() => onNavigate('play')}>
              ⚡ Cathedral Ultra
            </button>
            <button type="button" className="icon-btn" onClick={() => onNavigate('play')}>
              ⚛ Experimental Learning Engine
            </button>
            <button type="button" className="icon-btn" onClick={() => onNavigate('play')}>
              ⚔ Local Two-Player Sanctuary
            </button>
          </div>
          <p className="field-hint">
            Current match: {mode === 'engine' ? `you play ${humanColor === 'w' ? 'White' : 'Black'}` : 'two-player'}.
            Change mode and strength from the Play or Settings views.
          </p>
        </div>

        <div className="panel-section">
          <div className="section-header">
            <span>Your Chess &amp; Research Dashboard</span>
            <span>Verified Local Telemetry</span>
          </div>
          <div className="telemetry-grid">
            <div className="metric-box">
              <span className="metric-label">Games Saved</span>
              <span className="metric-value">{record.played}</span>
            </div>
            <div className="metric-box">
              <span className="metric-label">Completed</span>
              <span className="metric-value">{record.finished}</span>
            </div>
            <div className="metric-box">
              <span className="metric-label">Checkmates</span>
              <span className="metric-value">{record.checkmates}</span>
            </div>
            <div className="metric-box">
              <span className="metric-label">Training Generations</span>
              <span className="metric-value">{learning?.generation ?? 0}</span>
            </div>
          </div>
          {learning && learning.gamesSimulated > 0 && (
            <p className="field-hint">
              Self-play champion {learning.championVersion} has simulated {learning.gamesSimulated.toLocaleString()} headless
              games.
            </p>
          )}
        </div>

        <div className="panel-section">
          <div className="section-header">
            <span>Quick Access</span>
          </div>
          <div className="launch-grid">
            <button type="button" className="icon-btn" onClick={() => onNavigate('analysis')}>
              ◈ X-Ray: Tactical Awareness
            </button>
            <button type="button" className="icon-btn" onClick={() => onNavigate('training')}>
              ⚛ Headless Training Laboratory
            </button>
            <button type="button" className="icon-btn" onClick={() => onNavigate('library')}>
              ☰ Saved Game Library &amp; PGN
            </button>
            <button type="button" className="icon-btn" onClick={() => onNavigate('settings')}>
              ⚙ Settings
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}