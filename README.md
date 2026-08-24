# Project Survival

A browser-based top-down survival game with a Dune-like desert setting. A single player character explores an open, procedurally generated desert dotted with scattered boulder formations, digs up and relocates the rock/resources within them, forages food, crafts tools and structures, and survives against desert scavenger enemies. Rendered on an HTML canvas at a fixed tile size, panned/zoomed around the player.

No framework — plain TypeScript + Vite + Canvas 2D.

## Getting started

```
npm install
npm run dev
```

Then open the printed local URL in a browser.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Typecheck (`tsc -b`) then production-build with Vite |
| `npm run lint` | ESLint |
| `npm run format` | Prettier, writes in place |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run the Vitest unit suite |

## Architecture

`src/game.ts` orchestrates a single mutable `GameState` (world/floor/obstacle/item layers, enemies, the player) on a fixed-timestep tick loop, with world generation, game logic (`systems/`), and rendering (`render/`) kept as separate, mostly pure modules. See `CLAUDE.md` for the full module-by-module breakdown and conventions for contributing.
