/**
 * camera.js — the security camera network.
 *
 * Six feeds, a floor-plan map, raise/lower transitions, per-feed static
 * and glitching, and the procedural room scenes themselves. Animatronics
 * standing in a room are asked to draw themselves at that room's anchor
 * slots, so the same feed can show several machines at once.
 */

import { rand, chance, clamp } from './game.js';

/** The camera roster. `node` matches the animatronics' map nodes. */
export const CAMS = [
  { id: 'CAM 1', name: 'WORKSHOP FLOOR', node: 'workshop' },
  { id: 'CAM 2', name: 'PLAY ROOM', node: 'playroom' },
  { id: 'CAM 3', name: 'WEST HALL', node: 'westHall' },
  { id: 'CAM 4', name: 'EAST HALL', node: 'eastHall' },
  { id: 'CAM 5', name: 'STORAGE BAY', node: 'storage' },
  { id: 'CAM 6', name: 'MAINTENANCE', node: 'maintenance' },
];

/** Floor-plan rectangles for the map overlay (canvas coordinates). */
const MAP_ROOMS = [
  { cam: 0, x: 1015, y: 398, w: 125, h: 64 },  // workshop
  { cam: 1, x: 930, y: 398, w: 75, h: 64 },    // play room
  { cam: 2, x: 968, y: 546, w: 54, h: 104 },   // west hall
  { cam: 3, x: 1128, y: 546, w: 54, h: 104 },  // east hall
  { cam: 4, x: 930, y: 472, w: 75, h: 64 },    // storage
  { cam: 5, x: 1150, y: 472, w: 88, h: 64 },   // maintenance
];

const MAP_OFFICE = { x: 1032, y: 600, w: 86, h: 50 };
const MAP_PANEL = { x: 908, y: 378, w: 340, h: 292 };

/** Where animatronics stand in each room: [x, y(feet), scale] slots. */
const ROOM_ANCHORS = {
  workshop: [[640, 480, 1.1], [420, 490, 1.0], [880, 495, 0.95]],
  playroom: [[520, 500, 1.0], [780, 505, 0.95]],
  westHall: [[640, 540, 1.2], [500, 530, 1.05]],
  eastHall: [[640, 540, 1.2], [790, 530, 1.05]],
  storage: [[630, 515, 1.05], [420, 515, 0.95]],
  maintenance: [[640, 510, 1.05], [870, 515, 0.9]],
};

export class CameraSystem {
  constructor(game) {
    this.game = game;
    this.isUp = false;
    this.activeIndex = 0;
    this.transition = 0;        // static-burst timer (raise/switch)
    this.pings = new Map();     // node → seconds of motion-blink left
  }

  get transitioning() {
    return this.transition > 0;
  }

  reset() {
    this.isUp = false;
    this.activeIndex = 0;
    this.transition = 0;
    this.pings.clear();
  }

  activeNode() {
    return CAMS[this.activeIndex].node;
  }

  isViewing(node) {
    return this.isUp && !this.transitioning && this.activeNode() === node;
  }

  /* ------------------------------------------------------------------ */
  /* Controls                                                            */
  /* ------------------------------------------------------------------ */

  toggle() {
    if (this.isUp) {
      this.isUp = false;
      this.game.audio.camDown();
      // Lowering the monitor is the moment of truth for anything that
      // slipped inside while you were watching hallways.
      for (const a of this.game.animatronics) a.onMonitorLowered();
    } else {
      this.isUp = true;
      this.transition = 0.35;
      this.game.audio.camUp();
      // The monitor takes both hands: door lights die when it comes up.
      this.game.office.setLightsOff();
    }
  }

  /** Blackout or jumpscare: slam the monitor down without fanfare. */
  forceDown() {
    this.isUp = false;
    this.transition = 0;
  }

  select(index) {
    if (index < 0 || index >= CAMS.length || index === this.activeIndex) return;
    this.activeIndex = index;
    this.transition = 0.22;
    this.game.audio.camSwitch();
  }

  handleClick(x, y) {
    for (const room of MAP_ROOMS) {
      if (x >= room.x && x <= room.x + room.w && y >= room.y && y <= room.y + room.h) {
        this.select(room.cam);
        return true;
      }
    }
    return false;
  }

