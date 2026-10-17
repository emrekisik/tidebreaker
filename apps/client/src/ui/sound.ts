/**
 * The few sounds the interface makes (lock-on beeps and the warning), synthesized with the browser's
 * audio so no files are needed. Every call is safe when audio is not available: nothing happens.
 */
let context: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    context ??= new AudioContext();
    if (context.state === 'suspended') void context.resume();
    return context;
  } catch {
    return null;
  }
}

/** A short tone: `freq` Hz for `sec` seconds, starting `delay` seconds from now (volume 0..1). */
export function tone(
  freq: number,
  sec: number,
  volume = 0.05,
  type: OscillatorType = 'square',
  delay = 0,
): void {
  const ac = audio();
  if (!ac) return;
  const start = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
  gain.gain.setValueAtTime(volume, start + Math.max(0.01, sec - 0.06));
  gain.gain.exponentialRampToValueAtTime(0.0001, start + sec);
  osc.connect(gain).connect(ac.destination);
  osc.start(start);
  osc.stop(start + sec + 0.02);
}
