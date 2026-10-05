# ASSETS.md

Every third-party asset (model, texture, sound, font) must be listed here before it is committed.
Only CC0 or commercially usable licenses. Never use Starblast assets, names or UI.

| Asset | Source / URL | Author | License | Used in | Notes |
|---|---|---|---|---|---|
| Low-poly ship pack: `assault_boat`, `battleship`, `cruiser`, `frigate1`, `frigate2`, `hovercraft`, `landing_craft`, `submarine` (+ `aircraft_carrier`, unused) | purchased by the project owner; seller/URL **TODO** | **TODO** | Seller's "Royalty Free License": personal/educational/commercial use allowed; **no resale, redistribution or repackaging of the purchased product** without the creator's permission; not usable in a logo/watermark/trademark | all ship models; `assault_boat` = T1 player ship | Turrets separated in Blender by the project owner. Processed by `pnpm assets:build`. **Never commit the raw `models/` GLBs** (public repo = redistribution); `apps/client/public/models/` is also git-ignored. Open question: shipping optimized copies inside the deployed game (browser-downloadable) should be confirmed with the seller before launch. |

## Model pipeline

- Source GLBs live in `models/` (local only). `pnpm assets:build` writes optimized copies to `apps/client/public/models/`.
- `apps/client/src/render/modelSpecs.ts` describes each model (hull node, bow direction, length, waterline, aimable turret nodes).
- If a GLB is missing or fails to load, the client falls back to the procedural placeholder.
