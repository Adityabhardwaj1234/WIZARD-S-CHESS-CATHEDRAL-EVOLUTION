/**
 * Engine Difficulty Options
 *
 * Derived from the engine's own `DIFFICULTY_PRESETS` so the Settings and Play
 * controls can never drift from the search presets that actually exist.
 * `Analysis` is a review preset (Multi-PV deep search) rather than an opponent,
 * so it is exposed separately for the analysis panel instead of here.
 */

import { DIFFICULTY_PRESETS } from '../engine/CathedralEngine';

export interface DifficultyOption {
  id: string;
  label: string;
  description: string;
  maxDepth: number;
  timeLimitMs: number;
}

type PresetMap = Record<
  string,
  { name: string; label: string; maxDepth: number; timeLimitMs: number; description: string }
>;

const presets = DIFFICULTY_PRESETS as PresetMap;

export const DIFFICULTY_OPTIONS: DifficultyOption[] = Object.keys(presets)
  .filter(id => id !== 'Analysis')
  .map(id => ({
    id,
    label: presets[id].label,
    description: presets[id].description,
    maxDepth: presets[id].maxDepth,
    timeLimitMs: presets[id].timeLimitMs
  }));

export const ANALYSIS_PRESET_ID = 'Analysis';

export function describePreset(id: string): string {
  return presets[id]?.description ?? 'Unknown preset.';
}

export const VISUAL_QUALITY_OPTIONS: { id: 'low' | 'medium' | 'high'; label: string }[] = [
  { id: 'low', label: 'Low — weakest hardware' },
  { id: 'medium', label: 'Medium — balanced' },
  { id: 'high', label: 'High — full cathedral detail' }
];

export const SEARCH_TIME_OPTIONS = [250, 500, 900, 1500, 2500, 4000];