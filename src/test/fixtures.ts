// Shared test fixtures for constructing minimal-but-real GameState/HudRefs
// objects. Not matched by the vitest include glob (src/**/*.test.ts).
import type {
  Cactus,
  Enemy,
  GameRefs,
  GameState,
  HudRefs,
  Player,
  Tree,
} from '../types/types';
import {
  MAP_H,
  MAP_W,
  PLAYER_MAX_HP,
  SPAWN_X,
  SPAWN_Y,
  TICK_MS,
  TILE,
} from '../constants';
import { buildMap, mulberry32 } from '../worldgen/worldgen';
import { makeEnemy } from '../entities/entities';
import { makeCactusAt, makeTreeAt } from '../state/state';

// inert stub — safe to dereference only because tests that reach code paths
// touching state.refs (combat.ts's death path) mock render/ground-atlas.ts,
// the only module that ever calls into it
export function createTestRefs(): GameRefs {
  return {} as unknown as GameRefs;
}

function stubEl<T extends HTMLElement>(): T {
  return {
    textContent: '',
    style: {},
    classList: {
      add: () => {},
      remove: () => {},
    },
    addEventListener: () => {},
  } as unknown as T;
}

export function createTestHudRefs(): HudRefs {
  return {
    statHp: stubEl(),
    statCarry: stubEl(),
    toastEl: stubEl(),
    useItemBtn: stubEl(),

    worldMapOverlay: stubEl(),
    worldMapCloseBtn: stubEl(),
    mapToggleBtn: stubEl(),
    worldMapScroll: stubEl(),

    seedInput: stubEl(),
    seedLoadBtn: stubEl(),
    seedRandomBtn: stubEl(),
    zoomInBtn: stubEl(),
    zoomOutBtn: stubEl(),
  };
}

export function createTestPlayer(overrides?: Partial<Player>): Player {
  return {
    tileX: SPAWN_X,
    tileY: SPAWN_Y,
    px: SPAWN_X * TILE,
    py: SPAWN_Y * TILE,
    dir: 'down',
    moving: false,
    moveStart: 0,
    moveDur: TICK_MS,
    fromX: 0,
    fromY: 0,
    toX: 0,
    toY: 0,
    path: [],
    held: null,
    pendingAction: null,
    pendingUse: false,
    attacked: false,
    attackTarget: null,
    nextAttackAt: 0,
    nextMoveAt: 0,
    hp: PLAYER_MAX_HP,
    maxHp: PLAYER_MAX_HP,
    flashUntil: 0,
    ...overrides,
  };
}

// hp/maxHp default to a generous, test-only value rather than jerboa's real
// (low) ENEMY_DEFS.maxHp, so combat tests that just need "a sufficiently
// tanky enemy" (not specifically testing per-type hp) don't silently start
// asserting on a lethal hit whenever real balance numbers change — tests
// that do care about low/exact hp override it via `overrides`.
export function createTestEnemy(
  x: number,
  y: number,
  overrides?: Partial<Enemy>,
): Enemy {
  return {
    ...makeEnemy('jerboa', x, y),
    hp: 999,
    maxHp: 999,
    ...overrides,
  };
}

export function createTestTree(
  x: number,
  y: number,
  overrides?: Partial<Tree>,
): Tree {
  return { ...makeTreeAt(x, y), ...overrides };
}

export function createTestCactus(
  x: number,
  y: number,
  overrides?: Partial<Cactus>,
): Cactus {
  return { ...makeCactusAt(x, y), ...overrides };
}

export function createTestGameState(overrides?: Partial<GameState>): GameState {
  const seed = 1;
  return {
    refs: createTestRefs(),
    tick: 0,
    seed,
    rng: mulberry32(seed),
    map: buildMap(MAP_W, MAP_H),
    floor: new Map(),
    obstacles: new Map(),
    items: new Map(),
    seeds: new Map(),
    smelters: new Map(),
    furnaces: new Map(),
    trees: new Map(),
    cacti: new Map(),
    berryBushes: new Map(),
    enemies: [],
    player: createTestPlayer(),
    floatingTexts: [],
    projectiles: [],
    footprints: [],
    zoomIndex: 0,
    VP_W: 0,
    VP_H: 0,
    mapOpen: false,
    hoveredTile: null,
    ...overrides,
  };
}
