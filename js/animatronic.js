/**
 * animatronic.js — the four machines and their minds.
 *
 * Every enemy is an original character with its own state machine,
 * preferred route, quirk and counter-play:
 *
 *  - TEDDY RAGBEAR  (east) — only stalks while your monitor is raised.
 *  - MOPPET         (west) — camera-shy sprinter; watching her buys time.
 *  - SPROCKET       (west) — wind-up rabbit; neglect lets him charge and
 *                            sprint the hall. Watching CAM 5 unwinds him.
 *  - HOLLOW         (both) — teleporting owl; hoots, then haunts a random
 *                            doorway until you shut it or he gets in.
 *
 * AI levels follow the classic d20 model: every few seconds a character
 * rolls 1–20 against its level (per-night base + late-hour bonus) and
 * moves on success. All decisions are randomized within tuned ranges so
 * no two nights play identically.
 *
 * All sprites are procedural Canvas drawings — original designs, no
 * image assets. Each class draws its room pose, its door silhouette and
 * its jumpscare face.
 */

import { rand, randInt, chance, clamp, lerp } from './game.js';

/** Sound panning for each side of the building. */
const PAN = { west: -0.7, east: 0.7 };

/* ========================================================================== */
/* Base class                                                                 */
/* ========================================================================== */

class Animatronic {
  /**
   * @param {object} game  back-reference to the Game orchestrator
   * @param {object} opts  { id, name, home, aiTable, moveInterval }
   */
  constructor(game, opts) {
    this.game = game;
    this.id = opts.id;
    this.name = opts.name;
    this.home = opts.home;          // starting map node
    this.aiTable = opts.aiTable;    // per-night base AI level (index night-1)
    this.moveInterval = opts.moveInterval;

    this.node = opts.home;
    this.level = 0;
    this.moveTimer = 0;
    this.cooldown = 0;
    this.state = 'roam';            // roam | door | office (+ subclass states)
    this.officeTimer = 0;           // grace period once inside the office
  }

  reset(night) {
    this.node = this.home;
    this.level = this.baseLevel(night);
    this.moveTimer = rand(0.4, 1.2) * this.moveInterval;
    this.cooldown = rand(2, 6);
    this.state = 'roam';
    this.officeTimer = 0;
  }

  /** Base AI for the night; past night 7 it keeps climbing toward 20. */
  baseLevel(night) {
    if (night <= this.aiTable.length) return this.aiTable[night - 1];
    return Math.min(20, this.aiTable[this.aiTable.length - 1] + (night - this.aiTable.length) * 2);
  }

  /** Current effective aggression: night base + creeping hour bonus. */
  effectiveLevel() {
    return clamp(this.level + this.game.hourAggressionBonus(), 0, 20);
  }

  /** The d20 movement check. */
  rollMove() {
    return randInt(1, 20) <= this.effectiveLevel();
  }

  /** Relocate and notify the world (map ping, feed glitch, sound). */
  moveTo(node) {
    const from = this.node;
    this.node = node;
    this.game.onAnimatronicMoved(this, from, node);
  }

  /** Shown on the active camera feed? Doors and the office are off-feed. */
  visibleOnCamera() {
    return this.node !== 'office' && this.node !== 'gone' &&
      this.node !== 'leftDoor' && this.node !== 'rightDoor';
  }

  /** Slip inside: the attack lands when the monitor next drops. */
  enterOffice() {
    this.state = 'office';
    this.node = 'office';
    this.officeTimer = rand(3.5, 7);
  }

  /** Back off to a node and sulk for a while. */
  retreat(node, cooldownSeconds) {
    this.state = 'roam';
    this.moveTo(node);
    this.cooldown = cooldownSeconds;
    this.moveTimer = this.moveInterval * rand(0.8, 1.3);
  }

  /** Called by the camera system the instant the monitor drops. */
  onMonitorLowered() {
    if (this.state === 'office') {
      this.game.triggerJumpscare(this);
    }
  }

