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
export type TileType = 'stone' | 'soil' | 'furnace';
export type ItemType = 'energy' | 'energySeed' | 'ingot' | 'ore';
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
// cell at once (see systems/farming.ts)
export interface PlantedSeed extends Point {
  readyAt: number;
}

// an item dumped on a furnace tile, tracked separately from
// state.groundItems for the same reason as PlantedSeed — see
// systems/smelting.ts. The player can pick the original `item` back up any
// time before readyAt; once it passes, the job resolves (smelts, survives,
// or is destroyed) and the entry is removed either way — no re-arming.
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
  attacked: boolean;
  attackTarget: Enemy | null;
  lastAttack: number;
  hp: number;
  maxHp: number;
  invulnUntil: number;
}

export interface Enemy extends Actor {
  hp: number;
  maxHp: number;
  state: 'wander' | 'chase';
  target: Player | null;
  nextWanderAt: number;
  nextRepathAt: number;
  lastAttack: number;
  aggroUntil: number;
  flashUntil: number;
}

export interface FloatingText {
  worldX: number;
  worldY: number;
  text: string;
  color: string;
  born: number;
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

  zoomIndex: number;
  VP_W: number;
  VP_H: number;
  mapOpen: boolean;
  hoveredTile: Point | null;
}
