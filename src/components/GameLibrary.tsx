'use client';

/**
 * Game Library — the locally persisted match archive.
 *
 * Games live in localStorage (capped at 60 records by the persistence layer).
 * Sharing produces a self-contained URL fragment, so no server or account is
 * required and nothing leaves the browser.
 */

import { useMemo, useState } from 'react';

import { useSession, type ArchivedGame } from '../context/CathedralSession';
import { encodeGameToUrlHash } from '../sharing/shareUrl';

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function downloadPgn(record: ArchivedGame): void {
  const blob = new Blob([record.pgn], { type: 'application/x-chess-pgn' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${record.id}.pgn`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function GameLibrary() {
  const { archive, sessionGameId, openArchivedGame, removeArchivedGame, saveCurrentGame, refreshArchive, snapshot } =
    useSession();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'engine' | 'two-player'>('all');
  const [notice, setNotice] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return archive.filter(record => {
      if (filter !== 'all' && record.mode !== filter) return false;
      if (!needle) return true;
      return (
        record.title.toLowerCase().includes(needle) ||
        record.result.toLowerCase().includes(needle) ||
        record.pgn.toLowerCase().includes(needle)
      );
    });
  }, [archive, filter, query]);

  const totals = useMemo(
    () => ({
      games: archive.length,
      plies: archive.reduce((sum, r) => sum + r.moveCount, 0),
      finished: archive.filter(r => r.result !== 'In progress').length
    }),
    [archive]
  );

  const share = (record: ArchivedGame) => {
    try {
      const url = encodeGameToUrlHash({ pgn: record.pgn, startFen: record.startFen, title: record.title, notes: '' });
      void navigator.clipboard?.writeText(url);
      setNotice('Shareable URL copied to the clipboard.');
    } catch (_err) {
      setNotice('Could not build a share URL for this game.');
    }
  };

  return (
    <section className="game-library-view" aria-label="Saved game archive and PGN manager">
      <div className="panel-section">
        <div className="section-header">
          <span>Cathedral Game Library</span>
          <span>Stored locally in this browser</span>
        </div>

        <div className="control-row">
          <input
            className="library-search"
            value={query}
            placeholder="Search title, result or PGN…"
            onChange={e => setQuery(e.target.value)}
            aria-label="Search saved games"
          />
          <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)} aria-label="Filter by mode">
            <option value="all">All modes</option>
            <option value="engine">Vs engine</option>
            <option value="two-player">Two player</option>
          </select>
          <button type="button" className="nav-btn primary" onClick={saveCurrentGame}>
            ⛁ Save current game ({snapshot.moveCount} ply)
          </button>
          <button type="button" className="icon-btn" onClick={refreshArchive}>
            ↻ Refresh
          </button>
        </div>

        <div className="telemetry-grid">
          <div className="metric-box">
            <span className="metric-label">Saved games</span>
            <span className="metric-value">{totals.games}</span>
          </div>
          <div className="metric-box">
            <span className="metric-label">Completed</span>
            <span className="metric-value">{totals.finished}</span>
          </div>
          <div className="metric-box">
            <span className="metric-label">Total plies</span>
            <span className="metric-value">{totals.plies}</span>
          </div>
        </div>

        {notice && <p className="text-muted" role="status">{notice}</p>}
      </div>

      {filtered.length === 0 ? (
        <div className="panel-section">
          <p className="text-muted">
            {archive.length === 0
              ? 'No saved games yet. Play a match and use “Save” to archive it here.'
              : 'No saved games match the current search.'}
          </p>
        </div>
      ) : (
        <ul className="library-list">
          {filtered.map(record => (
            <li key={record.id} className="library-item" data-current={record.id === sessionGameId || undefined}>
              <div className="library-item-main">
                <span className="library-title">{record.title}</span>
                <span className="library-meta">
                  {record.mode === 'engine' ? `vs ${record.difficulty}` : 'Two player'} · {record.moveCount} ply ·{' '}
                  {formatDate(record.createdAt)}
                </span>
                <span className="library-result" data-in-progress={record.result === 'In progress' || undefined}>
                  {record.result}
                </span>
                <code className="library-fen">{record.fen}</code>
              </div>
              <div className="library-item-actions">
                <button type="button" className="icon-btn" onClick={() => openArchivedGame(record)}>
                  Open
                </button>
                <button type="button" className="icon-btn" onClick={() => share(record)}>
                  Share
                </button>
                <button type="button" className="icon-btn" onClick={() => downloadPgn(record)}>
                  PGN
                </button>
                <button type="button" className="icon-btn danger" onClick={() => removeArchivedGame(record.id)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}