# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A browser-based top-down survival game: a single player character explores a procedurally generated cave, digs up and relocates obstacles, forages food, and fights off roaming enemies. Rendered on an HTML canvas at a fixed tile size, panned/zoomed around the player. There is no framework (React was removed) — this is plain TypeScript + Vite + Canvas 2D.

## Commands

- `npm run dev` — start the Vite dev server
- `npm run build` — typecheck (`tsc -b`) then production-build with Vite; run this to catch type errors across the whole project
- `npm run lint` — ESLint (flat config, `eslint.config.js`)
- `npm run format` — Prettier, writes in place
- `npm run preview` — serve the production build locally

There is no test suite in this repo. `prepare`/husky + lint-staged run Prettier on staged files at commit time.

## Architecture

`GameState` (defined in `src/types/types.ts`) is a single mutable object holding all simulation state — map/stone, food items, enemies, the player, floating combat text, camera/zoom/UI flags. Every module takes `state` as an explicit parameter instead of closing over module-level variables, so dependencies between files are visible from imports alone. `src/game.ts` is the only place that owns a `GameState` instance; everything else is a pure function of `(state, ...)` in, mutation out.

Module layout, roughly bottom-up:

- **`worldgen/worldgen.ts`** — seeded procedural cave generation (`mulberry32` PRNG, `buildMap`/`buildStones`). A numeric seed fully determines the world, so it can be typed in or shared to regenerate the same cave (`regenerateWorld` in `state/state.ts` rebuilds everything in place, no page reload).
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
