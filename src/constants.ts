import type {
  CarryType,
  FloorType,
  ItemType,
  ObstacleType,
  ZoomLevel,
} from './types/types';

export const TILE = 16;
export const MAP_W = 300;
export const MAP_H = 300;
export const SPAWN_X = Math.floor(MAP_W / 2);
export const SPAWN_Y = Math.floor(MAP_H / 2);
export const INITIAL_SEED = 1674584215;

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

// ---- boulder-structure resources: buildStones' noise pass carves the
// wasteland into separated solid-stone "structures" (see worldgen.ts's
// CAVE_PRESET comment). Every structure at or above MIN_STRUCTURE_SIZE tiles
// gets ore rolled independently on each of its interior cells (worldgen.ts's
// interiorCells, so it never sits at the structure's edge) at ORE_SPAWN_CHANCE
// (see buildWorldLayers in state/state.ts); anything smaller stays plain
// undecorated stone. First-pass balance numbers. ----
export const MIN_STRUCTURE_SIZE = 15; // stone tiles; below this, no resources
export const ORE_SPAWN_CHANCE = 0.05; // per interior stone tile
// salts the resource-placement RNG so it's independent of both the terrain
// noise's own seed usage and gameplay's state.rng consumption order
export const RESOURCE_PLACEMENT_SALT = 0x9e3779b9;

// ---- oasis: a single small circular patch of background ground painted a
// different color, placed at a fixed distance from spawn in a random
// (seed-derived) direction — purely cosmetic, see OASIS in worldgen.ts and
// paintOasis in state/state.ts ----
export const OASIS_DISTANCE_TILES = 20;
export const OASIS_RADIUS = 4; // ~49-tile circular patch
export const OASIS_PLACEMENT_SALT = 0x1b873593; // distinct from RESOURCE_PLACEMENT_SALT

// ---- oasis vegetation: a fixed-distance ring band around the oasis's own
// (wobbly) cell set, same "fixed distance, not noise-driven" philosophy as
// the oasis itself — see buildVegetationRing in worldgen.ts. Bushes
// ('berryBush' obstacles, wild and inert until moved onto soil — see
// buildWorldLayers in state/state.ts) hug the water closely and densely;
// trees ('wood' obstacles, reusing the existing ObstacleType rather than
// adding a new one) sit further out and sparser. First-pass balance numbers,
// same spirit as ORE_SPAWN_CHANCE ----
export const VEGETATION_PLACEMENT_SALT = 0x2545f491; // distinct from the other placement salts
export const BUSH_RING_MIN = 1;
export const BUSH_RING_MAX = 2;
export const BUSH_SPAWN_CHANCE = 0.15;
export const TREE_RING_MIN = 2;
export const TREE_RING_MAX = 5;
export const TREE_SPAWN_CHANCE = 0.05;

// ---- cactus fruit: unlike the oasis-ring bushes/trees above, cacti scatter
// across the *whole* desert (see buildCactusScatter in worldgen.ts) — food
// worth exploring for, not clustered around the one water source. Rolled
// independently per open tile (stone/oasis/vegetation-ring cells excluded,
// same as everything else that shares the map), same spirit as
// ORE_SPAWN_CHANCE. CACTUS_SPAWN_SAFETY_R keeps them off the player's
// immediate spawn point, same idea as buildStones' SPAWN_SAFETY_R. ----
export const CACTUS_PLACEMENT_SALT = 0x3c6ef372; // distinct from the other placement salts
export const CACTUS_SPAWN_CHANCE = 0.00075;
export const CACTUS_SPAWN_SAFETY_R = 5;

// ---- obstacle defs: the grid layer (solid, atlas-baked). pickable is
// checked by doPickup — every current obstacle is pickable, but the flag
// exists so a future non-pickable solid type (e.g. a boundary wall) has
// somewhere to say so. allowItem marks whether the item layer can also be
// occupied at the obstacle's cell (furnace does, so an item dumped in for
// smelting can sit on top of it; stone/ore don't) ----
export const OBSTACLE_DEFS: Record<
  ObstacleType,
  {
    solid: boolean;
    pickable: boolean;
    allowItem: boolean;
    colors: { primary: string; secondary: string };
  }
