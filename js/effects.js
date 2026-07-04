/**
 * effects.js — procedural visual effects.
 *
 * Static/noise, VHS-style glitches, screen shake, flashes, flicker and
 * vignette are all drawn here on the main canvas. The CSS layer on top
 * (styles.css) adds scanlines, an aperture-grille tint and CRT vignette,
 * so together the two form the full retro-monitor look.
 *
 * Performance notes:
 *  - Noise is pre-rendered once into a small pool of offscreen canvases
 *    and blitted scaled-up each frame; nothing is allocated per frame.
 *  - The vignette gradient is built once and reused.
 *  - Glitch slices copy the canvas onto itself (no intermediate buffers).
 */

import { rand, randInt, clamp } from './game.js';

const NOISE_FRAMES = 6;   // pool size; cycled to fake animated static
const NOISE_W = 320;      // low-res noise scaled up = chunky VHS grain
const NOISE_H = 180;

export class EffectsSystem {
  constructor(game) {
    this.game = game;

    // Pre-rendered noise pool.
    this.noiseFrames = [];
    this._buildNoise();
    this._noiseIndex = 0;
    this._noiseFlip = 0;

    // Cached vignette gradient (built lazily against the real context).
    this._vignette = null;

    // Transient effect state.
    this.shakeMag = 0;
    this.shakeTime = 0;
    this.shakeDur = 1;
    this.flashAlpha = 0;
    this.glitchTime = 0;
    this.flickerTime = 0;

    // Persistent per-frame jitter used by the tracking-line effect.
    this._trackingY = rand(0, game.H);
  }

  /** 0..1 multiplier from the player's "Visual FX Intensity" setting. */
  get intensity() {
    return clamp(this.game.save.data.settings.effects / 100, 0, 1);
  }

  reset() {
    this.shakeMag = 0;
    this.shakeTime = 0;
    this.flashAlpha = 0;
    this.glitchTime = 0;
    this.flickerTime = 0;
  }

  /* ------------------------------------------------------------------ */
  /* Triggers                                                            */
  /* ------------------------------------------------------------------ */

  /** Kick the screen. Respects the screen-shake accessibility setting. */
  shake(magnitude, duration) {
    if (!this.game.save.data.settings.screenShake) return;
    this.shakeMag = Math.max(this.shakeMag, magnitude);
    this.shakeTime = Math.max(this.shakeTime, duration);
    this.shakeDur = duration;
  }

  /** White flash that decays over a few frames. */
  flash(alpha) {
    this.flashAlpha = Math.max(this.flashAlpha, clamp(alpha, 0, 1));
  }

  /** VHS glitch burst (slice tearing + color bars) for `duration` sec. */
  glitch(duration) {
    this.glitchTime = Math.max(this.glitchTime, duration);
  }

  /** Brown-out flicker: the whole scene dims erratically. */
  flicker(duration) {
    this.flickerTime = Math.max(this.flickerTime, duration);
  }

  /* ------------------------------------------------------------------ */
  /* Frame hooks                                                         */
  /* ------------------------------------------------------------------ */

  update(dt) {
    if (this.shakeTime > 0) this.shakeTime -= dt;
    if (this.glitchTime > 0) this.glitchTime -= dt;
    if (this.flickerTime > 0) this.flickerTime -= dt;
    if (this.flashAlpha > 0) this.flashAlpha = Math.max(0, this.flashAlpha - dt * 2.2);

    // Cycle the noise pool at ~30 Hz so static shimmers without
    // regenerating pixels.
    this._noiseFlip += dt;
    if (this._noiseFlip > 1 / 30) {
      this._noiseFlip = 0;
      this._noiseIndex = (this._noiseIndex + 1) % NOISE_FRAMES;
    }

    // The tracking line slowly rolls up the screen, VHS-style.
    this._trackingY -= dt * 40;
    if (this._trackingY < -20) this._trackingY = this.game.H + rand(0, 200);
  }

  /** Apply screen-shake translation. Must be paired with endShake(). */
  beginShake(ctx) {
    ctx.save();
    if (this.shakeTime > 0 && this.shakeMag > 0) {
      const falloff = clamp(this.shakeTime / this.shakeDur, 0, 1);
      const m = this.shakeMag * falloff;
      ctx.translate(rand(-m, m), rand(-m, m));
    } else {
      this.shakeMag = 0;
    }
  }