  /** Flash a room on the map when something moves through it. */
  motionPing(node) {
    if (node === 'leftDoor' || node === 'rightDoor' || node === 'office') return;
    this.pings.set(node, 1.6);
  }

  update(dt) {
    if (this.transition > 0) this.transition -= dt;
    for (const [node, t] of this.pings) {
      const left = t - dt;
      if (left <= 0) this.pings.delete(node);
      else this.pings.set(node, left);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Rendering                                                           */
  /* ------------------------------------------------------------------ */

  render(ctx) {
    const cam = CAMS[this.activeIndex];

    // Room scene (or a wall of static while the feed settles).
    if (this.transition > 0.12) {
      this.game.effects.drawStatic(ctx, 0.9);
    } else {
      this._drawRoom(ctx, cam.node);
      this._drawOccupants(ctx, cam.node);
      // Cold surveillance tint unifies every feed.
      ctx.fillStyle = 'rgba(70,110,90,0.07)';
      ctx.fillRect(0, 0, this.game.W, this.game.H);
      // Feed grain sits above the scene, below the chrome.
      const grain = 0.1 + 0.25 * Math.max(0, this.transition / 0.12);
      this.game.effects.drawStatic(ctx, grain * (0.4 + this.game.effects.intensity));
      // Spontaneous per-feed interference.
      if (chance(0.012)) this.game.effects.glitch(0.12);
    }

    this._drawChrome(ctx, cam);
    this._drawMap(ctx);
  }

  /** HUD chrome: REC dot, feed label, viewfinder corners, timestamp. */
  _drawChrome(ctx, cam) {
    const W = this.game.W;

    // Blinking REC.
    if (Math.floor(performance.now() / 600) % 2 === 0) {
      ctx.fillStyle = '#d03040';
      ctx.beginPath();
      ctx.arc(52, 52, 10, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#cfd2d6';
    ctx.font = 'bold 24px "Courier New", monospace';
    ctx.fillText('REC', 72, 61);

    // Timestamp: night + rolling clock with fake minutes.
    const g = this.game;
    const minutes = Math.floor(((g.nightTimer % 72) / 72) * 60);
    const hh = g.hour === 0 ? 12 : g.hour;
    const stamp = `NIGHT ${g.night}  ${hh}:${String(minutes).padStart(2, '0')} AM`;
    ctx.textAlign = 'right';
    ctx.fillText(stamp, W - 44, 61);
    ctx.textAlign = 'left';

    // Feed label sits under the REC marker; the power HUD owns the
    // bottom-left corner.
    ctx.font = 'bold 30px "Courier New", monospace';
    ctx.fillStyle = '#cfd2d6';
    ctx.fillText(`${cam.id} — ${cam.name}`, 46, 108);

    // Viewfinder corner brackets.
    ctx.strokeStyle = 'rgba(207,210,214,0.5)';
    ctx.lineWidth = 3;
    const m = 26;
    const L = 34;
    const H = this.game.H;
    ctx.beginPath();
    ctx.moveTo(m, m + L); ctx.lineTo(m, m); ctx.lineTo(m + L, m);
    ctx.moveTo(W - m - L, m); ctx.lineTo(W - m, m); ctx.lineTo(W - m, m + L);
    ctx.moveTo(m, H - m - L); ctx.lineTo(m, H - m); ctx.lineTo(m + L, H - m);
    ctx.moveTo(W - m - L, H - m); ctx.lineTo(W - m, H - m); ctx.lineTo(W - m, H - m - L);
    ctx.stroke();
  }

  /** The clickable floor plan in the lower-right corner. */
  _drawMap(ctx) {
    const p = MAP_PANEL;
    ctx.fillStyle = 'rgba(8,10,12,0.82)';
    ctx.fillRect(p.x, p.y, p.w, p.h);
    ctx.strokeStyle = '#39424a';
    ctx.lineWidth = 2;
    ctx.strokeRect(p.x, p.y, p.w, p.h);

    ctx.fillStyle = '#8a949c';
    ctx.font = '12px "Courier New", monospace';
    ctx.fillText('FLOOR PLAN — TAP A ROOM', p.x + 12, p.y + 14);

    for (const room of MAP_ROOMS) {
      const active = room.cam === this.activeIndex;
      const node = CAMS[room.cam].node;
      const ping = this.pings.get(node);

      ctx.fillStyle = active ? 'rgba(120,190,140,0.35)' : 'rgba(50,60,68,0.55)';
      ctx.fillRect(room.x, room.y, room.w, room.h);
      if (ping) {
        // Motion blink fades over ~1.6 s.
        ctx.fillStyle = `rgba(210,60,60,${clamp(ping / 1.6, 0, 1) * 0.5})`;
        ctx.fillRect(room.x, room.y, room.w, room.h);
      }
      ctx.strokeStyle = active ? '#7fd487' : '#4a545c';
      ctx.lineWidth = active ? 2.5 : 1.5;
      ctx.strokeRect(room.x, room.y, room.w, room.h);

      ctx.fillStyle = active ? '#c6f0ca' : '#9aa4ac';
      ctx.font = 'bold 15px "Courier New", monospace';
      ctx.fillText(String(room.cam + 1), room.x + 7, room.y + 19);
    }

    // The office (not a feed — it's where you are).
    ctx.fillStyle = 'rgba(30,34,40,0.8)';
    ctx.fillRect(MAP_OFFICE.x, MAP_OFFICE.y, MAP_OFFICE.w, MAP_OFFICE.h);
    ctx.strokeStyle = '#5a5044';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(MAP_OFFICE.x, MAP_OFFICE.y, MAP_OFFICE.w, MAP_OFFICE.h);
    ctx.fillStyle = '#d8b25a';
    ctx.font = 'bold 12px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('YOU', MAP_OFFICE.x + MAP_OFFICE.w / 2, MAP_OFFICE.y + MAP_OFFICE.h / 2 + 4);
    ctx.textAlign = 'left';
  }

  /* ------------------------------------------------------------------ */
  /* Room scenes                                                         */
  /* ------------------------------------------------------------------ */

  /** Draw all animatronics currently standing in this room. */
  _drawOccupants(ctx, node) {
    const anchors = ROOM_ANCHORS[node];
    const here = this.game.animatronicsAt(node).filter((a) => a.visibleOnCamera());
    here.forEach((a, i) => {
      const slot = anchors[Math.min(i, anchors.length - 1)];
      a.drawInRoom(ctx, slot[0], slot[1], slot[2]);
    });
  }

  _drawRoom(ctx, node) {
    switch (node) {
      case 'workshop': this._roomWorkshop(ctx); break;
      case 'playroom': this._roomPlayroom(ctx); break;
      case 'westHall': this._roomHall(ctx, true); break;
      case 'eastHall': this._roomHall(ctx, false); break;
      case 'storage': this._roomStorage(ctx); break;
      case 'maintenance': this._roomMaintenance(ctx); break;
      default: break;
    }
  }

  /** Shared wall/floor base with a per-room tint. */
  _roomBase(ctx, wallTop, wallBottom, floorColor, horizon = 500) {
    const W = this.game.W;
    const H = this.game.H;
    const wall = ctx.createLinearGradient(0, 0, 0, horizon);
    wall.addColorStop(0, wallTop);
    wall.addColorStop(1, wallBottom);
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, W, horizon);
    const floor = ctx.createLinearGradient(0, horizon, 0, H);
    floor.addColorStop(0, floorColor);
    floor.addColorStop(1, '#050507');
    ctx.fillStyle = floor;
    ctx.fillRect(0, horizon, W, H - horizon);
  }

  /** CAM 1 — the old display stage where the machines were shown off. */
  _roomWorkshop(ctx) {
    this._roomBase(ctx, '#101018', '#1b1a22', '#161219', 500);

    // Curtain backdrop with vertical folds.
    ctx.fillStyle = '#251622';
    ctx.fillRect(240, 120, 800, 300);
    ctx.strokeStyle = '#311e2c';
    ctx.lineWidth = 6;
    for (let i = 0; i < 12; i++) {
      ctx.beginPath();
      ctx.moveTo(270 + i * 68, 122);
      ctx.lineTo(270 + i * 68, 418);
      ctx.stroke();
    }

    // Raised stage platform.
    ctx.fillStyle = '#241f28';
    ctx.beginPath();
    ctx.moveTo(200, 500);
    ctx.lineTo(1080, 500);
    ctx.lineTo(1140, 560);
    ctx.lineTo(140, 560);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#191520';
    ctx.fillRect(140, 560, 1000, 26);

    // Dead spotlight rigs overhead.
    ctx.strokeStyle = '#20202c';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(300, 60);
    ctx.lineTo(980, 60);
    ctx.stroke();
    ctx.fillStyle = '#2b2b3a';
    for (const x of [420, 640, 860]) {
      ctx.beginPath();
      ctx.arc(x, 78, 16, 0, Math.PI * 2);
      ctx.fill();
    }
    // One rig still hums with a weak cone of light.
    const cone = ctx.createLinearGradient(640, 90, 640, 520);
    cone.addColorStop(0, 'rgba(190,200,170,0.10)');
    cone.addColorStop(1, 'rgba(190,200,170,0)');
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(624, 90);
    ctx.lineTo(656, 90);
    ctx.lineTo(800, 520);
    ctx.lineTo(480, 520);
    ctx.closePath();
    ctx.fill();
  }

  /** CAM 2 — the children's play room, wrong without children. */
  _roomPlayroom(ctx) {
    this._roomBase(ctx, '#121019', '#1d1826', '#141118', 500);

    // Faded wall art: chalk shapes.
    ctx.strokeStyle = 'rgba(140,130,150,0.25)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(300, 240, 46, 0, Math.PI * 2);
    ctx.moveTo(960, 200);
    ctx.lineTo(1010, 290);
    ctx.lineTo(910, 290);
    ctx.closePath();
    ctx.stroke();
    ctx.strokeRect(590, 190, 90, 90);

    // Ball pit.
    ctx.fillStyle = '#1c1a26';
    ctx.fillRect(200, 520, 380, 130);
    const ballColors = ['#5a3040', '#30465a', '#5a5230', '#3c305a'];
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = ballColors[i % ballColors.length];
      const bx = 215 + ((i * 61) % 350);
      const by = 528 + ((i * 37) % 105);
      ctx.beginPath();
      ctx.arc(bx, by, 12, 0, Math.PI * 2);
      ctx.fill();
    }

    // Stacked alphabet blocks.
    ctx.fillStyle = '#3a2f28';
    ctx.fillRect(880, 560, 54, 54);
    ctx.fillRect(940, 560, 54, 54);
    ctx.fillRect(910, 506, 54, 54);
    ctx.fillStyle = '#8a7a66';
    ctx.font = 'bold 26px "Courier New", monospace';
    ctx.fillText('T', 899, 597);
    ctx.fillText('W', 955, 597);
    ctx.fillText('!', 932, 543);
  }

  /** CAM 3 / CAM 4 — the two corridors leading to your doors. */
  _roomHall(ctx, west) {
    this._roomBase(ctx, '#0e0e15', '#191a20', '#101014', 470);
    const W = this.game.W;

    // One-point perspective corridor.
    const vx = west ? W * 0.42 : W * 0.58;
    ctx.fillStyle = '#14141c';
    ctx.beginPath();
    ctx.moveTo(0, 80);
    ctx.lineTo(vx - 130, 300);
    ctx.lineTo(vx - 130, 560);
    ctx.lineTo(0, 700);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(W, 80);
    ctx.lineTo(vx + 130, 300);
    ctx.lineTo(vx + 130, 560);
    ctx.lineTo(W, 700);
    ctx.closePath();
    ctx.fill();
    // The far end: the door to your office.
    ctx.fillStyle = '#08080c';
    ctx.fillRect(vx - 130, 300, 260, 260);
    ctx.strokeStyle = '#23232f';
    ctx.lineWidth = 4;
    ctx.strokeRect(vx - 130, 300, 260, 260);

    // Ceiling tube light, guttering.
    const flick = chance(0.08) ? rand(0.1, 0.4) : rand(0.7, 1);
    ctx.fillStyle = `rgba(200,210,190,${0.5 * flick})`;
    ctx.fillRect(vx - 60, 96, 120, 10);
    const spill = ctx.createRadialGradient(vx, 110, 10, vx, 110, 380);
    spill.addColorStop(0, `rgba(190,200,175,${0.14 * flick})`);
    spill.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = spill;
    ctx.fillRect(0, 0, W, 620);

    // Wall dressing differs per hall so the feeds read differently.
    if (west) {
      // Crayon drawings taped along the west wall.
      ctx.fillStyle = '#1e1c24';
      for (let i = 0; i < 3; i++) ctx.fillRect(80 + i * 150, 240 + i * 40, 70, 88);
    } else {
      // Exposed pipes along the east wall.
      ctx.strokeStyle = '#22242e';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(W - 60, 120);
      ctx.lineTo(W - 200, 260);
      ctx.lineTo(W - 200, 640);
      ctx.stroke();
    }
  }

  /** CAM 5 — storage bay: crate canyons and one tarp that moves. */
  _roomStorage(ctx) {
    this._roomBase(ctx, '#111309', '#1c1e12', '#12130c', 500);

    // Shelving racks.
    ctx.strokeStyle = '#262a1c';
    ctx.lineWidth = 8;
    for (const x of [180, 1100]) {
      ctx.beginPath();
      ctx.moveTo(x, 180);
      ctx.lineTo(x, 640);
      ctx.stroke();
    }
    ctx.beginPath();
    for (const y of [260, 380, 500]) {
      ctx.moveTo(140, y);
      ctx.lineTo(400, y);
      ctx.moveTo(880, y);
      ctx.lineTo(1140, y);
    }
    ctx.stroke();

    // Crates on the shelves and floor.
    ctx.fillStyle = '#23251a';
    const crates = [
      [150, 208, 78, 50], [250, 214, 60, 44], [900, 210, 84, 48],
      [160, 322, 70, 56], [910, 330, 64, 48], [1010, 318, 70, 60],
      [220, 570, 110, 84], [960, 580, 96, 72],
    ];
    for (const [x, y, w, h] of crates) {
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#161810';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
    }

    // A shape under a tarp, center floor. Sprocket's corner.
    ctx.fillStyle = '#2a2d20';
    ctx.beginPath();
    ctx.moveTo(520, 640);
    ctx.quadraticCurveTo(560, 480, 660, 500);
    ctx.quadraticCurveTo(770, 520, 790, 645);
    ctx.closePath();
    ctx.fill();
  }

  /** CAM 6 — maintenance: workbench, chains, and Hollow's perch. */
  _roomMaintenance(ctx) {
    this._roomBase(ctx, '#0e1014', '#181b21', '#101215', 500);
    const W = this.game.W;

    // Hanging chains.
    ctx.strokeStyle = '#272b33';
    ctx.lineWidth = 5;
    for (const x of [300, 380, 940]) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + 10, 260 + (x % 90));
      ctx.stroke();
    }

    // Workbench with tools.
    ctx.fillStyle = '#20232b';
    ctx.fillRect(120, 470, 420, 40);
    ctx.fillRect(150, 510, 24, 150);
    ctx.fillRect(470, 510, 24, 150);
    ctx.strokeStyle = '#32363f';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(200, 470);  // wrench
    ctx.lineTo(250, 452);
    ctx.moveTo(300, 462);  // screwdriver
    ctx.lineTo(360, 462);
    ctx.stroke();

    // Spare parts bin: limbs that fit nothing anymore.
    ctx.fillStyle = '#1a1d24';
    ctx.fillRect(760, 560, 220, 100);
    ctx.strokeStyle = '#2c303a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(800, 560);
    ctx.lineTo(830, 520);
    ctx.moveTo(900, 560);
    ctx.lineTo(890, 512);
    ctx.stroke();

    // High shelf across the back — the owl's favorite roost.
    ctx.fillStyle = '#1c1f26';
    ctx.fillRect(W / 2 - 220, 300, 440, 18);
  }
}
