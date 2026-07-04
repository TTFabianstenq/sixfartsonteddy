/**
 * audio.js — fully procedural sound engine.
 *
 * Every sound in the game is synthesized at runtime with the Web Audio
 * API: oscillators, filtered noise buffers and gain envelopes. No audio
 * files are loaded, so the game works offline and ships zero media bytes.
 *
 * The AudioContext is created lazily on the first user gesture (browsers
 * block autoplay), and every public method is safe to call before that —
 * it simply does nothing until the context exists.
 */

import { rand, randInt, clamp } from './game.js';

export class AudioEngine {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.master = null;

    // Long-lived loop nodes, tracked so they can be stopped cleanly.
    this._ambience = null;   // { nodes: [...], gains: [...] }
    this._camStatic = null;
    this._lightHum = null;
    this._musicBox = null;   // interval id for the melody scheduler

    // Shared noise buffers (white + brown), built once per context.
    this._noiseWhite = null;
    this._noiseBrown = null;

    this._volume = 0.8;
  }

  /* ------------------------------------------------------------------ */
  /* Lifecycle                                                           */
  /* ------------------------------------------------------------------ */

  /** Create/resume the context. Safe to call on every user gesture. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this._volume;
      this.master.connect(this.ctx.destination);
      this._buildNoiseBuffers();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  /** Master volume, 0..1. Applied immediately if the context exists. */
  setVolume(v) {
    this._volume = clamp(v, 0, 1);
    if (this.master) {
      this.master.gain.setTargetAtTime(this._volume, this.ctx.currentTime, 0.05);
    }
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') {
      this.ctx.suspend().catch(() => {});
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  /** Stop every loop (ambience, static, hum, music box). */
  stopAll() {
    this._stopLoop('_ambience');
    this._stopLoop('_camStatic');
    this._stopLoop('_lightHum');
    this.musicBoxStop();
  }

  /* ------------------------------------------------------------------ */
  /* Internal helpers                                                    */
  /* ------------------------------------------------------------------ */

  _buildNoiseBuffers() {
    const len = this.ctx.sampleRate * 2; // two-second loops

    // White noise: flat random samples.
    this._noiseWhite = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const w = this._noiseWhite.getChannelData(0);
    for (let i = 0; i < len; i++) w[i] = Math.random() * 2 - 1;

    // Brown noise: integrated white noise, dark and rumbly — the sound
    // of an old building at night.
    this._noiseBrown = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const b = this._noiseBrown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      b[i] = last * 3.5;
    }
  }

  /** A gain node with an attack/decay envelope, connected to master. */
  _env(peak, attack, decay, when = 0) {
    const t = this.ctx.currentTime + when;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(this.master);
    return g;
  }

  /** Stereo panner (falls back to a plain gain on ancient browsers). */
  _pan(value) {
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = clamp(value, -1, 1);
      return p;
    }
    return this.ctx.createGain();
  }

  /** One-shot oscillator: type, freq (or [start,end] sweep), length. */
  _tone(type, freq, dur, peak, attack = 0.005, when = 0, dest = null) {
    const t = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    if (Array.isArray(freq)) {
      osc.frequency.setValueAtTime(freq[0], t);
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, freq[1]), t + dur);
    } else {
      osc.frequency.value = freq;
    }
    const g = this._env(peak, attack, dur, when);
    if (dest) { g.disconnect(); g.connect(dest); }
    osc.connect(g);
    osc.start(t);
    osc.stop(t + attack + dur + 0.05);
    return osc;
  }

  /** One-shot filtered noise burst. */
  _noiseBurst(buffer, dur, peak, filterType, filterFreq, attack = 0.004, when = 0, dest = null) {
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = filterFreq;
    const g = this._env(peak, attack, dur, when);
    if (dest) { g.disconnect(); g.connect(dest); }
    src.connect(f).connect(g);
    src.start(t, rand(0, 1.5));
    src.stop(t + attack + dur + 0.05);
  }

  _stopLoop(key) {
    const loop = this[key];
    if (!loop) return;
    const t = this.ctx ? this.ctx.currentTime : 0;
    for (const g of loop.gains) {
      g.gain.setTargetAtTime(0.0001, t, 0.15);
    }
    for (const n of loop.nodes) {
      try { n.stop(t + 0.8); } catch { /* already stopped */ }
    }
    this[key] = null;
  }

  /* ------------------------------------------------------------------ */
  /* Long-running beds                                                   */
  /* ------------------------------------------------------------------ */

  /**
   * Room tone for the whole night: dark brown-noise rumble, a faint
   * 50 Hz generator drone, and a slow amplitude wobble so the bed
   * breathes instead of sitting still. Later nights sit slightly louder.
   */
  startAmbience(night) {
    if (!this.ctx) return;
    this._stopLoop('_ambience');
    const t = this.ctx.currentTime;
    const level = 0.05 + Math.min(night, 7) * 0.004;

    // Rumble bed.
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBrown;
    src.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(level, t + 3);

    // Slow breathing LFO on the bed's gain.
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = level * 0.4;
    lfo.connect(lfoGain).connect(g.gain);

    // Generator drone.
    const drone = this.ctx.createOscillator();
    drone.type = 'sine';
    drone.frequency.value = 50;
    const dg = this.ctx.createGain();
    dg.gain.setValueAtTime(0.0001, t);
    dg.gain.linearRampToValueAtTime(0.02, t + 4);

    src.connect(lp).connect(g).connect(this.master);
    drone.connect(dg).connect(this.master);
    src.start(t);
    drone.start(t);
    lfo.start(t);

    this._ambience = { nodes: [src, drone, lfo], gains: [g, dg] };
  }

  /** Hiss bed while the camera monitor is raised. */
  setCameraStatic(on) {
    if (!this.ctx) return;
    if (on && !this._camStatic) {
      const t = this.ctx.currentTime;
      const src = this.ctx.createBufferSource();
      src.buffer = this._noiseWhite;
      src.loop = true;
      const hp = this.ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1200;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.035, t + 0.15);
      src.connect(hp).connect(g).connect(this.master);
      src.start(t, rand(0, 1.5));
      this._camStatic = { nodes: [src], gains: [g] };
    } else if (!on && this._camStatic) {
      this._stopLoop('_camStatic');
    }
  }

  /** Fluorescent buzz while either door light is on. */
  setLightHum(on) {
    if (!this.ctx) return;
    if (on && !this._lightHum) {
      const t = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 120;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 800;
      bp.Q.value = 2;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.018, t + 0.05);
      osc.connect(bp).connect(g).connect(this.master);
      osc.start(t);
      this._lightHum = { nodes: [osc], gains: [g] };
    } else if (!on && this._lightHum) {
      this._stopLoop('_lightHum');
    }
  }

  /* ------------------------------------------------------------------ */
  /* One-shot effects                                                    */
  /* ------------------------------------------------------------------ */

  /** Heavy pneumatic door: servo whir + steel slam. pan: -1 left, 1 right. */
  doorToggle(closed, pan = 0) {
    if (!this.ctx) return;
    const p = this._pan(pan);
    p.connect(this.master);
    // Servo whir sweeping down (close) or up (open).
    this._tone('sawtooth', closed ? [340, 130] : [130, 300], 0.16, 0.05, 0.01, 0, p);
    // Slam thud.
    this._tone('sine', [95, 38], 0.22, 0.32, 0.004, 0.1, p);
    this._noiseBurst(this._noiseWhite, 0.12, 0.16, 'lowpass', 500, 0.004, 0.1, p);
  }

  /** Two dry knocks — a machine testing a closed door. */
  doorKnock(pan = 0) {
    if (!this.ctx) return;
    const p = this._pan(pan);
    p.connect(this.master);
    for (let i = 0; i < 2; i++) {
      this._tone('sine', [130, 60], 0.1, 0.22, 0.003, i * 0.24, p);
      this._noiseBurst(this._noiseWhite, 0.05, 0.08, 'lowpass', 900, 0.003, i * 0.24, p);
    }
  }

  /** Sprocket slamming into a sealed door at full sprint. */
  doorBang(pan = 0) {
    if (!this.ctx) return;
    const p = this._pan(pan);
    p.connect(this.master);
    this._tone('sine', [110, 30], 0.4, 0.45, 0.003, 0, p);
    this._noiseBurst(this._noiseBrown, 0.35, 0.3, 'lowpass', 350, 0.003, 0, p);
    this._noiseBurst(this._noiseWhite, 0.1, 0.12, 'highpass', 2500, 0.002, 0, p);
  }

  /** Light switch click. */
  lightClick() {
    if (!this.ctx) return;
    this._noiseBurst(this._noiseWhite, 0.03, 0.12, 'highpass', 3000);
    this._tone('square', 1600, 0.02, 0.04);
  }

  /** Monitor raised: plastic clack + static bloom. */
  camUp() {
    if (!this.ctx) return;
    this._noiseBurst(this._noiseWhite, 0.18, 0.14, 'highpass', 900);
    this._tone('square', [220, 440], 0.08, 0.05);
    this.setCameraStatic(true);
  }

  /** Monitor dropped. */
  camDown() {
    if (!this.ctx) return;
    this.setCameraStatic(false);
    this._noiseBurst(this._noiseWhite, 0.1, 0.1, 'lowpass', 1200);
    this._tone('square', [440, 180], 0.07, 0.05);
  }

  /** Feed switch: short burst of harsher static and a blip. */
  camSwitch() {
    if (!this.ctx) return;
    this._noiseBurst(this._noiseWhite, 0.12, 0.16, 'bandpass', 2200);
    this._tone('square', randInt(700, 1000), 0.03, 0.03);
  }

  /** Faint interference blip when something moves off-screen. */
  moveBlip() {
    if (!this.ctx) return;
    this._noiseBurst(this._noiseWhite, 0.08, 0.05, 'bandpass', rand(1500, 3500));
  }

  /** Distant footsteps. hurried=true doubles the pace (Sprocket's sprint). */
  footsteps(pan = 0, hurried = false) {
    if (!this.ctx) return;
    const p = this._pan(pan);
    p.connect(this.master);
    const steps = hurried ? 6 : 3;
    const gap = hurried ? 0.16 : 0.38;
    for (let i = 0; i < steps; i++) {
      const jitter = rand(-0.02, 0.02);
      this._tone('sine', [rand(75, 95), 40], 0.09, hurried ? 0.16 : 0.09, 0.003, i * gap + jitter, p);
      this._noiseBurst(this._noiseBrown, 0.06, hurried ? 0.1 : 0.05, 'lowpass', 300, 0.003, i * gap + jitter, p);
    }
  }

  /** Hollow's two-note hoot, hollow and woody. */
  hoot(pan = 0) {
    if (!this.ctx) return;
    const p = this._pan(pan);
    p.connect(this.master);
    this._tone('sine', [390, 330], 0.28, 0.1, 0.03, 0, p);
    this._tone('sine', [340, 285], 0.42, 0.12, 0.03, 0.4, p);
  }

  /** Teddy's slow, wrong-sounding chuckle: three descending wooden notes. */
  chuckle() {
    if (!this.ctx) return;
    const notes = [180, 150, 122];
    notes.forEach((f, i) => {
      this._tone('triangle', [f, f * 0.8], 0.22, 0.09, 0.02, i * 0.28);
      this._noiseBurst(this._noiseBrown, 0.12, 0.03, 'lowpass', 400, 0.02, i * 0.28);
    });
  }

  /** Sprocket's clockwork ratchet winding tighter. */
  windup() {
    if (!this.ctx) return;
    for (let i = 0; i < 7; i++) {
      this._noiseBurst(this._noiseWhite, 0.02, 0.06, 'bandpass', 3200, 0.002, i * 0.07);
      this._tone('square', 900 + i * 90, 0.015, 0.02, 0.002, i * 0.07);
    }
  }

  /** Generator failure: pitch spirals down, then a distant breaker thud. */
  powerDown() {
    if (!this.ctx) return;
    this._tone('sawtooth', [180, 25], 1.4, 0.16, 0.02);
    this._tone('sine', [90, 20], 1.6, 0.14, 0.02);
    this._noiseBurst(this._noiseBrown, 0.5, 0.2, 'lowpass', 200, 0.02, 1.2);
  }

  /** Soft far-off bell marking the passing hour. */
  hourTick() {
    if (!this.ctx) return;
    this._bell(660, 0.9, 0.035);
  }

  /** Random distant building noises — clangs, groans, skitters. */
  ambientEvent() {
    if (!this.ctx) return;
    const kind = randInt(0, 2);
    const pan = rand(-0.8, 0.8);
    const p = this._pan(pan);
    p.connect(this.master);
    if (kind === 0) {
      // Metal clang far away.
      this._tone('triangle', [rand(500, 900), 90], 0.7, 0.05, 0.004, 0, p);
    } else if (kind === 1) {
      // Structural groan.
      this._tone('sawtooth', [rand(60, 90), rand(40, 55)], 1.1, 0.045, 0.3, 0, p);
    } else {
      // Quick skittering.
      for (let i = 0; i < 5; i++) {
        this._noiseBurst(this._noiseWhite, 0.03, 0.03, 'bandpass', rand(2000, 5000), 0.002, i * 0.09, p);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Music box (power-out lullaby)                                       */
  /* ------------------------------------------------------------------ */

  /**
   * An original eight-bar lullaby in A minor, voiced like a music box
   * (pure tone + quiet third harmonic, fast decay). Loops until stopped.
   */
  musicBoxStart() {
    if (!this.ctx || this._musicBox) return;
    // Note frequencies (Hz). 0 = rest.
    const A4 = 440.0, C5 = 523.25, D5 = 587.33, E5 = 659.25,
      G5 = 783.99, A5 = 880.0, B4 = 493.88;
    const melody = [A4, C5, E5, A5, G5, E5, C5, D5, E5, C5, B4, A4, 0, E5, D5, C5];
    const step = 0.42;
    let index = 0;

    const playNote = () => {
      const f = melody[index % melody.length];
      index++;
      if (f > 0) {
        this._tone('sine', f, 0.9, 0.09, 0.005);
        this._tone('sine', f * 3, 0.35, 0.02, 0.005);
      }
    };
    playNote();
    this._musicBox = setInterval(playNote, step * 1000);
  }

  musicBoxStop() {
    if (this._musicBox) {
      clearInterval(this._musicBox);
      this._musicBox = null;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Stings                                                              */
  /* ------------------------------------------------------------------ */

  /**
   * The jumpscare stinger: a wall of screeching noise, a detuned saw
   * cluster and a shrieking downward sweep. Loud by design, but capped
   * well below clipping and still subject to the master volume.
   */
  jumpscare() {
    if (!this.ctx) return;
    this._noiseBurst(this._noiseWhite, 0.9, 0.4, 'highpass', 700, 0.005);
    this._noiseBurst(this._noiseBrown, 0.9, 0.35, 'lowpass', 300, 0.005);
    for (const f of [110, 117, 124]) {
      this._tone('sawtooth', f, 1.0, 0.12, 0.005);
    }
    this._tone('sawtooth', [1500, 320], 0.85, 0.2, 0.005);
    this._tone('square', [2200, 600], 0.5, 0.1, 0.005);
    this._tone('sine', [60, 28], 1.1, 0.35, 0.005);
  }

  /** 6 AM: four rising bell notes over birdsong-adjacent chirps. */
  victoryChime() {
    if (!this.ctx) return;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    notes.forEach((f, i) => this._bell(f, 1.4, 0.12, i * 0.45));
    // Two faint dawn chirps.
    this._tone('sine', [2600, 3100], 0.09, 0.02, 0.02, 2.2);
    this._tone('sine', [2900, 2500], 0.12, 0.02, 0.02, 2.6);
  }

  /** UI confirmation click. */
  uiClick() {
    if (!this.ctx) return;
    this._tone('square', 880, 0.04, 0.05);
    this._noiseBurst(this._noiseWhite, 0.02, 0.04, 'highpass', 4000);
  }

  /** Featherweight tick when the pointer crosses a menu button. */
  uiHover() {
    if (!this.ctx) return;
    this._tone('square', 1320, 0.018, 0.018);
  }

  /**
   * Discovery sting: the door light snaps on and something is standing
   * there. A short detuned shriek over a low body thump — startling,
   * but far below jumpscare level.
   */
  revealSting(pan = 0) {
    if (!this.ctx) return;
    const p = this._pan(pan);
    p.connect(this.master);
    this._tone('sawtooth', [1180, 860], 0.38, 0.055, 0.004, 0, p);
    this._tone('sawtooth', [1250, 915], 0.38, 0.045, 0.004, 0, p);
    this._noiseBurst(this._noiseWhite, 0.14, 0.05, 'highpass', 2600, 0.004, 0, p);
    this._tone('sine', [72, 44], 0.3, 0.15, 0.004, 0, p);
  }

  /** Bell voice used by the hour tick and the victory chime. */
  _bell(freq, dur, peak, when = 0) {
    this._tone('sine', freq, dur, peak, 0.005, when);
    this._tone('sine', freq * 2.76, dur * 0.6, peak * 0.3, 0.005, when);
    this._tone('sine', freq * 5.4, dur * 0.3, peak * 0.12, 0.005, when);
  }
}
