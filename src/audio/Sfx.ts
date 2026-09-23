import type { BlockDef } from '../world/blocks';

type Material = BlockDef['sound'];

interface Voice {
  /** Filter centre frequency for the noise body. */
  freq: number;
  q: number;
  type: BiquadFilterType;
  /** Optional tonal ping (glass, stone). */
  tone?: number;
}

const VOICES: Record<Material, Voice> = {
  grass: { freq: 2400, q: 0.7, type: 'highpass' },
  leaves: { freq: 3200, q: 0.6, type: 'highpass' },
  dirt: { freq: 520, q: 0.9, type: 'lowpass' },
  sand: { freq: 3800, q: 0.5, type: 'bandpass' },
  snow: { freq: 1800, q: 0.4, type: 'bandpass' },
  stone: { freq: 1300, q: 1.6, type: 'bandpass', tone: 190 },
  wood: { freq: 720, q: 3.2, type: 'bandpass', tone: 140 },
  glass: { freq: 4200, q: 4, type: 'bandpass', tone: 1850 },
};

/** Tiny synthesised sound effects (no audio files). Created lazily after a user gesture. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private volume = 0.6;

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  /** Must be called from a user gesture (click / key press). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
      return;
    }
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 0.5);
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      let seed = 1;
      for (let i = 0; i < len; i++) {
        seed = (seed * 16807) % 2147483647;
        d[i] = (seed / 2147483647) * 2 - 1;
      }
    } catch {
      this.ctx = null;
    }
  }

  private burst(material: Material, duration: number, gain: number, pitch: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise || this.volume <= 0 || ctx.state !== 'running') return;
    const v = VOICES[material];
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = pitch;
    const filter = ctx.createBiquadFilter();
    filter.type = v.type;
    filter.frequency.value = v.freq * pitch;
    filter.Q.value = v.q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter).connect(env).connect(this.master);
    src.start(t, Math.random() * 0.3);
    src.stop(t + duration + 0.02);
    if (v.tone) {
      const osc = ctx.createOscillator();
      osc.type = material === 'glass' ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(v.tone * pitch, t);
      osc.frequency.exponentialRampToValueAtTime(v.tone * pitch * 0.6, t + duration);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(gain * 0.35, t + 0.005);
      og.gain.exponentialRampToValueAtTime(0.0001, t + duration * 0.8);
      osc.connect(og).connect(this.master);
      osc.start(t);
      osc.stop(t + duration);
    }
  }

  dig(material: Material): void {
    this.burst(material, 0.16, 0.5, 0.9 + Math.random() * 0.2);
  }

  breakBlock(material: Material): void {
    this.burst(material, 0.26, 0.8, 0.75 + Math.random() * 0.15);
  }

  place(material: Material): void {
    this.burst(material, 0.12, 0.7, 0.6 + Math.random() * 0.1);
  }

  step(material: Material): void {
    this.burst(material, 0.09, 0.18, 0.9 + Math.random() * 0.3);
  }

  splash(): void {
    this.burst('sand', 0.35, 0.35, 0.5);
  }

  click(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== 'running' || this.volume <= 0) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(440, t + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.07);
  }

  private tone(freqs: [number, number], duration: number, gain: number, type: OscillatorType = 'sine'): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || ctx.state !== 'running' || this.volume <= 0) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freqs[0], t);
    osc.frequency.exponentialRampToValueAtTime(freqs[1], t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  hurt(): void {
    this.tone([420, 180], 0.22, 0.35, 'square');
    this.burst('dirt', 0.15, 0.4, 0.8);
  }

  eat(): void {
    for (let i = 0; i < 3; i++) setTimeout(() => this.burst('grass', 0.07, 0.35, 0.5 + Math.random() * 0.3), i * 110);
  }

  mob(kind: string, hurt = false): void {
    if(kind==='fish'){if(hurt)this.splash();return;}
    if(kind==='bird'){this.tone([1800,2400],.13,.045,'sine');return;}
    if(kind==='skeleton'){this.burst('stone',.1,.2,1.6);return;}
    if(kind==='zombie'){this.tone([95,72],.45,.12,'sawtooth');return;}
    if(kind==='villager'){this.tone([210,175],.22,.1,'triangle');return;}
    const base = kind === 'pig' ? 240 : kind === 'cow' ? 130 : 900;
    const f = base * (hurt ? 1.3 : 0.9 + Math.random() * 0.2);
    if (kind === 'chicken') {
      this.tone([f, f * 1.4], 0.08, 0.12, 'triangle');
      setTimeout(() => this.tone([f * 1.2, f * 0.9], 0.1, 0.1, 'triangle'), 110);
    } else {
      this.tone([f, f * 0.7], kind === 'cow' ? 0.6 : 0.25, 0.16, 'sawtooth');
    }
  }

  craft(): void {
    this.burst('wood', 0.12, 0.5, 0.9);
  }
}

