// Save/load: snapshots the player-driven parts of GameState to localStorage
// so closing and reopening the tab picks up where it left off. `state.map`
// isn't persisted — it's cheap to rebuild (buildMap is a pure function of
// MAP_W/MAP_H) — but `state.tiles` is saved in full rather than replayed
// from the seed, since it already reflects everything the player has dug up
// or placed since world-gen ran. It's stored as a dense one-byte-per-cell
// grid rather than a sparse [key, type][] list: a solid cave is mostly
// "stone", so a per-cell byte (base64-encoded) runs an order of magnitude
// smaller than repeating "stone" and an "x,y" string per tile. Transient
// per-frame/interaction fields (paths, pending actions, attack targets,
// timers keyed off the old performance.now() epoch) are deliberately
// dropped on load and rebuilt fresh, the same way
// createGameState/regenerateWorld initialize them.
import type {
  Dir,
  GameRefs,
  GameState,
  GroundItem,
  ItemType,
  PlantedSeed,
  Player,
  Smelter,
  TileType,
} from '../types/types';
import {
  DUMMY_SPAWN_DX,
  DUMMY_SPAWN_DY,
  MAP_H,
  MAP_W,
  PLAYER_MAX_HP,
  SPAWN_X,
  SPAWN_Y,
  TICK_MS,
} from '../constants';
import { buildMap, mulberry32 } from '../worldgen/worldgen';
import { buildGroundAtlas } from '../render/ground-atlas';
import { makeDummyEnemy, makeEnemy } from '../entities/entities';

const SAVE_KEY = 'project-survival-save-v1';

// grid-cell byte id, 0 = no tile (open ground). Room for 255 tile types
// before this needs to grow past one byte per cell.
const TILE_TO_ID: Record<TileType, number> = {
  stone: 1,
  soil: 2,
  furnace: 3,
  wood: 4,
};
const ID_TO_TILE: (TileType | undefined)[] = [
  undefined,
  'stone',
  'soil',
  'furnace',
  'wood',
];

function encodeTilesGrid(tiles: Map<string, TileType>): string {
  const bytes = new Uint8Array(MAP_W * MAP_H);
  for (const [key, type] of tiles) {
    const [x, y] = key.split(',').map(Number);
    bytes[y * MAP_W + x] = TILE_TO_ID[type];
  }
  return bytesToBase64(bytes);
}

function decodeTilesGrid(b64: string): {
  tiles: Map<string, TileType>;
  furnaces: Map<string, { x: number; y: number }>;
} {
  const bytes = base64ToBytes(b64);
  const tiles = new Map<string, TileType>();
  const furnaces = new Map<string, { x: number; y: number }>();
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const type = ID_TO_TILE[bytes[y * MAP_W + x]];
      if (!type) continue;
      const key = x + ',' + y;
      tiles.set(key, type);
      if (type === 'furnace') furnaces.set(key, { x, y });
    }
  }
  return { tiles, furnaces };
}

