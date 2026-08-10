// GameState lifecycle and terrain/entity-occupancy queries. Entity factories
// and generic actor-movement primitives live in entities/entities.ts instead —
// this module never imports them; `createGameState`/`regenerateWorld` take
// `spawnEnemies` as a callback parameter so the two files don't form an
// import cycle (entities/entities.ts imports randomOpenTile from here, one
// direction only).
import type {
  CarryType,
  GameRefs,
  GameState,
  GroundItem,
  ItemType,
  Point,
  TileType,
} from '../types/types';
import {
  INITIAL_FOOD_COUNT,
  INITIAL_SEED,
  MAP_H,
  MAP_W,
  PLAYER_MAX_HP,
  SPAWN_X,
  SPAWN_Y,
  TILE,
  TILE_DEFS,
} from '../constants';
import { buildMap, buildStones, mulberry32 } from '../worldgen/worldgen';
import { buildGroundAtlas, patchGroundAtlasTile } from '../render/ground-atlas';

export function terrainWalkable(
  state: GameState,
  x: number,
  y: number,
): boolean {
  if (x < 0 || y < 0 || y >= state.map.length || x >= state.map[0].length)
    return false;
  return true;
}

export function isSolid(state: GameState, x: number, y: number): boolean {
  const t = state.tiles.get(x + ',' + y);
  return t !== undefined && TILE_DEFS[t].solid;
}

export function setTile(
  state: GameState,
  x: number,
  y: number,
  type: TileType | null,
): void {
  const key = x + ',' + y;
  if (type) {
    state.tiles.set(key, type);
  } else {
    state.tiles.delete(key);
  }
  patchGroundAtlasTile(state.refs, state.map, x, y, state.tiles.get(key));
}

// writes `type` as the occupant at (x,y), clearing whichever of
// state.tiles/state.groundItems currently holds the key first — needed
// because a combine result can land in a different layer than either its
// held or target inputs came from. Reuses setTile for the tile-layer case
// so the ground atlas patch still happens.
export function setOccupant(
  state: GameState,
  x: number,
  y: number,
  type: CarryType | null,
): void {
  const key = x + ',' + y;
  if (state.tiles.has(key)) setTile(state, x, y, null);
  else state.groundItems.delete(key);

  if (type === null) return;
  if (type in TILE_DEFS) setTile(state, x, y, type as TileType);
  else state.groundItems.set(key, { x, y, type: type as ItemType });
}

export function tileAt(
  state: GameState,
  x: number,
  y: number,
): TileType | undefined {
  return state.tiles.get(x + ',' + y);
}

export function groundItemAt(
  state: GameState,
  x: number,
  y: number,
): GroundItem | undefined {
  return state.groundItems.get(x + ',' + y);
}

// single occupancy check across both layers — replaces the repeated
// `!isSolid(...) && !groundItemAt(...)` pattern that used to appear at
// every call site that just needs to know "is anything here"
export function occupantAt(
  state: GameState,
  x: number,
  y: number,
): TileType | ItemType | null {
  return tileAt(state, x, y) ?? groundItemAt(state, x, y)?.type ?? null;
}

export function isEnemyAt(state: GameState, x: number, y: number): boolean {
  return state.enemies.some((e) => e.hp > 0 && e.tileX === x && e.tileY === y);
}

export function isPlayerAt(state: GameState, x: number, y: number): boolean {
  return state.player.tileX === x && state.player.tileY === y;
}

export function walkable(state: GameState, x: number, y: number): boolean {
  return (
    terrainWalkable(state, x, y) &&
    !isSolid(state, x, y) &&
    !isEnemyAt(state, x, y) &&
    !isPlayerAt(state, x, y)
  );
}

export function randomOpenTile(state: GameState): Point | null {
  for (let tries = 0; tries < 300; tries++) {
    const x = 1 + Math.floor(state.rng() * (MAP_W - 2));
    const y = 1 + Math.floor(state.rng() * (MAP_H - 2));
    if (
      !occupantAt(state, x, y) &&
      !isEnemyAt(state, x, y) &&
      !isPlayerAt(state, x, y)
    )
      return { x, y };
  }
  return null;
}

