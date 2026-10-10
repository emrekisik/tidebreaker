# CLAUDE.md — Tidebreaker.io (working title)

Desktop-browser multiplayer **.io naval combat game** (browser first, not mobile first; no touch or mobile quality tiers): 3D low-poly ships, instant join (type a name, press Play), authoritative Node server, three.js client. Think "Starblast.io at sea".

**Source of truth: `GAME_DESIGN.md` (written in Turkish).** Read the relevant sections before starting any phase. If code and the doc disagree, update the doc first (ask the user if the change is a design decision), then the code.

## Language conventions
- Code, identifiers, code comments, commit messages, and PR text: **English**.
- `GAME_DESIGN.md` and user-facing explanations to the user: **Turkish**.
- In-game strings live in `tr` / `en` JSON files, never hardcoded in components.

## Stack (do not swap without asking)
- TypeScript (strict, `noUncheckedIndexedAccess`) everywhere. pnpm workspaces monorepo.
- `packages/shared` (no Node/DOM APIs), `apps/server` (Node.js >= 22 + `ws` behind a `Transport` interface), `apps/client` (Vite + three.js, vanilla TS DOM UI, no UI framework in MVP), `tools/*`.
- Binary protocol with `DataView`, little-endian. **No JSON on the wire.**
- Tests: vitest, fast-check, Playwright (smoke). Pin the three.js version.

## Hard rules (architecture)
1. **Server is authoritative.** Clients send only input. Never trust any client-provided value; validate and clamp everything.
2. **Shared simulation code:** `shared/sim` functions (e.g. `stepShip`) are pure, deterministic, and used by both server and client prediction. No `Math.random()` or `Date.now()` inside; inject RNG/time.
3. **Fixed timestep** (`TICK_RATE`, default 20 Hz) on both sides. Client renders by interpolating between sim states.
4. **Zero allocation in hot paths** (`apps/server/src/sim/hot/**` and per-frame client code): no `.map/.filter/.forEach/.reduce/.concat/.slice`, no spread, no object/array literals, no closures, no `Map`/`Set` creation. Use object pools, typed arrays (struct-of-arrays), preallocated buffers, out-parameter math helpers. The ESLint rules for this must stay enabled.
5. **Projectiles are event-based:** server sends `PROJECTILE_SPAWN` / `PROJECTILE_END`; clients simulate the straight-line flight themselves. Never put projectiles in snapshots.
6. **Map is generated from a seed in `shared`.** The server sends only the seed. Keep the generation byte-for-byte deterministic (hash test required).
7. **No lag compensation / rewind.** Hit resolution is server-side at the current tick (slow projectiles by design). Use swept segment-circle tests to avoid tunneling.
8. **One room = one Node process.** No shared state between rooms. Admit new players only when `tickBusyEma < 0.65` and `players < MAX_PLAYERS`.
9. **Every tunable number lives in `packages/shared/src/config/`** (see Appendix A of the design doc). No magic numbers in gameplay code.
10. Changing the wire format requires bumping `PROTOCOL_VERSION` and updating codec tests.
11. Coordinates: sim is 2D `(x, y)`; three.js uses `(x, 0, y)`; heading θ goes from +x toward +y; model forward is +x; `mesh.rotation.y = -θ`.

## Security defaults
Bounds-checked binary reader (never throws or loops on bad input), per-connection token-bucket rate limit, name sanitization + blocklist, `Origin` allowlist, per-IP connection cap, `perMessageDeflate: false`, small `maxPayload`. See design doc §13.

## Performance budgets (verify, do not guess)
Initial load <= 2.5 MB (JS <= ~350 KB gz) · client >= 60 fps on a mid-range desktop browser · <= 120 draw calls · server tick p99 <= 8 ms at 50 players + 30 pirates + 1000 projectiles · <= 200 MB RAM per room · <= 4 KB/s downstream per player on average. Details in design doc §16.

## Workflow
- Work **phase by phase** (design doc §17). Before each phase: read the sections, write a short plan, get the user's confirmation, then implement. Do not start the next phase before the current phase's acceptance criteria pass.
- Small, meaningful commits (conventional style: `feat:`, `fix:`, `test:`, `docs:`, `perf:`). Never commit secrets or large binaries outside `assets-src/` and `public/models/`.
- Before finishing any task run: `pnpm typecheck && pnpm lint && pnpm test`. For net/sim changes also run the integration tests; for perf-sensitive changes run `pnpm bench`.
- Write tests with the code: codec round-trip, determinism, economy formulas, collision/tunneling, integration with headless `ws` clients.
- Prefer the simplest implementation that meets the budget, measure, then optimize. Profile server with `node --inspect`, client with Chrome DevTools.
- If a decision is listed in design doc §19 (open questions), do not silently change the assumption; ask the user.
- Gameplay "feel" and balance cannot be verified by you. After implementing, tell the user exactly what to playtest and which config values to tweak.
- Keep `ASSETS.md` up to date for every third-party asset (source, license, author, URL). Never use Starblast assets, names, or UI.

## Commands (create these in Phase 0)
```
pnpm dev          # server + client + 10 test bots (5 per team) with hot reload
pnpm dev:solo     # the same without bots
pnpm bots         # fill a running server with bots (pnpm bots --per-team 3)
pnpm build        # production build (client bundle size check included)
pnpm test         # vitest (unit, property, integration)
pnpm bench        # server tick cost with a full room (hot-path benchmark)
pnpm lint         # eslint (including hot-path rules)
pnpm typecheck    # tsc --noEmit across the workspace
pnpm loadtest     # N fake clients against a local room, prints tick p99 / bandwidth
pnpm netem        # WS proxy adding latency / jitter / stalls (then open the game with ?server=ws://localhost:9002)
pnpm bot          # one bot that joins a running server (pnpm bot --name X --ship corvette [--passive])
pnpm balance-sim  # combat balance tables (time to sink each class pair and the carrier); economy pacing joins in Phase 4
pnpm assets:build # optimize GLB models (gltf-transform)
pnpm e2e          # Playwright smoke test
```

## Definition of done (any task)
Types and lint clean · tests added and green · budgets not regressed · design doc updated if behavior or numbers changed · no new hot-path allocations · committed.
