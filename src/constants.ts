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
export const INITIAL_FOOD_COUNT = 100;

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
  ore: {
    solid: true,
    pickable: true,
    allowGroundItem: false,
    colors: { primary: '#57c2c9', secondary: '#2f6a6e' },
  },
  soil: {
    solid: true,
    pickable: true,
    allowGroundItem: true,
    colors: { primary: '#6b4a30', secondary: '#43301f' },
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
};

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
export const PLAYER_MAX_HP = 20;
export const PLAYER_HIT_INVULN_MS = 500;
export const PLAYER_RESPAWN_INVULN_MS = 1200;
export const PLAYER_ATK_DAMAGE = 3;
export const PLAYER_ATK_COOLDOWN = 650;

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
