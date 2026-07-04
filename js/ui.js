/**
 * ui.js — menus, HUD and settings.
 *
 * The overlay screens (menu, settings, pause, results) are DOM elements
 * defined in index.html and toggled here; the in-game HUD (clock, power,
 * usage meter, camera strip) is drawn on the canvas so it inherits the
 * CRT treatment. Settings changes persist immediately through the
 * SaveSystem.
 */

import { CONFIG } from './game.js';

/** The clickable strip that raises/lowers the camera monitor. */
const CAMERA_STRIP = { x: 460, y: 656, w: 360, h: 46 };

const SCREEN_IDS = {
  menu: 'screen-menu',
  settings: 'screen-settings',
  instructions: 'screen-instructions',
  pause: 'screen-pause',
  night: 'screen-night',
  gameover: 'screen-gameover',
  victory: 'screen-victory',
};

export class UIManager {
  constructor(game) {
    this.game = game;
    this.screens = {};
    for (const [key, id] of Object.entries(SCREEN_IDS)) {
      this.screens[key] = document.getElementById(id);
    }
    this.fpsEl = document.getElementById('fps-counter');
  }

  /* ------------------------------------------------------------------ */
  /* DOM wiring                                                          */
  /* ------------------------------------------------------------------ */

  bind() {
    const g = this.game;
    const click = (id, fn) => {
      document.getElementById(id).addEventListener('click', () => {
        g.audio.unlock();
        g.audio.uiClick();
        fn();
      });
    };

    // Main menu.
    click('btn-new-game', () => {
      g.save.data.currentNight = 1;
      g.save.save();
      g.startNight(1);
    });
    click('btn-continue', () => g.startNight(g.save.data.currentNight));
    click('btn-settings', () => this.showScreen('settings'));
    click('btn-instructions', () => this.showScreen('instructions'));

    // Settings.
    click('btn-settings-back', () => {
      this.refreshMenu();
      this.showScreen('menu');
    });
    click('btn-reset-save', () => {
      if (window.confirm('Erase all progress, statistics and settings?')) {
        g.save.erase();
        this.applySettings();
        this.refreshMenu();
      }
    });
    click('btn-instructions-back', () => this.showScreen('menu'));

    // Pause.
    click('btn-resume', () => g.resume());
    click('btn-restart-night', () => g.startNight(g.night));
    click('btn-quit-menu', () => g.quitToMenu());

    // Results.
    click('btn-retry', () => g.startNight(g.night));
    click('btn-gameover-menu', () => g.quitToMenu());
    click('btn-next-night', () => g.startNight(g.save.data.currentNight));
    click('btn-victory-menu', () => g.quitToMenu());

    // A featherweight tick as the pointer crosses any menu button.
    for (const btn of document.querySelectorAll('.menu-btn')) {
      btn.addEventListener('mouseenter', () => g.audio.uiHover());
    }

    // Settings inputs write straight into the save file.
    const s = g.save.data.settings;
    const volume = document.getElementById('set-volume');
    volume.addEventListener('input', () => {
      s.volume = Number(volume.value);
      g.audio.setVolume(s.volume / 100);
      g.save.save();
    });
    const effects = document.getElementById('set-effects');
    effects.addEventListener('input', () => {
      s.effects = Number(effects.value);
      g.save.save();
    });
    const shake = document.getElementById('set-shake');
    shake.addEventListener('change', () => {
      s.screenShake = shake.checked;
      g.save.save();
    });
    const fps = document.getElementById('set-fps');
    fps.addEventListener('change', () => {
      s.showFps = fps.checked;
      this.fpsEl.classList.toggle('hidden', !s.showFps);
      g.save.save();
    });
  }

  /** Push persisted settings into the widgets and live systems. */
  applySettings() {
    const s = this.game.save.data.settings;
    document.getElementById('set-volume').value = s.volume;
    document.getElementById('set-effects').value = s.effects;
    document.getElementById('set-shake').checked = s.screenShake;
    document.getElementById('set-fps').checked = s.showFps;
    this.fpsEl.classList.toggle('hidden', !s.showFps);
    this.game.audio.setVolume(s.volume / 100);
  }

