# Night Shift at Teddy's Toyworks

A complete, original browser survival-horror game inspired by classic
security-office night-watch gameplay. You are the new night watchman at a
derelict toy factory. Four broken display machines wander the building
after midnight. Manage two doors, two hallway lights and a six-camera
network on a dying generator, and survive from **12 AM to 6 AM**.

Built with **HTML5, CSS3 and vanilla JavaScript (ES6 modules)** on the
**Canvas** and **Web Audio** APIs. No frameworks, no libraries, no npm
dependencies, no build step. Every sprite, room, effect and sound is
generated procedurally at runtime — the deploy ships zero media files.

> Headphones recommended. Contains flashing imagery and sudden loud sounds.

---

## How to play

| Action | Mouse | Keyboard |
| --- | --- | --- |
| Close/open left door | click left red panel | `Q` |
| Close/open right door | click right red panel | `E` |
| Left door light | click left white panel | `A` |
| Right door light | click right white panel | `D` |
| Raise/lower cameras | click the CAMERA strip | `Space` or `S` |
| Switch camera feed | click a room on the map | `1`–`6` |
| Pause | — | `Esc` or `P` |

Everything you switch on drains the generator. At **0%** the doors open,
the lights die, and the mascot comes to say goodnight.

### The machines

- **Teddy Ragbear** — the patchwork mascot. He only creeps forward while
  your monitor is raised, and favors the east hall. If he slips inside,
  the next time you lower the monitor will be the last.
- **Moppet** — a rag doll on the west route. Watching her camera freezes
  her, but her patience runs out after a few seconds.
- **Sprocket** — a wind-up tin rabbit under a tarp in the storage bay.
  His spring winds tighter the longer he goes unwatched; at full tension
  he sprints the west hall. A closed door survives the hit but the
  impact costs power — and the price goes up every time.
- **Hollow** — an owl that unbolts itself from maintenance and reappears
  at either doorway. Listen for the hoot, then check your door lights.

Aggression scales per night (nights 1–6, plus endless overtime) and
creeps upward as the hours pass within each night. All movement is
driven by randomized dice checks, so no two nights play the same.

### Saving

Progress (current night), best night, lifetime statistics and all
settings are stored in `localStorage` — close the tab and continue later.

---

## Deployment

The project is a plain static site; the repository root is the deploy.

### Netlify

**Drag and drop:** open [Netlify Drop](https://app.netlify.com/drop) and
drag the project folder onto the page. Done — `netlify.toml`, `_headers`
and `_redirects` are picked up automatically.

**From Git:** create a new site from this repository. Build command:
*(none)*. Publish directory: `.` (already configured in `netlify.toml`).

**CLI:**

```bash
npm install -g netlify-cli   # only for deploying; the game itself has no dependencies
netlify deploy --prod --dir .
```

### GitHub Pages

1. Push the repository to GitHub.
2. Settings → Pages → Source: **Deploy from a branch**.
3. Select your branch and the **/ (root)** folder, then save.
4. The game is served at `https://<user>.github.io/<repo>/`. All asset
   paths are relative, so it works from a subpath without changes.
   (`_headers`/`_redirects` are Netlify-specific and are ignored by
   GitHub Pages; the game does not depend on them.)

### Local hosting

ES modules require an HTTP origin (opening `index.html` from `file://`
will not load modules). Any static server works:

```bash
# Python
python3 -m http.server 8000

# Node
npx serve .

# PHP
php -S localhost:8000
```

Then open `http://localhost:8000`.

---

## Project structure

```
/
├── index.html          # shell, menu screens, canvas
├── styles.css          # UI chrome + CSS half of the CRT effect
├── script.js           # entry point
├── js/
│   ├── game.js         # loop, state machine, night clock, save system
│   ├── office.js       # office scene, doors, lights, blackout sequence
│   ├── camera.js       # six feeds, floor-plan map, room scenes
│   ├── animatronic.js  # the four AIs + all character artwork
│   ├── ui.js           # menus, settings, HUD, FPS counter
│   ├── power.js        # generator drain model
│   ├── audio.js        # fully procedural Web Audio synthesis
│   └── effects.js      # static, glitches, shake, flash, vignette
├── assets/
│   ├── generated/      # intentionally empty — art is procedural
│   └── audio/          # intentionally empty — sound is procedural
├── _headers            # Netlify security/caching headers
├── _redirects          # SPA fallback
├── netlify.toml        # publish config
├── favicon.ico
├── LICENSE             # MIT
└── README.md
```

## Performance notes

- Fixed 1280×720 internal resolution, scaled with CSS; one `<canvas>`.
- Static/noise is pre-rendered once into a small pool of offscreen
  canvases and blitted — no per-frame pixel generation.
- Gradients that never change (vignette) are cached.
- No per-frame allocations of buffers or images; audio nodes are
  short-lived by design and garbage-collected after their envelopes end.
- The simulation clamps `dt`, so background-tab pauses cannot teleport
  the animatronics (the game also auto-pauses when the tab is hidden).

## License

MIT — see [LICENSE](LICENSE). All code, characters, artwork and audio
are original to this project.
