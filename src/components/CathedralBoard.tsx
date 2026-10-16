'use client';

/**
 * Cathedral Board — imperative Three.js host.
 *
 * React owns nothing inside the canvas. This component creates the renderer once,
 * then pushes board state into the scene imperatively whenever the position,
 * selection or X-Ray configuration changes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useSession } from '../context/CathedralSession';
import { xray as xrayApi } from '../lib/cathedral';
import { loadCathedralScene, type CathedralSceneInstance } from '../lib/scene';

const CAMERA_PRESETS = ['default', 'overhead', 'strategic', 'cinematic'] as const;

type BoardStatus = 'loading' | 'ready' | 'unsupported' | 'error';

export function CathedralBoard() {
  const session = useSession();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<CathedralSceneInstance | null>(null);
  const lastMoveCountRef = useRef(-1);
  const cameraIndexRef = useRef(0);
  const [status, setStatus] = useState<BoardStatus>('loading');
  const [failure, setFailure] = useState<string | null>(null);
  const [hoverSquare, setHoverSquare] = useState<string | null>(null);

  // The scene is created once, so its callbacks must always reach the current
  // session callbacks rather than the ones captured at mount time.
  const clickSquareRef = useRef(session.clickSquare);
  clickSquareRef.current = session.clickSquare;

  const { snapshot, selectedSquare, selectionMoves, hintMove, xrayLayers, settings, boardFlipped, gameHandle, engineResult } =
    session;

  /* ------------------------------------------------------------ scene setup */
  useEffect(() => {
    let disposed = false;
    const container = containerRef.current;
    if (!container) return;

    void (async () => {
      try {
        const loaded = await loadCathedralScene();
        if (!loaded) {
          if (!disposed) setStatus('unsupported');
          return;
        }
        if (disposed) return;

        const scene = new loaded.Scene(container, {
          onSquareClick: square => clickSquareRef.current(square),
          onSquareHover: square => setHoverSquare(square)
        });

        if (disposed) {
          scene.dispose();
          return;
        }
        sceneRef.current = scene;
        setStatus('ready');
      } catch (err) {
        if (disposed) return;
        setFailure(err instanceof Error ? err.message : 'Unknown renderer error');
        setStatus('error');
      }
    })();

    return () => {
      disposed = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
      lastMoveCountRef.current = -1;
    };
  }, []);

  /* ------------------------------------------------------- visual settings */
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || status !== 'ready') return;
    scene.setVisualSettings({
      animationsEnabled: settings.animationsEnabled,
      reducedMotion: settings.reducedMotion,
      showCoordinates: settings.showCoordinates,
      quality: settings.visualQuality
    });
  }, [settings.animationsEnabled, settings.reducedMotion, settings.showCoordinates, settings.visualQuality, status]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || status !== 'ready') return;
    scene.setFlipped(boardFlipped);
    cameraIndexRef.current = 0;
    scene.setCameraPreset('default');
  }, [boardFlipped, status]);

  /* ---------------------------------------------------------- board syncing */
  useEffect(() => {
    const scene = sceneRef.current;
    const game = gameHandle.current;
    if (!scene || !game || status !== 'ready') return;

    const isNewMove = snapshot.moveCount > lastMoveCountRef.current;
    const last = snapshot.lastMove;
    const transition =
      isNewMove && last
        ? { from: last.from, to: last.to, flags: last.flags, captured: last.captured, color: last.color }
        : null;

    if (isNewMove) scene.clearShatterEffects();
    scene.syncBoard(game, transition);
    lastMoveCountRef.current = snapshot.moveCount;
  }, [gameHandle, snapshot.fen, snapshot.moveCount, snapshot.lastMove, status]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || status !== 'ready') return;
    scene.updateHighlights({
      selectedSquare,
      legalMoves: settings.showLegalMoves ? selectionMoves : [],
      lastMove: snapshot.lastMove ? { from: snapshot.lastMove.from, to: snapshot.lastMove.to } : null,
      checkSquare: snapshot.checkSquare,
      hintMove: hintMove ? { from: hintMove.from, to: hintMove.to } : null
    });
  }, [
    selectedSquare,
    selectionMoves,
    hintMove,
    snapshot.lastMove,
    snapshot.checkSquare,
    settings.showLegalMoves,
    status
  ]);

  /* -------------------------------------------------------------- X-Ray 3D */
  const xrayData = useMemo(() => {
    if (!xrayLayers.enabled) return null;
    const game = gameHandle.current;
    if (!game) return null;
    try {
      return xrayApi.computeXRayAnalysis(game);
    } catch (_err) {
      return null;
    }
    // Recomputed only when the position changes — the analysis walks all 64
    // squares, so it must not re-run on unrelated renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.fen, xrayLayers.enabled]);

  const predictionArrows = useMemo(() => {
    const best = engineResult?.bestMove;
    if (!best?.from || !best?.to) return [];
    return [{ from: best.from, to: best.to, colorHex: 0x38bdf8, width: 0.1, yOffset: 0.2 }];
  }, [engineResult]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene || status !== 'ready') return;
    scene.updateXRayOverlays(xrayData, xrayLayers, predictionArrows);
  }, [xrayData, xrayLayers, predictionArrows, status]);

  /* ---------------------------------------------------------------- camera */
  const zoom = useCallback((delta: number) => sceneRef.current?.zoomCamera(delta), []);

  const cycleCamera = useCallback(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const next = (cameraIndexRef.current + 1) % CAMERA_PRESETS.length;
    cameraIndexRef.current = next;
    scene.setCameraPreset(CAMERA_PRESETS[next]);
  }, []);

  const disabled = status !== 'ready';

  return (
    <div className="board-stage">
      <div className="board-canvas-host" ref={containerRef} />

      {status === 'loading' && (
        <div className="board-fallback" role="status">
          <span className="text-muted">Consecrating the cathedral…</span>
        </div>
      )}

      {status === 'unsupported' && (
        <div className="board-fallback" role="status">
          <span className="text-muted">
            WebGL is unavailable in this browser, so the 3D sanctuary cannot be drawn. The match is still
            fully playable from the move controls below.
          </span>
        </div>
      )}

      {status === 'error' && (
        <div className="board-fallback" role="status">
          <span className="text-muted">The 3D renderer failed to initialise{failure ? `: ${failure}` : ''}.</span>
        </div>
      )}

      {status === 'ready' && hoverSquare && (
        <span className="board-hover-readout" aria-hidden="true">
          {hoverSquare}
        </span>
      )}

      <div className="board-overlay-controls">
        <button type="button" className="icon-btn" onClick={() => zoom(-1.1)} disabled={disabled} title="Zoom in">
          +
        </button>
        <button type="button" className="icon-btn" onClick={() => zoom(1.1)} disabled={disabled} title="Zoom out">
          −
        </button>
        <button type="button" className="icon-btn" onClick={cycleCamera} disabled={disabled} title="Cycle camera angle">
          ⌖ View
        </button>
        <button type="button" className="icon-btn" onClick={session.flipBoard} title="Flip board">
          ⇅ Flip
        </button>
      </div>
    </div>
  );
}