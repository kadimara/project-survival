import type { CarryType, ItemType, TileType, ZoomLevel } from './types/types';

export const TILE = 16;
export const MAP_W = 240;
export const MAP_H = 240;
export const SPAWN_X = Math.floor(MAP_W / 2);
export const SPAWN_Y = Math.floor(MAP_H / 2);
export const INITIAL_SEED = 393845991;

// length of one simulation tick — OSRS-style: movement, attacks, and AI
// decisions all resolve on this cadence instead of continuously (see
// game.ts's frame/simulateTick split)
export const TICK_MS = 250;

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
  // a diggable obstacle like stone/soil, not yet consumed by any recipe —
  // seeded near spawn (see buildTiles in state/state.ts) so it's
  // visible/testable ahead of the combine recipe that will use it (a
  // spear or similar, held alongside ingot)
  wood: {
    solid: true,
    pickable: true,
    allowGroundItem: false,
    colors: { primary: '#a9773f', secondary: '#6b4c22' },
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
  // crafted from ingot + ingot (see systems/combine.ts) — see WEAPON_DEFS
  // below for how holding it changes the player's attack. Shares colors
  // with ore/ingot on purpose (same lineage: ore -> ingot -> sword), same
  // idea as energy/energySeed above; drawn with its own blade-shaped icon
  // rather than the generic item square (see drawSwordIcon in rendering.ts)
  sword: {
    colors: { primary: '#57c2c9', secondary: '#2f6a6e' },
  },
  // crafted from wood + ingot (see RECIPES in systems/combine.ts) — see
  // WEAPON_DEFS below for its ranged attack stats. Shares wood's colors
  // (see TILE_DEFS.wood above) rather than ingot's, since the shaft/limb is
  // what reads visually, not the arrowhead
  bow: {
    colors: { primary: '#a9773f', secondary: '#6b4c22' },
  },
};

// ---- soil farming: an energySeed planted on soil spawns an energy item on
// the same cell after ENERGY_SEED_GROW_TICKS (if the cell doesn't already
// have one); harvesting that energy restarts the seed's timer, so a seed
// keeps producing renewably as long as it's kept picked
// (systems/farming.ts). Measured in ticks, like everything else that gates
// on state.tick, rather than milliseconds — 40 ticks (~10s at the current
// TICK_MS) ----
export const ENERGY_SEED_GROW_TICKS = 40;

// ---- furnace: ore placed on a furnace tile becomes an ingot after
// ORE_SMELT_TICKS; any other item placed there melts away after
// ITEM_MELT_TICKS unless it survives (see FURNACE_SURVIVORS in
// systems/smelting.ts). The player can pick the original item back up any
// time before its timer fires, canceling the job. ----
export const ORE_SMELT_TICKS = 20; // ~5s at the current TICK_MS
export const ITEM_MELT_TICKS = 8; // ~2s at the current TICK_MS

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
export const PLAYER_MAX_HP = 100;
// duration of the white on-hit flash overlay, shared by the player and
// enemies (see render.ts, combat.ts's damagePlayer, ai.ts's
// attemptEnemyAttack, and player-actions.ts's attemptPlayerAttack)
export const HIT_FLASH_MS = 140;
export const PLAYER_ATK_DAMAGE = 3;
// measured in whole ticks (state.tick), not ms — attack cooldowns are
// gated against state.tick (see attemptPlayerAttack in
// systems/player-actions.ts), not wall-clock time, so cadence stays exact
// regardless of frame timing/hitches instead of drifting like a
// performance.now() comparison would
export const PLAYER_ATK_COOLDOWN_TICKS = 4;

