/**
 * Cathedral Scene Typed Boundary
 *
 * `CathedralScene.js` reads the Three.js runtime off `window.THREE` and is a
 * plain JS class, so it is described here once and cast at load time. The
 * renderer is also WebGL-only, so every consumer must mount it inside an effect.
 */

import type { CathedralGame, VerboseMove, XRayAnalysis } from './cathedral';

export interface SceneCallbacks {
  onSquareClick?: (square: string) => void;
  onSquareHover?: (square: string) => void;
  onWebGLError?: (message: string) => void;
}

export interface SceneTransition {
  from: string;
  to: string;
  flags: string;
  captured?: string;
  color: string;
}

export interface SceneHighlights {
  selectedSquare: string | null;
  legalMoves: Pick<VerboseMove, 'to' | 'captured' | 'flags'>[];
  lastMove: { from: string; to: string } | null;
  checkSquare: string | null;
  hintMove: { from: string; to: string } | null;
}

export interface SceneVisualSettings {
  animationsEnabled?: boolean;
  reducedMotion?: boolean;
  showCoordinates?: boolean;
  quality?: 'low' | 'medium' | 'high';
  highVisibility?: boolean;
  brightness?: number;
  boardLight?: number;
}

export interface PredictionArrow {
  from: string;
  to: string;
  colorHex?: number;
  width?: number;
  yOffset?: number;
}

export interface CathedralSceneInstance {
  syncBoard(game: CathedralGame, transition?: SceneTransition | null): void;
  updateHighlights(highlights: SceneHighlights): void;
  updateXRayOverlays(
    data: XRayAnalysis | null,
    layers: {
      enabled: boolean;
      attackMap: boolean;
      vulnerable: boolean;
      kingSafety: boolean;
      motifs: boolean;
      prediction: boolean;
    },
    arrows: PredictionArrow[]
  ): void;
  setVisualSettings(settings: SceneVisualSettings): void;
  setBoardTheme(themeId?: string): void;
  setFlipped(flipped: boolean): void;
  setCameraPreset(preset: 'default' | 'overhead' | 'strategic' | 'cinematic'): void;
  zoomCamera(deltaRadius: number): void;
  clearShatterEffects(): void;
  dispose(): void;
}

interface SceneModule {
  CathedralScene: new (container: HTMLElement, callbacks?: SceneCallbacks) => CathedralSceneInstance;
}

/**
 * Loads Three.js and the scene module, publishing THREE on `window` because the
 * scene class resolves its renderer through that global. Resolves to null when
 * WebGL is unavailable so the caller can render an accessible fallback.
 */
export async function loadCathedralScene(): Promise<{
  Scene: SceneModule['CathedralScene'];
  THREE: unknown;
} | null> {
  if (typeof window === 'undefined') return null;

  const probe = document.createElement('canvas');
  const webgl = probe.getContext('webgl2') ?? probe.getContext('webgl') ?? probe.getContext('experimental-webgl');
  if (!webgl) return null;

  const [threeModule, sceneModule] = await Promise.all([
    import('three'),
    import('../scene/CathedralScene.js') as unknown as Promise<SceneModule>
  ]);

  (window as unknown as { THREE: unknown }).THREE = threeModule;
  return { Scene: sceneModule.CathedralScene, THREE: threeModule };
}