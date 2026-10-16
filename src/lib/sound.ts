/**
 * Cathedral Sound
 *
 * Tiny WebAudio synthesiser. No audio assets ship with the project, so every
 * cue is generated from oscillators at call time. Safe to call in any browser;
 * a suspended AudioContext (autoplay policy) simply resumes on first gesture.
 */

type Cue = 'move' | 'capture' | 'check' | 'select' | 'illegal' | 'gameover' | 'promote';

interface Tone {
  freq: number;
  durationMs: number;
  type: OscillatorType;
  gain: number;
  sweepTo?: number;
}

const CUES: Record<Cue, Tone[]> = {
  select: [{ freq: 520, durationMs: 60, type: 'sine', gain: 0.05 }],
  move: [{ freq: 330, durationMs: 110, type: 'triangle', gain: 0.09 }],
  capture: [
    { freq: 180, durationMs: 170, type: 'sawtooth', gain: 0.11, sweepTo: 90 },
    { freq: 420, durationMs: 90, type: 'triangle', gain: 0.06 }
  ],
  promote: [
    { freq: 440, durationMs: 110, type: 'triangle', gain: 0.08 },
    { freq: 660, durationMs: 110, type: 'triangle', gain: 0.08 },
    { freq: 880, durationMs: 180, type: 'sine', gain: 0.07 }
  ],
  check: [
    { freq: 740, durationMs: 90, type: 'square', gain: 0.07 },
    { freq: 988, durationMs: 140, type: 'square', gain: 0.06 }
  ],
  illegal: [{ freq: 140, durationMs: 150, type: 'square', gain: 0.07, sweepTo: 100 }],
  gameover: [
    { freq: 392, durationMs: 200, type: 'sine', gain: 0.09 },
    { freq: 311, durationMs: 220, type: 'sine', gain: 0.08 },
    { freq: 261, durationMs: 380, type: 'sine', gain: 0.08 }
  ]
};

let context: AudioContext | null = null;
let enabled = true;

function getContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!context) {
    try {
      context = new Ctor();
    } catch (_err) {
      return null;
    }
  }
  if (context.state === 'suspended') void context.resume();
  return context;
}

export function setSoundEnabled(value: boolean): void {
  enabled = value;
}

export function playCue(cue: Cue): void {
  if (!enabled) return;
  const ctx = getContext();
  if (!ctx) return;

  let offset = 0;
  for (const tone of CUES[cue]) {
    const startAt = ctx.currentTime + offset;
    const endAt = startAt + tone.durationMs / 1000;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();

    osc.type = tone.type;
    osc.frequency.setValueAtTime(tone.freq, startAt);
    if (tone.sweepTo) osc.frequency.exponentialRampToValueAtTime(tone.sweepTo, endAt);

    // Short attack / exponential decay keeps cues percussive rather than clicky.
    amp.gain.setValueAtTime(0.0001, startAt);
    amp.gain.exponentialRampToValueAtTime(tone.gain, startAt + 0.012);
    amp.gain.exponentialRampToValueAtTime(0.0001, endAt);

    osc.connect(amp).connect(ctx.destination);
    osc.start(startAt);
    osc.stop(endAt + 0.02);

    offset += tone.durationMs / 1000;
  }
}