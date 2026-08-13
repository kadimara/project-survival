// Shared type definitions for the survival game engine. GameState is the
// single bag of mutable simulation state that every other module reads and
// writes — modules take it as a parameter instead of closing over local
// variables, so each file's dependencies are explicit and it stays
// independently readable.
import type { Rng } from '../worldgen/worldgen';

export type Dir = 'up' | 'down' | 'left' | 'right';

// tiles are the grid layer: solid, atlas-baked (see TILE_DEFS in
// constants.ts). Items are the ground layer: loose, drawn per-frame, sit on
// top of terrain rather than being part of the grid (see ITEM_DEFS).
export type TileType = 'stone' | 'soil' | 'furnace' | 'wood';
export type ItemType =
  'energy' | 'energySeed' | 'ingot' | 'ore' | 'sword' | 'bow';
export type CarryType = TileType | ItemType;

export interface Point {
  x: number;
  y: number;
}

// entry in the ground-item layer; needs its own x/y since it's stored in a
// position-keyed map alongside its key, for convenient per-frame iteration
export interface GroundItem extends Point {
  type: ItemType;
}

// a seed planted on soil, tracked separately from state.groundItems so an
// energySeed and the energy it periodically spawns can occupy the same
// cell at once (see systems/farming.ts). readyAt is a tick count
// (state.tick), not a millisecond timestamp.
export interface PlantedSeed extends Point {
  readyAt: number;
}

// an item dumped on a furnace tile, tracked separately from
// state.groundItems for the same reason as PlantedSeed — see
// systems/smelting.ts. The player can pick the original `item` back up any
// time before readyAt; once it passes, the job resolves (smelts, survives,
// or is destroyed) and the entry is removed either way — no re-arming.
// readyAt is a tick count (state.tick), not a millisecond timestamp.
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
  attackTarget: Enemy | null;
  // tick count (state.tick) at which the next attack becomes allowed, same
  // readyAt-style pattern as Seed/SmeltJob above — gated against state.tick
  // rather than a ms timestamp so attack cadence stays exact regardless of
  // frame timing (see attemptPlayerAttack in systems/player-actions.ts)
  nextAttackAt: number;
  hp: number;
  maxHp: number;
  flashUntil: number;
}

export interface Enemy extends Actor {
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
  target: Enemy;
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
  tiles: Map<string, TileType>;
  groundItems: Map<string, GroundItem>;
  seeds: Map<string, PlantedSeed>;
  smelters: Map<string, Smelter>;
  // positions of every furnace tile, kept in sync by setTile — lets the
  // per-frame render loop draw the flickering firebox glow (render.ts)
  // without scanning the whole state.tiles map every frame
  furnaces: Map<string, Point>;
  enemies: Enemy[];
  player: Player;
  floatingTexts: FloatingText[];
  projectiles: Projectile[];

  zoomIndex: number;
  VP_W: number;
  VP_H: number;
  mapOpen: boolean;
  hoveredTile: Point | null;
}
