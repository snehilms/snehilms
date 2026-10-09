/* ============================================================================
   SOUND

   An original, fully synthesised soundscape in the spirit of igloo.inc's:
   measured from the reference, theirs is a quiet ambient bed (steady around
   −35 dBFS) — a low, chord-like drone with its energy at 80–200 Hz — over
   which an airy, glittering hiss swells (+12 dB above 4 kHz) while particles
   are flying. Nothing here is sampled; it is oscillators and filtered noise.

   Graph:
     drone  — five soft partials (A1, G2, G3, C4, E4) → lowpass → breathing gain
     air    — looping white noise → bandpass → high shelf → gain (driven by gust)
     pings  — short high sine "ice" glints, scheduled at a rate set by the gust
     sparkle — a crystalline chime cluster for the crystals' hover mesh: bell
              partials (fundamental + inharmonic 2.76x) on a high pentatonic set
     space  — a generated convolution tail shared by air and pings
     master → compressor → speakers

   Browsers only allow audio after a user gesture, so the context is created
   on the visitor's first click of the Sound toggle. The visitor's choice is
   remembered; on later visits sound resumes on their first interaction.
   ========================================================================= */

const SOUND_KEY = 'cryo-sound';

/** E major pentatonic from E6 up: consonant whatever order the notes fall in,
    so a cluster of them always rings as one chord, never as a clash. */
const SPARKLE_NOTES = [1318.5, 1480, 1661.2, 1975.5, 2217.5, 2637, 2960, 3322.4];

