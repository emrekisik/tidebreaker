# ASSETS.md

Every third-party asset (model, texture, sound, font) must be listed here before it is committed.
Only CC0 or commercially usable licenses. Never use Starblast assets, names or UI.

| Asset | Source / URL | Author | License | Used in | Notes |
|---|---|---|---|---|---|
| Low-poly ship pack: `assault_boat`, `battleship`, `cruiser`, `frigate1`, `frigate2`, `hovercraft`, `landing_craft`, `submarine` (+ `aircraft_carrier`, unused) | purchased by the project owner; seller/URL **TODO** | **TODO** | Seller's "Royalty Free License": personal/educational/commercial use allowed; **no resale, redistribution or repackaging of the purchased product** without the creator's permission; not usable in a logo/watermark/trademark | all ship models; `assault_boat` = T1 player ship | Turrets separated in Blender by the project owner. Processed by `pnpm assets:build`. **Never commit the raw `models/` GLBs** (public repo = redistribution); `apps/client/public/models/` is also git-ignored. Open question: shipping optimized copies inside the deployed game (browser-downloadable) should be confirmed with the seller before launch. |
| Pirate ship: `pirate_ship` | AI-generated model supplied by the project owner (Tripo-style export); generator, terms and URL **TODO** | **TODO** | **TODO** (check the generator's terms for commercial use) | the three pirate classes (one model at three sizes) | 4096 px texture, shrunk to 1024 px by `pnpm assets:build`. Raw GLB is local only (`models/`). |
| Oil rig: `oil_rig` | same as above, **TODO** | **TODO** | **TODO** | the three capture rigs | same processing. |
| Islands: `island_tropical`, `island_rocky` | same as above, **TODO** | **TODO** | **TODO** | every island of the map (bent onto the collision outline at load time, `render/islands.ts`) | same processing; `pnpm assets:footprint` measures the coast outline of each (`render/islandFootprints.ts`, generated). |

## Model pipeline

- Source GLBs live in `models/` (local only). `pnpm assets:build` writes optimized copies to `apps/client/public/models/`.
- `apps/client/src/render/modelSpecs.ts` describes each model (hull node, bow direction, length, waterline, aimable turret nodes).
- Generated models (pirate ship, oil rig, islands) keep real textures (1024 px) and are renamed to their file name by the build; ships take team paint, these do not. Islands are bent to the map outline at load time (`render/islands.ts`); run `pnpm assets:footprint` after changing an island model.
- If a GLB is missing or fails to load, the client falls back to the procedural placeholder.
