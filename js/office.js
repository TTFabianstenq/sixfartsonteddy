/**
 * office.js — the security booth.
 *
 * Renders the default first-person view: two doorways with sliding steel
 * doors, door/light control panels, the desk with its props, and the
 * blackout sequence. Also owns door & light state, which the power and
 * AI systems read constantly.
 *
 * Everything is drawn with Canvas primitives; there are no image assets.
 */

import { rand, chance, clamp, easeInOut } from './game.js';

/** Doorway frames (interior opening) in canvas coordinates. */
const DOORWAY = {
  left: { x: 70, y: 120, w: 145, h: 505 },
  right: { x: 1065, y: 120, w: 145, h: 505 },
};

/** Control panel buttons beside each doorway. */
const BUTTONS = {
  left: {
    door: { x: 232, y: 298, w: 62, h: 66 },
    light: { x: 232, y: 386, w: 62, h: 66 },
  },
  right: {
    door: { x: 986, y: 298, w: 62, h: 66 },
    light: { x: 986, y: 386, w: 62, h: 66 },
  },
};

const DOOR_ANIM_SPEED = 6; // full open<->close in ~0.17 s

export class Office {
  constructor(game) {
    this.game = game;
    this.doors = {
      left: { closed: false, anim: 0 },   // anim: 0 open .. 1 closed
      right: { closed: false, anim: 0 },
    };
    this.lights = { left: false, right: false };
  }

  reset() {
    this.doors.left.closed = false;
    this.doors.left.anim = 0;
    this.doors.right.closed = false;
    this.doors.right.anim = 0;
    this.lights.left = false;
    this.lights.right = false;
  }

  /* ------------------------------------------------------------------ */
  /* Controls                                                            */
  /* ------------------------------------------------------------------ */

  toggleDoor(side) {
    // Door controls are unreachable while the monitor is raised.
    if (this.game.cameras.isUp) return;
    const door = this.doors[side];
    door.closed = !door.closed;
    this.game.audio.doorToggle(door.closed, side === 'left' ? -0.7 : 0.7);
  }

  toggleLight(side) {
    if (this.game.cameras.isUp) return;
    this.lights[side] = !this.lights[side];
    this.game.audio.lightClick();
    this.game.audio.setLightHum(this.lights.left || this.lights.right);
  }

  /** Kill both lights (used when the monitor comes up, and on blackout). */
  setLightsOff() {
    this.lights.left = false;
    this.lights.right = false;
    this.game.audio.setLightHum(false);
  }

  /** Blackout: doors retract, lights die, panels go dark. */
  forceOpenAll() {
    this.doors.left.closed = false;
    this.doors.right.closed = false;
    this.setLightsOff();
  }

  isDoorClosed(side) {
    return this.doors[side].closed;
  }

  /** Route a canvas click to whichever panel button it landed on. */
  handleClick(x, y) {
    for (const side of ['left', 'right']) {
      const b = BUTTONS[side];
      if (hit(b.door, x, y)) { this.toggleDoor(side); return true; }
      if (hit(b.light, x, y)) { this.toggleLight(side); return true; }
    }
    return false;
  }