const DRONE = [
  { f: 55, type: 'sine' as OscillatorType, g: 0.5 },
  { f: 98, type: 'triangle' as OscillatorType, g: 0.38 },
  { f: 196, type: 'sine' as OscillatorType, g: 0.22 },
  { f: 261.6, type: 'sine' as OscillatorType, g: 0.08 },
  { f: 329.6, type: 'sine' as OscillatorType, g: 0.06 },
];

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private droneGain!: GainNode;
  private airGain!: GainNode;
  private airFilter!: BiquadFilterNode;
  private send!: GainNode;
  private gust = 0;
  private presence = 0;
  private lastSparkle = 0;
  enabled = false;
  private listeners = new Set<() => void>();

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((l) => l());
  }

  /** Whether the visitor turned sound on last time. */
  wanted() {
    try {
      return localStorage.getItem(SOUND_KEY) === 'on';
    } catch {
      return false;
    }
  }

  private build() {
    const ctx = new AudioContext();
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    comp.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(comp);

    // Shared space: a generated, decaying stereo noise impulse.
    const len = Math.round(ctx.sampleRate * 2.6);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    const verb = ctx.createConvolver();
    verb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.42;
    verb.connect(wet).connect(this.master);
    this.send = ctx.createGain();
    this.send.gain.value = 1;
    this.send.connect(verb);

    // Drone.
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.Q.value = 0.4;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0.05;
    lp.connect(this.droneGain).connect(this.master);
    DRONE.forEach((p, i) => {
      const o = ctx.createOscillator();
      o.type = p.type;
      o.frequency.value = p.f;
      const g = ctx.createGain();
      g.gain.value = p.g;
      // Slow detune drift so the chord breathes instead of droning flat.
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + i * 0.023;
      const depth = ctx.createGain();
      depth.gain.value = 3 + i;
      lfo.connect(depth).connect(o.detune);
      o.connect(g).connect(lp);
      o.start();
      lfo.start();
    });
    const breath = ctx.createOscillator();
    breath.frequency.value = 0.07;
    const breathDepth = ctx.createGain();
    breathDepth.gain.value = 0.012;
    breath.connect(breathDepth).connect(this.droneGain.gain);
    breath.start();

    // Air: noise → bandpass → shelf → gain.
    const nlen = ctx.sampleRate * 2;
    const nbuf = ctx.createBuffer(1, nlen, ctx.sampleRate);
    const nd = nbuf.getChannelData(0);
    for (let i = 0; i < nlen; i++) nd[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = nbuf;
    noise.loop = true;
    this.airFilter = ctx.createBiquadFilter();
    this.airFilter.type = 'bandpass';
    this.airFilter.frequency.value = 4200;
    this.airFilter.Q.value = 0.7;
    const shelf = ctx.createBiquadFilter();
    shelf.type = 'highshelf';
    shelf.frequency.value = 8000;
    shelf.gain.value = 5;
    this.airGain = ctx.createGain();
    this.airGain.gain.value = 0;
    noise.connect(this.airFilter).connect(shelf).connect(this.airGain);
    this.airGain.connect(this.master);
    this.airGain.connect(this.send);
    noise.start();
  }

  async enable() {
    if (!this.ctx) this.build();
    const ctx = this.ctx!;
    if (ctx.state !== 'running') await ctx.resume();
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setTargetAtTime(0.9, ctx.currentTime, 0.4);
    this.enabled = true;
    try {
      localStorage.setItem(SOUND_KEY, 'on');
    } catch {
      /* not persisted */
    }
    this.emit();
  }

  disable() {
    if (this.ctx) {
      const ctx = this.ctx;
      this.master.gain.cancelScheduledValues(ctx.currentTime);
      this.master.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
      window.setTimeout(() => {
        if (!this.enabled) ctx.suspend();
      }, 900);
    }
    this.enabled = false;
    try {
      localStorage.setItem(SOUND_KEY, 'off');
    } catch {
      /* not persisted */
    }
    this.emit();
  }

  /** 0 → 1: how much of the room the visitor is in (the stage is louder). */
  setPresence(level: number) {
    this.presence = level;
    if (!this.ctx || !this.enabled) return;
    this.droneGain.gain.setTargetAtTime(0.04 + level * 0.03, this.ctx.currentTime, 0.5);
  }

  /** Called every frame with the current disturbance, 0 → 1. */
  setGust(level: number, dt: number) {
    if (!this.ctx || !this.enabled) return;
    const now = this.ctx.currentTime;
    const rising = level > this.gust;
    this.gust = level;
    // Fast attack, slow release: a gust arrives at once and dies away.
    this.airGain.gain.setTargetAtTime(level * 0.16, now, rising ? 0.04 : 0.35);
    this.airFilter.frequency.setTargetAtTime(3200 + level * 4200, now, 0.1);
    // Glints: a Poisson-ish trickle whose rate follows the gust.
    if (Math.random() < level * dt * 22) this.ping(0.35 + level * 0.65);
  }

  /** A swell: a change of mark, or a hard knock on it. */
  burst(strength = 1) {
    if (!this.ctx || !this.enabled) return;
    const now = this.ctx.currentTime;
    const g = this.airGain.gain;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(0.2 * strength, now, 0.05);
    g.setTargetAtTime(0, now + 0.35, 0.6);
    for (let i = 0; i < Math.round(5 * strength); i++) {
      window.setTimeout(() => this.ping(0.6 + Math.random() * 0.4), i * 60 + Math.random() * 120);
    }
  }

  /**
   * The hover mesh radiating over a crystal: two to four glassy chimes,
   * staggered a few tens of milliseconds apart, panned toward the pointer.
   * Rate-limited, because pulses can arrive faster than chimes should.
   */
  sparkle(strength = 1, panX = 0) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (now - this.lastSparkle < 0.11) return;
    this.lastSparkle = now;
    const count = 2 + Math.round(Math.random() * 2 * strength);
    let base = Math.floor(Math.random() * (SPARKLE_NOTES.length - 3));
    for (let i = 0; i < count; i++) {
      const t = now + i * (0.022 + Math.random() * 0.04);
      base = Math.min(base + 1 + Math.round(Math.random()), SPARKLE_NOTES.length - 1);
      const f = SPARKLE_NOTES[base] * (1 + (Math.random() - 0.5) * 0.004);
      const decay = 0.55 + Math.random() * 0.7;
      const peak = 0.014 * strength * (1 - i * 0.12);
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.max(-0.9, Math.min(0.9, panX * 0.7 + (Math.random() - 0.5) * 0.3));
      pan.connect(this.master);
      // Twice a ping's reverb send: the chime should hang in the air.
      const wet = ctx.createGain();
      wet.gain.value = 2;
      pan.connect(wet).connect(this.send);
      // Fundamental and the inharmonic partial that makes it glass, not a beep.
      for (const [mult, level, len] of [
        [1, 1, decay],
        [2.76, 0.32, decay * 0.45],
      ] as const) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f * mult;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(peak * level, t + 0.003);
        g.gain.exponentialRampToValueAtTime(0.0001, t + len);
        o.connect(g).connect(pan);
        o.start(t);
        o.stop(t + len + 0.05);
      }
    }
  }

  private ping(strength: number) {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 2600 + Math.random() * 5200;
    const g = ctx.createGain();
    const peak = 0.012 * strength;
    const decay = 0.12 + Math.random() * 0.4;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(peak, now + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, now + decay);
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    o.connect(g).connect(pan);
    pan.connect(this.master);
    pan.connect(this.send);
    o.start(now);
    o.stop(now + decay + 0.05);
  }
}

export const sound = new SoundEngine();
