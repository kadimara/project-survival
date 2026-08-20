// Shared type definitions for the survival game engine. GameState is the
// single bag of mutable simulation state that every other module reads and
// writes — modules take it as a parameter instead of closing over local
// variables, so each file's dependencies are explicit and it stays
// independently readable.
import type { Rng } from '../worldgen/worldgen';

export type Dir = 'up' | 'down' | 'left' | 'right';

// three occupancy layers, bottom to top: floor (walkable ground material,
// see FLOOR_DEFS in constants.ts), obstacles (solid, atlas-baked, see
// OBSTACLE_DEFS), and items (loose, drawn per-frame, sit on top of an
// obstacle that opts in via allowItem — see ITEM_DEFS). Floor and obstacles
// are independent maps, so an obstacle can sit on top of a floor tile
// without the two ever conflicting.
export type FloorType = 'dirt';
export type ObstacleType =
  'stone' | 'soil' | 'furnace' | 'wood' | 'fiber' | 'tree';
export type ItemType =
  'energy' | 'energySeed' | 'ingot' | 'ore' | 'sword' | 'bow';
export type CarryType = ObstacleType | ItemType | FloorType;

export interface Point {
  x: number;
  y: number;
}

// entry in the item layer; needs its own x/y since it's stored in a
// position-keyed map alongside its key, for convenient per-frame iteration
export interface Item extends Point {
  type: ItemType;
}

// a seed planted on soil, tracked separately from state.items so an
// energySeed and the energy it periodically spawns can occupy the same
// cell at once (see systems/farming.ts). readyAt is a tick count
// (state.tick), not a millisecond timestamp.
export interface PlantedSeed extends Point {
  readyAt: number;
}

// an item dumped on a furnace tile, tracked separately from state.items for
// the same reason as PlantedSeed — see systems/smelting.ts. The player can
// pick the original `item` back up any time before readyAt; once it passes,
// the job resolves (smelts, survives, or is destroyed) and the entry is
// removed either way — no re-arming. readyAt is a tick count (state.tick),
// not a millisecond timestamp.
export interface Smelter extends Point {
  item: ItemType;
  readyAt: number;
}

export interface ZoomLevel {
  vpw: number;
  vph: number;
}

// common movement/animation fields shared by the player and enemies
export interface Actor {
  tileX: number;
  tileY: number;
  px: number;
  py: number;
  dir: Dir;
  moving: boolean;
  moveStart: number;
  moveDur: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  path: Point[];
}

export type PendingAction =
  | { type: 'pickup'; x: number; y: number }
  | { type: 'place'; x: number; y: number };

export interface Player extends Actor {
  held: CarryType | null;
  pendingAction: PendingAction | null;
  // set by the "Use item" button; resolved on the next simulation tick
  // (see game.ts's simulateTick) rather than instantly on click, same
  // deferred-resolution convention as pendingAction above. Kept separate
  // from pendingAction/attackTarget rather than folded into the same
  // movement/attack priority chain, since using an item (e.g. healing)
  // needs to work even while chasing or mid-attack, not get starved by them.
  pendingUse: boolean;
  attacked: boolean;
  attackTarget: Enemy | Tree | null;
  // tick count (state.tick) at which the next attack becomes allowed, same
  // readyAt-style pattern as Seed/SmeltJob above — gated against state.tick
  // rather than a ms timestamp so attack cadence stays exact regardless of
  // frame timing (see attemptPlayerAttack in systems/player-actions.ts)
  nextAttackAt: number;
  // tick count (state.tick) at which the next step becomes allowed — same
  // readyAt-style gating as nextAttackAt above, set by tryPlayerStep
  // (systems/player-actions.ts) to state.tick + 1 normally, or further out
  // while wading through the oasis's water (see PLAYER_WATER_MOVE_TICKS in
  // constants.ts), so movement through water takes proportionally longer in
  // real time without changing the fixed-tick simulation itself. Checked in
  // game.ts's simulateTick before a step is issued.
  nextMoveAt: number;
  hp: number;
  maxHp: number;
  flashUntil: number;
}

export interface Enemy extends Actor {
  // discriminant shared with Tree below, so code that can target either
  // (Player.attackTarget, Projectile.target) can branch to the right
  // damage-application function without the two types otherwise needing
  // anything in common beyond position/hp/flash
  kind: 'enemy';
  hp: number;
  maxHp: number;
  state: 'wander' | 'chase';
  target: Player | null;
  nextWanderAt: number;
  nextRepathAt: number;
  // tick count (state.tick), same as Player.nextAttackAt above
  nextAttackAt: number;
  aggroUntil: number;
  flashUntil: number;
  // true for the fixed training dummy near spawn: never wanders/chases and
  // ignores hp loss (see systems/ai.ts's updateEnemy and entities.ts's
  // makeDummyEnemy)
  stationary: boolean;
}

