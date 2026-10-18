import { Gen } from './gen.ts';
import type { Style } from './gen.ts';
import { SOUNDS } from './recipes.ts';
import type { Bus, SoundId } from './recipes.ts';

export type { SoundId, Style };

const STORAGE_KEY = 'tidebreaker.sound';
/** Beyond this distance (world units) a sound is not heard at all. */
const HEAR_RANGE = 150;
/** Distance over which a sound pans from the middle to the side. */
const PAN_RANGE = 90;
/** Volume of every group in the mix (before the player's volume). */
const BUS_LEVEL: Record<Bus, number> = { weapon: 0.95, impact: 1, ui: 1.5, ambient: 0.5 };
/** At most this many sounds play at once. */
const MAX_VOICES = 36;

export interface PlayOpts {
  /** World position of the sound (it gets quieter and moves to the side with the distance). */
  x?: number;
  y?: number;
  /** The player's own doing: full volume, in the middle. */
  own?: boolean;
  /** Extra volume factor. */
  gain?: number;
  /** Pitch factor (1 = as written). */
  pitch?: number;
  /** How big (explosions and sinking ships): 1 = normal. */
  size?: number;
}

interface Settings {
  volume: number;
  muted: boolean;
  style: Style;
}

/**
 * The game's sound: one Web Audio context, a mix of four groups (weapons, impacts, interface,
 * ambience) behind the player's volume, positions of sounds relative to the player, and the sounds
 * themselves, synthesized from recipes (see recipes.ts) unless a sound file replaces one
 * (`public/sounds/manifest.json` maps a sound's id to a file). Every call is safe when audio is
 * unavailable: nothing happens.
 */
class AudioEngine {
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private buses: Record<Bus, GainNode> | null = null;
  private reverb: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private readonly files = new Map<string, AudioBuffer>();
  private readonly playing = new Map<string, number>();
  private voices = 0;
  private listenerX = 0;
  private listenerY = 0;
  private settings: Settings = { volume: 0.7, muted: false, style: 'arcade' };
  private readonly listeners: (() => void)[] = [];
  private ambient: { stop: () => void } | null = null;
  private engineHum: { set: (speed: number, on: boolean) => void } | null = null;
  private wantAmbient = false;
  private lastEngine = { speed: 0, on: false };

