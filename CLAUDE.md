# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser-based top-down survival game with a Dune-like desert setting: a single player character explores an open, procedurally generated desert dotted with scattered boulder formations, digs up and relocates the rock/resources within them, forages food, and establishes a base — informally, wherever the player spends the most time and accumulates the most crafted tiles/items, not (yet) a dedicated placement mechanic. Desert scavenger enemies roam the wastes looking to steal food and will fight the player if it comes to that. Rendered on an HTML canvas at a fixed tile size, panned/zoomed around the player. There is no framework (React was removed) — this is plain TypeScript + Vite + Canvas 2D.

## Commands

- `npm run dev` — start the Vite dev server
- `npm run build` — typecheck (`tsc -b`) then production-build with Vite; run this to catch type errors across the whole project
- `npm run lint` — ESLint (flat config, `eslint.config.js`)
- `npm run format` — Prettier, writes in place
- `npm run preview` — serve the production build locally
- `npm test` — run the Vitest unit suite (`vitest run`)

Tests are colocated `*.test.ts` files next to the module they cover (e.g. `src/systems/combat.test.ts`); shared `GameState`/`HudRefs` test fixtures live in `src/test/fixtures.ts`. Coverage currently targets the pure-logic modules — `systems/` (`pathfinding`, `combine`, `farming`, `smelting`, `cooking`, `fishing`, `combat`, `ai`, `player-actions`, `ticker`), plus `entities/entities.ts` and `worldgen/worldgen.ts` — rendering, DOM, and `game.ts`'s orchestration are untested by design, not oversight. `prepare`/husky + lint-staged run Prettier on staged files at commit time.

**When implementing a feature or bug fix that touches a pure-logic module** (anything shaped like `(state, ...) -> mutation`, currently the `systems/` modules listed above plus any new ones with the same shape), add or update its `*.test.ts` file in the same change — new exported functions and new branches in existing ones should land with tests, not as a follow-up. Reuse `src/test/fixtures.ts` rather than hand-rolling a new `GameState`/`HudRefs` fixture per file. Changes confined to `render/`, `ui/`, or `game.ts`'s DOM/canvas wiring don't need tests under this suite.

## Architecture

`GameState` (defined in `src/types/types.ts`) is a single mutable object holding all simulation state — map/stone, food items, enemies, the player, floating combat text, camera/zoom/UI flags. Every module takes `state` as an explicit parameter instead of closing over module-level variables, so dependencies between files are visible from imports alone. `src/game.ts` is the only place that owns a `GameState` instance; everything else is a pure function of `(state, ...)` in, mutation out.

Module layout, roughly bottom-up:

