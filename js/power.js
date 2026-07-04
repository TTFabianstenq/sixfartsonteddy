/**
 * power.js — the generator.
 *
 * The whole game balances on this number. Usage is measured in "bars":
 * one bar for life support (always on), plus one for each door, each
 * door light, and the camera monitor. Each bar drains the battery at a
 * fixed rate that creeps up slightly on later nights, and hard events
 * (Sprocket slamming a sealed door) take an immediate bite.
 */

import { clamp } from './game.js';

export class PowerSystem {
  constructor(game) {
    this.game = game;
    this.level = 100;          // remaining battery, 0..100
    this.ratePerBar = 0.075;   // % drained per bar per second
    this._depleted = false;
    this._bangPenalty = 1;     // grows each time Sprocket hits the door
  }

  /** Fresh battery for a new night; later nights drain a touch faster. */
  reset(night) {
    this.level = 100;
    this._depleted = false;
    this._bangPenalty = 1;
    this.ratePerBar = 0.075 + Math.min(night, 8) * 0.004;
  }

  /**
   * Current draw in bars (1..6):
   * baseline + left door + right door + left light + right light + camera.
   */
  usage() {
    const office = this.game.office;
    let bars = 1;
    if (office.doors.left.closed) bars++;
    if (office.doors.right.closed) bars++;
    if (office.lights.left) bars++;
    if (office.lights.right) bars++;
    if (this.game.cameras.isUp) bars++;
    return bars;
  }

  update(dt) {
    if (this._depleted) return;
    this.level -= this.usage() * this.ratePerBar * dt;
    if (this.level <= 0) {
      this.level = 0;
      this._depleted = true;
      this.game.onPowerDepleted();
    }
  }

  /**
   * Instant drain from an event. Sprocket's door bangs use an escalating
   * penalty (1%, then 6%, 11%...), matching the risk of ignoring him.
   */
  applyBangDrain() {
    this.level = clamp(this.level - this._bangPenalty, 0, 100);
    this._bangPenalty += 5;
    if (this.level <= 0 && !this._depleted) {
      this._depleted = true;
      this.game.onPowerDepleted();
    }
  }

  /** Whole-number percentage for the HUD: shows 0 only when truly empty. */
  percent() {
    if (this.level <= 0) return 0;
    return Math.max(1, Math.floor(this.level));
  }
}
