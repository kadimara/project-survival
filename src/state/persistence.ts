// Save/load: snapshots the player-driven parts of GameState to localStorage
// so closing and reopening the tab picks up where it left off. `state.map`
// isn't persisted — it's cheap to rebuild (buildMap is a pure function of
// MAP_W/MAP_H) — but `state.obstacles` is saved in full rather than
// replayed from the seed, since it already reflects everything the player
// has dug up or placed since world-gen ran. It's stored as a dense
// one-byte-per-cell grid rather than a sparse [key, type][] list: a solid
// cave is mostly "stone", so a per-cell byte (base64-encoded) runs an order
// of magnitude smaller than repeating "stone" and an "x,y" string per cell.
// Transient per-frame/interaction fields (paths, pending actions, attack
// targets, timers keyed off the old performance.now() epoch) are
// deliberately dropped on load and rebuilt fresh, the same way
// createGameState/regenerateWorld initialize them.
//
// Note: the SaveData field names below (`tilesGrid`, `groundItems`) are the
// serialized wire format and intentionally kept as-is even though the
// TypeScript-side names they're built from (state.obstacles, state.items)
// were renamed — renaming a persisted field would silently drop that data
// out of every save already sitting in a user's localStorage.
import type {
  BerryBush,
  Cactus,
  Dir,
  EnemyType,
  FloorType,
  GameRefs,
  GameState,
  Item,
  ItemType,
  ObstacleType,
  PlantedSeed,
  Player,
  Point,
  Smelter,
  Tree,
} from '../types/types';
import { MAP_H, MAP_W, PLAYER_MAX_HP, TICK_MS } from '../constants';
import { buildMap, mulberry32 } from '../worldgen/worldgen';
import { buildGroundAtlas, buildWorldMapAtlas } from '../render/ground-atlas';
import { makeEnemy } from '../entities/entities';
import { makeBerryBushAt, makeCactusAt, makeTreeAt, paintOasis } from './state';

const SAVE_KEY = 'project-survival-save-v1';

// grid-cell byte id, 0 = no obstacle (open ground). Room for 255 obstacle
// types before this needs to grow past one byte per cell. ids 2 and 5 are
// retired — 2 used to be the 'soil' ObstacleType, now a FloorType (see
// FLOOR_TO_ID below); 5 used to be the old (dead, never actually placed)
// 'dirt' ObstacleType, also reclaimed as a FloorType. Both are deliberately
// left unassigned rather than reused, so there's no ambiguity decoding an
// old save. 6 keeps its old id across the fiber -> berryBush rename, same
// obstacle, new name.
const OBSTACLE_TO_ID: Record<ObstacleType, number> = {
  stone: 1,
  furnace: 3,
  wood: 4,
  berryBush: 6,
  tree: 7,
  cactus: 8,
};
const ID_TO_OBSTACLE: (ObstacleType | undefined)[] = [
  undefined,
  'stone',
  undefined,
  'furnace',
  'wood',
  undefined,
  'berryBush',
  'tree',
  'cactus',
];

function encodeObstacleGrid(obstacles: Map<string, ObstacleType>): string {
  const bytes = new Uint8Array(MAP_W * MAP_H);
  for (const [key, type] of obstacles) {
    const [x, y] = key.split(',').map(Number);
    bytes[y * MAP_W + x] = OBSTACLE_TO_ID[type];
  }
  return bytesToBase64(bytes);
}

function decodeObstacleGrid(
  b64: string,
  tick: number,
): {
  obstacles: Map<string, ObstacleType>;
  furnaces: Map<string, { x: number; y: number }>;
  trees: Map<string, Tree>;
  cacti: Map<string, Cactus>;
  berryBushes: Map<string, BerryBush>;
} {
  const bytes = base64ToBytes(b64);
  const obstacles = new Map<string, ObstacleType>();
  const furnaces = new Map<string, { x: number; y: number }>();
  const trees = new Map<string, Tree>();
  const cacti = new Map<string, Cactus>();
  const berryBushes = new Map<string, BerryBush>();
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const type = ID_TO_OBSTACLE[bytes[y * MAP_W + x]];
      if (!type) continue;
      const key = x + ',' + y;
      obstacles.set(key, type);
      if (type === 'furnace') furnaces.set(key, { x, y });
      // a tree/cactus's hp isn't persisted — makeTreeAt/makeCactusAt always
      // start at full hp, so a half-chopped one just resets on reload.
      // Low-stakes (both are rare, hp isn't precious state) and simpler
      // than threading a second parallel hp grid through the save format
      // for this first pass. A berryBush's grow timer isn't persisted
      // either, but unlike hp it does need a starting point — restarted
      // from the loaded tick (see makeBerryBushAt), same full wait as any
      // other fresh placement, rather than a free instant berry.
      if (type === 'tree') trees.set(key, makeTreeAt(x, y));
      if (type === 'cactus') cacti.set(key, makeCactusAt(x, y));
      if (type === 'berryBush')
        berryBushes.set(key, makeBerryBushAt(x, y, tick));
    }
  }
  return { obstacles, furnaces, trees, cacti, berryBushes };
}

