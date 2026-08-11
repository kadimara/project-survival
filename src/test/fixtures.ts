// Shared test fixtures for constructing minimal-but-real GameState/HudRefs
// objects. Not matched by the vitest include glob (src/**/*.test.ts).
import type { Enemy, GameRefs, GameState, HudRefs, Player } from '../types/types';
import { MAP_H, MAP_W, PLAYER_MAX_HP, SPAWN_X, SPAWN_Y, TILE } from '../constants';
import { buildMap, mulberry32 } from '../worldgen/worldgen';
import { makeEnemy } from '../entities/entities';

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
    moveDur: 240,
    fromX: 0,
    fromY: 0,
    toX: 0,
    toY: 0,
    path: [],
    held: null,
    pendingAction: null,
    attacked: false,
    attackTarget: null,
    lastAttack: 0,
    hp: PLAYER_MAX_HP,
    maxHp: PLAYER_MAX_HP,
    invulnUntil: 0,
    ...overrides,
  };
}

export function createTestEnemy(
  x: number,
  y: number,
  overrides?: Partial<Enemy>,
): Enemy {
  return { ...makeEnemy(x, y), ...overrides };
}

export function createTestGameState(overrides?: Partial<GameState>): GameState {
  const seed = 1;
  return {
    refs: createTestRefs(),
    seed,
    rng: mulberry32(seed),
    map: buildMap(MAP_W, MAP_H),
    tiles: new Map(),
    groundItems: new Map(),
    seeds: new Map(),
    smelters: new Map(),
    furnaces: new Map(),
    enemies: [],
    player: createTestPlayer(),
    floatingTexts: [],
    zoomIndex: 0,
    VP_W: 0,
    VP_H: 0,
    mapOpen: false,
    hoveredTile: null,
    ...overrides,
  };
}