  endShake(ctx) {
    ctx.restore();
  }

  /**
   * Post-scene overlays, in order: glitch tears, tracking line, film
   * grain, vignette, flicker darkening, flash. Called every frame from
   * Game.render after the scene is drawn.
   */
  renderOverlays(ctx) {
    const k = this.intensity;

    if (this.glitchTime > 0 && k > 0) this._drawGlitch(ctx);
    if (k > 0.15) this._drawTrackingLine(ctx, k);

    // Ever-present film grain — very faint over the office, and the
    // camera view layers extra static on top of this itself.
    this.drawStatic(ctx, 0.045 * k);
    this.drawVignette(ctx, 0.9);

    if (this.flickerTime > 0) {
      ctx.fillStyle = `rgba(0,0,0,${rand(0.05, 0.4)})`;
      ctx.fillRect(0, 0, this.game.W, this.game.H);
    }

    if (this.flashAlpha > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.flashAlpha})`;
      ctx.fillRect(0, 0, this.game.W, this.game.H);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Drawing primitives (also used by the camera system)                 */
  /* ------------------------------------------------------------------ */

  /** Blit one frame of pre-rendered noise across the screen. */
  drawStatic(ctx, alpha) {
    if (alpha <= 0.003) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.drawImage(this.noiseFrames[this._noiseIndex], 0, 0, this.game.W, this.game.H);
    ctx.restore();
  }

  /** Darkened corners pull the eye to the middle of the frame. */
  drawVignette(ctx, strength) {
    if (!this._vignette) {
      const g = ctx.createRadialGradient(
        this.game.W / 2, this.game.H / 2, this.game.H * 0.35,
        this.game.W / 2, this.game.H / 2, this.game.H * 0.85,
      );
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.55)');
      this._vignette = g;
    }
    ctx.save();
    ctx.globalAlpha = strength;
    ctx.fillStyle = this._vignette;
    ctx.fillRect(0, 0, this.game.W, this.game.H);
    ctx.restore();
  }

  /** Horizontal slice tearing plus a couple of hot color bars. */
  _drawGlitch(ctx) {
    const W = this.game.W;
    const H = this.game.H;
    const slices = randInt(2, 5);
    for (let i = 0; i < slices; i++) {
      const sy = randInt(0, H - 30);
      const sh = randInt(6, 26);
      const off = randInt(-38, 38);
      // Copy a band of the freshly drawn frame sideways onto itself.
      ctx.drawImage(ctx.canvas, 0, sy, W, sh, off, sy, W, sh);
    }
    // Occasional chroma bars.
    if (Math.random() < 0.5) {
      ctx.save();
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = Math.random() < 0.5 ? '#ff2a2a' : '#2ae0ff';
      ctx.fillRect(0, randInt(0, H - 4), W, randInt(2, 5));
      ctx.restore();
    }
  }

  /** The soft bright band of a VHS tracking error rolling upward. */
  _drawTrackingLine(ctx, k) {
    const y = this._trackingY;
    ctx.save();
    ctx.globalAlpha = 0.05 * k;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, y, this.game.W, 3);
    ctx.globalAlpha = 0.03 * k;
    ctx.fillRect(0, y - 6, this.game.W, 14);
    ctx.restore();
  }

  /* ------------------------------------------------------------------ */

  /** Pre-render the noise pool into offscreen canvases (done once). */
  _buildNoise() {
    for (let f = 0; f < NOISE_FRAMES; f++) {
      const c = document.createElement('canvas');
      c.width = NOISE_W;
      c.height = NOISE_H;
      const cctx = c.getContext('2d');
      const img = cctx.createImageData(NOISE_W, NOISE_H);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const v = (Math.random() * 255) | 0;
        d[i] = v;
        d[i + 1] = v;
        d[i + 2] = v;
        d[i + 3] = 255;
      }
      cctx.putImageData(img, 0, 0);
      this.noiseFrames.push(c);
    }
  }
}