// same dense one-byte-per-cell approach as the obstacle grid above, its own
// id space starting fresh at 1 (independent of OBSTACLE_TO_ID's ids)
const FLOOR_TO_ID: Record<FloorType, number> = {
  dirt: 1,
  soil: 2,
};
const ID_TO_FLOOR: (FloorType | undefined)[] = [undefined, 'dirt', 'soil'];

function encodeFloorGrid(floor: Map<string, FloorType>): string {
  const bytes = new Uint8Array(MAP_W * MAP_H);
  for (const [key, type] of floor) {
    const [x, y] = key.split(',').map(Number);
    bytes[y * MAP_W + x] = FLOOR_TO_ID[type];
  }
  return bytesToBase64(bytes);
}

// `b64` is undefined when loading a save from before the floor layer
// existed — an empty floor map is the correct, unambiguous default there
function decodeFloorGrid(b64: string | undefined): Map<string, FloorType> {
  const floor = new Map<string, FloorType>();
  if (!b64) return floor;
  const bytes = base64ToBytes(b64);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const type = ID_TO_FLOOR[bytes[y * MAP_W + x]];
      if (!type) continue;
      floor.set(x + ',' + y, type);
    }
  }
  return floor;
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

// items are sparse (a couple hundred scattered across thousands of cells at
// most), so a dense per-cell grid like the obstacle grid above would waste
// space on all the empty cells — instead each item is 3 plain numbers (x,
// y, item-type id) flattened into one array, which drops the repeated
// "x"/"y"/"type" object keys and the redundant "x,y" string key that the
// old [key, {x,y,type}][] shape paid for on every entry
const ITEM_TO_ID: Record<ItemType, number> = {
  energy: 1,
  energySeed: 2,
  ore: 3,
  ingot: 4,
  sword: 5,
  bow: 6,
  cactusFruit: 7,
  berry: 8,
  poop: 9,
};
const ID_TO_ITEM: (ItemType | undefined)[] = [
  undefined,
  'energy',
  'energySeed',
  'ore',
  'ingot',
  'sword',
  'bow',
  'cactusFruit',
  'berry',
  'poop',
];

function encodeItems(items: Map<string, Item>): number[] {
  const flat: number[] = [];
  for (const item of items.values()) {
    flat.push(item.x, item.y, ITEM_TO_ID[item.type]);
  }
  return flat;
}

function decodeItems(flat: number[]): Map<string, Item> {
  const items = new Map<string, Item>();
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
  // absent on saves from before enemy types existed — loadGame defaults
  // both to a jerboa with no home, same as a pre-existing enemy always was
  type?: EnemyType;
  home?: Point | null;
  // absent on saves from before jerboa food-stealing existed — defaults to
  // not carrying anything
  carrying?: ItemType | null;
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
  // saved and restored verbatim (unlike the old wall-clock timers this
  // replaced) so seeds/smelters readyAt — measured in ticks — stays valid
  // across a reload instead of desyncing against a fresh performance.now()
  // epoch
  tick: number;
  tilesGrid: string;
  // absent on saves from before the floor layer existed — decodeFloorGrid
  // treats that as an empty floor map
  floorGrid?: string;
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
    tick: state.tick,
    tilesGrid: encodeObstacleGrid(state.obstacles),
    floorGrid: encodeFloorGrid(state.floor),
    groundItems: encodeItems(state.items),
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
        type: e.type,
        home: e.home,
        carrying: e.carrying,
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
  paintOasis(map, data.seed);
  const { obstacles, furnaces, trees, cacti, berryBushes } = decodeObstacleGrid(
    data.tilesGrid,
    data.tick ?? 0,
  );
  const floor = decodeFloorGrid(data.floorGrid);

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
    pendingUse: false,
    attacked: false,
    attackTarget: null,
    nextAttackAt: 0,
    nextMoveAt: 0,
    hp: sp.hp,
    maxHp: sp.maxHp ?? PLAYER_MAX_HP,
    flashUntil: 0,
  };

  const enemies = data.enemies.map((se) => {
    const e = makeEnemy(
      se.type ?? 'jerboa',
      se.tileX,
      se.tileY,
      se.home ?? null,
    );
    e.px = se.px;
    e.py = se.py;
    e.dir = se.dir;
    e.hp = se.hp;
    e.maxHp = se.maxHp;
    e.carrying = se.carrying ?? null;
    return e;
  });
  // the training dummy is disabled for now — see spawnEnemies in
  // entities/entities.ts for the same call-site removal

  const state: GameState = {
    refs,
    // old saves predate the tick clock — default to 0, same as a fresh game
    tick: data.tick ?? 0,
    seed: data.seed,
    rng: mulberry32(data.seed),
    map,
    floor,
    obstacles,
    items: decodeItems(data.groundItems),
    seeds: new Map(data.seeds),
    smelters: new Map(data.smelters),
    furnaces,
    trees,
    cacti,
    berryBushes,
    enemies,
    player,
    floatingTexts: [],
    projectiles: [],
    footprints: [],
    zoomIndex: data.zoomIndex,
    VP_W: 0,
    VP_H: 0,
    mapOpen: false,
    hoveredTile: null,
  };

  buildGroundAtlas(refs, map, floor, obstacles);
  buildWorldMapAtlas(refs, map, floor, obstacles);
  return state;
}
