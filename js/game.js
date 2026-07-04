/**
 * game.js — core game orchestration.
 *
 * Owns the fixed-timestep-free render loop, the top-level state machine
 * (menu → night intro → playing → power-out / jumpscare → results),
 * night/hour timing, input routing, the save system and difficulty
 * scaling. All subsystems receive a reference to this Game instance
 * and communicate through it; no subsystem imports another subsystem.
 */

import { AudioEngine } from './audio.js';
import { EffectsSystem } from './effects.js';
import { Office } from './office.js';
import { CameraSystem } from './camera.js';
import { PowerSystem } from './power.js';
import { UIManager } from './ui.js';
import { createAnimatronics } from './animatronic.js';

/* --------------------------------------------------------------------------
 * Small shared utilities. Exported from here so every module pulls them
 * from a single place (function declarations are hoisted, so the circular
 * import back into game.js is safe in native ES modules).
 * ------------------------------------------------------------------------ */

/** Clamp v into [min, max]. */
export function clamp(v, min, max) {
  return v < min ? min : (v > max ? max : v);
}

/** Random float in [min, max). */
export function rand(min, max) {
  return min + Math.random() * (max - min);
}

/** Random integer in [min, max] inclusive. */
export function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}

/** True with probability p (0..1). */
export function chance(p) {
  return Math.random() < p;
}

/** Linear interpolation. */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Smooth ease for door/monitor animations. */
export function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/* --------------------------------------------------------------------------
 * Tuning constants for the night cycle.
 * ------------------------------------------------------------------------ */

export const CONFIG = {
  WIDTH: 1280,
  HEIGHT: 720,
  HOUR_SECONDS: 72,        // one in-game hour of real time (night = 7.2 min)
  HOURS_PER_NIGHT: 6,      // 12 AM → 6 AM
  FINAL_NIGHT: 6,          // beating this night rolls the credits message
  JUMPSCARE_SECONDS: 1.35, // length of the lunge animation
  INTRO_SECONDS: 3.0,      // "Night N / 12:00 AM" card
};

/** Top-level game states. */
export const STATE = {
  MENU: 'menu',
  NIGHT_INTRO: 'nightIntro',
  PLAYING: 'playing',
  PAUSED: 'paused',
  POWEROUT: 'powerout',
  JUMPSCARE: 'jumpscare',
  GAMEOVER: 'gameover',
  VICTORY: 'victory',
};

/* --------------------------------------------------------------------------
 * SaveSystem — localStorage persistence for progress, settings and stats.
 * ------------------------------------------------------------------------ */

const SAVE_KEY = 'toyworks-save-v1';

export class SaveSystem {
  constructor() {
    this.data = SaveSystem.defaults();
    this.load();
  }

  static defaults() {
    return {
      currentNight: 1,
      bestNight: 0,
      settings: {
        volume: 80,       // 0..100 master volume
        effects: 70,      // 0..100 visual noise/glitch intensity
        screenShake: true,
        showFps: false,
      },
      stats: {
        gamesPlayed: 0,
        nightsSurvived: 0,
        deaths: 0,
        hoursSurvived: 0,
        caughtBy: {},     // animatronic id → times caught
      },
    };
  }

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      // Merge shallowly per section so new fields keep their defaults.
      const d = SaveSystem.defaults();
      this.data = {
        currentNight: Number(parsed.currentNight) || d.currentNight,
        bestNight: Number(parsed.bestNight) || d.bestNight,
        settings: { ...d.settings, ...(parsed.settings || {}) },
        stats: { ...d.stats, ...(parsed.stats || {}) },
      };
    } catch {
      // Corrupt or inaccessible storage: fall back to a fresh profile.
      this.data = SaveSystem.defaults();
    }
  }

  save() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.data));
    } catch {
      // Storage may be unavailable (private mode / quota); play on without it.
    }
  }

  erase() {
    this.data = SaveSystem.defaults();
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      // Ignore: nothing to remove or storage unavailable.
    }
  }
}

