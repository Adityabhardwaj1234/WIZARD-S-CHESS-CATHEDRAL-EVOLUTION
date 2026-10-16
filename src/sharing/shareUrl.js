/**
 * Shareable Game URL & PGN/FEN Payload Encoding
 * Encodes and decodes validated game payloads in the URL fragment (#cathedral=...)
 * without requiring a remote backend or user account.
 */

import { ChessGame, validateFen, DEFAULT_FEN } from '../game/ChessGame.js';

const MAX_PAYLOAD_CHARS = 4096;

export function encodeGameToUrlHash({ pgn, startFen, title, notes }) {
  const payload = {
    v: 1,
    p: pgn || '',
    f: startFen && startFen !== DEFAULT_FEN ? startFen : undefined,
    t: title ? String(title).slice(0, 80) : undefined,
    n: notes ? String(notes).slice(0, 240) : undefined
  };
  const json = JSON.stringify(payload);
  const encoded = btoa(unescape(encodeURIComponent(json)));
  const baseUrl =
    typeof window !== 'undefined'
      ? window.location.href.split('#')[0]
      : 'https://wizards-chess.local/';
  return `${baseUrl}#cathedral=${encoded}`;
}

export function decodeGameFromUrlHash(hashString) {
  if (!hashString || typeof hashString !== 'string') return null;
  const cleaned = hashString.replace(/^#/, '');
  const params = new URLSearchParams(cleaned);
  const token = params.get('cathedral');
  if (!token || token.length > MAX_PAYLOAD_CHARS) return null;

  try {
    const json = decodeURIComponent(escape(atob(token)));
    const data = JSON.parse(json);
    if (!data || typeof data !== 'object') return null;

    if (data.f) {
      const vf = validateFen(data.f);
      if (!vf.valid) return null;
    }

    const testGame = new ChessGame(data.f || DEFAULT_FEN);
    if (data.p && typeof data.p === 'string' && data.p.trim().length > 0) {
      const ok = testGame.load_pgn(data.p);
      if (!ok) return null;
    }

    return {
      pgn: testGame.pgn(),
      fen: testGame.fen(),
      startFen: data.f || DEFAULT_FEN,
      moves: testGame.history({ verbose: true }),
      title: data.t || 'Shared Cathedral Match',
      notes: data.n || ''
    };
  } catch (_e) {
    return null;
  }
}