  /* ------------------------------------------------------------------ */
  /* Screen switching                                                    */
  /* ------------------------------------------------------------------ */

  showScreen(name) {
    this.hideScreens();
    this.screens[name].classList.add('visible');
  }

  hideScreens() {
    for (const el of Object.values(this.screens)) {
      el.classList.remove('visible');
    }
  }

  showNightIntro(night) {
    document.getElementById('night-intro-label').textContent = `Night ${night}`;
    this.showScreen('night');
  }

  showGameOver(attacker, hour) {
    const clock = hour === 0 ? '12 AM' : `${hour} AM`;
    const who = attacker ? attacker.name : 'Something';
    const tips = {
      teddy: 'Teddy Ragbear only moves while your monitor is up. Watch less, listen more.',
      moppet: 'Moppet stalls while CAM 2 or CAM 3 is watched — but never for long.',
      sprocket: 'Check CAM 5 regularly. A watched spring never fully winds.',
      hollow: 'After the hoot, sweep both door lights before you do anything else.',
    };
    const tip = attacker && tips[attacker.id] ? tips[attacker.id] : '';
    document.getElementById('gameover-detail').textContent =
      `${who} reached you at ${clock}.\n${tip}`;
    this.showScreen('gameover');
  }

  showVictory(night) {
    const detail = document.getElementById('victory-detail');
    const next = document.getElementById('btn-next-night');
    if (night >= CONFIG.FINAL_NIGHT) {
      detail.textContent =
        `Night ${night} complete. Your week at Teddy's Toyworks is over — ` +
        'the machines stand silent, for now. Overtime is available, if you dare.';
      next.textContent = `Overtime — Night ${night + 1}`;
    } else {
      detail.textContent = `Night ${night} complete. The sun is up. They went still where they stood.`;
      next.textContent = `Next Night — Night ${night + 1}`;
    }
    this.showScreen('victory');
  }

  /** Menu labels + lifetime statistics readout. */
  refreshMenu() {
    const d = this.game.save.data;
    document.getElementById('btn-continue').textContent =
      `Continue — Night ${d.currentNight}`;
    const st = d.stats;
    const caught = Object.values(st.caughtBy).reduce((a, b) => a + b, 0);
    document.getElementById('menu-stats').innerHTML =
      `BEST NIGHT: ${d.bestNight || '—'} &nbsp;·&nbsp; ` +
      `NIGHTS SURVIVED: ${st.nightsSurvived} &nbsp;·&nbsp; ` +
      `SHIFTS STARTED: ${st.gamesPlayed}<br>` +
      `HOURS ON THE CLOCK: ${st.hoursSurvived} &nbsp;·&nbsp; ` +
      `TIMES CAUGHT: ${caught}`;
  }

