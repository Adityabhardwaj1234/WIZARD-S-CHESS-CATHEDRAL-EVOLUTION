'use client';

/**
 * Settings — engine, clock and cathedral presentation preferences.
 * Every control writes straight through to the persisted session settings and
 * takes effect immediately; there is no separate save step.
 */

import { useSession } from '../context/CathedralSession';
import { CLOCK_PRESETS } from '../lib/cathedral';
import { DIFFICULTY_OPTIONS, SEARCH_TIME_OPTIONS, VISUAL_QUALITY_OPTIONS } from '../lib/options';

export function SettingsView() {
  const { settings, updateSettings, transport, snapshot, mounted } = useSession();

  return (
    <section className="settings-view" aria-label="Cathedral settings">
      <div className="settings-grid">
        <div className="panel-section">
          <div className="section-header">
            <span>Cathedral Engine</span>
            <span>Search behaviour</span>
          </div>

          <label className="field">
            <span>Opponent strength</span>
            <select value={settings.difficulty} onChange={e => updateSettings({ difficulty: e.target.value })}>
              {DIFFICULTY_OPTIONS.map(option => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <p className="field-hint">{DIFFICULTY_OPTIONS.find(o => o.id === settings.difficulty)?.description}</p>

          <label className="field">
            <span>Think time — {settings.searchTimeMs} ms</span>
            <input
              type="range"
              min={0}
              max={SEARCH_TIME_OPTIONS.length - 1}
              step={1}
              value={Math.max(0, SEARCH_TIME_OPTIONS.indexOf(settings.searchTimeMs))}
              onChange={e => updateSettings({ searchTimeMs: SEARCH_TIME_OPTIONS[Number(e.target.value)] })}
            />
          </label>

          <p className="honest-disclaimer">
            “Experimental” plays with the evaluation weights evolved in the Training Lab rather than the
            handcrafted defaults.
          </p>
        </div>

        <div className="panel-section">
          <div className="section-header">
            <span>Clock</span>
            <span>Applied to the next game</span>
          </div>

          <label className="field">
            <span>Time control</span>
            <select value={settings.timeControl} onChange={e => updateSettings({ timeControl: e.target.value })}>
              {Object.values(CLOCK_PRESETS).map(preset => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Sound cues</span>
            <input
              type="checkbox"
              checked={settings.soundEnabled}
              onChange={e => updateSettings({ soundEnabled: e.target.checked })}
            />
          </label>

          <p className="field-hint">
            Changing the time control mid-game restarts the clock from the preset's initial time.
          </p>
        </div>

        <div className="panel-section">
          <div className="section-header">
            <span>Cathedral Presentation</span>
            <span>3D rendering</span>
          </div>

          <label className="field">
            <span>Visual quality</span>
            <select
              value={settings.visualQuality}
              onChange={e => updateSettings({ visualQuality: e.target.value as typeof settings.visualQuality })}
            >
              {VISUAL_QUALITY_OPTIONS.map(option => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Show legal-move markers</span>
            <input
              type="checkbox"
              checked={settings.showLegalMoves}
              onChange={e => updateSettings({ showLegalMoves: e.target.checked })}
            />
          </label>

          <label className="field">
            <span>Show engine principal variation</span>
            <input
              type="checkbox"
              checked={settings.showMoveHints}
              onChange={e => updateSettings({ showMoveHints: e.target.checked })}
            />
          </label>

          <label className="field">
            <span>Show board coordinates</span>
            <input
              type="checkbox"
              checked={settings.showCoordinates}
              onChange={e => updateSettings({ showCoordinates: e.target.checked })}
            />
          </label>

          <label className="field">
            <span>Piece animations</span>
            <input
              type="checkbox"
              checked={settings.animationsEnabled}
              onChange={e => updateSettings({ animationsEnabled: e.target.checked })}
            />
          </label>

          <label className="field">
            <span>Reduce motion</span>
            <input
              type="checkbox"
              checked={settings.reducedMotion}
              onChange={e => updateSettings({ reducedMotion: e.target.checked })}
            />
          </label>
        </div>

        <div className="panel-section">
          <div className="section-header">
            <span>Diagnostics</span>
            <span>Local only</span>
          </div>
          <dl className="diagnostics">
            <dt>Engine transport</dt>
            <dd>{transport === 'pending' && !mounted ? 'starting…' : transport}</dd>
            <dt>Current position</dt>
            <dd className="diag-mono">{snapshot.fen}</dd>
            <dt>Side to move</dt>
            <dd>{snapshot.turn === 'w' ? 'White' : 'Black'}</dd>
            <dt>Plies played</dt>
            <dd>{snapshot.moveCount}</dd>
          </dl>
          <p className="honest-disclaimer">
            All engines, evaluation and saved games run locally in your browser. Nothing is uploaded.
          </p>
        </div>
      </div>
    </section>
  );
}