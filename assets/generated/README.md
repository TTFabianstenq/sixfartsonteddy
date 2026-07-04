# assets/generated

This directory is intentionally (almost) empty.

Every visual asset in Night Shift at Teddy's Toyworks — the office, the
six camera rooms, all four animatronic characters, their door
silhouettes and jumpscare faces, the static/noise pool, the vignette and
every UI element — is generated procedurally at runtime with the Canvas
API. See:

- `js/office.js` — office scene, doors, control panels, desk props
- `js/camera.js` — the six room scenes and the floor-plan map
- `js/animatronic.js` — all character artwork (room poses, silhouettes,
  jumpscare faces)
- `js/effects.js` — the pre-rendered noise frame pool, glitch and
  vignette effects

No image files are downloaded or bundled, which keeps the deploy tiny
and the game fully self-contained. This folder is reserved for any
pre-rendered assets a fork might want to add; the game does not read
from it.