/* --------------------------------------------------------------------------
 * Game
 * ------------------------------------------------------------------------ */

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.W = CONFIG.WIDTH;
    this.H = CONFIG.HEIGHT;

    this.state = STATE.MENU;
    this.night = 1;
    this.hour = 0;          // 0 = 12 AM ... 5 = 5 AM; reaching 6 wins
    this.nightTimer = 0;    // seconds elapsed this night
    this.stateTimer = 0;    // seconds in the current state

    // Subsystems. Order matters only for construction (they all take `this`).
    this.save = new SaveSystem();
    this.audio = new AudioEngine(this);
    this.effects = new EffectsSystem(this);
    this.power = new PowerSystem(this);
    this.office = new Office(this);
    this.cameras = new CameraSystem(this);
    this.animatronics = createAnimatronics(this);
    this.ui = new UIManager(this);

    // Power-out scripted sequence bookkeeping.
    this.powerOut = { phase: 0, timer: 0, musicLen: 0 };

    // The animatronic responsible for the current jumpscare / loss.
    this.attacker = null;

    // Ambient one-shot scare scheduling (distant clangs, whispers...).
    this.ambientTimer = rand(18, 40);

    // Pointer position in canvas space, for hover feedback on the
    // office panels, camera map and monitor strip.
    this.pointer = { x: -1, y: -1 };

    // Transient "2 AM" toast shown when the hour rolls over.
    this.hourToast = null;

    // Rare glowing-eye glint on the menu backdrop.
    this._menuGlint = null;

    // Frame timing.
    this._last = performance.now();
    this._fps = 60;
    this._fpsAccum = 0;
    this._running = false;
  }

  /** Called once from script.js. Wires input and starts the loop. */
  boot() {
    this.ui.bind();
    this.ui.applySettings();
    this.ui.refreshMenu();
    this._bindInput();
    this._running = true;
    requestAnimationFrame((t) => this._frame(t));
  }

  /* ------------------------------------------------------------------ */
  /* Night lifecycle                                                     */
  /* ------------------------------------------------------------------ */

  /** Begin a night (from menu, retry, or next-night). */
  startNight(night) {
    this.night = night;
    this.hour = 0;
    this.nightTimer = 0;
    this.attacker = null;
    this.powerOut = { phase: 0, timer: 0, musicLen: 0 };
    this.ambientTimer = rand(18, 40);

    this.power.reset(night);
    this.office.reset();
    this.cameras.reset();
    this.effects.reset();
    for (const a of this.animatronics) a.reset(night);

    this.save.data.stats.gamesPlayed += 1;
    this.save.save();

    this.audio.stopAll();
    this._setState(STATE.NIGHT_INTRO);
    this.ui.showNightIntro(night);
  }

  /** Survived until 6 AM. */
  win() {
    const s = this.save.data;
    s.stats.nightsSurvived += 1;
    s.stats.hoursSurvived += CONFIG.HOURS_PER_NIGHT;
    s.bestNight = Math.max(s.bestNight, this.night);
    s.currentNight = this.night + 1;
    this.save.save();

    this.audio.stopAll();
    this.audio.victoryChime();
    this.effects.flash(0.65);
    this._setState(STATE.VICTORY);
    this.ui.showVictory(this.night);
  }

  /** An animatronic reached the player. */
  triggerJumpscare(animatronic) {
    if (this.state === STATE.JUMPSCARE || this.state === STATE.GAMEOVER) return;
    this.attacker = animatronic;
    this.audio.stopAll();
    this.audio.jumpscare();
    this.effects.shake(26, CONFIG.JUMPSCARE_SECONDS);
    this.effects.flash(0.4);
    this._setState(STATE.JUMPSCARE);
  }

  /** Jumpscare finished — record the death and show the results screen. */
  gameOver() {
    const s = this.save.data;
    s.stats.deaths += 1;
    s.stats.hoursSurvived += this.hour;
    if (this.attacker) {
      const id = this.attacker.id;
      s.stats.caughtBy[id] = (s.stats.caughtBy[id] || 0) + 1;
    }
    this.save.save();
    this._setState(STATE.GAMEOVER);
    this.ui.showGameOver(this.attacker, this.hour);
  }

  /** The generator hit 0% — begin the blackout sequence. */
  onPowerDepleted() {
    if (this.state !== STATE.PLAYING) return;
    this.office.forceOpenAll();
    this.cameras.forceDown();
    this.audio.powerDown();
    this.audio.setCameraStatic(false);
    this.audio.setLightHum(false);
    this.powerOut = { phase: 0, timer: rand(3.5, 7), musicLen: 0 };
    this._setState(STATE.POWEROUT);
  }

  /* ------------------------------------------------------------------ */
  /* Pause                                                               */
  /* ------------------------------------------------------------------ */

  pause() {
    if (this.state !== STATE.PLAYING && this.state !== STATE.POWEROUT) return;
    this._resumeState = this.state;
    this._setState(STATE.PAUSED);
    this.audio.suspend();
    this.ui.showScreen('pause');
  }

  resume() {
    if (this.state !== STATE.PAUSED) return;
    this._setState(this._resumeState || STATE.PLAYING);
    this.audio.resume();
    this.ui.hideScreens();
  }

  quitToMenu() {
    this.audio.stopAll();
    this.audio.resume();
    this._setState(STATE.MENU);
    this.ui.refreshMenu();
    this.ui.showScreen('menu');
  }

  /* ------------------------------------------------------------------ */
  /* Queries used by subsystems                                          */
  /* ------------------------------------------------------------------ */

  /** Human-readable in-game clock, e.g. "2 AM". */
  clockLabel() {
    return this.hour === 0 ? '12 AM' : `${this.hour} AM`;
  }

  /** Is the player currently looking at the camera feed showing `node`? */
  isCameraViewing(node) {
    return this.cameras.isUp && !this.cameras.transitioning &&
      this.cameras.activeNode() === node;
  }

  /** First animatronic occupying a map node, or null. */
  animatronicAt(node) {
    for (const a of this.animatronics) {
      if (a.node === node) return a;
    }
    return null;
  }

  /** All animatronics occupying a map node. */
  animatronicsAt(node) {
    return this.animatronics.filter((a) => a.node === node);
  }

  /**
   * Late-night aggression creep: everyone gets a small AI bump as the
   * hours pass, so a night that starts quiet never stays that way.
   */
  hourAggressionBonus() {
    if (this.hour >= 4) return 3;
    if (this.hour >= 3) return 2;
    if (this.hour >= 2) return 1;
    return 0;
  }

  /** Notification hub: an animatronic changed rooms. */
  onAnimatronicMoved(anim, fromNode, toNode) {
    this.cameras.motionPing(fromNode);
    this.cameras.motionPing(toNode);
    // Movement corrupts whatever feed you are on for a beat — a classic tell.
    if (this.cameras.isUp) this.effects.glitch(rand(0.15, 0.4));
    if (chance(0.6)) this.audio.moveBlip();
  }

  /* ------------------------------------------------------------------ */
  /* Main loop                                                           */
  /* ------------------------------------------------------------------ */

  _frame(now) {
    if (!this._running) return;
    // Clamp dt so tab-switch pauses cannot teleport the simulation.
    const dt = Math.min(0.05, (now - this._last) / 1000);
    this._last = now;

    // Exponential moving average keeps the FPS readout steady.
    if (dt > 0) this._fps = lerp(this._fps, 1 / dt, 0.08);
    this._fpsAccum += dt;
    if (this._fpsAccum >= 0.25) {
      this._fpsAccum = 0;
      this.ui.updateFps(Math.round(this._fps));
    }

    this.update(dt);
    this.render();
    requestAnimationFrame((t) => this._frame(t));
  }

  update(dt) {
    this.stateTimer += dt;
    this.effects.update(dt);

    if (this.hourToast) {
      this.hourToast.t -= dt;
      if (this.hourToast.t <= 0) this.hourToast = null;
    }

    switch (this.state) {
      case STATE.NIGHT_INTRO:
        if (this.stateTimer >= CONFIG.INTRO_SECONDS) {
          this.ui.hideScreens();
          this._setState(STATE.PLAYING);
          this.audio.startAmbience(this.night);
        }
        break;

      case STATE.PLAYING:
        this._advanceClock(dt);
        this.power.update(dt);
        this.office.update(dt);
        this.cameras.update(dt);
        for (const a of this.animatronics) a.update(dt);
        this._updateAmbientScares(dt);
        break;

      case STATE.POWEROUT:
        this._advanceClock(dt);
        this.office.update(dt);
        this._updatePowerOut(dt);
        break;

      case STATE.JUMPSCARE:
        if (this.stateTimer >= CONFIG.JUMPSCARE_SECONDS) this.gameOver();
        break;

      default:
        break; // MENU / PAUSED / GAMEOVER / VICTORY are static.
    }
  }

  _advanceClock(dt) {
    this.nightTimer += dt;
    const newHour = Math.floor(this.nightTimer / CONFIG.HOUR_SECONDS);
    if (newHour !== this.hour) {
      this.hour = newHour;
      if (this.hour >= CONFIG.HOURS_PER_NIGHT) {
        this.win();
        return;
      }
      // A soft distant bell marks each passing hour.
      this.audio.hourTick();
      this.hourToast = { label: this.clockLabel(), t: 2.6 };
    }
  }

  /**
   * The blackout is a scripted countdown: darkness → Teddy's glowing eyes
   * and a music-box lullaby → silence → the end. Reaching 6 AM at any
   * point during the sequence still counts as survival.
   */
  _updatePowerOut(dt) {
    const po = this.powerOut;
    po.timer -= dt;
    if (po.timer > 0) return;

    switch (po.phase) {
      case 0: // Eyes appear, lullaby begins.
        po.phase = 1;
        po.musicLen = rand(9, 17);
        po.timer = po.musicLen;
        this.audio.musicBoxStart();
        break;
      case 1: // Music stops; total darkness.
        po.phase = 2;
        po.timer = rand(2, 8);
        this.audio.musicBoxStop();
        break;
      case 2: { // Lights out for good.
        po.phase = 3;
        const teddy = this.animatronics.find((a) => a.id === 'teddy');
        this.triggerJumpscare(teddy || this.animatronics[0]);
        break;
      }
      default:
        break;
    }
  }

  /** Occasional distant noises keep the office from ever feeling safe. */
  _updateAmbientScares(dt) {
    this.ambientTimer -= dt;
    if (this.ambientTimer <= 0) {
      this.ambientTimer = rand(16, 45);
      this.audio.ambientEvent();
      if (chance(0.35)) this.effects.flicker(rand(0.3, 0.8));
    }
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */

  render() {
    const ctx = this.ctx;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.W, this.H);

    this.effects.beginShake(ctx);

    switch (this.state) {
      case STATE.MENU:
      case STATE.GAMEOVER:
      case STATE.VICTORY:
        this._renderBackdrop(ctx);
        break;

      case STATE.NIGHT_INTRO:
        break; // Black behind the DOM intro card.

      case STATE.PLAYING:
      case STATE.PAUSED: {
        if (this.cameras.isUp) {
          // The monitor slides up from the bottom edge as it is raised.
          const lift = easeInOut(this.cameras.raise);
          ctx.save();
          ctx.translate(0, (1 - lift) * this.H);
          this.cameras.render(ctx);
          ctx.restore();
        } else {
          this.office.render(ctx);
        }
        this.ui.renderHUD(ctx);
        break;
      }

      case STATE.POWEROUT:
        this.office.renderPowerOut(ctx, this.powerOut);
        this.ui.renderHUD(ctx);
        break;

      case STATE.JUMPSCARE: {
        const t = clamp(this.stateTimer / CONFIG.JUMPSCARE_SECONDS, 0, 1);
        if (this.attacker) this.attacker.drawJumpscare(ctx, this.W, this.H, t);
        break;
      }

      default:
        break;
    }

    this.effects.renderOverlays(ctx);
    this.effects.endShake(ctx);
  }

  /** Dim, noisy office glimpse behind menu and result screens. */
  _renderBackdrop(ctx) {
    ctx.save();
    ctx.globalAlpha = 0.35;
    this.office.render(ctx);
    ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, this.W, this.H);

    // Once in a while, a pair of eyes catches the light in a doorway.
    if (!this._menuGlint && chance(0.0015)) {
      this._menuGlint = { t: 1.6, dur: 1.6, side: chance(0.5) ? 'left' : 'right' };
    }
    if (this._menuGlint) {
      const g = this._menuGlint;
      g.t -= 1 / 60; // menu backdrop always runs at frame cadence
      const a = Math.sin(Math.PI * clamp(g.t / g.dur, 0, 1)) * 0.45;
      const cx = g.side === 'left' ? 142 : 1138;
      ctx.save();
      ctx.shadowColor = `rgba(255,196,90,${a})`;
      ctx.shadowBlur = 14;
      ctx.fillStyle = `rgba(255,196,90,${a})`;
      ctx.beginPath();
      ctx.arc(cx - 13, 292, 4, 0, Math.PI * 2);
      ctx.arc(cx + 13, 292, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (g.t <= 0) this._menuGlint = null;
    }

    this.effects.drawStatic(ctx, 0.1);
  }

  /* ------------------------------------------------------------------ */
  /* Input                                                               */
  /* ------------------------------------------------------------------ */

  _bindInput() {
    this.canvas.addEventListener('mousedown', (e) => {
      const { x, y } = this._canvasPoint(e);
      this._handlePointer(x, y);
    });

    this.canvas.addEventListener('mousemove', (e) => {
      const { x, y } = this._canvasPoint(e);
      this.pointer.x = x;
      this.pointer.y = y;
      this._updateCursor();
    });

    // Touch support: treat a tap like a click at the same canvas point.
    this.canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 0) return;
      e.preventDefault();
      const { x, y } = this._canvasPoint(e.touches[0]);
      this._handlePointer(x, y);
    }, { passive: false });

    window.addEventListener('keydown', (e) => this._handleKey(e));

    // Auto-pause when the tab is hidden so nothing sneaks up unseen.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === STATE.PLAYING) this.pause();
    });
  }

  /** Convert a client-space event position into canvas coordinates. */
  _canvasPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (this.W / rect.width),
      y: (e.clientY - rect.top) * (this.H / rect.height),
    };
  }

  /** Show a pointer cursor over anything clickable, crosshair elsewhere. */
  _updateCursor() {
    let clickable = false;
    if (this.state === STATE.PLAYING) {
      const { x, y } = this.pointer;
      if (this.ui.hitCameraStrip(x, y)) {
        clickable = true;
      } else if (this.cameras.isUp) {
        clickable = this.cameras.hitTest(x, y);
      } else {
        clickable = this.office.hitTest(x, y);
      }
    }
    this.canvas.style.cursor = clickable ? 'pointer' : 'crosshair';
  }

  _handlePointer(x, y) {
    this.audio.unlock();
    if (this.state !== STATE.PLAYING) return;

    // The camera pull-up strip is shared by both views.
    if (this.ui.hitCameraStrip(x, y)) {
      this.cameras.toggle();
      return;
    }
    if (this.cameras.isUp) {
      this.cameras.handleClick(x, y);
    } else {
      this.office.handleClick(x, y);
    }
  }

  _handleKey(e) {
    // Ignore keystrokes aimed at menu widgets (sliders, checkboxes).
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'BUTTON') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }

    this.audio.unlock();

    if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
      if (this.state === STATE.PLAYING || this.state === STATE.POWEROUT) {
        this.pause();
      } else if (this.state === STATE.PAUSED) {
        this.resume();
      }
      return;
    }

    if (this.state !== STATE.PLAYING) return;

    switch (e.key) {
      case ' ':
      case 's':
      case 'S':
        e.preventDefault();
        this.cameras.toggle();
        break;
      case 'q': case 'Q': this.office.toggleDoor('left'); break;
      case 'e': case 'E': this.office.toggleDoor('right'); break;
      case 'a': case 'A': this.office.toggleLight('left'); break;
      case 'd': case 'D': this.office.toggleLight('right'); break;
      case '1': case '2': case '3': case '4': case '5': case '6':
        if (this.cameras.isUp) this.cameras.select(Number(e.key) - 1);
        break;
      default:
        break;
    }
  }

  /* ------------------------------------------------------------------ */

  _setState(next) {
    this.state = next;
    this.stateTimer = 0;
  }
}
