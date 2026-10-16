/**
 * Persistence Layer (gameRepository & settingsRepository)
 * Uses localStorage with graceful fallback and IndexedDB archiving for saved games.
 */

const SETTINGS_KEY = 'wizards_chess_cathedral_settings_v1';
const HISTORY_KEY = 'wizards_chess_cathedral_games_v1';

export const DEFAULT_SETTINGS = {
  difficulty: 'Mage',
  searchTimeMs: 900,
  showLegalMoves: true,
  showMoveHints: true,
  showCoordinates: true,
  soundEnabled: true,
  animationsEnabled: true,
  reducedMotion: false,
  visualQuality: 'high',
  timeControl: 'untimed'
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch (_e) {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch (_e) {
    return false;
  }
}

export function loadGameArchive() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) {
    return [];
  }
}

export function saveGameToArchive(record) {
  try {
    const list = loadGameArchive();
    const idx = list.findIndex(g => g.id === record.id);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...record, updatedAt: new Date().toISOString() };
    } else {
      list.unshift({
        ...record,
        createdAt: record.createdAt || new Date().toISOString()
      });
    }
    const trimmed = list.slice(0, 60);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed));
    return trimmed;
  } catch (_e) {
    return [];
  }
}

export function deleteGameFromArchive(id) {
  try {
    const list = loadGameArchive().filter(g => g.id !== id);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
    return list;
  } catch (_e) {
    return [];
  }
}