// places a ground item at (tx,ty), falling back to a neighboring open tile
// if that exact spot is occupied — shared by world-gen food seeding, player
// drops, and combat.ts's death drops, so a carried/dropped item never has
// nowhere to go
export function placeGroundItemNear(
  state: GameState,
  tx: number,
  ty: number,
  type: ItemType,
): boolean {
  // the origin tile is where the dropping actor itself is standing, so its
  // own occupancy there doesn't make it "taken" — only ring tiles need the
  // player occupancy check, otherwise dropping at (tx,ty) always fails (the
  // actor is always standing there) and pushes the item onto a ring tile
  const freeAt = (x: number, y: number, isOrigin: boolean) =>
    terrainWalkable(state, x, y) &&
    !occupantAt(state, x, y) &&
    !isEnemyAt(state, x, y) &&
    (isOrigin || !isPlayerAt(state, x, y));
  let dropX = tx,
    dropY = ty;
  if (!freeAt(dropX, dropY, true)) {
    const ring = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ];
    let placed = false;
    for (const [dx, dy] of ring) {
      if (freeAt(tx + dx, ty + dy, false)) {
        dropX = tx + dx;
        dropY = ty + dy;
        placed = true;
        break;
      }
    }
    if (!placed) return false;
  }
  state.groundItems.set(dropX + ',' + dropY, { x: dropX, y: dropY, type });
  return true;
}

// builds the noise-generated 'stone' layer via worldgen.ts's buildStones
// (left completely untouched), then adds one 'ore' tile near spawn purely so
// a second tile type is visible/testable in-game — not part of procedural
// generation, a fixed offset within buildStones's own carved spawn-safety
// bubble guarantees it's always open ground and reachable
function buildTiles(seed: number): Map<string, TileType> {
  const keys = buildStones(seed, MAP_W, MAP_H, SPAWN_X, SPAWN_Y);
  const tiles = new Map<string, TileType>();
  for (const key of keys) tiles.set(key, 'stone');
  tiles.set(SPAWN_X + 2 + ',' + SPAWN_Y, 'ore');
  return tiles;
}

export function spawnFloatingText(
  state: GameState,
  entity: { px: number; py: number },
  text: string,
  color: string,
): void {
  state.floatingTexts.push({
    worldX: entity.px + TILE / 2,
    worldY: entity.py,
    text,
    color,
    born: performance.now(),
  });
}

// rebuilds the whole world in place from a new seed — no reload needed,
// since navigating/rewriting the URL isn't available in this environment.
// Purely mutates state; callers are responsible for refreshing any HUD/DOM.
export function regenerateWorld(
  state: GameState,
  newSeed: number,
  spawnEnemies: (state: GameState) => void,
): void {
  state.seed = newSeed;
  state.rng = mulberry32(newSeed);

  state.tiles = buildTiles(newSeed);
  buildGroundAtlas(state.refs, state.map, state.tiles);
  state.groundItems.clear();
  for (let i = 0; i < INITIAL_FOOD_COUNT; i++) {
    const s = randomOpenTile(state);
    if (s) state.groundItems.set(s.x + ',' + s.y, { ...s, type: 'energy' });
  }
  spawnEnemies(state);

  const { player } = state;
  player.held = null;
  player.pendingAction = null;
  player.attackTarget = null;
  player.path = [];
  player.attacked = false;
  player.moving = false;
  player.tileX = SPAWN_X;
  player.tileY = SPAWN_Y;
  player.px = SPAWN_X * TILE;
  player.py = SPAWN_Y * TILE;
  player.hp = player.maxHp;
  player.invulnUntil = 0;
}

export function createGameState(
  refs: GameRefs,
  spawnEnemies: (state: GameState) => void,
): GameState {
  const seed = INITIAL_SEED;
  const rng = mulberry32(seed);
  const map = buildMap(MAP_W, MAP_H);
  const tiles = buildTiles(seed);

  const state: GameState = {
    refs,
    seed,
    rng,
    map,
    tiles,
    groundItems: new Map(),
    enemies: [],
    player: {
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
    },
    floatingTexts: [],
    zoomIndex: 0,
    VP_W: 0,
    VP_H: 0,
    mapOpen: false,
    hoveredTile: null,
  };

  buildGroundAtlas(refs, map, tiles);
  for (let i = 0; i < INITIAL_FOOD_COUNT; i++) {
    const s = randomOpenTile(state);
    if (s) state.groundItems.set(s.x + ',' + s.y, { ...s, type: 'energy' });
  }
  spawnEnemies(state);

  return state;
}