// a choppable tree — see OBSTACLE_DEFS.tree in constants.ts for the
// 2-tall/trunk-only-collides visual, and state.trees for how this is
// tracked. Deliberately not folded into Enemy/state.enemies: a tree is
// stationary and has no AI, so it only carries the fields the shared
// combat code (attemptPlayerAttack, updateProjectiles, the y-sorted render
// pass) actually needs — px/py are static since a tree never moves,
// computed once as tileX/tileY * TILE.
export interface Tree {
  kind: 'tree';
  tileX: number;
  tileY: number;
  px: number;
  py: number;
  hp: number;
  maxHp: number;
  flashUntil: number;
}

// a darkened patch left on a tile the player has walked off of (see
// leaveFootprint in state/state.ts and its render.ts draw loop) — purely
// cosmetic, so it's not persisted (see state/persistence.ts) and rebuilt
// empty on load, same as floatingTexts/projectiles below.
export interface Footprint extends Point {
  born: number;
}

export interface FloatingText {
  worldX: number;
  worldY: number;
  text: string;
  color: string;
  born: number;
}

// an in-flight ranged shot. Damage is rolled and committed at fire time
// (see fireProjectile in systems/combat.ts) — the same OSRS-style "hit
// decided immediately, hitsplat delayed" convention — only the application
// (the damageEnemy call and its flash/floating-text/death handling) and the
// cosmetic travel animation are deferred until landTick. from/to px/py are
// snapshotted once at fire time purely for the travel-line render (see
// render.ts); they don't track the target's later movement, matching the
// same "hit already decided" convention.
export interface Projectile {
  target: Enemy | Tree;
  damage: number;
  fromPx: number;
  fromPy: number;
  toPx: number;
  toPy: number;
  spawnAt: number; // ms (rAF/performance.now() timestamp) — for render lerp
  landAt: number; // ms — for render lerp
  landTick: number; // state.tick count at which damage applies
}

export interface GameRefs {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  worldCanvas: HTMLCanvasElement;
  worldCtx: CanvasRenderingContext2D;
  groundAtlas: HTMLCanvasElement;
  groundAtlasCtx: CanvasRenderingContext2D;
  worldAtlas: HTMLCanvasElement;
  worldAtlasCtx: CanvasRenderingContext2D;
}

// DOM element refs for the HUD stat bar and the world-map overlay
export interface HudRefs {
  statHp: HTMLElement;
  statCarry: HTMLElement;
  toastEl: HTMLElement;
  useItemBtn: HTMLElement;

  worldMapOverlay: HTMLElement;
  worldMapCloseBtn: HTMLElement;
  mapToggleBtn: HTMLElement;
  worldMapScroll: HTMLElement;

  seedInput: HTMLInputElement;
  seedLoadBtn: HTMLElement;
  seedRandomBtn: HTMLElement;
  zoomInBtn: HTMLElement;
  zoomOutBtn: HTMLElement;
}

export interface GameState {
  refs: GameRefs;

  // count of simulation ticks elapsed (see game.ts's simulateTick) — the
  // clock that seeds/smelters readyAt (and nothing else) is measured
  // against, instead of a wall-clock timestamp
  tick: number;

  seed: number;
  rng: Rng;
  map: number[][];
  floor: Map<string, FloorType>;
  obstacles: Map<string, ObstacleType>;
  items: Map<string, Item>;
  seeds: Map<string, PlantedSeed>;
  smelters: Map<string, Smelter>;
  // positions of every furnace obstacle, kept in sync by setObstacle — lets
  // the per-frame render loop draw the flickering firebox glow (render.ts)
  // without scanning the whole state.obstacles map every frame
  furnaces: Map<string, Point>;
  // every tree obstacle (the trunk cell), same kept-in-sync-by-setObstacle
  // pattern as furnaces above — lets the per-frame y-sorted render pass
  // draw each tree's canopy, and attemptPlayerAttack/updateProjectiles
  // apply damage to one, without scanning the whole state.obstacles map
  // every frame
  trees: Map<string, Tree>;
  enemies: Enemy[];
  player: Player;
  floatingTexts: FloatingText[];
  projectiles: Projectile[];
  footprints: Footprint[];

  zoomIndex: number;
  VP_W: number;
  VP_H: number;
  mapOpen: boolean;
  hoveredTile: Point | null;
}
