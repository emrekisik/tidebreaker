export interface ToneOpts {
  /** Seconds after the start of the sound. */
  at?: number;
  /** Seconds to rise to full volume (default 3 ms). */
  attack?: number;
  /** Share of this voice sent to the reverb. */
  wet?: number;
}

export interface NoiseOpts extends ToneOpts {
  type: BiquadFilterType;
  /** Filter frequency at the start and at the end of the sound (Hz): it sweeps between them. */
  f0: number;
  f1?: number;
  q?: number;
}

/**
 * What a sound recipe draws with: tones and filtered noise bursts shaped by an envelope, sent to the
 * sound's output. All times are relative to the start of the sound; every method returns the time the
 * voice ends, so a recipe can report its length.
 */
export class Gen {
  constructor(
    readonly ac: AudioContext,
    /** Where the sound goes (its own volume and pan). */
    readonly out: AudioNode,
    /** The reverb send, or null when there is none. */
    readonly wetOut: AudioNode | null,
    readonly t0: number,
    /** Random pitch factor of this play (also scales every tone). */
    readonly pitch: number,
    /** How big the thing is (explosions): 1 = normal. */
    readonly size: number,
    private readonly noiseBuffer: AudioBuffer,
    /** Random numbers in [0, 1) (for small differences between plays). */
    readonly rnd: () => number,
  ) {}

  private envelope(start: number, attack: number, dur: number, vol: number, wet: number): GainNode {
    const g = this.ac.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    g.connect(this.out);
    if (wet > 0 && this.wetOut) {
      const send = this.ac.createGain();
      send.gain.value = wet;
      g.connect(send);
      send.connect(this.wetOut);
    }
    return g;
  }

  /** An oscillator whose pitch slides from `f0` to `f1` over `dur` seconds. */
  tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, o: ToneOpts = {}): number {
    const start = this.t0 + (o.at ?? 0);
    const osc = this.ac.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(20, f0 * this.pitch), start);
    if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1 * this.pitch), start + dur);
    osc.connect(this.envelope(start, o.attack ?? 0.003, dur, vol, o.wet ?? 0));
    osc.start(start);
    osc.stop(start + dur + 0.05);
    return (o.at ?? 0) + dur;
  }

  /** A burst of white noise through a filter that sweeps from `f0` to `f1`. */
  noise(dur: number, vol: number, o: NoiseOpts): number {
    const start = this.t0 + (o.at ?? 0);
    const src = this.ac.createBufferSource();
    src.buffer = this.noiseBuffer;
    const offset = this.rnd() * Math.max(0, this.noiseBuffer.duration - dur - 0.1);
    const filter = this.ac.createBiquadFilter();
    filter.type = o.type;
    filter.Q.value = o.q ?? 0.8;
    filter.frequency.setValueAtTime(Math.max(20, o.f0), start);
    if (o.f1 !== undefined && o.f1 !== o.f0) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), start + dur);
    }
    src.connect(filter);
    filter.connect(this.envelope(start, o.attack ?? 0.003, dur, vol, o.wet ?? 0));
    src.start(start, offset);
    src.stop(start + dur + 0.05);
    return (o.at ?? 0) + dur;
  }
}
