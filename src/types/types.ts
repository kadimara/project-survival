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
export type TileType = 'stone' | 'ore' | 'soil';
export type ItemType = 'energy';
export type CarryType = TileType | ItemType;

export interface Point {
  x: number;
  y: number;
}

export type GrowthStage = 'small' | 'full';

// entry in the ground-item layer; needs its own x/y since it's stored in a
// position-keyed map alongside its key, for convenient per-frame iteration.
// stage/readyAt are only set for soil-planted energy (see systems/farming.ts)
// — undefined means a plain one-shot item, same as before growth existed.
export interface GroundItem extends Point {
  type: ItemType;
  stage?: GrowthStage;
  readyAt?: number;
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
  enemies: Enemy[];
  player: Player;
  floatingTexts: FloatingText[];

  zoomIndex: number;
  VP_W: number;
  VP_H: number;
  mapOpen: boolean;
  hoveredTile: Point | null;
}