  update(dt) {
    for (const side of ['left', 'right']) {
      const door = this.doors[side];
      const target = door.closed ? 1 : 0;
      if (door.anim !== target) {
        const dir = Math.sign(target - door.anim);
        door.anim = clamp(door.anim + dir * DOOR_ANIM_SPEED * dt, 0, 1);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */

  render(ctx) {
    this._drawShell(ctx);
    this._drawWallDressing(ctx);
    this._drawDoorway(ctx, 'left');
    this._drawDoorway(ctx, 'right');
    this._drawPanel(ctx, 'left');
    this._drawPanel(ctx, 'right');
    this._drawDesk(ctx);
  }

  /** Ceiling, back wall and floor. */
  _drawShell(ctx) {
    const W = this.game.W;
    const H = this.game.H;

    // Back wall.
    const wall = ctx.createLinearGradient(0, 120, 0, 560);
    wall.addColorStop(0, '#15151f');
    wall.addColorStop(1, '#0a0a11');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 120, W, 440);

    // Ceiling with a sagging cable run.
    const ceil = ctx.createLinearGradient(0, 0, 0, 120);
    ceil.addColorStop(0, '#05050a');
    ceil.addColorStop(1, '#111119');
    ctx.fillStyle = ceil;
    ctx.fillRect(0, 0, W, 120);
    ctx.strokeStyle = '#1e1e2a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(240, 40);
    ctx.quadraticCurveTo(640, 95, 1040, 40);
    ctx.stroke();

    // Floor: worn tiles receding toward the desk.
    const floor = ctx.createLinearGradient(0, 560, 0, H);
    floor.addColorStop(0, '#12121a');
    floor.addColorStop(1, '#050508');
    ctx.fillStyle = floor;
    ctx.fillRect(0, 560, W, H - 560);
    ctx.strokeStyle = 'rgba(40,40,58,0.5)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const y = 575 + i * 32 + i * i * 2;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    for (let i = 0; i <= 8; i++) {
      const xTop = 160 + i * 120;
      const xBot = -320 + i * 240;
      ctx.beginPath();
      ctx.moveTo(xTop, 560);
      ctx.lineTo(xBot, H);
      ctx.stroke();
    }
  }

  /** Posters and clutter on the back wall. */
  _drawWallDressing(ctx) {
    // Faded factory poster: a smiling toy bear over the company name.
    ctx.fillStyle = '#1c1a24';
    ctx.fillRect(330, 180, 130, 170);
    ctx.strokeStyle = '#2c2a38';
    ctx.lineWidth = 2;
    ctx.strokeRect(330, 180, 130, 170);
    ctx.fillStyle = '#4a3b30';
    ctx.beginPath();
    ctx.arc(395, 245, 34, 0, Math.PI * 2);   // head
    ctx.arc(370, 218, 12, 0, Math.PI * 2);   // ears
    ctx.arc(420, 218, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5c4c3e';
    ctx.beginPath();
    ctx.ellipse(395, 258, 14, 10, 0, 0, Math.PI * 2); // muzzle
    ctx.fill();
    ctx.fillStyle = '#181820';
    ctx.beginPath();
    ctx.arc(383, 238, 3.5, 0, Math.PI * 2);
    ctx.arc(407, 238, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8a8577';
    ctx.font = '13px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText("TEDDY'S", 395, 310);
    ctx.fillText('TOYWORKS', 395, 326);
    ctx.textAlign = 'left';

    // A child's crayon drawing taped up on the right.
    ctx.fillStyle = '#211f28';
    ctx.fillRect(842, 205, 96, 120);
    ctx.strokeStyle = '#33303f';
    ctx.strokeRect(842, 205, 96, 120);
    ctx.strokeStyle = '#6e5a4a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(890, 240, 16, 0, Math.PI * 2);   // stick figure: head
    ctx.moveTo(890, 256);
    ctx.lineTo(890, 288);                     // body
    ctx.moveTo(874, 268);
    ctx.lineTo(906, 268);                     // arms
    ctx.moveTo(890, 288);
    ctx.lineTo(878, 310);                     // legs
    ctx.moveTo(890, 288);
    ctx.lineTo(902, 310);
    ctx.stroke();

    // Dusty air vent.
    ctx.fillStyle = '#181822';
    ctx.fillRect(600, 150, 90, 46);
    ctx.strokeStyle = '#242433';
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(606, 160 + i * 9);
      ctx.lineTo(684, 160 + i * 9);
      ctx.stroke();
    }
  }

  /**
   * One doorway: hallway void (or lit hallway + lurker), the sliding
   * steel door, and the frame on top.
   */
  _drawDoorway(ctx, side) {
    const d = DOORWAY[side];
    const lit = this.lights[side];
    const doorNode = side === 'left' ? 'leftDoor' : 'rightDoor';
    const lurker = this.game.animatronicAt(doorNode);

    // The void beyond the door.
    ctx.fillStyle = '#010103';
    ctx.fillRect(d.x, d.y, d.w, d.h);

    if (lit) {
      // Fluorescent tube flicker: mostly bright, sometimes stuttering.
      const flick = chance(0.06) ? rand(0.15, 0.5) : rand(0.82, 1);

      // Hallway beyond: cold light, receding wall lines.
      const hall = ctx.createLinearGradient(d.x, d.y, d.x, d.y + d.h);
      hall.addColorStop(0, `rgba(200,214,190,${0.16 * flick})`);
      hall.addColorStop(0.55, `rgba(168,180,158,${0.30 * flick})`);
      hall.addColorStop(1, `rgba(80,88,76,${0.22 * flick})`);
      ctx.fillStyle = hall;
      ctx.fillRect(d.x, d.y, d.w, d.h);

      ctx.strokeStyle = `rgba(120,130,110,${0.3 * flick})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(d.x + 8, d.y + d.h);
      ctx.lineTo(d.x + d.w * 0.4, d.y + d.h * 0.55);
      ctx.moveTo(d.x + d.w - 8, d.y + d.h);
      ctx.lineTo(d.x + d.w * 0.6, d.y + d.h * 0.55);
      ctx.stroke();

      // The reason you checked: something standing in the light.
      if (lurker) {
        lurker.drawDoorSilhouette(ctx, d.x + d.w / 2, d.y + d.h, d.h * 0.86, flick);
      }

      // Light spill into the office.
      const spillX = side === 'left' ? d.x + d.w : d.x;
      const spill = ctx.createRadialGradient(spillX, d.y + d.h * 0.5, 20, spillX, d.y + d.h * 0.5, 320);
      spill.addColorStop(0, `rgba(190,205,180,${0.10 * flick})`);
      spill.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = spill;
      ctx.fillRect(0, 60, this.game.W, 620);
    } else if (lurker && chance(0.012)) {
      // Unlit lurkers stay invisible, but very rarely their eyes catch a
      // stray reflection — a subliminal warning for the observant.
      ctx.fillStyle = 'rgba(220,225,235,0.16)';
      const ey = d.y + d.h * 0.34;
      ctx.beginPath();
      ctx.arc(d.x + d.w / 2 - 12, ey, 3, 0, Math.PI * 2);
      ctx.arc(d.x + d.w / 2 + 12, ey, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Sliding steel door.
    const door = this.doors[side];
    if (door.anim > 0) {
      const t = easeInOut(door.anim);
      const dh = d.h * t;
      const slab = ctx.createLinearGradient(d.x, 0, d.x + d.w, 0);
      slab.addColorStop(0, '#2a2c34');
      slab.addColorStop(0.5, '#3a3d48');
      slab.addColorStop(1, '#23252d');
      ctx.fillStyle = slab;
      ctx.fillRect(d.x, d.y, d.w, dh);
      // Cross-brace and rivet lines make the slab read as metal.
      ctx.strokeStyle = '#1a1c22';
      ctx.lineWidth = 3;
      ctx.strokeRect(d.x + 5, d.y + 5, d.w - 10, Math.max(0, dh - 10));
      if (dh > 60) {
        ctx.beginPath();
        ctx.moveTo(d.x + 8, d.y + 8);
        ctx.lineTo(d.x + d.w - 8, d.y + dh - 8);
        ctx.moveTo(d.x + d.w - 8, d.y + 8);
        ctx.lineTo(d.x + 8, d.y + dh - 8);
        ctx.stroke();
      }
      // Leading edge highlight.
      ctx.fillStyle = '#4a4e5c';
      ctx.fillRect(d.x, d.y + dh - 6, d.w, 6);
    }

    // Door frame drawn last so it overlaps hallway and slab alike.
    ctx.strokeStyle = '#2e2e3e';
    ctx.lineWidth = 10;
    ctx.strokeRect(d.x - 5, d.y - 5, d.w + 10, d.h + 10);
    ctx.strokeStyle = '#1b1b26';
    ctx.lineWidth = 3;
    ctx.strokeRect(d.x - 12, d.y - 12, d.w + 24, d.h + 24);
  }

  /** Door/light control panel with glowing state LEDs. */
  _drawPanel(ctx, side) {
    const b = BUTTONS[side];
    const doorOn = this.doors[side].closed;
    const lightOn = this.lights[side];

    // Backing plate.
    const plate = {
      x: b.door.x - 10, y: b.door.y - 14,
      w: b.door.w + 20, h: (b.light.y + b.light.h) - b.door.y + 28,
    };
    ctx.fillStyle = '#14141d';
    ctx.fillRect(plate.x, plate.y, plate.w, plate.h);
    ctx.strokeStyle = '#262636';
    ctx.lineWidth = 2;
    ctx.strokeRect(plate.x, plate.y, plate.w, plate.h);

    this._drawButton(ctx, b.door, 'DOOR', doorOn, '#c03040', '#59151f');
    this._drawButton(ctx, b.light, 'LIGHT', lightOn, '#cfd6c2', '#54584a');
  }

  _drawButton(ctx, r, label, on, onColor, offColor) {
    ctx.fillStyle = on ? onColor : offColor;
    if (on) {
      ctx.save();
      ctx.shadowColor = onColor;   // cheap bloom on the active button
      ctx.shadowBlur = 18;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.restore();
    } else {
      ctx.fillRect(r.x, r.y, r.w, r.h);
    }
    ctx.strokeStyle = '#0a0a10';
    ctx.lineWidth = 3;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = on ? '#0d0d12' : '#9a9aa8';
    ctx.font = 'bold 13px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + 5);
    ctx.textAlign = 'left';
  }

  /** Desk, spinning fan, dead monitor, clutter. */
  _drawDesk(ctx) {
    const W = this.game.W;

    // Desk slab.
    const desk = ctx.createLinearGradient(0, 596, 0, 720);
    desk.addColorStop(0, '#26202b');
    desk.addColorStop(1, '#141017');
    ctx.fillStyle = desk;
    ctx.beginPath();
    ctx.moveTo(330, 640);
    ctx.lineTo(950, 640);
    ctx.lineTo(1010, 720);
    ctx.lineTo(270, 720);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#302835';
    ctx.fillRect(330, 632, 620, 10);

    // Scattered paperwork.
    ctx.save();
    ctx.translate(560, 668);
    ctx.rotate(-0.08);
    ctx.fillStyle = '#8e897c';
    ctx.fillRect(0, 0, 74, 48);
    ctx.fillStyle = '#7c776b';
    ctx.fillRect(10, -8, 74, 48);
    ctx.strokeStyle = '#5c584e';
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(16, 2 + i * 9);
      ctx.lineTo(70, 2 + i * 9);
      ctx.stroke();
    }
    ctx.restore();

    // Coffee mug.
    ctx.fillStyle = '#3a3f52';
    ctx.fillRect(700, 648, 26, 32);
    ctx.strokeStyle = '#4a5068';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(732, 664, 9, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();

    // Dead monitor showing idle interference.
    ctx.fillStyle = '#191921';
    ctx.fillRect(790, 566, 130, 84);
    ctx.fillStyle = '#0b0e14';
    ctx.fillRect(797, 572, 116, 66);
    ctx.strokeStyle = 'rgba(90,140,150,0.25)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      const y = 576 + Math.random() * 58;
      ctx.beginPath();
      ctx.moveTo(799, y);
      ctx.lineTo(911, y);
      ctx.stroke();
    }
    ctx.fillStyle = '#14141c';
    ctx.fillRect(840, 650, 30, 8);

    // Desk fan — the guard's only company. Blades spin continuously.
    const t = performance.now() / 1000;
    const cx = 432;
    const cy = 610;
    ctx.fillStyle = '#20222c';
    ctx.fillRect(cx - 7, cy + 26, 14, 26);      // stalk
    ctx.beginPath();
    ctx.ellipse(cx, cy + 54, 30, 8, 0, 0, Math.PI * 2); // base
    ctx.fill();
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(t * 14);
    ctx.fillStyle = '#3b4051';
    for (let i = 0; i < 3; i++) {
      ctx.rotate((Math.PI * 2) / 3);
      ctx.beginPath();
      ctx.ellipse(0, -19, 9, 20, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.strokeStyle = '#454b5e';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, cy, 34, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#454b5e';
    ctx.fill();

    // Soft monitor glow across the desk keeps the scene readable.
    const glow = ctx.createRadialGradient(W / 2, 700, 60, W / 2, 700, 520);
    glow.addColorStop(0, 'rgba(90,100,140,0.08)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 300, W, 420);
  }

  /* ------------------------------------------------------------------ */
  /* Blackout                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * The power-out office: near-total darkness. During phase 1, Teddy's
   * eyes glow in the left doorway, pulsing with the music box. Phase 2
   * is pure darkness before the end.
   */
  renderPowerOut(ctx, powerOut) {
    const W = this.game.W;
    const H = this.game.H;

    // The room, barely: a memory of the scene under moonless dark.
    ctx.save();
    ctx.globalAlpha = 0.12;
    this._drawShell(ctx);
    this._drawDoorway(ctx, 'left');
    this._drawDoorway(ctx, 'right');
    ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,0.82)';
    ctx.fillRect(0, 0, W, H);

    if (powerOut.phase === 1) {
      // Twin amber eyes and the faint outline of a bear, keeping time.
      const d = DOORWAY.left;
      const pulse = 0.55 + 0.45 * Math.abs(Math.sin(performance.now() / 420));
      const cx = d.x + d.w / 2;
      const ey = d.y + d.h * 0.3;

      ctx.save();
      ctx.shadowColor = `rgba(255,190,80,${pulse})`;
      ctx.shadowBlur = 22;
      ctx.fillStyle = `rgba(255,196,90,${0.75 * pulse})`;
      ctx.beginPath();
      ctx.arc(cx - 16, ey, 5, 0, Math.PI * 2);
      ctx.arc(cx + 16, ey, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Suggestion of a head around the eyes.
      ctx.strokeStyle = `rgba(120,90,50,${0.12 * pulse})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(cx, ey + 6, 42, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

/** Point-in-rect test for the clickable panels. */
function hit(r, x, y) {
  return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
}