> = {
  stone: {
    solid: true,
    pickable: true,
    allowItem: false,
    colors: { primary: '#8a8478', secondary: '#5e594e' },
  },
  // built by combining two stone obstacles (see combine.ts) — not part of
  // procedural generation. allowItem lets any item be dumped straight onto
  // it, same as soil (see systems/smelting.ts)
  furnace: {
    solid: true,
    pickable: true,
    allowItem: true,
    colors: { primary: '#c65a2e', secondary: '#5a2c17' },
  },
  // a diggable obstacle like stone/soil, not yet consumed by any recipe —
  // seeded near spawn (see buildWorldLayers in state/state.ts) so it's
  // visible/testable ahead of the combine recipe that will use it (a
  // spear or similar, held alongside ingot)
  wood: {
    solid: true,
    pickable: true,
    allowItem: false,
    colors: { primary: '#a9773f', secondary: '#6b4c22' },
  },
  // scrub/bush vegetation scattered in a ring around the oasis (see
  // buildVegetationRing in worldgen.ts) — solid so it reads as a real
  // obstacle to walk around, pickable like every other obstacle. Wild, it
  // stands on no floor at all and just sits there inert; picked up and
  // placed onto 'soil' (made via the dirt + poop recipe, see combine.ts)
  // it grows a berry item over time (see updateBerryBushes in
  // systems/farming.ts) — moved back off soil, it goes idle again.
  berryBush: {
    solid: true,
    pickable: true,
    allowItem: false,
    colors: { primary: '#5a7a3a', secondary: '#33471f' },
  },
  // a choppable desert cactus (see Cactus in types.ts, CACTUS_MAX_HP below,
  // destroyCactus in systems/combat.ts) — reuses berryBush's exact green
  // palette on purpose, so the body reads as the same scrub-plant material; the red
  // fruit it drops (ITEM_DEFS.cactusFruit below) is drawn on top of this
  // body as its own accent color rather than baked into these colors (see
  // drawCactusBody in render/rendering.ts). Not pickable, same as tree —
  // has to be destroyed in combat, not lifted straight off the ground.
  cactus: {
    solid: true,
    pickable: false,
    allowItem: false,
    colors: { primary: '#5a7a3a', secondary: '#33471f' },
  },
  // a 2-tall tree: this entry is only the trunk/base cell, the sole thing
  // that occupies state.obstacles and collides — the canopy is a per-frame,
  // y-sorted visual one tile north of it with no data-layer presence of its
  // own (see TREE_CANOPY_COLORS below and the tree pass in render.ts), so
  // that tile stays walkable. Trunk colors reuse wood's palette (it's
  // literally a trunk); scattered in the oasis vegetation ring alongside
  // berryBush (see buildVegetationRing in worldgen.ts), placed as its own
  // ObstacleType rather than reusing 'wood' — see buildWorldLayers in
  // state/state.ts. Not directly pickable — a tree has to be chopped down
  // via combat (see TREE_MAX_HP, fellTree in systems/combat.ts) first,
  // which swaps this cell for a plain 'wood' obstacle (pickable: true).
  tree: {
    solid: true,
    pickable: false,
    allowItem: false,
    colors: { primary: '#a9773f', secondary: '#6b4c22' },
  },
};

// hp a tree has before fellTree (systems/combat.ts) swaps it for a plain
// 'wood' obstacle — first-pass balance number, double ENEMY_MAX_HP so
// chopping one down takes noticeably more hits than fighting a basic enemy
export const TREE_MAX_HP = 20;

// hp a cactus has before destroyCactus (systems/combat.ts) clears it and
// drops a cactusFruit — a smaller plant than a tree, so noticeably less hp,
// but still more than a basic enemy (see ENEMY_MAX_HP above) so it isn't a
// one-hit freebie
export const CACTUS_MAX_HP = 12;