  updateFps(fps) {
    if (this.game.save.data.settings.showFps) {
      this.fpsEl.textContent = `${fps} FPS`;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Canvas HUD                                                          */
  /* ------------------------------------------------------------------ */

  /** True if a canvas click landed on the camera raise/lower strip. */
  hitCameraStrip(x, y) {
    const r = CAMERA_STRIP;
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  renderHUD(ctx) {
    const g = this.game;

    // During the blackout the panels are dead: no power readout, no
    // camera strip — only the clock, your last hope, stays visible.
    const blackout = g.state === 'powerout';

    // Clock and night indicator (the camera view carries its own
    // timestamp, so only the office view shows these).
    if (!g.cameras.isUp) {
      ctx.save();
      if (blackout) ctx.globalAlpha = 0.4;
      ctx.fillStyle = '#cfd2d6';
      ctx.font = 'bold 44px "Courier New", monospace';
      ctx.textAlign = 'right';
      ctx.fillText(g.clockLabel(), g.W - 44, 68);
      ctx.font = '20px "Courier New", monospace';
      ctx.fillStyle = '#8a8e96';
      ctx.fillText(`Night ${g.night}`, g.W - 44, 96);
      ctx.textAlign = 'left';
      ctx.restore();
    }

    if (!blackout) {
      this._renderPower(ctx);
      this._renderCameraStrip(ctx);
    }

    this._renderHourToast(ctx);
    this._renderControlsHint(ctx);
  }

  /** Center-screen "2 AM" flash when the hour rolls over. */
  _renderHourToast(ctx) {
    const toast = this.game.hourToast;
    if (!toast) return;
    // Quick fade in, hold, slow fade out.
    const shown = 2.6 - toast.t;
    const alpha = Math.min(1, shown / 0.3, toast.t / 0.8);
    ctx.save();
    ctx.globalAlpha = alpha * 0.85;
    ctx.fillStyle = '#cfd2d6';
    ctx.font = 'bold 54px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(toast.label, this.game.W / 2, 200);
    ctx.restore();
    ctx.textAlign = 'left';
  }

  /** First-night key reference, fading out as the shift begins. */
  _renderControlsHint(ctx) {
    const g = this.game;
    if (g.night !== 1 || g.cameras.isUp || g.state !== 'playing') return;
    if (g.nightTimer > 11) return;
    const alpha = g.nightTimer > 8 ? (11 - g.nightTimer) / 3 : 1;
    ctx.save();
    ctx.globalAlpha = alpha * 0.8;
    ctx.fillStyle = '#9aa0ac';
    ctx.font = '18px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Q / E — doors      A / D — lights      SPACE — cameras', g.W / 2, 566);
    ctx.fillText('or click the panels beside each door', g.W / 2, 592);
    ctx.restore();
    ctx.textAlign = 'left';
  }

  _renderPower(ctx) {
    const g = this.game;
    const pct = g.power.percent();
    const usage = g.power.usage();
    const x = 44;
    const y = g.H - 92;

    // Percentage, pulsing red when the battery runs dry.
    const critical = pct <= 20;
    const pulse = critical && Math.floor(performance.now() / 400) % 2 === 0;
    ctx.font = 'bold 30px "Courier New", monospace';
    ctx.fillStyle = pulse ? '#ff5560' : (critical ? '#d03040' : '#cfd2d6');
    ctx.fillText(`POWER: ${pct}%`, x, y);

    // Usage meter: six cells, green through red.
    ctx.font = '16px "Courier New", monospace';
    ctx.fillStyle = '#8a8e96';
    ctx.fillText('USAGE:', x, y + 30);
    const colors = ['#5fae66', '#5fae66', '#c9b04a', '#c9b04a', '#c9612e', '#d03040'];
    for (let i = 0; i < 6; i++) {
      const bx = x + 78 + i * 26;
      if (i < usage) {
        ctx.save();
        ctx.shadowColor = colors[i];
        ctx.shadowBlur = 8;
        ctx.fillStyle = colors[i];
        ctx.fillRect(bx, y + 16, 20, 18);
        ctx.restore();
      } else {
        ctx.strokeStyle = '#3a3e48';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(bx, y + 16, 20, 18);
      }
    }
  }

  _renderCameraStrip(ctx) {
    const g = this.game;
    const r = CAMERA_STRIP;
    const hovered = this.hitCameraStrip(g.pointer.x, g.pointer.y);
    ctx.fillStyle = hovered ? 'rgba(26,30,42,0.85)' : 'rgba(16,18,26,0.75)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = g.cameras.isUp ? '#7fd487' : (hovered ? '#7a828e' : '#4a505e');
    ctx.lineWidth = 2;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = g.cameras.isUp ? '#c6f0ca' : '#9aa0ac';
    ctx.font = 'bold 20px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(
      g.cameras.isUp ? '▼  LOWER MONITOR  ▼' : '▲  CAMERA  ▲',
      r.x + r.w / 2,
      r.y + r.h / 2 + 7,
    );
    ctx.textAlign = 'left';
  }
}