  /** Shared per-frame work; subclasses call super.update(dt) first. */
  update(dt) {
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.state === 'office') {
      this.officeTimer -= dt;
      // Hiding in the dark of your own office — the grace period ends
      // whether or not you ever look up from the monitor.
      if (this.officeTimer <= 0) this.game.triggerJumpscare(this);
    }
  }

  /* ---------------- rendering hooks (implemented by subclasses) -------- */

  /** Standing pose on a camera feed. (x, y) is the feet center. */
  drawInRoom(ctx, x, y, scale) {
    this.drawBody(ctx, x, y, 260 * scale, false);
  }

  /** Backlit shape in a lit doorway. */
  drawDoorSilhouette(ctx, cx, floorY, height, flick) {
    ctx.save();
    ctx.globalAlpha = clamp(flick, 0.25, 1);
    this.drawBody(ctx, cx, floorY, height, true);
    ctx.restore();
  }

  /**
   * The lunge. Shared motion: the face surges up from the bottom of the
   * frame with jitter; subclasses supply drawJumpscareFace.
   */
  drawJumpscare(ctx, W, H, t) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const surge = 1 - Math.pow(1 - Math.min(1, t * 1.6), 3);
    const r = lerp(H * 0.16, H * 0.62, surge);
    const cx = W / 2 + rand(-16, 16) * surge;
    const cy = lerp(H * 1.05, H * 0.52, surge) + rand(-12, 12) * surge;
    this.drawJumpscareFace(ctx, cx, cy, r);
    // The signal ruptures for the first instant of the attack.
    if (t < 0.12) {
      this.game.effects.drawStatic(ctx, 0.9 - t * 6);
    }
    // Hard cut to black at the very end.
    if (t > 0.88) {
      ctx.fillStyle = `rgba(0,0,0,${(t - 0.88) / 0.12})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  /** Glowing-eye helper with a cheap bloom. */
  _glowEye(ctx, x, y, radius, color) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = radius * 3;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/* ========================================================================== */
/* Teddy Ragbear — the patchwork mascot                                       */
/* ========================================================================== */

class Teddy extends Animatronic {
  constructor(game) {
    super(game, {
      id: 'teddy',
      name: 'Teddy Ragbear',
      home: 'workshop',
      aiTable: [0, 2, 4, 7, 10, 13, 16],
      moveInterval: 5.0,
    });
    this.path = ['workshop', 'playroom', 'eastHall', 'rightDoor'];
  }

  update(dt) {
    super.update(dt);
    if (this.state === 'office' || this.cooldown > 0 || this.level === 0) return;

    // Teddy's quirk: he only advances while you are buried in the
    // cameras. Time at the desk with the monitor down is safe from him.
    if (!this.game.cameras.isUp) return;

    this.moveTimer -= dt;
    if (this.moveTimer > 0) return;
    this.moveTimer = this.moveInterval * rand(0.85, 1.25);
    if (!this.rollMove()) return;

    if (this.node === 'rightDoor') {
      if (this.game.office.isDoorClosed('right')) {
        // Sealed out: knock twice and fall back to prowl again.
        this.game.audio.doorKnock(PAN.east);
        this.retreat('playroom', rand(7, 12));
      } else {
        this.game.audio.chuckle();
        this.enterOffice();
      }
      return;
    }

    // Advance one step along the east route.
    const next = this.path[this.path.indexOf(this.node) + 1];
    this.moveTo(next);
    if (chance(0.5)) this.game.audio.footsteps(PAN.east);
    if (next === 'rightDoor' && chance(0.6)) this.game.audio.chuckle();
  }

  /* ---------------- rendering ---------------- */

  drawBody(ctx, x, y, h, sil) {
    const u = h / 260;
    const c = (col) => (sil ? '#0b0b10' : col);

    // Stubby legs.
    ctx.fillStyle = c('#3e2d1f');
    ctx.fillRect(x - 34 * u, y - 52 * u, 26 * u, 52 * u);
    ctx.fillRect(x + 8 * u, y - 52 * u, 26 * u, 52 * u);

    // Round belly.
    ctx.fillStyle = c('#4a3626');
    ctx.beginPath();
    ctx.ellipse(x, y - 118 * u, 58 * u, 78 * u, 0, 0, Math.PI * 2);
    ctx.fill();

    // Patchwork: a lighter square patch with stitch dashes.
    if (!sil) {
      ctx.fillStyle = '#6b5137';
      ctx.fillRect(x - 8 * u, y - 140 * u, 34 * u, 30 * u);
      ctx.strokeStyle = '#2c2015';
      ctx.lineWidth = 2 * u;
      ctx.setLineDash([4 * u, 4 * u]);
      ctx.strokeRect(x - 8 * u, y - 140 * u, 34 * u, 30 * u);
      ctx.setLineDash([]);
      // Belly seam.
      ctx.beginPath();
      ctx.moveTo(x, y - 188 * u);
      ctx.lineTo(x, y - 60 * u);
      ctx.stroke();
    }

    // Hanging arms.
    ctx.fillStyle = c('#3e2d1f');
    ctx.beginPath();
    ctx.ellipse(x - 62 * u, y - 120 * u, 16 * u, 52 * u, 0.15, 0, Math.PI * 2);
    ctx.ellipse(x + 62 * u, y - 120 * u, 16 * u, 52 * u, -0.15, 0, Math.PI * 2);
    ctx.fill();

    // Head with round ears.
    const hy = y - 214 * u;
    ctx.fillStyle = c('#4a3626');
    ctx.beginPath();
    ctx.arc(x - 32 * u, hy - 30 * u, 15 * u, 0, Math.PI * 2);
    ctx.arc(x + 32 * u, hy - 30 * u, 15 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, hy, 44 * u, 0, Math.PI * 2);
    ctx.fill();

    // Muzzle and stitched mouth.
    ctx.fillStyle = c('#5c4331');
    ctx.beginPath();
    ctx.ellipse(x, hy + 16 * u, 20 * u, 14 * u, 0, 0, Math.PI * 2);
    ctx.fill();
    if (!sil) {
      ctx.fillStyle = '#1c140d';
      ctx.beginPath();
      ctx.moveTo(x - 6 * u, hy + 8 * u);
      ctx.lineTo(x + 6 * u, hy + 8 * u);
      ctx.lineTo(x, hy + 15 * u);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#1c140d';
      ctx.lineWidth = 2 * u;
      ctx.beginPath();
      ctx.moveTo(x - 12 * u, hy + 24 * u);
      ctx.quadraticCurveTo(x, hy + 29 * u, x + 12 * u, hy + 24 * u);
      ctx.stroke();
    }

    // Mismatched eyes: one live amber lamp, one dead black button.
    this._glowEye(ctx, x - 16 * u, hy - 8 * u, 5.5 * u, '#ffc45a');
    ctx.fillStyle = sil ? '#15151c' : '#101014';
    ctx.beginPath();
    ctx.arc(x + 16 * u, hy - 8 * u, 6 * u, 0, Math.PI * 2);
    ctx.fill();
    if (!sil) {
      ctx.strokeStyle = '#3a3a44';
      ctx.lineWidth = 1.5 * u;
      ctx.beginPath();
      ctx.arc(x + 16 * u, hy - 8 * u, 6 * u, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  drawJumpscareFace(ctx, cx, cy, r) {
    // Ears.
    ctx.fillStyle = '#3e2d1f';
    ctx.beginPath();
    ctx.arc(cx - r * 0.72, cy - r * 0.72, r * 0.32, 0, Math.PI * 2);
    ctx.arc(cx + r * 0.72, cy - r * 0.72, r * 0.32, 0, Math.PI * 2);
    ctx.fill();
    // Head.
    ctx.fillStyle = '#4a3626';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    // Torn seam across the crown.
    ctx.strokeStyle = '#241a10';
    ctx.lineWidth = r * 0.05;
    ctx.setLineDash([r * 0.08, r * 0.06]);
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.6, cy - r * 0.5);
    ctx.quadraticCurveTo(cx, cy - r * 0.85, cx + r * 0.55, cy - r * 0.45);
    ctx.stroke();
    ctx.setLineDash([]);
    // Eyes: both burn during the attack.
    this._glowEye(ctx, cx - r * 0.34, cy - r * 0.18, r * 0.13, '#ffc45a');
    this._glowEye(ctx, cx + r * 0.34, cy - r * 0.18, r * 0.13, '#ffc45a');
    // Gaping jaw full of peg teeth.
    ctx.fillStyle = '#120b06';
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.45, r * 0.5, r * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#cfc5a8';
    for (let i = -3; i <= 3; i++) {
      const tx = cx + i * r * 0.13;
      ctx.beginPath();
      ctx.moveTo(tx - r * 0.05, cy + r * 0.12);
      ctx.lineTo(tx + r * 0.05, cy + r * 0.12);
      ctx.lineTo(tx, cy + r * 0.3);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(tx - r * 0.05, cy + r * 0.8);
      ctx.lineTo(tx + r * 0.05, cy + r * 0.8);
      ctx.lineTo(tx, cy + r * 0.62);
      ctx.closePath();
      ctx.fill();
    }
  }
}

/* ========================================================================== */
/* Moppet — the camera-shy rag doll                                           */
/* ========================================================================== */

class Moppet extends Animatronic {
  constructor(game) {
    super(game, {
      id: 'moppet',
      name: 'Moppet',
      home: 'playroom',
      aiTable: [3, 5, 7, 9, 12, 15, 18],
      moveInterval: 4.2,
    });
    this.path = ['playroom', 'westHall', 'leftDoor'];
    this.watchedTime = 0;   // how long she has endured being observed
    this.doorTimer = 0;     // countdown while she stands at your door
  }

  reset(night) {
    super.reset(night);
    this.watchedTime = 0;
    this.doorTimer = 0;
  }

  update(dt) {
    super.update(dt);
    if (this.state === 'office' || this.cooldown > 0 || this.level === 0) return;

    // At the door she is off-camera, so her freeze rule no longer helps.
    if (this.node === 'leftDoor') {
      this.doorTimer -= dt;
      if (this.doorTimer <= 0) {
        if (this.game.office.isDoorClosed('left')) {
          this.game.audio.doorKnock(PAN.west);
          this.retreat('playroom', rand(6, 11));
        } else {
          this.enterOffice();
        }
      }
      return;
    }

    // Quirk: being watched freezes her — but her patience is finite.
    // After ~5 s of continuous observation of her room she moves anyway.
    if (this.game.isCameraViewing(this.node)) {
      this.watchedTime += dt;
      if (this.watchedTime < 5) return;
    } else {
      this.watchedTime = Math.max(0, this.watchedTime - dt * 2);
    }

    this.moveTimer -= dt;
    if (this.moveTimer > 0) return;
    this.moveTimer = this.moveInterval * rand(0.8, 1.3);
    if (!this.rollMove()) return;

    // A skittish 15% of successful rolls sends her backwards instead.
    const idx = this.path.indexOf(this.node);
    if (idx > 0 && chance(0.15)) {
      this.moveTo(this.path[idx - 1]);
      return;
    }

    const next = this.path[idx + 1];
    this.moveTo(next);
    this.watchedTime = 0;
    if (chance(0.6)) this.game.audio.footsteps(PAN.west);
    if (next === 'leftDoor') this.doorTimer = rand(4, 7);
  }

  /* ---------------- rendering ---------------- */

  drawBody(ctx, x, y, h, sil) {
    const u = h / 260;
    const c = (col) => (sil ? '#0b0b10' : col);

    // Spindly legs.
    ctx.strokeStyle = c('#6e6258');
    ctx.lineWidth = 9 * u;
    ctx.beginPath();
    ctx.moveTo(x - 14 * u, y - 92 * u);
    ctx.lineTo(x - 18 * u, y);
    ctx.moveTo(x + 14 * u, y - 92 * u);
    ctx.lineTo(x + 20 * u, y);
    ctx.stroke();

    // Patch dress.
    ctx.fillStyle = c('#5e3a48');
    ctx.beginPath();
    ctx.moveTo(x, y - 190 * u);
    ctx.lineTo(x + 52 * u, y - 84 * u);
    ctx.lineTo(x - 52 * u, y - 84 * u);
    ctx.closePath();
    ctx.fill();
    if (!sil) {
      ctx.fillStyle = '#7a5261';
      ctx.fillRect(x - 4 * u, y - 130 * u, 24 * u, 22 * u);
      ctx.strokeStyle = '#33202a';
      ctx.lineWidth = 1.6 * u;
      ctx.setLineDash([3 * u, 3 * u]);
      ctx.strokeRect(x - 4 * u, y - 130 * u, 24 * u, 22 * u);
      ctx.setLineDash([]);
    }

    // Dangling arms.
    ctx.strokeStyle = c('#6e6258');
    ctx.lineWidth = 8 * u;
    ctx.beginPath();
    ctx.moveTo(x - 36 * u, y - 168 * u);
    ctx.lineTo(x - 58 * u, y - 92 * u);
    ctx.moveTo(x + 36 * u, y - 168 * u);
    ctx.lineTo(x + 58 * u, y - 92 * u);
    ctx.stroke();

    // Head: cloth oval framed by loose yarn hair.
    const hy = y - 216 * u;
    if (!sil) {
      ctx.strokeStyle = '#6e2f2f';
      ctx.lineWidth = 4 * u;
      for (let i = -3; i <= 3; i++) {
        ctx.beginPath();
        ctx.moveTo(x + i * 9 * u, hy - 32 * u);
        ctx.quadraticCurveTo(x + i * 16 * u, hy, x + i * 15 * u, hy + 34 * u);
        ctx.stroke();
      }
    }
    ctx.fillStyle = c('#8f8378');
    ctx.beginPath();
    ctx.ellipse(x, hy, 32 * u, 36 * u, 0, 0, Math.PI * 2);
    ctx.fill();

    // Mismatched button eyes: one lit, one cross-stitched shut.
    this._glowEye(ctx, x - 12 * u, hy - 6 * u, 4.5 * u, '#d8e6ff');
    if (!sil) {
      ctx.strokeStyle = '#2a2119';
      ctx.lineWidth = 2.2 * u;
      ctx.beginPath();
      ctx.moveTo(x + 8 * u, hy - 10 * u);
      ctx.lineTo(x + 17 * u, hy - 2 * u);
      ctx.moveTo(x + 17 * u, hy - 10 * u);
      ctx.lineTo(x + 8 * u, hy - 2 * u);
      ctx.stroke();
      // Stitched grin, slightly too wide.
      ctx.beginPath();
      ctx.moveTo(x - 16 * u, hy + 14 * u);
      ctx.quadraticCurveTo(x, hy + 24 * u, x + 16 * u, hy + 14 * u);
      ctx.stroke();
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(x + i * 7 * u, hy + 13 * u);
        ctx.lineTo(x + i * 7 * u, hy + 21 * u);
        ctx.stroke();
      }
    }
  }

  drawJumpscareFace(ctx, cx, cy, r) {
    // Wild yarn hair radiating outward.
    ctx.strokeStyle = '#6e2f2f';
    ctx.lineWidth = r * 0.06;
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r * 0.7, cy + Math.sin(a) * r * 0.7);
      ctx.lineTo(cx + Math.cos(a) * r * 1.25, cy + Math.sin(a) * r * 1.25);
      ctx.stroke();
    }
    // Face.
    ctx.fillStyle = '#8f8378';
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 0.85, r, 0, 0, Math.PI * 2);
    ctx.fill();
    // One blazing button eye, one ripped-open socket.
    this._glowEye(ctx, cx - r * 0.3, cy - r * 0.22, r * 0.12, '#d8e6ff');
    ctx.fillStyle = '#17110c';
    ctx.beginPath();
    ctx.ellipse(cx + r * 0.32, cy - r * 0.2, r * 0.16, r * 0.2, 0.3, 0, Math.PI * 2);
    ctx.fill();
    // The grin's stitches have torn: a wide dark mouth with loose threads.
    ctx.fillStyle = '#17110c';
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.42, r * 0.5, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#2a2119';
    ctx.lineWidth = r * 0.035;
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(cx + i * r * 0.14, cy + r * 0.16);
      ctx.lineTo(cx + i * r * 0.16, cy + r * 0.55);
      ctx.stroke();
    }
  }
}

/* ========================================================================== */
/* Sprocket — the wind-up tin rabbit                                          */
/* ========================================================================== */

class Sprocket extends Animatronic {
  constructor(game) {
    super(game, {
      id: 'sprocket',
      name: 'Sprocket',
      home: 'storage',
      aiTable: [1, 3, 5, 8, 11, 14, 17],
      moveInterval: 5.0,
    });
    this.charge = 0;        // 0..1 spring tension; 1 = sprint
    this.phase = 0;         // 0 dormant, 1 stirring, 2 poised (from charge)
    this.sprintTimer = 0;   // time until he reaches the left door
    this.neglect = 0;       // seconds since the monitor was last raised
  }

  reset(night) {
    super.reset(night);
    this.charge = 0;
    this.phase = 0;
    this.sprintTimer = 0;
    this.neglect = 0;
  }

  update(dt) {
    super.update(dt);
    if (this.state === 'office' || this.level === 0) return;

    // Track how long the player has gone without checking any camera.
    this.neglect = this.game.cameras.isUp ? 0 : this.neglect + dt;

    if (this.state === 'sprint') {
      this.sprintTimer -= dt;
      if (this.sprintTimer <= 0) this._arriveAtDoor();
      return;
    }

    if (this.cooldown > 0) return;

    // Spring tension. Watching CAM 5 actively unwinds him; ignoring the
    // cameras entirely lets him wind half again as fast.
    const watched = this.game.isCameraViewing('storage');
    if (watched) {
      this.charge = Math.max(0, this.charge - 0.045 * dt);
    } else {
      // Roughly two minutes to full tension on night 1, tightening to
      // under half a minute at maximum aggression.
      const neglectBoost = this.neglect > 25 ? 1.5 : 1;
      this.charge += (0.006 + 0.0028 * this.effectiveLevel()) * neglectBoost * dt;
    }

    // Phase thresholds drive both the CAM 5 pose and the ratchet audio.
    const newPhase = this.charge >= 0.66 ? 2 : (this.charge >= 0.33 ? 1 : 0);
    if (newPhase > this.phase) {
      this.game.audio.windup();
      this.game.cameras.motionPing('storage');
    }
    this.phase = newPhase;

    if (this.charge >= 1) this._launch();
  }

  _launch() {
    this.state = 'sprint';
    this.charge = 1;
    this.sprintTimer = 2.4;
    this.moveTo('westHall');
    this.game.audio.footsteps(PAN.west, true);
  }

  _arriveAtDoor() {
    this.node = 'leftDoor';
    if (this.game.office.isDoorClosed('left')) {
      // Full-speed collision with sealed steel: loud, and it costs you.
      this.game.audio.doorBang(PAN.west);
      this.game.effects.shake(14, 0.5);
      this.game.power.applyBangDrain();
      this.charge = rand(0, 0.2);
      this.phase = 0;
      this.retreat('storage', rand(8, 14));
    } else {
      this.game.triggerJumpscare(this);
    }
  }

  /* ---------------- rendering ---------------- */

  drawInRoom(ctx, x, y, scale) {
    if (this.state === 'sprint' && this.node === 'westHall') {
      // Caught mid-sprint on CAM 3: a lean blur of tin.
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-0.28);
      this.drawBody(ctx, 0, 0, 240 * scale, false);
      ctx.restore();
      return;
    }
    if (this.node === 'storage') {
      // Phase poses in the storage bay.
      if (this.phase === 0) {
        // Dormant: only ear tips past the tarp, easy to miss.
        const u = scale;
        ctx.fillStyle = '#3d5a5e';
        ctx.fillRect(x - 26 * u, y - 190 * u, 12 * u, 60 * u);
        ctx.fillRect(x + 16 * u, y - 182 * u, 12 * u, 52 * u);
        return;
      }
      if (this.phase === 1) {
        // Stirring: head and shoulders above the tarp.
        this.drawBody(ctx, x, y + 120 * scale, 260 * scale, false);
        return;
      }
    }
    this.drawBody(ctx, x, y, 260 * scale, false); // poised, fully upright
  }

  drawBody(ctx, x, y, h, sil) {
    const u = h / 260;
    const c = (col) => (sil ? '#0b0b10' : col);

    // Sprung legs, crouched and ready.
    ctx.strokeStyle = c('#31494c');
    ctx.lineWidth = 11 * u;
    ctx.beginPath();
    ctx.moveTo(x - 20 * u, y - 84 * u);
    ctx.lineTo(x - 34 * u, y - 40 * u);
    ctx.lineTo(x - 22 * u, y);
    ctx.moveTo(x + 20 * u, y - 84 * u);
    ctx.lineTo(x + 34 * u, y - 40 * u);
    ctx.lineTo(x + 22 * u, y);
    ctx.stroke();

    // Tin body with rust patches.
    ctx.fillStyle = c('#3d5a5e');
    ctx.beginPath();
    ctx.ellipse(x, y - 130 * u, 44 * u, 62 * u, 0, 0, Math.PI * 2);
    ctx.fill();
    if (!sil) {
      ctx.fillStyle = '#6e4b33';
      ctx.beginPath();
      ctx.ellipse(x - 20 * u, y - 104 * u, 12 * u, 8 * u, 0.4, 0, Math.PI * 2);
      ctx.ellipse(x + 26 * u, y - 152 * u, 8 * u, 6 * u, -0.3, 0, Math.PI * 2);
      ctx.fill();
      // Chest gear with teeth.
      ctx.fillStyle = '#22343a';
      ctx.beginPath();
      ctx.arc(x, y - 132 * u, 17 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#4e6a70';
      ctx.lineWidth = 3 * u;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(a) * 17 * u, y - 132 * u + Math.sin(a) * 17 * u);
        ctx.lineTo(x + Math.cos(a) * 23 * u, y - 132 * u + Math.sin(a) * 23 * u);
        ctx.stroke();
      }
      // Wind-up key jutting from his side.
      ctx.strokeStyle = '#7a8a8e';
      ctx.lineWidth = 5 * u;
      ctx.beginPath();
      ctx.moveTo(x + 44 * u, y - 130 * u);
      ctx.lineTo(x + 66 * u, y - 130 * u);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(x + 74 * u, y - 130 * u, 8 * u, 16 * u, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Head: angular tin skull.
    const hy = y - 226 * u;
    ctx.fillStyle = c('#46666b');
    ctx.beginPath();
    ctx.moveTo(x - 30 * u, hy + 24 * u);
    ctx.lineTo(x - 26 * u, hy - 18 * u);
    ctx.lineTo(x, hy - 26 * u);
    ctx.lineTo(x + 26 * u, hy - 18 * u);
    ctx.lineTo(x + 30 * u, hy + 24 * u);
    ctx.closePath();
    ctx.fill();

    // Tall tin ears — one bent at the tip.
    ctx.fillStyle = c('#3d5a5e');
    ctx.fillRect(x - 24 * u, hy - 92 * u, 13 * u, 72 * u);
    ctx.save();
    ctx.translate(x + 18 * u, hy - 20 * u);
    ctx.rotate(0.12);
    ctx.fillRect(-6 * u, -72 * u, 13 * u, 72 * u);
    ctx.restore();
    if (!sil) {
      ctx.save();
      ctx.translate(x + 22 * u, hy - 88 * u);
      ctx.rotate(1.1);
      ctx.fillRect(-6 * u, 0, 13 * u, 26 * u);
      ctx.restore();
    }

    // Burning green lamps and etched whiskers.
    this._glowEye(ctx, x - 13 * u, hy - 4 * u, 5 * u, '#7dff8a');
    this._glowEye(ctx, x + 13 * u, hy - 4 * u, 5 * u, '#7dff8a');
    if (!sil) {
      ctx.strokeStyle = '#2a3f44';
      ctx.lineWidth = 1.8 * u;
      ctx.beginPath();
      for (const s of [-1, 1]) {
        ctx.moveTo(x + s * 8 * u, hy + 12 * u);
        ctx.lineTo(x + s * 30 * u, hy + 8 * u);
        ctx.moveTo(x + s * 8 * u, hy + 15 * u);
        ctx.lineTo(x + s * 30 * u, hy + 18 * u);
      }
      ctx.stroke();
    }
  }

  drawJumpscareFace(ctx, cx, cy, r) {
    // Ears shooting past the top of the frame.
    ctx.fillStyle = '#3d5a5e';
    ctx.fillRect(cx - r * 0.55, cy - r * 2.1, r * 0.3, r * 1.5);
    ctx.fillRect(cx + r * 0.25, cy - r * 2.0, r * 0.3, r * 1.4);
    // Angular skull.
    ctx.fillStyle = '#46666b';
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.8, cy + r * 0.7);
    ctx.lineTo(cx - r * 0.7, cy - r * 0.55);
    ctx.lineTo(cx, cy - r * 0.8);
    ctx.lineTo(cx + r * 0.7, cy - r * 0.55);
    ctx.lineTo(cx + r * 0.8, cy + r * 0.7);
    ctx.closePath();
    ctx.fill();
    // Rust bloom across one cheek.
    ctx.fillStyle = '#6e4b33';
    ctx.beginPath();
    ctx.ellipse(cx + r * 0.4, cy + r * 0.25, r * 0.25, r * 0.16, 0.4, 0, Math.PI * 2);
    ctx.fill();
    // Eyes.
    this._glowEye(ctx, cx - r * 0.32, cy - r * 0.15, r * 0.14, '#7dff8a');
    this._glowEye(ctx, cx + r * 0.32, cy - r * 0.15, r * 0.14, '#7dff8a');
    // Sheet-metal jaw torn open, zig-zag edge.
    ctx.fillStyle = '#10181a';
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.55, cy + r * 0.2);
    for (let i = 0; i <= 8; i++) {
      const tx = cx - r * 0.55 + (i / 8) * r * 1.1;
      ctx.lineTo(tx, cy + r * (i % 2 === 0 ? 0.28 : 0.16));
    }
    ctx.lineTo(cx + r * 0.55, cy + r * 0.75);
    ctx.lineTo(cx - r * 0.55, cy + r * 0.75);
    ctx.closePath();
    ctx.fill();
  }
}

/* ========================================================================== */
/* Hollow — the owl that unbolts itself                                       */
/* ========================================================================== */

class Hollow extends Animatronic {
  constructor(game) {
    super(game, {
      id: 'hollow',
      name: 'Hollow',
      home: 'maintenance',
      aiTable: [0, 2, 4, 7, 10, 13, 17],
      moveInterval: 6.0,
    });
    this.vanishTimer = 0;   // dark time between perch and doorway
    this.doorTimer = 0;     // haunt window at a doorway
    this.targetSide = 'left';
  }

  reset(night) {
    super.reset(night);
    this.vanishTimer = 0;
    this.doorTimer = 0;
  }

  update(dt) {
    super.update(dt);
    if (this.state === 'office' || this.level === 0) return;

    // Traveling unseen between the perch and a doorway.
    if (this.state === 'gone') {
      this.vanishTimer -= dt;
      if (this.vanishTimer <= 0) this._appearAtDoor();
      return;
    }

    // Haunting a doorway: shut it before the window closes.
    if (this.state === 'door') {
      this.doorTimer -= dt;
      if (this.doorTimer <= 0) {
        if (this.game.office.isDoorClosed(this.targetSide)) {
          this.retreat('maintenance', rand(6, 12));
        } else {
          this.enterOffice();
        }
      }
      return;
    }

    if (this.cooldown > 0) return;
    this.moveTimer -= dt;
    if (this.moveTimer > 0) return;
    this.moveTimer = this.moveInterval * rand(0.85, 1.3);
    if (!this.rollMove()) return;

    // Unbolt and vanish. The feed he leaves ruptures for a moment.
    this.state = 'gone';
    this.vanishTimer = rand(2.5, 5.5);
    this.moveTo('gone');
    this.game.effects.glitch(0.45);
  }

  _appearAtDoor() {
    // Slightly favors the right door so he and Teddy squeeze the east
    // side together on late nights.
    this.targetSide = chance(0.55) ? 'right' : 'left';
    this.state = 'door';
    this.node = this.targetSide === 'left' ? 'leftDoor' : 'rightDoor';
    // The haunt window shrinks as his aggression rises.
    this.doorTimer = rand(4.5, 7) - this.effectiveLevel() * 0.08;
    this.game.audio.hoot(this.targetSide === 'left' ? PAN.west : PAN.east);
    this.game.effects.glitch(0.2);
  }

  visibleOnCamera() {
    return this.node === 'maintenance';
  }

  /* ---------------- rendering ---------------- */

  drawInRoom(ctx, x, y, scale) {
    // Perched on the high maintenance shelf rather than on the floor.
    this.drawBody(ctx, x, y - 100 * scale, 220 * scale, false);
  }

  drawBody(ctx, x, y, h, sil) {
    const u = h / 260;
    const c = (col) => (sil ? '#0b0b10' : col);

    // Talons gripping whatever he stands on.
    if (!sil) {
      ctx.strokeStyle = '#4a4438';
      ctx.lineWidth = 5 * u;
      ctx.beginPath();
      for (const s of [-1, 1]) {
        for (let t = -1; t <= 1; t++) {
          ctx.moveTo(x + s * 22 * u, y - 8 * u);
          ctx.lineTo(x + s * 22 * u + t * 10 * u, y + 6 * u);
        }
      }
      ctx.stroke();
    }

    // Body: a single owl-shaped mass, wings folded tight.
    ctx.fillStyle = c('#232028');
    ctx.beginPath();
    ctx.ellipse(x, y - 96 * u, 56 * u, 92 * u, 0, 0, Math.PI * 2);
    ctx.fill();
    if (!sil) {
      // Wing seams and breast feather chevrons.
      ctx.strokeStyle = '#302c38';
      ctx.lineWidth = 3 * u;
      ctx.beginPath();
      ctx.moveTo(x - 40 * u, y - 150 * u);
      ctx.quadraticCurveTo(x - 60 * u, y - 90 * u, x - 30 * u, y - 20 * u);
      ctx.moveTo(x + 40 * u, y - 150 * u);
      ctx.quadraticCurveTo(x + 60 * u, y - 90 * u, x + 30 * u, y - 20 * u);
      ctx.stroke();
      for (let row = 0; row < 4; row++) {
        for (let i = -1; i <= 1; i++) {
          const fx = x + i * 16 * u;
          const fy = y - 96 * u + row * 18 * u;
          ctx.beginPath();
          ctx.moveTo(fx - 6 * u, fy);
          ctx.lineTo(fx, fy + 7 * u);
          ctx.lineTo(fx + 6 * u, fy);
          ctx.stroke();
        }
      }
    }

    // Head: wide disc with horn tufts.
    const hy = y - 196 * u;
    ctx.fillStyle = c('#2a2632');
    ctx.beginPath();
    ctx.ellipse(x, hy, 46 * u, 40 * u, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - 40 * u, hy - 22 * u);
    ctx.lineTo(x - 22 * u, hy - 58 * u);
    ctx.lineTo(x - 10 * u, hy - 30 * u);
    ctx.moveTo(x + 40 * u, hy - 22 * u);
    ctx.lineTo(x + 22 * u, hy - 58 * u);
    ctx.lineTo(x + 10 * u, hy - 30 * u);
    ctx.closePath();
    ctx.fill();

    // The eyes: enormous, ringed, and completely empty.
    for (const s of [-1, 1]) {
      const ex = x + s * 18 * u;
      if (!sil) {
        ctx.strokeStyle = '#4a4456';
        ctx.lineWidth = 3 * u;
        ctx.beginPath();
        ctx.arc(ex, hy - 2 * u, 15 * u, 0, Math.PI * 2);
        ctx.stroke();
      }
      this._glowEye(ctx, ex, hy - 2 * u, 8 * u, '#e8ecf4');
      // A pinprick void at the center of each lamp.
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(ex, hy - 2 * u, 2.5 * u, 0, Math.PI * 2);
      ctx.fill();
    }

    // Hooked beak.
    ctx.fillStyle = c('#57503f');
    ctx.beginPath();
    ctx.moveTo(x - 6 * u, hy + 12 * u);
    ctx.lineTo(x + 6 * u, hy + 12 * u);
    ctx.lineTo(x, hy + 26 * u);
    ctx.closePath();
    ctx.fill();
  }

  drawJumpscareFace(ctx, cx, cy, r) {
    // Flared wings behind the head.
    ctx.fillStyle = '#1c1922';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.quadraticCurveTo(cx - r * 2.2, cy - r * 1.4, cx - r * 2.6, cy + r * 0.6);
    ctx.quadraticCurveTo(cx - r * 1.2, cy + r * 0.3, cx, cy + r * 0.4);
    ctx.moveTo(cx, cy);
    ctx.quadraticCurveTo(cx + r * 2.2, cy - r * 1.4, cx + r * 2.6, cy + r * 0.6);
    ctx.quadraticCurveTo(cx + r * 1.2, cy + r * 0.3, cx, cy + r * 0.4);
    ctx.fill();
    // Head disc and tufts.
    ctx.fillStyle = '#2a2632';
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * 0.9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.85, cy - r * 0.5);
    ctx.lineTo(cx - r * 0.45, cy - r * 1.35);
    ctx.lineTo(cx - r * 0.2, cy - r * 0.7);
    ctx.moveTo(cx + r * 0.85, cy - r * 0.5);
    ctx.lineTo(cx + r * 0.45, cy - r * 1.35);
    ctx.lineTo(cx + r * 0.2, cy - r * 0.7);
    ctx.closePath();
    ctx.fill();
    // Void-center searchlight eyes.
    for (const s of [-1, 1]) {
      this._glowEye(ctx, cx + s * r * 0.38, cy - r * 0.1, r * 0.2, '#e8ecf4');
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(cx + s * r * 0.38, cy - r * 0.1, r * 0.07, 0, Math.PI * 2);
      ctx.fill();
    }
    // Beak wide open, screeching.
    ctx.fillStyle = '#57503f';
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.22, cy + r * 0.28);
    ctx.lineTo(cx + r * 0.22, cy + r * 0.28);
    ctx.lineTo(cx, cy + r * 0.52);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#0c0a06';
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.16, cy + r * 0.52);
    ctx.lineTo(cx + r * 0.16, cy + r * 0.52);
    ctx.lineTo(cx, cy + r * 0.78);
    ctx.closePath();
    ctx.fill();
  }
}

/* ========================================================================== */

/** Build the full cast for a game instance. */
export function createAnimatronics(game) {
  return [new Teddy(game), new Moppet(game), new Sprocket(game), new Hollow(game)];
}
