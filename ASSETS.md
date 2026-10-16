# ASSETS.md

Every third-party asset (model, texture, sound, font) must be listed here before it is committed.
Only CC0 or commercially usable licenses. Never use Starblast assets, names or UI.

| Asset | Source / URL | Author | License | Used in | Notes |
|---|---|---|---|---|---|
| Low-poly ship pack: `assault_boat`, `battleship`, `cruiser`, `frigate1`, `frigate2`, `hovercraft`, `landing_craft`, `submarine` (+ `aircraft_carrier`, unused) | purchased by the project owner; seller/URL **TODO** | **TODO** | Seller's "Royalty Free License": personal/educational/commercial use allowed; **no resale, redistribution or repackaging of the purchased product** without the creator's permission; not usable in a logo/watermark/trademark | all ship models; `assault_boat` = T1 player ship | Turrets separated in Blender by the project owner. Processed by `pnpm assets:build`. **Never commit the raw `models/` GLBs** (public repo = redistribution); `apps/client/public/models/` is also git-ignored. Open question: shipping optimized copies inside the deployed game (browser-downloadable) should be confirmed with the seller before launch. |
| Pirate ship: `pirate_ship` | AI-generated model supplied by the project owner (Tripo-style export); generator, terms and URL **TODO** | **TODO** | **TODO** (check the generator's terms for commercial use) | the three pirate classes (one model at three sizes) | 4096 px texture, shrunk to 1024 px by `pnpm assets:build`. Raw GLB is local only (`models/`). |
| Pickups and drones: `red_oil_barrel`, `wooden_create_loot`, `pirate_golden_treasure_chest`, `money_model`, `fpv_drone`, `combat_drone` | AI-generated models supplied by the project owner (same kind as the pirate ship); generator, terms and URL **TODO** | **TODO** | **TODO** (check the generator's terms for commercial use) | explosive barrels, crates, treasure chests (also the pirate loot), banknote piles, the two drone types | 512 px textures; `pnpm assets:build` cuts them to ~1.5-4k triangles (they are drawn many times). Raw GLBs are local only (`models/`). |
| Oil rig: `oil_rig` | same as above, **TODO** | **TODO** | **TODO** | the three capture rigs | same processing. |
| Islands: `island_tropical`, `island_rocky` | same as above, **TODO** | **TODO** | **TODO** | every island of the map (bent onto the collision outline at load time, `render/islands.ts`) | same processing; `pnpm assets:footprint` measures the coast outline of each (`render/islandFootprints.ts`, generated). |
| Font: Oxanium (500, 700; latin, latin-ext) | npm `@fontsource/oxanium` (Oxanium by Severin Meyer) | Severin Meyer | SIL Open Font License 1.1 | all UI text (bundled with the client) | |
| UI icons: `apps/client/src/ui/icons/*.svg` (shield, ammunition, damage, speed, agility, repair, cash) | supplied by the project owner; source and license **TODO** | **TODO** | **TODO** | upgrade tiles, money | |
| Class cards: `apps/client/public/icons/ships/card/*.png` (top-down ship pictures) | supplied by the project owner; source and license **TODO** | **TODO** | **TODO** | the "class upgrade" card | Originals in the repo root folder `ship-topdown/` (not committed). |

## Model pipeline

- Source GLBs live in `models/` (local only). `pnpm assets:build` writes optimized copies to `apps/client/public/models/`.
- `apps/client/src/render/modelSpecs.ts` describes each model (hull node, bow direction, length, waterline, aimable turret nodes).
- Generated models (pirate ship, oil rig, islands) keep real textures (1024 px) and are renamed to their file name by the build; ships take team paint, these do not. Islands are bent to the map outline at load time (`render/islands.ts`); run `pnpm assets:footprint` after changing an island model.
- Ship icons (`apps/client/public/icons/ships/{up,side}/{blue,red,white}/<ship>.png`, generated, committed): top-down renders of the ship models. `up` = 128x128 with the bow up, `side` = 128x64 with the bow to the right, `white` = flat silhouette for tinting. Regenerate with `pnpm icons` and open `/ship-icons.html` on the dev server (`apps/client/src/dev/shipIcons.ts`). The scoreboard uses them.
- If a GLB is missing or fails to load, the client falls back to the procedural placeholder.
