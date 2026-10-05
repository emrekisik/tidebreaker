# ASSETS.md

Every third-party asset (model, texture, sound, font) must be listed here before it is committed.
Only CC0 or commercially usable licenses. Never use Starblast assets, names or UI.

| Asset | Source / URL | Author | License | Used in | Notes |
|---|---|---|---|---|---|
| Low-poly ship pack: `assault_boat`, `battleship`, `cruiser`, `frigate1`, `frigate2`, `hovercraft`, `landing_craft`, `submarine` (+ `aircraft_carrier`, unused) | purchased by the project owner; seller/URL **TODO** | **TODO** | "Creative Commons", exact variant **TODO** (BY / BY-SA / NC / ND?) | `assault_boat` = player ship (T1); the others are `?ship=` previews | Turrets separated in Blender by the project owner. Processed by `pnpm assets:build`. **Do not commit** `models/` or `apps/client/public/models/` until the license is confirmed (both are in `.gitignore`). A `-ND` license would forbid the processing step. |

## Model pipeline

- Source GLBs live in `models/` (local only). `pnpm assets:build` writes optimized copies to `apps/client/public/models/`.
- `apps/client/src/render/modelSpecs.ts` describes each model (hull node, bow direction, length, waterline, aimable turret nodes).
- If a GLB is missing or fails to load, the client falls back to the procedural placeholder.
