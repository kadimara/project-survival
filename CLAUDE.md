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

Tests are colocated `*.test.ts` files next to the module they cover (e.g. `src/systems/combat.test.ts`); shared `GameState`/`HudRefs` test fixtures live in `src/test/fixtures.ts`. Coverage currently targets the pure-logic `systems/` modules (`pathfinding`, `combine`, `farming`, `smelting`, `combat`) — rendering, DOM, and `game.ts`'s orchestration are untested by design, not oversight. `prepare`/husky + lint-staged run Prettier on staged files at commit time.

**When implementing a feature or bug fix that touches a pure-logic module** (anything shaped like `(state, ...) -> mutation`, currently the `systems/` modules listed above plus any new ones with the same shape), add or update its `*.test.ts` file in the same change — new exported functions and new branches in existing ones should land with tests, not as a follow-up. Reuse `src/test/fixtures.ts` rather than hand-rolling a new `GameState`/`HudRefs` fixture per file. Changes confined to `render/`, `ui/`, or `game.ts`'s DOM/canvas wiring don't need tests under this suite.

## Architecture

`GameState` (defined in `src/types/types.ts`) is a single mutable object holding all simulation state — map/stone, food items, enemies, the player, floating combat text, camera/zoom/UI flags. Every module takes `state` as an explicit parameter instead of closing over module-level variables, so dependencies between files are visible from imports alone. `src/game.ts` is the only place that owns a `GameState` instance; everything else is a pure function of `(state, ...)` in, mutation out.

Module layout, roughly bottom-up:

- **`worldgen/worldgen.ts`** — seeded procedural desert generation (`mulberry32` PRNG, `buildMap`/`buildStones`). A numeric seed fully determines the world, so it can be typed in or shared to regenerate the same desert (`regenerateWorld` in `state/state.ts` rebuilds everything in place, no page reload).
- **`state/state.ts`** — `GameState` lifecycle (`createGameState`, `regenerateWorld`) plus terrain/occupancy queries (`isSolid`, `walkable`, `tileAt`, `groundItemAt`, `occupantAt`, `isEnemyAt`, `isPlayerAt`, `randomOpenTile`, `placeGroundItemNear`, etc.). This is the shared query layer nearly every other module reads from. The world model splits into two layers: `state.tiles` (a `Map<string, TileType>` — solid, grid-level, baked into the ground atlas; e.g. stone/ore) and `state.groundItems` (a `Map<string, GroundItem>` — loose, walkable, drawn per-frame; currently just energy). `TILE_DEFS`/`ITEM_DEFS` in `constants.ts` hold the per-type config (solid/pickable/colors) for each layer respectively.
- **`entities/entities.ts`** — entity factories (`makeEnemy`/`spawnEnemies`) and the generic tile-to-tile movement/animation primitives (`startStep`, `updateActorAnimation`, `dirBetween`) shared by the player and enemies. Imports from `state/state.ts` one-way only (no cycle: enemy spawning is injected into `createGameState`/`regenerateWorld` as a callback instead of `state.ts` importing this file).
- **`systems/`** — game logic:
  - `player-actions.ts`: movement, click-to-pickup/place obstacles and food, click-to-attack an enemy. All player behavior lives here; `input/player-input.ts` only tracks which keys are currently held.
  - `ai.ts`: enemy AI — wander until the player is sighted (line-of-sight + aggro radius), then chase and attack.
  - `combat.ts`: shared damage/death resolution (player and enemies), including dropping food on death and respawning the player.
  - `pathfinding.ts`: generic 4-directional BFS (`findPath`, `bfsToAdjacent`) and line-of-sight, parameterized by a `walkable`/`isSolid` callback so it has no game-state coupling.
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

- The game previously had an ant-colony layer (player castes, NPC colonists, a nest, scent-trail navigation) that was removed in favor of a single fixed player role fighting/surviving alone against enemies. If you see stray references to "caste," "colonist," "nest," or "scent" anywhere, they're leftover and should be cleaned up, not extended.
- `PLAYER_*` constants in `constants.ts` (color, move duration, attack damage/cooldown, etc.) are the single place player tuning lives — prefer adding there over hardcoding values in `player-actions.ts`/`render.ts`.
- `README.md` is still the unmodified Vite React template boilerplate from before the framework was removed — it's stale and not a reliable source of truth for this repo.
- The desert/boulder-formation framing above describes intent as much as implementation, so don't assume more exists than does:
  - `worldgen.ts`'s noise-thresholded stone clusters (already commented in-code as "boulder-cluster structures") already are the boulder formations conceptually — this doesn't need a generator rewrite, just future palette/threshold tuning to look and feel more desert-like.
  - The player's "base" is an emergent idea only — wherever the player concentrates activity and crafted tiles — not a coded mechanic. There is no placement/building system; don't assume one exists when reading the code.
  - Enemies are meant to be reframed as scavengers that prioritize stealing food and only fight the player if it comes to that. `systems/ai.ts`'s wander/chase/attack logic is the substrate this would build on, but today `ENEMY_COUNT` is 0 (no scavengers spawn by default) and there's no food-stealing behavior yet.
