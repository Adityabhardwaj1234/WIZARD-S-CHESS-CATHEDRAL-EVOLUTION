'use client';

/**
 * Application shell.
 *
 * `SessionProvider` wraps the whole router stage so a match in progress survives
 * navigating between Home, Play, Analysis, Training, Library and Settings.
 * The 3D board is only mounted on the Play view, so its WebGL context is created
 * once and released when you leave.
 */

import { useCallback, useEffect, useState } from 'react';

import { TopNavbar } from '../components/TopNavbar';
import { HomeDashboard } from '../components/HomeDashboard';
import { PlayView } from '../components/PlayView';
import { XRayOverlayPanel } from '../components/XRayOverlayPanel';
import { TrainingLab } from '../components/TrainingLab';
import { GameLibrary } from '../components/GameLibrary';
import { SettingsView } from '../components/SettingsView';
import { SessionProvider, type PrimaryView } from '../context/CathedralSession';

export type { PrimaryView } from '../context/CathedralSession';

export default function WizardsChessCathedralPage() {
  const [activeView, setActiveView] = useState<PrimaryView>('home');
  const [uiDensity, setUiDensity] = useState<'comfortable' | 'compact'>('comfortable');

  const navigate = useCallback((view: PrimaryView) => setActiveView(view), []);
  const toggleDensity = useCallback(
    () => setUiDensity(prev => (prev === 'comfortable' ? 'compact' : 'comfortable')),
    []
  );

  // Keyboard shortcuts are disabled while typing so SAN entry keeps working.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
      const map: Record<string, PrimaryView> = {
        h: 'home',
        p: 'play',
        x: 'analysis',
        t: 'training',
        l: 'library',
        s: 'settings'
      };
      const view = map[event.key.toLowerCase()];
      if (view) {
        event.preventDefault();
        setActiveView(view);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <SessionProvider>
      <div className={`app-shell density-${uiDensity}`}>
        <TopNavbar
          activeView={activeView}
          onNavigate={navigate}
          uiDensity={uiDensity}
          onToggleDensity={toggleDensity}
        />
        <main className="main-router-stage">
          {activeView === 'home' && <HomeDashboard onNavigate={navigate} />}
          {activeView === 'play' && <PlayView />}
          {activeView === 'analysis' && <XRayOverlayPanel />}
          {activeView === 'training' && <TrainingLab />}
          {activeView === 'library' && <GameLibrary />}
          {activeView === 'settings' && <SettingsView />}
        </main>
      </div>
    </SessionProvider>
  );
}