/**
 * Optional sound cues (DESIGN A2 "optional chime"), synthesised with WebAudio so the kiosk ships no audio assets.
 * Silent unless the admin setting `kiosk.soundCues` is on.
 */
let ctx: AudioContext | null = null;

function tone(freq: number, start: number, dur: number, gain = 0.06) {
  if (typeof AudioContext === 'undefined') return;
  ctx ??= new AudioContext();
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = 'sine';
  o.frequency.value = freq;
  const t0 = ctx.currentTime + start;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

export type Cue = 'tap' | 'success' | 'error';

export function playCue(cue: Cue, enabled: boolean) {
  if (!enabled) return;
  try {
    if (cue === 'tap') tone(880, 0, 0.08, 0.04);
    if (cue === 'success') {
      tone(660, 0, 0.12);
      tone(990, 0.1, 0.22);
    }
    if (cue === 'error') {
      tone(220, 0, 0.18, 0.07);
      tone(180, 0.16, 0.22, 0.07);
    }
  } catch {
    // Audio is decoration only.
  }
}
