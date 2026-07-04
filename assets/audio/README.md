# assets/audio

This directory is intentionally (almost) empty.

Every sound in Six Farts On Teddy is synthesized at runtime
with the Web Audio API — oscillators, filtered noise buffers and gain
envelopes. That includes:

- room-tone ambience and the generator drone
- door servos, slams, knocks and Sprocket's full-speed door bang
- light-switch clicks and fluorescent hum
- camera raise/lower clacks, feed-switch static and the monitor hiss
- footsteps, sprint steps, Hollow's hoot, Teddy's chuckle, the wind-up
  ratchet
- the power-outage spiral, the original music-box lullaby, the jumpscare
  stinger, the hour bell and the 6 AM victory chime

See `js/audio.js` for all of it. No audio files are downloaded or
bundled. This folder is reserved for any recorded audio a fork might
want to add; the game does not read from it.
