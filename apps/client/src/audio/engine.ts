import { Gen } from './gen.ts';
import { SOUNDS } from './recipes.ts';
import type { Bus, SoundId } from './recipes.ts';

export type { SoundId };

const STORAGE_KEY = 'tidebreaker.sound';
/** Beyond this distance (world units) a sound is not heard at all. */
const HEAR_RANGE = 150;
/** Distance over which a sound pans from the middle to the side. */
const PAN_RANGE = 90;
/** Volume of every group in the mix (before the player's volume). */
const BUS_LEVEL: Record<Bus, number> = { weapon: 0.95, impact: 1, ui: 1.5, ambient: 0.5 };
/** At most this many sounds play at once. */
const MAX_VOICES = 36;

/** The two sounds that run all the time; a file can replace them too (`ambient_sea` loops, `engine` loops and speeds up). */
export const CONTINUOUS = ['ambient_sea', 'engine'] as const;

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
  /** The sea and the engine (the sounds that run all the time). */
  ambient: boolean;
}

/** A sound file that replaces a synthesized sound: one or several takes (one is picked at random). */
interface FileSound {
  buffers: AudioBuffer[];
  gain: number;
  pitch: number;
}

/** What `manifest.json` may hold per sound id: a file, a list of files, or an object with the extras. */
type ManifestEntry = string | string[] | { file?: string; files?: string[]; gain?: number; pitch?: number };

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
  private readonly files = new Map<string, FileSound>();
  private readonly playing = new Map<string, number>();
  private voices = 0;
  private listenerX = 0;
  private listenerY = 0;
  private settings: Settings = { volume: 0.7, muted: false, ambient: true };
  private readonly listeners: (() => void)[] = [];
  private ambient: { stop: () => void } | null = null;
  private engineHum: { set: (speed: number, on: boolean) => void; stop: () => void } | null = null;
  private inMatch = false;
  private lastEngine = { speed: 0, on: false };

  constructor() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw) as Partial<Settings>;
        this.settings = {
          volume: typeof s.volume === 'number' ? Math.max(0, Math.min(1, s.volume)) : 0.7,
          muted: s.muted === true,
          ambient: s.ambient !== false,
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
  get ambientOn(): boolean {
    return this.settings.ambient;
  }

  setVolume(v: number): void {
    this.settings.volume = Math.max(0, Math.min(1, v));
    this.apply();
  }
  setMuted(m: boolean): void {
    this.settings.muted = m;
    this.apply();
  }
  setAmbient(on: boolean): void {
    this.settings.ambient = on;
    this.apply();
    this.syncContinuous();
  }

  /** True when a sound file replaces this sound (after the files were read). */
  usingFile(id: string): boolean {
    return this.files.has(id);
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
      void this.loadFiles().then(() => {
        // Files that replace the sea or the engine take over from the synthesized ones.
        this.stopContinuous();
        this.syncContinuous();
      });
      this.syncContinuous();
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

  /** A room-like tail made of decaying noise; the sounds send some of themselves to it. */
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

  /**
   * Sound files that replace synthesized sounds: `public/sounds/manifest.json` maps a sound id to a file, a
   * list of files (one is picked at random each time) or `{ "files": [...], "gain": 0.8, "pitch": 1 }`.
   */
  private async loadFiles(): Promise<void> {
    const ac = this.ac;
    if (!ac) return;
    try {
      const base = `${import.meta.env.BASE_URL}sounds/`;
      const res = await fetch(`${base}manifest.json`);
      if (!res.ok) return;
      const manifest = (await res.json()) as Record<string, ManifestEntry>;
      for (const [id, entry] of Object.entries(manifest)) {
        if (!(id in SOUNDS) && !(CONTINUOUS as readonly string[]).includes(id)) continue;
        const list =
          typeof entry === 'string' ? [entry] : Array.isArray(entry) ? entry : (entry.files ?? (entry.file ? [entry.file] : []));
        const buffers: AudioBuffer[] = [];
        for (const file of list) {
          try {
            const data = await (await fetch(base + file)).arrayBuffer();
            buffers.push(await ac.decodeAudioData(data));
          } catch {
            // A file that is missing or cannot be read: the others (or the synthesized sound) stay.
          }
        }
        if (buffers.length === 0) continue;
        const extra = typeof entry === 'object' && !Array.isArray(entry) ? entry : {};
        this.files.set(id, { buffers, gain: extra.gain ?? 1, pitch: extra.pitch ?? 1 });
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
    const file = this.files.get(id);
    let level = (opts.gain ?? 1) * (file ? file.gain : (def.trim ?? 1));
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

    let dur: number;
    if (file) {
      const src = ac.createBufferSource();
      src.buffer = file.buffers[Math.floor(Math.random() * file.buffers.length)]!;
      src.playbackRate.value = (opts.pitch ?? 1) * file.pitch * (0.96 + Math.random() * 0.08);
      src.connect(out);
      src.start(t0);
      dur = src.buffer.duration / src.playbackRate.value;
    } else {
      const pitch = (opts.pitch ?? 1) * (0.94 + Math.random() * 0.12);
      const g = new Gen(ac, out, this.reverb, t0, pitch, opts.size ?? 1, this.noise, Math.random);
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

  // ---- continuous sounds (the sea and the engine)

  /** A match is on: the sea and the engine run (if the player has them on). */
  startAmbient(): void {
    this.inMatch = true;
    this.syncContinuous();
  }

  stopAmbient(): void {
    this.inMatch = false;
    this.syncContinuous();
  }

  /** Starts or stops the continuous sounds so they match "in a match" and the player's setting. */
  private syncContinuous(): void {
    const want = this.inMatch && this.settings.ambient && this.ac !== null && this.buses !== null;
    if (want && !this.ambient) this.startSea();
    if (want && !this.engineHum) this.startEngine();
    if (!want) this.stopContinuous();
  }

  private stopContinuous(): void {
    this.ambient?.stop();
    this.ambient = null;
    this.engineHum?.stop();
    this.engineHum = null;
  }

  /**
   * The sea: very soft, low, slowly swelling noise (or the `ambient_sea` file, looped). Deliberately
   * quiet: it is only there so that silence between shots does not feel dead.
   */
  private startSea(): void {
    const ac = this.ac;
    const buses = this.buses;
    if (!ac || !buses || !this.noise) return;
    const file = this.files.get('ambient_sea');
    const src = ac.createBufferSource();
    const gain = ac.createGain();
    gain.gain.value = 0.0001;
    const stops: (() => void)[] = [];
    if (file) {
      src.buffer = file.buffers[0]!;
      src.loop = true;
      src.playbackRate.value = file.pitch;
      src.connect(gain);
      gain.gain.setTargetAtTime(0.5 * file.gain, ac.currentTime, 2);
    } else {
      src.buffer = this.noise;
      src.loop = true;
      const low = ac.createBiquadFilter();
      low.type = 'lowpass';
      low.frequency.value = 260;
      src.connect(low);
      low.connect(gain);
      gain.gain.setTargetAtTime(0.05, ac.currentTime, 2);
      // The swell: a very slow oscillator moves the filter and the level (waves rolling in and out).
      const lfo = ac.createOscillator();
      lfo.frequency.value = 0.08;
      const depth = ac.createGain();
      depth.gain.value = 90;
      lfo.connect(depth);
      depth.connect(low.frequency);
      const lfo2 = ac.createOscillator();
      lfo2.frequency.value = 0.05;
      const depth2 = ac.createGain();
      depth2.gain.value = 0.02;
      lfo2.connect(depth2);
      depth2.connect(gain.gain);
      lfo.start();
      lfo2.start();
      stops.push(() => lfo.stop(), () => lfo2.stop());
    }
    gain.connect(buses.ambient);
    src.start();
    this.ambient = {
      stop: () => {
        gain.gain.setTargetAtTime(0.0001, ac.currentTime, 0.3);
        setTimeout(() => {
          src.stop();
          for (const s of stops) s();
          gain.disconnect();
        }, 1500);
      },
    };
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
    if (!ac || !buses) return;
    const file = this.files.get('engine');
    const gain = ac.createGain();
    gain.gain.value = 0.0001;
    gain.connect(buses.ambient);
    let last = -1;
    if (file) {
      const src = ac.createBufferSource();
      src.buffer = file.buffers[0]!;
      src.loop = true;
      src.connect(gain);
      src.start();
      this.engineHum = {
        set: (speed, on) => {
          const s = on ? Math.max(0, Math.min(1, speed)) : -0.5;
          if (Math.abs(s - last) < 0.02) return;
          last = s;
          const t = ac.currentTime;
          gain.gain.setTargetAtTime(on ? file.gain * (0.35 + 0.65 * s) : 0.0001, t, 0.2);
          src.playbackRate.setTargetAtTime(file.pitch * (0.8 + 0.6 * Math.max(0, s)), t, 0.3);
        },
        stop: () => {
          gain.gain.setTargetAtTime(0.0001, ac.currentTime, 0.2);
          setTimeout(() => {
            src.stop();
            gain.disconnect();
          }, 800);
        },
      };
    } else {
      const saw = ac.createOscillator();
      saw.type = 'sawtooth';
      saw.frequency.value = 46;
      const sq = ac.createOscillator();
      sq.type = 'square';
      sq.frequency.value = 69;
      const low = ac.createBiquadFilter();
      low.type = 'lowpass';
      low.frequency.value = 130;
      saw.connect(low);
      sq.connect(low);
      low.connect(gain);
      saw.start();
      sq.start();
      this.engineHum = {
        set: (speed, on) => {
          // (Only touches the audio graph when the value moved a little.)
          const s = on ? Math.max(0, Math.min(1, speed)) : -0.5;
          if (Math.abs(s - last) < 0.02) return;
          last = s;
          const t = ac.currentTime;
          // Quiet: a low rumble you feel more than hear.
          gain.gain.setTargetAtTime(on ? 0.012 + 0.04 * Math.pow(s, 0.8) : 0.0001, t, 0.2);
          saw.frequency.setTargetAtTime(44 + 34 * s, t, 0.3);
          sq.frequency.setTargetAtTime(66 + 50 * s, t, 0.3);
          low.frequency.setTargetAtTime(110 + 160 * s, t, 0.3);
        },
        stop: () => {
          gain.gain.setTargetAtTime(0.0001, ac.currentTime, 0.2);
          setTimeout(() => {
            saw.stop();
            sq.stop();
            gain.disconnect();
          }, 800);
        },
      };
    }
    this.engineHum.set(this.lastEngine.speed, this.lastEngine.on);
  }
}

/** The game's one sound engine. */
export const audio = new AudioEngine();
