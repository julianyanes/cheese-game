/**
 * Original, procedural thrash-metal score and sound design.
 * Everything is synthesized locally: no downloads, samples, or licensed tracks.
 * Call start() from a click/tap before playing; browsers require a user gesture.
 */
export type GameSound =
  | "step" | "pickup" | "blast" | "break" | "jump"
  | "growl" | "hurt" | "land" | "secret";

type Source = OscillatorNode | AudioBufferSourceNode;

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private effects: GainNode | null = null;
  private guitar: WaveShaperNode | null = null;
  private noise: AudioBuffer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private sources = new Set<Source>();
  private paused = true;
  private muted = false;
  private disposed = false;
  private threat = 0;
  private nextNote = 0;
  private step = 0;
  private startRequest = 0;
  private readonly sixteenth = 60 / 184 / 4;

  async start(): Promise<void> {
    if (this.disposed || typeof window === "undefined") return;
    const request = ++this.startRequest;
    try {
      if (!this.ctx) this.build();
      if (!this.ctx) return;
      if (this.ctx.state === "suspended") await this.ctx.resume();
      if (this.disposed || request !== this.startRequest || this.ctx.state !== "running") return;
      this.paused = false;
      this.volume();
      if (this.timer !== null) return;
      this.nextNote = this.ctx.currentTime + 0.025;
      this.schedule();
      this.timer = setInterval(() => this.schedule(), 25);
    } catch {
      // Audio is optional when a browser/device refuses an AudioContext.
      this.setPaused(true);
    }
  }

  setPaused(paused: boolean): void {
    if (this.disposed) return;
    this.paused = paused;
    if (paused) {
      this.startRequest++;
      if (this.timer !== null) clearInterval(this.timer);
      this.timer = null;
      this.stopSources();
      this.volume();
    } else {
      void this.start();
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.volume();
  }

  setThreat(threat: number): void {
    this.threat = Math.max(0, Math.min(1, threat));
  }

  private build(): void {
    const AudioContextType = window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextType) return;
    const ctx = new AudioContextType();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -15;
    limiter.knee.value = 8;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.13;
    this.master.connect(limiter);
    limiter.connect(ctx.destination);

    this.music = ctx.createGain();
    this.music.gain.value = 0.42;
    this.music.connect(this.master);
    this.effects = ctx.createGain();
    this.effects.gain.value = 0.68;
    this.effects.connect(this.master);

    this.guitar = ctx.createWaveShaper();
    const curve = new Float32Array(4096);
    for (let i = 0; i < curve.length; i++) {
      const x = i * 2 / (curve.length - 1) - 1;
      curve[i] = Math.tanh(x * 11);
    }
    this.guitar.curve = curve;
    this.guitar.oversample = "2x";
    const cabinet = ctx.createBiquadFilter();
    cabinet.type = "lowpass";
    cabinet.frequency.value = 2900;
    cabinet.Q.value = 0.7;
    const rumble = ctx.createBiquadFilter();
    rumble.type = "highpass";
    rumble.frequency.value = 75;
    this.guitar.connect(cabinet);
    cabinet.connect(rumble);
    rumble.connect(this.music);

    this.noise = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 1.5), ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  private volume(): void {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(this.muted || this.paused ? 0 : 0.4, t, 0.025);
  }

  private track<T extends Source>(source: T): T {
    this.sources.add(source);
    source.onended = () => {
      source.disconnect();
      this.sources.delete(source);
    };
    return source;
  }

  private stopSources(): void {
    for (const source of this.sources) {
      try { source.stop(); } catch { /* Already stopped. */ }
      source.disconnect();
    }
    this.sources.clear();
  }

  private envelope(at: number, duration: number, level: number, destination: AudioNode, attack = 0.003): GainNode {
    const gain = this.ctx!.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, level), at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    gain.connect(destination);
    return gain;
  }

  private tone(at: number, frequency: number, duration: number, level: number, type: OscillatorType,
    destination: AudioNode, endFrequency?: number): void {
    const oscillator = this.track(this.ctx!.createOscillator());
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, at);
    if (endFrequency !== undefined) oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, endFrequency), at + duration);
    const gain = this.envelope(at, duration, level, destination);
    oscillator.connect(gain);
    oscillator.addEventListener("ended", () => gain.disconnect(), { once: true });
    oscillator.start(at);
    oscillator.stop(at + duration + 0.01);
  }

  private hiss(at: number, duration: number, level: number, frequency: number,
    type: BiquadFilterType, destination: AudioNode): void {
    if (!this.noise) return;
    const source = this.track(this.ctx!.createBufferSource());
    source.buffer = this.noise;
    const filter = this.ctx!.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = 0.8;
    const gain = this.envelope(at, duration, level, destination, 0.002);
    source.connect(filter);
    filter.connect(gain);
    source.addEventListener("ended", () => { filter.disconnect(); gain.disconnect(); }, { once: true });
    source.start(at, Math.random() * 0.12, Math.min(duration + 0.02, 1.3));
  }

  private schedule(): void {
    if (!this.ctx || this.paused || this.disposed) return;
    // Recover after a background tab throttles the scheduler; never queue stale bars.
    if (this.nextNote < this.ctx.currentTime - 0.1) this.nextNote = this.ctx.currentTime + 0.02;
    while (this.nextNote < this.ctx.currentTime + 0.11) {
      this.riff(this.nextNote, this.step++);
      this.nextNote += this.sixteenth;
    }
  }

  private riff(at: number, step: number): void {
    const music = this.music!;
    const beat = step % 16;
    const bar = Math.floor(step / 16) % 8;
    // E-minor / Phrygian chromatic power-chord phrases, with palm-muted pedal notes.
    const phrases = [
      [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 6, 5, 3, 1],
      [0, 0, -1, 0, 3, 0, 1, 0, 0, 0, -1, 0, 6, 0, 5, 3],
      [0, 0, 0, 3, 0, 0, 5, 0, 6, 5, 3, 1, 0, 0, 0, 0],
      [0, -1, 0, 0, 1, 0, 3, 0, 6, -1, 5, -1, 3, 1, 0, 0],
    ];
    const note = phrases[Math.floor(bar / 2)][beat];
    if (note >= 0) {
      const root = 82.4069 * Math.pow(2, note / 12);
      const accent = note !== 0 || beat === 0 || beat === 8;
      const duration = accent ? 0.135 : 0.062;
      const level = accent ? 0.105 : 0.085;
      this.tone(at, root, duration, level, "sawtooth", this.guitar!);
      this.tone(at, root * 1.4983, duration, level * 0.56, "sawtooth", this.guitar!);
      this.tone(at, root * 2.003, duration, level * 0.3, "sawtooth", this.guitar!);
      this.tone(at, root / 2, duration + 0.02, 0.17, "triangle", music);
    }
    const kicks = [0, 3, 6, 8, 10, 14];
    if (kicks.includes(beat) || (this.threat > 0.6 && [2, 7, 11, 15].includes(beat))) {
      this.tone(at, 145, 0.14, 0.6, "sine", music, 38);
      this.hiss(at, 0.018, 0.14, 1700, "highpass", music);
    }
    if (beat === 4 || beat === 12) {
      this.hiss(at, 0.135, 0.47, 1800, "highpass", music);
      this.tone(at, 190, 0.09, 0.23, "triangle", music, 110);
    }
    if (beat % 2 === 0 || this.threat > 0.75) this.hiss(at, 0.041, beat % 4 === 0 ? 0.13 : 0.08, 6500, "highpass", music);
    if (beat === 0 && bar % 2 === 0) this.hiss(at, 0.48, 0.18, 4200, "highpass", music);
  }

  effect(name: GameSound): void {
    if (!this.ctx || !this.effects || this.paused || this.disposed || this.muted || this.ctx.state !== "running") return;
    const t = this.ctx.currentTime + 0.002;
    const fx = this.effects;
    switch (name) {
      case "step":
        this.hiss(t, 0.045, 0.1, 420, "lowpass", fx);
        this.tone(t, 92, 0.04, 0.08, "sine", fx, 40);
        break;
      case "pickup":
        [659, 831, 988].forEach((note, i) => this.tone(t + i * 0.055, note, 0.13, 0.16, "triangle", fx));
        break;
      case "secret":
        [165, 220, 330, 440, 660].forEach((note, i) => this.tone(t + i * 0.065, note, 0.27, 0.19, "triangle", fx));
        break;
      case "blast":
        this.hiss(t, 0.48, 0.85, 2600, "lowpass", fx);
        this.tone(t, 180, 0.46, 0.8, "sine", fx, 24);
        this.tone(t, 900, 0.16, 0.23, "sawtooth", fx, 55);
        this.hiss(t + 0.065, 0.32, 0.32, 4000, "highpass", fx);
        break;
      case "break":
        this.hiss(t, 0.42, 0.75, 1600, "lowpass", fx);
        this.tone(t, 86, 0.32, 0.48, "sine", fx, 28);
        for (let i = 0; i < 4; i++) this.hiss(t + i * 0.055, 0.06, 0.2, 1800 + i * 500, "bandpass", fx);
        break;
      case "jump":
        this.hiss(t, 0.18, 0.22, 850, "bandpass", fx);
        this.tone(t, 55, 0.18, 0.2, "sawtooth", fx, 180);
        break;
      case "growl":
        this.tone(t, 62, 0.65, 0.23, "sawtooth", fx, 38);
        this.tone(t, 65, 0.67, 0.18, "sawtooth", fx, 37);
        this.hiss(t, 0.58, 0.25, 430, "bandpass", fx);
        break;
      case "hurt":
        this.hiss(t, 0.25, 0.53, 1100, "bandpass", fx);
        this.tone(t, 220, 0.32, 0.26, "sawtooth", fx, 45);
        break;
      case "land":
        this.hiss(t, 0.15, 0.3, 800, "lowpass", fx);
        this.tone(t, 120, 0.18, 0.3, "sine", fx, 35);
        break;
    }
  }

  dispose(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.paused = true;
    this.disposed = true;
    this.startRequest++;
    this.stopSources();
    this.master?.disconnect();
    if (this.ctx && this.ctx.state !== "closed") void this.ctx.close().catch(() => {});
    this.ctx = null;
  }
}