// chunked to stay well under the argument-count limit String.fromCharCode
// would otherwise hit if spread across a million-plus byte array at once
const BASE64_CHUNK = 0x8000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ground items are sparse (a couple hundred scattered across thousands of
// cells at most), so a dense per-cell grid like the tile grid above would
// waste space on all the empty cells — instead each item is 3 plain numbers
// (x, y, item-type id) flattened into one array, which drops the repeated
// "x"/"y"/"type" object keys and the redundant "x,y" string key that the
// old [key, {x,y,type}][] shape paid for on every entry
const ITEM_TO_ID: Record<ItemType, number> = {
  energy: 1,
  energySeed: 2,
  ore: 3,
  ingot: 4,
  sword: 5,
};
const ID_TO_ITEM: (ItemType | undefined)[] = [
  undefined,
  'energy',
  'energySeed',
  'ore',
  'ingot',
  'sword',
];

function encodeGroundItems(items: Map<string, GroundItem>): number[] {
  const flat: number[] = [];
  for (const item of items.values()) {
    flat.push(item.x, item.y, ITEM_TO_ID[item.type]);
  }
  return flat;
}

function decodeGroundItems(flat: number[]): Map<string, GroundItem> {
  const items = new Map<string, GroundItem>();
  for (let i = 0; i < flat.length; i += 3) {
    const x = flat[i],
      y = flat[i + 1];
    const type = ID_TO_ITEM[flat[i + 2]];
    if (!type) continue;
    items.set(x + ',' + y, { x, y, type });
  }
  return items;
}

interface SavedEnemy {
  tileX: number;
  tileY: number;
  px: number;
  py: number;
  dir: Dir;
  hp: number;
  maxHp: number;
}

interface SavedPlayer {
  tileX: number;
  tileY: number;
  px: number;
  py: number;
  dir: Dir;
  held: Player['held'];
  hp: number;
  maxHp: number;
}

interface SaveData {
  seed: number;
  tilesGrid: string;
  groundItems: number[];
  seeds: [string, PlantedSeed][];
  smelters: [string, Smelter][];
  enemies: SavedEnemy[];
  player: SavedPlayer;
  zoomIndex: number;
}

export function saveGame(state: GameState): void {
  const data: SaveData = {
    seed: state.seed,
    tilesGrid: encodeTilesGrid(state.tiles),
    groundItems: encodeGroundItems(state.groundItems),
    seeds: Array.from(state.seeds.entries()),
    smelters: Array.from(state.smelters.entries()),
    // the training dummy (Infinity hp, doesn't survive JSON) is re-created
    // fresh on load instead of being persisted, see loadGame below
    enemies: state.enemies
      .filter((e) => !e.stationary)
      .map((e) => ({
        tileX: e.tileX,
        tileY: e.tileY,
        px: e.px,
        py: e.py,
        dir: e.dir,
        hp: e.hp,
        maxHp: e.maxHp,
      })),
    player: {
      tileX: state.player.tileX,
      tileY: state.player.tileY,
      px: state.player.px,
      py: state.player.py,
      dir: state.player.dir,
      held: state.player.held,
      hp: state.player.hp,
      maxHp: state.player.maxHp,
    },
    zoomIndex: state.zoomIndex,
  };
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    // best-effort — storage full/unavailable/private-browsing, nothing to recover
  }
}

export function hasSavedGame(): boolean {
  return localStorage.getItem(SAVE_KEY) !== null;
}

export function clearSavedGame(): void {
  localStorage.removeItem(SAVE_KEY);
}

// rebuilds a full GameState from a snapshot, or returns null if there's no
// save or it doesn't parse — callers fall back to createGameState in that case
export function loadGame(refs: GameRefs): GameState | null {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return null;

  let data: SaveData;
  try {
    data = JSON.parse(raw) as SaveData;
  } catch {
    return null;
  }

  const map = buildMap(MAP_W, MAP_H);
  const { tiles, furnaces } = decodeTilesGrid(data.tilesGrid);

  const sp = data.player;
  const player: Player = {
    tileX: sp.tileX,
    tileY: sp.tileY,
    px: sp.px,
    py: sp.py,
    dir: sp.dir,
    moving: false,
    moveStart: 0,
    moveDur: TICK_MS,
    fromX: sp.tileX,
    fromY: sp.tileY,
    toX: sp.tileX,
    toY: sp.tileY,
    path: [],
    held: sp.held,
    pendingAction: null,
    attacked: false,
    attackTarget: null,
    lastAttack: 0,
    hp: sp.hp,
    maxHp: sp.maxHp ?? PLAYER_MAX_HP,
    flashUntil: 0,
  };

  const enemies = data.enemies.map((se) => {
    const e = makeEnemy(se.tileX, se.tileY);
    e.px = se.px;
    e.py = se.py;
    e.dir = se.dir;
    e.hp = se.hp;
    e.maxHp = se.maxHp;
    return e;
  });
  enemies.push(
    makeDummyEnemy(SPAWN_X + DUMMY_SPAWN_DX, SPAWN_Y + DUMMY_SPAWN_DY),
  );

  const state: GameState = {
    refs,
    seed: data.seed,
    rng: mulberry32(data.seed),
    map,
    tiles,
    groundItems: decodeGroundItems(data.groundItems),
    seeds: new Map(data.seeds),
    smelters: new Map(data.smelters),
    furnaces,
    enemies,
    player,
    floatingTexts: [],
    zoomIndex: data.zoomIndex,
    VP_W: 0,
    VP_H: 0,
    mapOpen: false,
    hoveredTile: null,
  };

  buildGroundAtlas(refs, map, tiles);
  return state;
}
