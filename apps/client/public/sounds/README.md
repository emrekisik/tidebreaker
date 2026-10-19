# Replacing a sound with a file

Every sound of the game is synthesized (see `src/audio/recipes.ts`). To use a recorded sound instead, just put the
file in this folder and **name it after the sound id** (the table below, or the buttons of the sound test page
`/sounds.html` on the dev server):

- `cannon.ogg` replaces the cannon sound.
- `cannon_1.ogg`, `cannon_2.ogg`, ... are several takes of it: one is picked at random each time (this is what makes
  repeated shots sound real; 2-4 takes for the often-heard ones: `mg`, `cannon`, `hit_hull`, `splash`, `explosion`).
- `ambient_sea.ogg` and `engine.ogg` loop (the engine speeds up with the ship).

Then run `pnpm sounds` (also part of `pnpm dev`) to write `manifest.json`, and reload the game. Sounds without a
file stay synthesized. Files whose names match no sound are reported. For a quieter or higher file, edit
`manifest.json` by hand: `"cannon": { "files": ["cannon_1.ogg"], "gain": 0.7, "pitch": 1.1 }` (the script keeps
those extras).

Recorded effects can also be dropped into the repo-root `sfx/` folder and imported in one go with
`node tools/sounds/import.mjs` (it maps each source file to a sound id, cuts silence, converts to mono Vorbis, peaks at
-3 dB and rewrites `manifest.json` with the per-sound gain/pitch listed in that script). Edit its `MAP` to add files.

## What the files should be

- `.ogg` (or `.mp3`), mono is fine, 44.1 kHz, trimmed so the sound starts at once (no silence before it), peak around
  -3 dB. Short: effects under 2 s (a sinking ship may take 3 s), loops 30-60 s and seamless.
- Keep all of them small (design budget: 300 KB total); note each file's source and license in `ASSETS.md`.
- Check the license of every file (CC0 / public domain is the easiest; attribution licenses need a credit line).

## Sound ids

Group | id | what it is | suggested content
--- | --- | --- | ---
Weapons | `mg` | Machine gun shot | machine gun burst, one short shot (~0.1 s)
Weapons | `cannon` | Cannon shot | naval deck gun, deep boom with tail (~1 s)
Weapons | `rocket_launch` | Rocket launch | rocket whoosh launch (~1 s)
Weapons | `heavy_launch` | Cruiser heavy rocket launch | big heavy missile launch, long roar (~1.5 s)
Weapons | `missile_launch` | Guided missile launch | guided missile launch, hiss and whoosh
Weapons | `mine_lay` | Laying a mine | small splash/thunk of something dropped in water
Impacts | `hit_hull` | Shot hits a hull | bullet/shell hitting metal hull
Impacts | `hit_shield` | Shot hits a shield | energy shield hit / zap
Impacts | `hit_rock` | Shot hits land | hit on rock/land, dull
Impacts | `splash` | Shot falls into the water | shell falling in the water, splash
Impacts | `intercept` | Shot hits a missile or mine | metal ping/spark of a small hit
Impacts | `explosion` | Explosion (barrel, mine, rocket splash) | medium explosion (barrel, mine)
Impacts | `sink` | A ship goes down | big ship sinking: explosion, groaning metal, bubbles (~2 s)
Impacts | `bump` | Ships collide | two ships colliding, heavy metal thud
Impacts | `shore` | Ship scrapes the shore | hull scraping on a shore
Impacts | `drone_die` | A drone is shot down | small aircraft crash/explosion
Interface | `ui_click` | Click | soft UI click
Interface | `ui_deny` | Not allowed | "not allowed" buzz
Interface | `upgrade` | Upgrade bought | short positive upgrade chime
Interface | `buy` | Bought at the base shop | cash register / purchase chime
Interface | `pickup` | Money picked up | coin or banknote pickup
Interface | `kill_ping` | You scored a kill | bright kill-confirm ping
Interface | `tier_ready` | You can move up a class | soft "ready" bell
Interface | `tier_up` | Class up | short level-up fanfare
Interface | `emote` | Emote pop | soft pop
Interface | `lock_beep` | Lock-on beep | radar lock beep (very short)
Interface | `lock_done` | Lock-on complete | lock acquired tone (~0.5 s)
Interface | `missile_warning` | Missile incoming warning | incoming missile alarm beep
Game events | `rig_capture` | Your team takes a rig | positive capture jingle
Game events | `rig_lost` | Your team loses a rig | negative lost jingle
Game events | `repair` | Carrier repaired | wrench/repair clicks
Game events | `you_died` | Your ship went down | your ship destroyed, low sad hit
Game events | `spawn` | You (re)appear | rising shimmer, appearing
Game events | `win` | Your team wins | victory jingle (~1 s)
Game events | `lose` | Your team loses | defeat jingle (~1 s)
`ambient_sea` | Continuous | the sea, seamless loop (30-60 s) | very soft waves, no gulls or voices
`engine` | Continuous | own ship engine, seamless loop (speeds up with the ship) | low steady diesel/turbine hum