  constructor() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw) as Partial<Settings>;
        this.settings = {
          volume: typeof s.volume === 'number' ? Math.max(0, Math.min(1, s.volume)) : 0.7,
          muted: s.muted === true,
          style: s.style === 'real' ? 'real' : 'arcade',
        };
      }
    } catch {
      // Private mode or broken data: the defaults are fine.
    }
  }

  get volume(): number {
    return this.settings.volume;
  }
  get muted(): boolean {
    return this.settings.muted;
  }
  get style(): Style {
    return this.settings.style;
  }

  setVolume(v: number): void {
    this.settings.volume = Math.max(0, Math.min(1, v));
    this.apply();
  }
  setMuted(m: boolean): void {
    this.settings.muted = m;
    this.apply();
  }
  setStyle(s: Style): void {
    this.settings.style = s;
    this.apply();
  }

  /** Called when a setting changes (the settings panels keep themselves up to date with it). */
  subscribe(fn: () => void): void {
    this.listeners.push(fn);
  }

  private apply(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Not remembering is fine.
    }
    if (this.master && this.ac) {
      const level = this.settings.muted ? 0 : this.settings.volume * this.settings.volume;
      this.master.gain.setTargetAtTime(level, this.ac.currentTime, 0.02);
    }
    for (const fn of this.listeners) fn();
  }

  /**
   * Opens the audio context. Browsers only allow it after the player did something (a click or key), so
   * this is called from the first of those.
   */
  unlock(): void {
    if (this.ac) {
      if (this.ac.state === 'suspended') void this.ac.resume();
      return;
    }
    try {
      const ac = new AudioContext();
      this.ac = ac;
      const master = ac.createGain();
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 12;
      comp.ratio.value = 5;
      comp.attack.value = 0.003;
      comp.release.value = 0.2;
      master.connect(comp);
      comp.connect(ac.destination);
      this.master = master;
      const buses = {} as Record<Bus, GainNode>;
      for (const b of Object.keys(BUS_LEVEL) as Bus[]) {
        const g = ac.createGain();
        g.gain.value = BUS_LEVEL[b];
        g.connect(master);
        buses[b] = g;
      }
      this.buses = buses;
      this.noise = this.makeNoise(ac, 2);
      this.reverb = this.makeReverb(ac, master);
      this.apply();
      void this.loadFiles();
      if (this.wantAmbient) this.startAmbient();
    } catch {
      this.ac = null;
    }
  }

  private makeNoise(ac: AudioContext, seconds: number): AudioBuffer {
    const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * seconds), ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** A room-like tail made of decaying noise; sounds in the real style send some of themselves to it. */
  private makeReverb(ac: AudioContext, to: AudioNode): GainNode {
    const len = Math.floor(ac.sampleRate * 1.5);
    const buf = ac.createBuffer(2, len, ac.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    const conv = ac.createConvolver();
    conv.buffer = buf;
    const send = ac.createGain();
    send.gain.value = 0.55;
    send.connect(conv);
    conv.connect(to);
    return send;
  }

  /** Sound files that replace synthesized sounds: `public/sounds/manifest.json` = { "<id>": "<file>" }. */
  private async loadFiles(): Promise<void> {
    const ac = this.ac;
    if (!ac) return;
    try {
      const base = `${import.meta.env.BASE_URL}sounds/`;
      const res = await fetch(`${base}manifest.json`);
      if (!res.ok) return;
      const manifest = (await res.json()) as Record<string, string>;
      for (const [id, file] of Object.entries(manifest)) {
        if (!(id in SOUNDS) || typeof file !== 'string') continue;
        try {
          const data = await (await fetch(base + file)).arrayBuffer();
          this.files.set(id, await ac.decodeAudioData(data));
        } catch {
          // A file that is missing or cannot be read: the synthesized sound stays.
        }
      }
    } catch {
      // No manifest: everything is synthesized.
    }
  }

  /** Where the player is, for positions of sounds (call every frame). */
  setListener(x: number, y: number): void {
    this.listenerX = x;
    this.listenerY = y;
  }

  /** Plays a sound. */
  play(id: SoundId, opts: PlayOpts = {}): void {
    const ac = this.ac;
    const buses = this.buses;
    if (!ac || !buses || !this.noise || this.settings.muted || this.settings.volume <= 0) return;
    const def = SOUNDS[id] as { bus: Bus; max: number; trim?: number; run: (g: Gen) => number };
    let level = (opts.gain ?? 1) * (def.trim ?? 1);
    let pan = 0;
    if (!opts.own && opts.x !== undefined && opts.y !== undefined) {
      const d = Math.hypot(opts.x - this.listenerX, opts.y - this.listenerY);
      if (d >= HEAR_RANGE) return;
      level *= Math.pow(1 - d / HEAR_RANGE, 1.4);
      pan = Math.max(-1, Math.min(1, (opts.x - this.listenerX) / PAN_RANGE)) * 0.8;
    }
    if (level < 0.015 || this.voices >= MAX_VOICES) return;
    const running = this.playing.get(id) ?? 0;
    if (running >= def.max) return;

    const t0 = ac.currentTime + 0.005;
    const out = ac.createGain();
    out.gain.value = level;
    let tail: AudioNode = out;
    if (pan !== 0 && typeof ac.createStereoPanner === 'function') {
      const p = ac.createStereoPanner();
      p.pan.value = pan;
      out.connect(p);
      tail = p;
    }
    tail.connect(buses[def.bus]);

    const file = this.files.get(id);
    let dur: number;
    if (file) {
      const src = ac.createBufferSource();
      src.buffer = file;
      src.playbackRate.value = (opts.pitch ?? 1) * (0.95 + Math.random() * 0.1);
      src.connect(out);
      src.start(t0);
      dur = file.duration;
    } else {
      const wet = this.settings.style === 'real' ? this.reverb : null;
      const pitch = (opts.pitch ?? 1) * (0.94 + Math.random() * 0.12);
      const g = new Gen(ac, out, wet, t0, this.settings.style, pitch, opts.size ?? 1, this.noise, Math.random);
      dur = def.run(g);
    }
    this.playing.set(id, running + 1);
    this.voices++;
    setTimeout(
      () => {
        this.playing.set(id, Math.max(0, (this.playing.get(id) ?? 1) - 1));
        this.voices = Math.max(0, this.voices - 1);
        out.disconnect();
      },
      (dur + 0.4) * 1000,
    );
  }

  // ---- continuous sounds

  /** The sea: a soft wash of filtered noise that slowly swells. Call when a match starts. */
  startAmbient(): void {
    this.wantAmbient = true;
    const ac = this.ac;
    const buses = this.buses;
    if (!ac || !buses || !this.noise || this.ambient) return;
    const src = ac.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const low = ac.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 420;
    const band = ac.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 800;
    band.Q.value = 0.6;
    const gain = ac.createGain();
    gain.gain.value = 0.0001;
    gain.gain.setTargetAtTime(0.28, ac.currentTime, 1.5);
    src.connect(low);
    src.connect(band);
    low.connect(gain);
    band.connect(gain);
    gain.connect(buses.ambient);
    // The swell: two slow oscillators move the filters (waves rolling in and out).
    const lfoA = ac.createOscillator();
    lfoA.frequency.value = 0.11;
    const depthA = ac.createGain();
    depthA.gain.value = 160;
    lfoA.connect(depthA);
    depthA.connect(low.frequency);
    const lfoB = ac.createOscillator();
    lfoB.frequency.value = 0.067;
    const depthB = ac.createGain();
    depthB.gain.value = 0.12;
    lfoB.connect(depthB);
    depthB.connect(gain.gain);
    src.start();
    lfoA.start();
    lfoB.start();
    this.ambient = {
      stop: () => {
        gain.gain.setTargetAtTime(0.0001, ac.currentTime, 0.3);
        setTimeout(() => {
          src.stop();
          lfoA.stop();
          lfoB.stop();
          gain.disconnect();
        }, 1500);
      },
    };
    this.startEngine();
  }

  stopAmbient(): void {
    this.wantAmbient = false;
    this.ambient?.stop();
    this.ambient = null;
    this.engineHum?.set(0, false);
  }

  /** The own ship's engine: a low hum that rises with the speed (0..1). Call every frame. */
  setEngine(speed: number, alive: boolean): void {
    this.lastEngine.speed = speed;
    this.lastEngine.on = alive;
    this.engineHum?.set(speed, alive);
  }

  private startEngine(): void {
    const ac = this.ac;
    const buses = this.buses;
    if (!ac || !buses || this.engineHum) return;
    const saw = ac.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.value = 48;
    const sq = ac.createOscillator();
    sq.type = 'square';
    sq.frequency.value = 72;
    const low = ac.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 180;
    const gain = ac.createGain();
    gain.gain.value = 0.0001;
    saw.connect(low);
    sq.connect(low);
    low.connect(gain);
    gain.connect(buses.ambient);
    saw.start();
    sq.start();
    let last = -1;
    this.engineHum = {
      set: (speed, on) => {
        // (Only touches the audio graph when the value moved a little.)
        const s = on ? Math.max(0, Math.min(1, speed)) : -0.5;
        if (Math.abs(s - last) < 0.02) return;
        last = s;
        const t = ac.currentTime;
        const level = on ? 0.03 + 0.1 * Math.pow(s, 0.8) : 0.0001;
        gain.gain.setTargetAtTime(level, t, 0.15);
        saw.frequency.setTargetAtTime(46 + 40 * s, t, 0.2);
        sq.frequency.setTargetAtTime(69 + 60 * s, t, 0.2);
        low.frequency.setTargetAtTime(150 + 260 * s, t, 0.2);
      },
    };
    this.engineHum.set(this.lastEngine.speed, this.lastEngine.on);
  }
}

/** The game's one sound engine. */
export const audio = new AudioEngine();