// canopy color pair for the 2-tall tree above — render-only, not part of
// OBSTACLE_DEFS since the canopy has no collision/pickup identity of its
// own (see the tree pass in render.ts). A fuller forest green, kept
// visually distinct from berryBush's scrub green.
export const TREE_CANOPY_COLORS = {
  primary: '#3f7a3a',
  secondary: '#234d20',
};

// ---- floor defs: the layer beneath obstacles (see FloorType in types.ts)
// — walkable ground material an obstacle or item can sit on top of. No
// `solid` field like OBSTACLE_DEFS: everything here is walkable by
// definition, so nothing ever needs to check it. 'dirt' is placed under the
// oasis's vegetation ring (see buildWorldLayers in state/state.ts); 'soil'
// never enters the world at world-gen time, only crafted via the dirt +
// poop combine recipe (see RECIPES in systems/combine.ts) — it's what
// makes a berryBush standing on it grow berries (see updateBerryBushes in
// systems/farming.ts) rather than an obstacle in its own right — it needs
// no solidity/occupant-combine semantics of its own, just to be checked as
// the floor under a bush ----
export const FLOOR_DEFS: Record<
  FloorType,
  { pickable: boolean; colors: { primary: string; secondary: string } }
> = {
  dirt: {
    pickable: true,
    colors: { primary: '#6b4a30', secondary: '#43301f' },
  },
  // shares ITEM_DEFS.poop's exact colors on purpose — soil is dirt dug
  // through with poop (see RECIPES in systems/combine.ts), so it reads as
  // visibly richer/darker than plain dirt
  soil: {
    pickable: true,
    colors: { primary: '#4a3323', secondary: '#2b1d13' },
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
  // (see OBSTACLE_DEFS.wood above) rather than ingot's, since the
  // shaft/limb is what reads visually, not the arrowhead
  bow: {
    colors: { primary: '#a9773f', secondary: '#6b4c22' },
  },
  // dropped by a destroyed cactus (see destroyCactus in systems/combat.ts) —
  // a vivid red, deliberately unlike anything else in ITEM_DEFS, so it reads
  // as food at a glance. Heals CACTUS_FRUIT_HEAL_AMOUNT on use (see
  // useHeldItem in systems/player-actions.ts).
  cactusFruit: {
    colors: { primary: '#c1392b', secondary: '#7a2318' },
  },
  // grown by a berryBush obstacle standing on soil (see updateBerryBushes
  // in systems/farming.ts) — a brighter, more saturated red than
  // cactusFruit so the two still read apart despite both being "red food."
  // Drawn as 4 dots at BERRY_DOT_OFFSETS rather than the generic item
  // square (see drawItemIcon in render/rendering.ts), lining up with the
  // same 4 spots the berryBush's own preview dots sit at.
  berry: {
    colors: { primary: '#e0333f', secondary: '#8a1620' },
  },
  // produced instead of healing when eating any food item while already at
  // max hp (see useHeldItem in systems/player-actions.ts) — combine with a
  // held dirt floor tile to make more soil (see RECIPES in
  // systems/combine.ts). Deliberately close to dirt's brown but darker, so
  // the two still read apart.
  poop: {
    colors: { primary: '#4a3323', secondary: '#2b1d13' },
  },
};

// ---- soil farming: two independent ways soil produces food (see
// systems/farming.ts) — an energySeed the player explicitly planted, or a
// berryBush obstacle simply standing on soil floor — each spawn an item on
// the same cell after their own grow-tick count (if the cell doesn't
// already have one); harvesting that item restarts the timer, so either
// keeps producing renewably as long as it's kept picked. Measured in
// ticks, like everything else that gates on state.tick, rather than
// milliseconds ----
export const ENERGY_SEED_GROW_TICKS = 40; // ~10s at the current TICK_MS
// a bit faster than ENERGY_SEED_GROW_TICKS, since berries are the starter/
// staple food rather than a mid-tier crafting resource
export const BERRY_BUSH_GROW_TICKS = 30; // ~7.5s at the current TICK_MS

// ---- furnace: ore placed on a furnace tile becomes an ingot after
// ORE_SMELT_TICKS; any other item placed there melts away after
// ITEM_MELT_TICKS unless it survives (see FURNACE_SURVIVORS in
// systems/smelting.ts). The player can pick the original item back up any
// time before its timer fires, canceling the job. ----
export const ORE_SMELT_TICKS = 20; // ~5s at the current TICK_MS
export const ITEM_MELT_TICKS = 8; // ~2s at the current TICK_MS

// looks up the primary color for anything the player can carry, whichever
// def table (OBSTACLE_DEFS, FLOOR_DEFS, or ITEM_DEFS) it belongs to
export function carryColor(kind: CarryType): string {
  if (kind in OBSTACLE_DEFS)
    return OBSTACLE_DEFS[kind as ObstacleType].colors.primary;
  if (kind in FLOOR_DEFS) return FLOOR_DEFS[kind as FloorType].colors.primary;
  return ITEM_DEFS[kind as ItemType].colors.primary;
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
// ticks a step onto the oasis's water takes before the next step is
// allowed, vs. the normal 1 tick per step everywhere else — see
// Player.nextMoveAt (types.ts) and tryPlayerStep (systems/player-actions.ts).
// Twice the normal pace, so wading through the water takes twice as long in
// real time without changing the fixed-tick simulation rate itself.
export const PLAYER_WATER_MOVE_TICKS = 2;

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
// ---- sand trail: the tile the player steps off of gets a dark overlay (see
// leaveFootprint in state/state.ts) that fades out over FOOTPRINT_FADE_MS
// (render.ts). Recorded on the tile being left, not the one being walked
// onto, so the mark never sits directly under the player. FOOTPRINT_MAX
// bounds the backing array so a long walk doesn't grow it forever — oldest
// marks are dropped first, same as they'd have faded out anyway. ----
export const FOOTPRINT_FADE_MS = 3000;
export const FOOTPRINT_MAX = 400;
export const FOOTPRINT_MAX_ALPHA = 0.18;
// same role as FOOTPRINT_MAX_ALPHA/FOOTPRINT_FADE_MS above, but for the
// pale wake mark a footprint on water renders as instead (see drawWake in
// rendering.ts). WAKE_MAX_ALPHA is higher than the sand darken since a
// light mark needs more opacity to read clearly against the water;
// WAKE_FADE_MS is shorter so the trailing stream reads as motion right
// behind the player rather than lingering.
export const WAKE_MAX_ALPHA = 0.35;
export const WAKE_FADE_MS = 700;

// hp spent per tile the player steps onto, however the step was triggered
// (keyboard, click-to-move, or auto-pathing toward an attack target)
export const PLAYER_MOVE_HP_COST = 1;
// hp spent per landed player attack (unarmed or with a weapon), same
// exertion-cost mechanic as PLAYER_MOVE_HP_COST
export const PLAYER_ATK_HP_COST = 1;
// hp restored by using (eating) a held energy item, see useHeldItem in
// systems/player-actions.ts
export const ENERGY_HEAL_AMOUNT = 50;
// hp restored by using (eating) a held cactusFruit item, same mechanic as
// ENERGY_HEAL_AMOUNT above (see useHeldItem in systems/player-actions.ts)
export const CACTUS_FRUIT_HEAL_AMOUNT = 50;
// hp restored by using (eating) a held berry item — deliberately weaker
// than ENERGY_HEAL_AMOUNT/CACTUS_FRUIT_HEAL_AMOUNT, since berries are the
// reliable renewable staple (see systems/farming.ts) rather than the best
// healing option. Eating any food (including berries) while already at max
// hp produces a poop item instead of healing, see useHeldItem.
export const BERRY_HEAL_AMOUNT = 25;

// ---- roaming enemies: wander until they see you, then chase and attack ----
export const ENEMY_COUNT = 0;
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
