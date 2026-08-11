// Save/load: snapshots the player-driven parts of GameState to localStorage
// so closing and reopening the tab picks up where it left off. `state.map`
// isn't persisted — it's cheap to rebuild (buildMap is a pure function of
// MAP_W/MAP_H) — but `state.tiles` is saved in full rather than replayed
// from the seed, since it already reflects everything the player has dug up
// or placed since world-gen ran. Transient per-frame/interaction fields
// (paths, pending actions, attack targets, timers keyed off the old
// performance.now() epoch) are deliberately dropped on load and rebuilt
// fresh, the same way createGameState/regenerateWorld initialize them.
import type {
  Dir,
  GameRefs,
  GameState,
  GroundItem,
  PlantedSeed,
  Player,
  Smelter,
  TileType,
} from '../types/types';
import { BASE_MOVE_DUR, MAP_H, MAP_W, PLAYER_MAX_HP } from '../constants';
import { buildMap, mulberry32 } from '../worldgen/worldgen';
import { buildGroundAtlas } from '../render/ground-atlas';
import { makeEnemy } from '../entities/entities';

const SAVE_KEY = 'project-survival-save-v1';

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
  tiles: [string, TileType][];
  groundItems: [string, GroundItem][];
  seeds: [string, PlantedSeed][];
  smelters: [string, Smelter][];
  enemies: SavedEnemy[];
  player: SavedPlayer;
  zoomIndex: number;
}

export function saveGame(state: GameState): void {
  const data: SaveData = {
    seed: state.seed,
    tiles: Array.from(state.tiles.entries()),
    groundItems: Array.from(state.groundItems.entries()),
    seeds: Array.from(state.seeds.entries()),
    smelters: Array.from(state.smelters.entries()),
    enemies: state.enemies.map((e) => ({
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
  const tiles = new Map<string, TileType>(data.tiles);
  const furnaces = new Map<string, { x: number; y: number }>();
  for (const key of tiles.keys()) {
    if (tiles.get(key) !== 'furnace') continue;
    const [x, y] = key.split(',').map(Number);
    furnaces.set(key, { x, y });
  }

  const sp = data.player;
  const player: Player = {
    tileX: sp.tileX,
    tileY: sp.tileY,
    px: sp.px,
    py: sp.py,
    dir: sp.dir,
    moving: false,
    moveStart: 0,
    moveDur: BASE_MOVE_DUR,
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
    invulnUntil: 0,
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

  const state: GameState = {
    refs,
    seed: data.seed,
    rng: mulberry32(data.seed),
    map,
    tiles,
    groundItems: new Map(data.groundItems),
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
