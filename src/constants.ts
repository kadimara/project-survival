import type { ItemType, TileType, ZoomLevel } from './types/types';

export const TILE = 16;
export const MAP_W = 100;
export const MAP_H = 80;
export const SPAWN_X = Math.floor(MAP_W / 2);
export const SPAWN_Y = Math.floor(MAP_H / 2);
export const INITIAL_SEED = 393845991;

export const BASE_MOVE_DUR = 240;

// vpw × vph tiles visible at each zoom level — kept square (vpw === vph) so
// the on-screen canvas is always a square that can be fit to the viewport
export const ZOOM_LEVELS: ZoomLevel[] = [
  { vpw: 16, vph: 16 }, // zoomed in
  { vpw: 21, vph: 21 }, // default
  { vpw: 32, vph: 32 }, // zoomed out
  { vpw: 64, vph: 64 }, // far
];
export const DEFAULT_ZOOM_INDEX = 1;

export const WORLD_TILE = 4;
export const INITIAL_ENERGY_SEED_COUNT = 100;

// ---- tile defs: the grid layer (solid, atlas-baked). pickable is checked
// by doPickup — every current tile is pickable, but the flag exists so a
// future non-pickable solid type (e.g. a boundary wall) has somewhere to
// say so. allowGroundItem marks whether the ground-item layer can also be
// occupied at the tile's cell (soil does, so a ground item — a planted
// crop — can sit on top of it; stone/ore don't) ----
export const TILE_DEFS: Record<
  TileType,
  {
    solid: boolean;
    pickable: boolean;
    allowGroundItem: boolean;
    colors: { primary: string; secondary: string };
  }
> = {
  stone: {
    solid: true,
    pickable: true,
    allowGroundItem: false,
    colors: { primary: '#8a8478', secondary: '#5e594e' },
  },
  soil: {
    solid: true,
    pickable: true,
    allowGroundItem: true,
    colors: { primary: '#6b4a30', secondary: '#43301f' },
  },
  // built by combining two stone tiles (see combine.ts) — not part of
  // procedural generation. allowGroundItem lets any item be dumped
  // straight onto it, same as soil (see systems/smelting.ts)
  furnace: {
    solid: true,
    pickable: true,
    allowGroundItem: true,
    colors: { primary: '#c65a2e', secondary: '#5a2c17' },
  },
};

// ---- item defs: the ground layer (loose, drawn per-frame, walkable) ----
export const ITEM_DEFS: Record<
  ItemType,
  { colors: { primary: string; secondary: string } }
> = {
  energy: {
    colors: { primary: '#e8c44f', secondary: '#a8862f' },
  },
  // same colors as energy on purpose — a planted seed and the energy it
  // grows are distinguished by render shape (scattered dots vs a solid
  // square, see render.ts), not by color
  energySeed: {
    colors: { primary: '#e8c44f', secondary: '#a8862f' },
  },
  // ore and the ingot it smelts into share colors on purpose, same as
  // energy/energySeed above
  ore: {
    colors: { primary: '#57c2c9', secondary: '#2f6a6e' },
  },
  ingot: {
    colors: { primary: '#57c2c9', secondary: '#2f6a6e' },
  },
};

// ---- soil farming: an energySeed planted on soil spawns an energy item on
// the same cell after ENERGY_SEED_GROW_MS (if the cell doesn't already have
// one); harvesting that energy restarts the seed's timer, so a seed keeps
// producing renewably as long as it's kept picked (systems/farming.ts) ----
export const ENERGY_SEED_GROW_MS = 10000;

// ---- furnace: ore placed on a furnace tile becomes an ingot after
// ORE_SMELT_MS; any other item placed there melts away after ITEM_MELT_MS
// unless it survives (see FURNACE_SURVIVORS in systems/smelting.ts). The
// player can pick the original item back up any time before its timer
// fires, canceling the job. ----
export const ORE_SMELT_MS = 5000;
export const ITEM_MELT_MS = 2000;

// looks up the primary color for anything the player can carry, whichever
// def table (TILE_DEFS or ITEM_DEFS) it belongs to
export function carryColor(kind: TileType | ItemType): string {
  return kind in TILE_DEFS
    ? TILE_DEFS[kind as TileType].colors.primary
    : ITEM_DEFS[kind as ItemType].colors.primary;
}

// ---- player: fixed worker+soldier combined role — picks up/places
// obstacles and food, and attacks nearby enemies ----
export const PLAYER_COLOR = '#d99a3f';
export const PLAYER_EDGE = '#8f5f1f';
export const PLAYER_INSET = 2;
export const PLAYER_CARRY_MOVE_DUR = 300; // slower while hauling an obstacle/food item
export const PLAYER_MAX_HP = 100;
export const PLAYER_HIT_INVULN_MS = 500;
export const PLAYER_RESPAWN_INVULN_MS = 1200;
export const PLAYER_ATK_DAMAGE = 3;
export const PLAYER_ATK_COOLDOWN = 650;
// hp spent per tile the player steps onto, however the step was triggered
// (keyboard, click-to-move, or auto-pathing toward an attack target)
export const PLAYER_MOVE_HP_COST = 1;
// hp restored by using (eating) a held energy item, see useHeldItem in
// systems/player-actions.ts
export const ENERGY_HEAL_AMOUNT = 50;

// ---- roaming enemies: wander until they see you, then chase and attack ----
export const ENEMY_COUNT = 0;
export const ENEMY_MAX_HP = 10;
export const ENEMY_MOVE_DUR = 280;
export const ENEMY_ATK_DAMAGE = 2;
export const ENEMY_ATK_COOLDOWN = 900;
export const ENEMY_AGGRO_RADIUS = 5;
export const ENEMY_LOSE_AGGRO_MS = 4000;
export const ENEMY_WANDER_MIN_MS = 1200;
export const ENEMY_WANDER_MAX_MS = 3000;
export const ENEMY_WANDER_RADIUS = 4;
export const ENEMY_REPATH_MS = 500;
export const ENEMY_SPAWN_MIN_DIST = 10; // keep initial spawns away from the player's start