// a weapon is "equipped" simply by being held (see attemptPlayerAttack in
// systems/player-actions.ts) — no separate equip slot, so wielding one
// means your one carry slot isn't free for hauling ore/energy/etc. Only
// item types listed here override the unarmed PLAYER_ATK_DAMAGE/COOLDOWN_TICKS
// above; anything else held attacks unarmed. `range` (optional, in tiles)
// turns the weapon into a ranged attack: game.ts's attack-chase loop uses
// weaponRange (below) + inRange (systems/pathfinding.ts) to attack from
// distance instead of closing to adjacency, and attemptPlayerAttack
// (systems/player-actions.ts) fires a delayed-hit projectile instead of
// applying damage instantly. Weapons without `range` default to melee's
// exact range of 1 (plain orthogonal adjacency, no line-of-sight check).
export const WEAPON_DEFS: Partial<
  Record<ItemType, { damage: number; cooldownTicks: number; range?: number }>
> = {
  sword: { damage: 6, cooldownTicks: 4 },
  bow: { damage: 4, cooldownTicks: 5, range: 6 },
};

// range (in tiles) the currently held item can attack from — see
// WEAPON_DEFS' range field above.
export function weaponRange(held: CarryType | null): number {
  const weapon = held ? WEAPON_DEFS[held as ItemType] : undefined;
  return weapon?.range ?? 1;
}
// hp spent per tile the player steps onto, however the step was triggered
// (keyboard, click-to-move, or auto-pathing toward an attack target)
export const PLAYER_MOVE_HP_COST = 1;
// hp spent per landed player attack (unarmed or with a weapon), same
// exertion-cost mechanic as PLAYER_MOVE_HP_COST
export const PLAYER_ATK_HP_COST = 1;
// hp restored by using (eating) a held energy item, see useHeldItem in
// systems/player-actions.ts
export const ENERGY_HEAL_AMOUNT = 50;

// ---- roaming enemies: wander until they see you, then chase and attack ----
export const ENEMY_COUNT = 20;
export const ENEMY_MAX_HP = 10;
export const ENEMY_ATK_DAMAGE = 2;
// in ticks — see PLAYER_ATK_COOLDOWN_TICKS's comment on why this is
// gated against state.tick rather than wall-clock time
export const ENEMY_ATK_COOLDOWN_TICKS = 2;
export const ENEMY_AGGRO_RADIUS = 5;
export const ENEMY_LOSE_AGGRO_MS = 4000;
export const ENEMY_WANDER_MIN_MS = 1200;
export const ENEMY_WANDER_MAX_MS = 3000;
export const ENEMY_WANDER_RADIUS = 4;
// 1 tick — throttles repathing only, so unlike the attack cooldowns above
// it's fine to stay wall-clock/ms rather than gated on state.tick
export const ENEMY_REPATH_MS = 250;
export const ENEMY_SPAWN_MIN_DIST = 10; // keep initial spawns away from the player's start

// ---- training dummy: fixed, immortal, immovable enemy near spawn (see
// makeDummyEnemy in entities/entities.ts). Retaliates like a normal enemy
// but on a much slower cooldown, and never wanders/chases.
export const DUMMY_SPAWN_DX = 0;
export const DUMMY_SPAWN_DY = 2; // within buildStones' spawn-safety bubble, so always open ground
// in ticks (12 ticks == 3000ms at the current TICK_MS) — see
// PLAYER_ATK_COOLDOWN_TICKS's comment on why this is gated against
// state.tick rather than wall-clock time
export const DUMMY_ATK_COOLDOWN_TICKS = 12;

// ---- ranged weapon projectiles (see systems/combat.ts's fireProjectile/
// updateProjectiles): a shot's hit/damage is decided at fire time, but
// applied `travelTicks` later, based on distance. OSRS-style constant —
// tiles of travel distance per simulation tick, e.g. a 3-tile shot takes 1
// tick to land, a 6-tile shot takes 2. Purely a cosmetic delay before the
// existing damageEnemy resolution runs; not a simulated physics object that
// can be dodged or missed by the target moving out of the way. ----
export const PROJECTILE_TILES_PER_TICK = 3;