- **`worldgen/worldgen.ts`** — seeded procedural desert generation (`mulberry32` PRNG, `buildMap`/`buildStones`). A numeric seed fully determines the world, so it can be typed in or shared to regenerate the same desert (`regenerateWorld` in `state/state.ts` rebuilds everything in place, no page reload).
- **`state/state.ts`** — `GameState` lifecycle (`createGameState`, `regenerateWorld`) plus terrain/occupancy queries (`isSolid`, `isWater`, `walkable`, `obstacleAt`, `floorAt`, `itemAt`, `occupantAt`, `isEnemyAt`, `isPlayerAt`, `randomOpenTile`, `placeItemNear`, etc.). This is the shared query layer nearly every other module reads from. The world model splits into three layers, bottom to top: `state.floor` (a `Map<string, FloorType>` — walkable ground material an obstacle or item can sit on top of; currently just `dirt`, placed under the oasis's vegetation), `state.obstacles` (a `Map<string, ObstacleType>` — solid, grid-level, baked into the ground atlas; e.g. stone/wood), and `state.items` (a `Map<string, Item>` — loose, walkable, drawn per-frame; e.g. energy/ore). `FLOOR_DEFS`/`OBSTACLE_DEFS`/`ITEM_DEFS` in `constants.ts` hold the per-type config (pickable/colors, solid where applicable) for each layer respectively. The oasis's water is a separate concept from all three layers — a background tile value (`state.map[y][x] === OASIS`, see `worldgen.ts`), checked via `isWater` rather than the floor/obstacle/item queries above.
- **`state/persistence.ts`** — save/load of `GameState` to `localStorage` (`loadGame`/`saveGame`), including an autosave wired in from `game.ts`, so a reload resumes the same world/player/inventory instead of regenerating.
- **`entities/entities.ts`** — entity factories (`makeEnemy`/`spawnEnemies`) and the generic tile-to-tile movement/animation primitives (`startStep`, `updateActorAnimation`, `dirBetween`) shared by the player and enemies. Imports from `state/state.ts` one-way only (no cycle: enemy spawning is injected into `createGameState`/`regenerateWorld` as a callback instead of `state.ts` importing this file).
- **`systems/`** — game logic:
  - `ticker.ts`: a fixed-timestep tick clock (`createTickClock`, `drainTicks`, `TICK_MS = 250`) that decouples simulation from the render framerate. `game.ts`'s `simulateTick` runs on ticks, and movement/attack/AI cooldowns are counted in ticks (`state.tick`) rather than wall-clock time.
  - `player-actions.ts`: movement, click-to-pickup/place obstacles and food, click-to-attack an enemy. All player behavior lives here; `input/player-input.ts` only tracks which keys are currently held.
  - `ai.ts`: enemy AI — wander until the player is sighted (line-of-sight + aggro radius), then chase and attack.
  - `combat.ts`: shared damage/death resolution (player and enemies, including dropping food on death and respawning the player), plus tree-felling, cactus destruction, and the ranged-weapon projectile system (`fireProjectile`/`updateProjectiles`).
  - `pathfinding.ts`: generic 4-directional BFS (`findPath`, `bfsToAdjacent`) and line-of-sight, parameterized by a `walkable`/`isSolid` callback so it has no game-state coupling.
  - `combine.ts`, `farming.ts`, `smelting.ts`, `cooking.ts`, `fishing.ts`: the crafting/production systems. `combine.ts` holds a static recipe table resolving "place a held item onto an occupied cell" (e.g. wood+stone→campfire, ingot+ingot→sword, reed+rope→fishingRod); `farming.ts` regrows berries on berry-bush obstacles standing on `soil` floor; `smelting.ts` and `cooking.ts` run timed jobs on furnace/campfire obstacles respectively (ore/sword→ingot in the furnace, rawMeat→meat/rawFish→fish and meat/fish/wood→coal in the campfire), tracked in `state.smelters`/`state.campfireJobs`; `fishing.ts` runs a timed job on any oasis water tile (no obstacle involved) started by clicking a held `fishingRod` there — the rod is a tool, never consumed — tracked in `state.fishingJobs` and always resolving to a `rawFish` item.
- **`render/`** — presentation only, no game logic:
  - `render.ts`: the main per-frame draw (`render`) plus the world-map overview (`renderWorldMap`), reading `GameState` and calling into `rendering.ts`'s primitives.
  - `rendering.ts`: low-level canvas drawing functions (tiles, entity squares, HP bars) that take only primitive values, not `GameState`.
  - `ground-atlas.ts`: pre-renders the static terrain to an offscreen canvas so the per-frame draw is just a `drawImage` blit plus dynamic entities/effects on top.
  - `camera.ts`: viewport/zoom math and screen↔tile coordinate conversion.
- **`ui/hud.ts`** — DOM stat bar, toast messages, and the world-map overlay open/close. Pure DOM manipulation (`document.getElementById` via a `byId` helper); never touches game logic directly — `game.ts` injects callbacks where the two need to meet.
- **`game.ts`** — the orchestrator: builds `GameRefs`/`GameState`, wires every DOM event listener (click, keydown, wheel, resize), and runs the `requestAnimationFrame` tick loop. This is the file to read first to see how everything connects.
- **`main.ts`** — entry point, just calls `initColonyGame()`.

`index.html` contains the game's entire DOM structure as static markup (canvas, HUD stat bar, world-map overlay, zoom controls) — there's no templating layer; `hud.ts` looks up fixed element IDs and `game.ts` mutates them directly.

### Notes for future changes

- `PLAYER_*` constants in `constants.ts` (color, move duration, attack damage/cooldown, HP cost per move/attack, water-tile move speed, etc.) are the single place player tuning lives — prefer adding there over hardcoding values in `player-actions.ts`/`render.ts`.
- `WEAPON_DEFS` (`constants.ts`) holds the two player weapons: `sword` (melee) and `bow` (ranged, fires a projectile resolved by `combat.ts`'s `fireProjectile`/`updateProjectiles`). Weapons are crafted via `combine.ts`'s recipes, not found in the world.
- `README.md` gives a human-facing overview and quickstart; this file is the fuller reference for architecture and conventions — keep both in sync when a change touches module layout or commands.
- The desert/boulder-formation framing above describes intent as much as implementation, so don't assume more exists than does:
  - `worldgen.ts`'s noise-thresholded stone clusters (already commented in-code as "boulder-cluster structures") already are the boulder formations conceptually — this doesn't need a generator rewrite, just future palette/threshold tuning to look and feel more desert-like.
  - The player's "base" is an emergent idea only — wherever the player concentrates activity and crafted tiles — not a coded mechanic. There is no placement/building system; don't assume one exists when reading the code.
  - Enemies now come in three types, defined in `ENEMY_DEFS` (`constants.ts`, mirrors `WEAPON_DEFS`'s per-variant-table shape — a new enemy type is a data addition, not a rearchitecture): `jerboa`, a skittish scavenger (`JERBOA_COUNT` of them) that roams the whole map, senses and steals loose food, flees on sight rather than fighting, and eats what it stole once safely away to heal; `boulderGuardian`, which spawns tied to boulder-cluster structures (`planGuardianClusters`/`findClusterBorderTiles` in `worldgen.ts`, placement tuned by the `GUARDIAN_*` constants) and chases/attacks the player within a leash of its home tile rather than roaming; and `fish` (`FISH_COUNT` of them), confined to the oasis's water and flees on sight like a jerboa but never forages and is never a valid attack target at all — see `game.ts`'s `handleClick`, which excludes `type === 'fish'` from the click-to-attack lookup, and `simulateTick`, which is the only place its water-boundedness is enforced (a water-filtered `walkable` is passed to `updateEnemy` only for this type; `ai.ts` itself needs no changes). A fish is ambient oasis wildlife, not something to fight — the only source of `rawFish` is the `fishingRod`'s timed catch (see `systems/fishing.ts`), not combat. `systems/ai.ts`'s `updateEnemy` holds the wander/chase/attack/flee/forage state machine all three types share.
