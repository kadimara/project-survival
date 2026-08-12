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
  INITIAL_ENERGY_SEED_COUNT,
  INITIAL_SEED,
  MAP_H,
  MAP_W,
  PLAYER_MAX_HP,
  SPAWN_X,
  SPAWN_Y,
  TICK_MS,
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
  if (type === 'furnace') state.furnaces.set(key, { x, y });
  else state.furnaces.delete(key);
  patchGroundAtlasTile(state.refs, state.map, x, y, state.tiles.get(key));
}

// writes `type` as the occupant at (x,y), first clearing whichever existing
// occupant `type` is about to replace — needed because a combine result can
// land in a different layer than either its held or target inputs came
// from. A tile that allows a ground item on top of it (soil) is only
// cleared when it's the tile layer itself being overwritten, so placing an
// item on top of it leaves the tile in place. Reuses setTile for the
// tile-layer case so the ground atlas patch still happens.
export function setOccupant(
  state: GameState,
  x: number,
  y: number,
  type: CarryType | null,
): void {
  const key = x + ',' + y;
  const existingTile = state.tiles.get(key);
  const tileBlocks =
    existingTile !== undefined && !TILE_DEFS[existingTile].allowGroundItem;

  if (tileBlocks) setTile(state, x, y, null);
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
// every call site that just needs to know "is anything here". For a tile
// that allows a ground item on top of it (soil), an item sitting there
// takes priority over the tile itself, so combining/picking up targets the
// item rather than the soil underneath.
export function occupantAt(
  state: GameState,
  x: number,
  y: number,
): TileType | ItemType | null {
  const tile = tileAt(state, x, y);
  if (tile !== undefined && !TILE_DEFS[tile].allowGroundItem) return tile;
  return groundItemAt(state, x, y)?.type ?? tile ?? null;
}

// true when (x,y) is a tile that allows a ground item on top of it (soil,
// furnace) and nothing is already sitting there — the direct-placement
// slot a ground item can drop into without going through the tile/combine
// check, since occupantAt reports a bare allowGroundItem tile as occupied
// (so pickup/click routing still finds it). Also excludes a cell with a
// planted (not-yet-grown) seed or an in-progress furnace job, both of
// which live outside state.groundItems and would otherwise get silently
// shadowed by a new drop.
export function openForGroundItem(
  state: GameState,
  x: number,
  y: number,
): boolean {
  const key = x + ',' + y;
  const tile = tileAt(state, x, y);
  return (
    tile !== undefined &&
    TILE_DEFS[tile].allowGroundItem &&
    !state.groundItems.has(key) &&
    !state.seeds.has(key) &&
    !state.smelters.has(key)
  );
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

// scatters `count` wild ground items of `type` across random open tiles —
// shared by the wild-energy and wild-energySeed seeding loops below, since
// both createGameState and regenerateWorld need to run each twice
function seedWildItems(state: GameState, count: number, type: ItemType): void {
  for (let i = 0; i < count; i++) {
    const s = randomOpenTile(state);
    if (s) state.groundItems.set(s.x + ',' + s.y, { ...s, type });
  }
}

// the extra 'stone' tiles buildTiles adds near spawn (see its comment) each
// get an ore ground item — enough (3) to smelt into ingots for one sword
// (2 ingots) with one ore left over, purely so the ore->ingot->sword loop is
// playable/testable in-game without a real ore-vein worldgen pass
const SPAWN_ORE_OFFSETS: [number, number][] = [
  [2, 0],
  [2, 1],
  [2, -1],
];

function placeSpawnOre(state: GameState): void {
  for (const [dx, dy] of SPAWN_ORE_OFFSETS) {
    const x = SPAWN_X + dx,
      y = SPAWN_Y + dy;
    state.groundItems.set(x + ',' + y, { x, y, type: 'ore' });
  }
}

// builds the noise-generated 'stone' layer via worldgen.ts's buildStones
// (left completely untouched), then adds a few extra fixed tiles near
// spawn purely so those types (and the ore ground items sitting on some of
// them, see placeSpawnOre) are visible/testable in-game — not part of
// procedural generation, fixed offsets within buildStones's own carved
// spawn-safety bubble guarantee they're always open ground and reachable
function buildTiles(seed: number): Map<string, TileType> {
  const keys = buildStones(seed, MAP_W, MAP_H, SPAWN_X, SPAWN_Y);
  const tiles = new Map<string, TileType>();
  for (const key of keys) tiles.set(key, 'stone');
  for (const [dx, dy] of SPAWN_ORE_OFFSETS) {
    tiles.set(SPAWN_X + dx + ',' + (SPAWN_Y + dy), 'stone');
  }
  tiles.set(SPAWN_X - 2 + ',' + SPAWN_Y, 'soil');
  tiles.set(SPAWN_X + ',' + (SPAWN_Y - 2), 'wood');
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
  state.seeds.clear();
  state.smelters.clear();
  state.furnaces.clear();
  seedWildItems(state, INITIAL_ENERGY_SEED_COUNT, 'energySeed');
  placeSpawnOre(state);
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
  player.flashUntil = 0;
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
    tick: 0,
    seed,
    rng,
    map,
    tiles,
    groundItems: new Map(),
    seeds: new Map(),
    smelters: new Map(),
    furnaces: new Map(),
    enemies: [],
    player: {
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
      attacked: false,
      attackTarget: null,
      lastAttack: 0,
      hp: PLAYER_MAX_HP,
      maxHp: PLAYER_MAX_HP,
      flashUntil: 0,
    },
    floatingTexts: [],
    zoomIndex: 0,
    VP_W: 0,
    VP_H: 0,
    mapOpen: false,
    hoveredTile: null,
  };

  buildGroundAtlas(refs, map, tiles);
  seedWildItems(state, INITIAL_ENERGY_SEED_COUNT, 'energySeed');
  placeSpawnOre(state);
  spawnEnemies(state);

  return state;
}
