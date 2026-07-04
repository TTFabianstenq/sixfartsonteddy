/**
 * Night Shift at Teddy's Toyworks — entry point.
 *
 * Boots the game once the DOM is ready. Everything else lives in the
 * ES modules under /js. There is no build step: this file is loaded
 * directly by index.html as a native module.
 */
import { Game } from './js/game.js';

function boot() {
  const canvas = document.getElementById('game-canvas');
  const game = new Game(canvas);
  game.boot();

  // Expose a read-only handle for debugging from the console. The game
  // never depends on this; it is purely a convenience for curious players.
  Object.defineProperty(window, 'toyworks', { value: game, writable: false });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
