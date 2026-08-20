// GameState lifecycle and terrain/entity-occupancy queries. Entity factories
// and generic actor-movement primitives live in entities/entities.ts instead —
// this module never imports them; `createGameState`/`regenerateWorld` take
// `spawnEnemies` as a callback parameter so the two files don't form an
// import cycle (entities/entities.ts imports randomOpenTile from here, one
// direction only).
import type {
  BerryBush,
  Cactus,
  CarryType,
  FloorType,
  GameRefs,
  GameState,
  Item,
  ItemType,
  ObstacleType,
  Point,
  Tree,
} from '../types/types';
import {
  BERRY_BUSH_GROW_TICKS,
  BUSH_RING_MAX,
  BUSH_RING_MIN,
  BUSH_SPAWN_CHANCE,
  CACTUS_MAX_HP,
  CACTUS_PLACEMENT_SALT,
  CACTUS_SPAWN_CHANCE,
  CACTUS_SPAWN_SAFETY_R,
  FLOOR_DEFS,
  FOOTPRINT_MAX,
  INITIAL_SEED,
  MAP_H,
  MAP_W,
  MIN_STRUCTURE_SIZE,
  OASIS_DISTANCE_TILES,
  OASIS_PLACEMENT_SALT,
  OASIS_RADIUS,
  OBSTACLE_DEFS,
  ORE_SPAWN_CHANCE,
  PLAYER_MAX_HP,
  RESOURCE_PLACEMENT_SALT,
  SPAWN_X,
  SPAWN_Y,
  TICK_MS,
  TILE,
  TREE_MAX_HP,
  TREE_RING_MAX,
  TREE_RING_MIN,
  TREE_SPAWN_CHANCE,
  VEGETATION_PLACEMENT_SALT,
} from '../constants';
import {
  buildCactusScatter,
  buildMap,
  buildOasisPatch,
  buildStones,
  buildVegetationRing,
  findRegions,
  interiorCells,
  mulberry32,
  OASIS,
} from '../worldgen/worldgen';
import {
  buildGroundAtlas,
  buildWorldMapAtlas,
  patchGroundAtlasTile,
  patchWorldMapAtlasTile,
} from '../render/ground-atlas';

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
  const o = state.obstacles.get(x + ',' + y);
  return o !== undefined && OBSTACLE_DEFS[o].solid;
}

// a fresh, full-hp tree at (x,y) — used both by world-gen (buildWorldLayers
// below, via setObstacle) and by persistence.ts's decodeObstacleGrid.
// Defined here rather than in entities/entities.ts (which has the
// equivalent makeEnemy/makeDummyEnemy factories) so this module doesn't
// need to import entities.ts and reintroduce the import cycle the module
// layout deliberately avoids (entities.ts already imports one-way from
// this file). A tree never moves, so px/py are just a static snapshot of
// tileX/tileY * TILE, not kept in sync by anything.
export function makeTreeAt(x: number, y: number): Tree {
  return {
    kind: 'tree',
    tileX: x,
    tileY: y,
    px: x * TILE,
    py: y * TILE,
    hp: TREE_MAX_HP,
    maxHp: TREE_MAX_HP,
    flashUntil: 0,
  };
}

// a fresh, full-hp cactus at (x,y) — mirrors makeTreeAt above, used both by
// world-gen (buildWorldLayers below, via setObstacle) and by
// persistence.ts's decodeObstacleGrid. Never moves, so px/py are a static
// snapshot like a tree's.
export function makeCactusAt(x: number, y: number): Cactus {
  return {
    kind: 'cactus',
    tileX: x,
    tileY: y,
    px: x * TILE,
    py: y * TILE,
    hp: CACTUS_MAX_HP,
    maxHp: CACTUS_MAX_HP,
    flashUntil: 0,
  };
}

// a fresh berryBush at (x,y), its grow timer starting from `tick` — used by
// world-gen (buildWorldLayers below, tick 0), setObstacle (the current
// state.tick, so a player-placed bush starts its own wait right away), and
// persistence.ts's decodeObstacleGrid (the loaded tick). Never ready
// immediately: placing/loading a bush starts the same
// BERRY_BUSH_GROW_TICKS wait as any regrow (see doPickup in
// systems/player-actions.ts, which re-arms it the same way once harvested).
export function makeBerryBushAt(x: number, y: number, tick: number): BerryBush {
  return { x, y, readyAt: tick + BERRY_BUSH_GROW_TICKS };
}

export function setObstacle(
  state: GameState,
  x: number,
  y: number,
  type: ObstacleType | null,
): void {
  const key = x + ',' + y;
  if (type) {
    state.obstacles.set(key, type);
  } else {
    state.obstacles.delete(key);
  }
  if (type === 'furnace') state.furnaces.set(key, { x, y });
  else state.furnaces.delete(key);
  if (type === 'tree') state.trees.set(key, makeTreeAt(x, y));
  else state.trees.delete(key);
  if (type === 'cactus') state.cacti.set(key, makeCactusAt(x, y));
  else state.cacti.delete(key);
  if (type === 'berryBush')
    state.berryBushes.set(key, makeBerryBushAt(x, y, state.tick));
  else state.berryBushes.delete(key);
  patchGroundAtlasTile(
    state.refs,
    state.map,
    state.floor,
    x,
    y,
    state.obstacles.get(key),
  );
  patchWorldMapAtlasTile(
    state.refs,
    state.map,
    state.floor,
    x,
    y,
    state.obstacles.get(key),
  );
}

export function floorAt(
  state: GameState,
  x: number,
  y: number,
): FloorType | undefined {
  return state.floor.get(x + ',' + y);
}

// mirrors setObstacle for the floor layer — floor never affects furnaces or
// solidity (see FLOOR_DEFS's comment in constants.ts), so this is just the
// map mutation plus the same atlas repatch.
export function setFloor(
  state: GameState,
  x: number,
  y: number,
  type: FloorType | null,
): void {
  const key = x + ',' + y;
  if (type) state.floor.set(key, type);
  else state.floor.delete(key);
  patchGroundAtlasTile(
    state.refs,
    state.map,
    state.floor,
    x,
    y,
    state.obstacles.get(key),
  );
  patchWorldMapAtlasTile(
    state.refs,
    state.map,
    state.floor,
    x,
    y,
    state.obstacles.get(key),
  );
}

// writes `type` as the occupant at (x,y), first clearing whichever existing
// occupant `type` is about to replace — needed because a combine result can
// land in a different layer than either its held or target inputs came
// from (e.g. dirt + poop -> soil: a floor result from a held-floor +
// target-item combine, see RECIPES in systems/combine.ts). An obstacle that
// allows an item on top of it (furnace) is only cleared when it's the
// obstacle layer itself being overwritten, so placing an item on top of it
// leaves the obstacle in place. Reuses setObstacle/setFloor for their
// respective layers so the ground atlas patch still happens either way.
export function setOccupant(
  state: GameState,
  x: number,
  y: number,
  type: CarryType | null,
): void {
  const key = x + ',' + y;
  const existingObstacle = state.obstacles.get(key);
  const obstacleBlocks =
    existingObstacle !== undefined &&
    !OBSTACLE_DEFS[existingObstacle].allowItem;

  if (obstacleBlocks) setObstacle(state, x, y, null);
  else state.items.delete(key);

  if (type === null) return;
  if (type in FLOOR_DEFS) setFloor(state, x, y, type as FloorType);
  else if (type in OBSTACLE_DEFS)
    setObstacle(state, x, y, type as ObstacleType);
  else state.items.set(key, { x, y, type: type as ItemType });
}

export function obstacleAt(
  state: GameState,
  x: number,
  y: number,
): ObstacleType | undefined {
  return state.obstacles.get(x + ',' + y);
}

export function itemAt(
  state: GameState,
  x: number,
  y: number,
): Item | undefined {
  return state.items.get(x + ',' + y);
}

// single occupancy check across both layers (plus a planted-but-not-yet-
// grown energySeed, see below) — replaces the repeated `!isSolid(...) &&
// !itemAt(...)` pattern that used to appear at every call site that just
// needs to know "is anything here". For an obstacle that allows an item on
// top of it (furnace), an item sitting there takes priority over the
// obstacle itself, so combining/picking up targets the item rather than the
// furnace underneath. A planted energySeed on bare soil (no energy grown
// yet) is reported as 'energySeed' — soil itself is a FloorType, so a bare
// planted seed is otherwise invisible to this obstacle/item-only check, and
// without this fallback a held obstacle could get silently placed on top of
// it (see doPlace/tryPlaceAt in systems/player-actions.ts). A berryBush
// needs no equivalent fallback — it's a normal solid obstacle itself, so
// the obstacle check above already reports it.
export function occupantAt(
  state: GameState,
  x: number,
  y: number,
): ObstacleType | ItemType | null {
  const obstacle = obstacleAt(state, x, y);
  if (obstacle !== undefined && !OBSTACLE_DEFS[obstacle].allowItem)
    return obstacle;
  const item = itemAt(state, x, y)?.type;
  if (item !== undefined) return item;
  if (obstacle !== undefined) return obstacle;
  return state.seeds.has(x + ',' + y) ? 'energySeed' : null;
}

// true when (x,y) is an obstacle that allows an item on top of it (furnace)
// and nothing is already sitting there — the direct-placement slot an item
// can drop into without going through the obstacle/combine check, since
// occupantAt reports a bare allowItem obstacle as occupied (so pickup/click
// routing still finds it). Also excludes a cell with a planted (not-yet-
// grown) energySeed or an in-progress furnace job, both of which live
// outside state.items and would otherwise get silently shadowed by a new
// drop.
export function openForItem(state: GameState, x: number, y: number): boolean {
  const key = x + ',' + y;
  const obstacle = obstacleAt(state, x, y);
  return (
    obstacle !== undefined &&
    OBSTACLE_DEFS[obstacle].allowItem &&
    !state.items.has(key) &&
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

// places an item at (tx,ty), falling back to a neighboring open tile if
// that exact spot is occupied — shared by world-gen food seeding, player
// drops, and combat.ts's death drops, so a carried/dropped item never has
// nowhere to go
export function placeItemNear(
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
  state.items.set(dropX + ',' + dropY, { x: dropX, y: dropY, type });
  return true;
}

// paints the one oasis patch into `map`'s background layer and returns the
// cells it touched — callers that also build state.obstacles
// (buildWorldLayers below) use the returned set to keep stone from
// generating underneath it; loadGame (persistence.ts) only needs the paint
// side effect, since the saved obstacles already reflect a world that had
// the oasis carved out at generation time
export function paintOasis(map: number[][], seed: number): Set<string> {
  const rng = mulberry32(seed ^ OASIS_PLACEMENT_SALT);
  const oasis = buildOasisPatch(
    rng,
    MAP_W,
    MAP_H,
    SPAWN_X,
    SPAWN_Y,
    OASIS_DISTANCE_TILES,
    OASIS_RADIUS,
  );
  for (const key of oasis) {
    const [x, y] = key.split(',').map(Number);
    map[y][x] = OASIS;
  }
  return oasis;
}

// builds the noise-generated 'stone' layer via worldgen.ts's buildStones
// (left completely untouched), then enumerates the separated boulder-cluster
// "structures" that noise pass produces (findRegions, called directly on
// buildStones' own `stones` set — each connected clump of solid tiles is one
// structure) and, for every one at or above MIN_STRUCTURE_SIZE, rolls ore
// independently on each interior cell (worldgen.ts's interiorCells, so ore
// never lands on a structure's outer edge — it has to be dug into, not just
// walked up to) at ORE_SPAWN_CHANCE. Ore is an item placed on cells that
// stay 'stone' — same pattern the ground already uses for it elsewhere
// (doPickup checks state.items before the obstacle, so the item is grabbed
// on approach and the stone obstacle itself still needs a separate dig to
// clear). Resource items are returned separately since state.items isn't
// populated until after the atlas is built (see
// createGameState/regenerateWorld). Clusters below the threshold are left
// as plain undecorated stone — small rubble, not real scavenge sites.
// Because buildStones' spawn-safety carve always removes a 25-tile bubble
// from `stones` regardless of seed, the player never spawns inside a
// structure — it always starts in the open wasteland and has to go find one.
// Also paints the one oasis patch into `map` and carves it out of `stones`
// so the two features never fight for the same cells (see paintOasis above).
// Finally scatters vegetation in a ring around the oasis (buildVegetationRing)
// — bushes as 'berryBush' obstacles, trees as a dedicated 2-tall 'tree' obstacle
// (only the trunk cell collides or occupies state.obstacles; the canopy is a
// per-frame, y-sorted visual — see the tree pass in render.ts) — carved out
// of `stones` the same way the oasis itself is, so vegetation never tries to
// grow out of a boulder. A tree's trunk cell gets a 'dirt' floor tile
// underneath it (the floor layer, see FloorType in types.ts); a wild bush
// gets no floor at all, so it just sits there inert until moved onto soil
// (see updateBerryBushes in systems/farming.ts) — soil never enters the
// world at world-gen time, only via the dirt + poop combine recipe (see
// RECIPES in systems/combine.ts). Picking up the obstacle only touches
// state.obstacles, so a tree's floor is left exposed automatically, no
// special-casing needed.
function buildWorldLayers(
  seed: number,
  map: number[][],
  tick: number,
): {
  floor: Map<string, FloorType>;
  obstacles: Map<string, ObstacleType>;
  trees: Map<string, Tree>;
  cacti: Map<string, Cactus>;
  berryBushes: Map<string, BerryBush>;
  resourceItems: Item[];
} {
  const oasis = paintOasis(map, seed);
  const stones = buildStones(seed, MAP_W, MAP_H, SPAWN_X, SPAWN_Y);
  for (const key of oasis) stones.delete(key);
  const obstacles = new Map<string, ObstacleType>();
  for (const key of stones) obstacles.set(key, 'stone');

  const vegRng = mulberry32(seed ^ VEGETATION_PLACEMENT_SALT);
  const { bushes, trees: treeCells } = buildVegetationRing(
    vegRng,
    oasis,
    MAP_W,
    MAP_H,
    { min: BUSH_RING_MIN, max: BUSH_RING_MAX, chance: BUSH_SPAWN_CHANCE },
    { min: TREE_RING_MIN, max: TREE_RING_MAX, chance: TREE_SPAWN_CHANCE },
  );
  const floor = new Map<string, FloorType>();
  const trees = new Map<string, Tree>();
  const berryBushes = new Map<string, BerryBush>();
  for (const key of bushes) {
    if (stones.has(key)) continue;
    obstacles.set(key, 'berryBush');
    const [x, y] = key.split(',').map(Number);
    berryBushes.set(key, makeBerryBushAt(x, y, tick));
  }
  for (const key of treeCells) {
    if (stones.has(key) || bushes.has(key)) continue;
    obstacles.set(key, 'tree');
    floor.set(key, 'dirt');
    const [x, y] = key.split(',').map(Number);
    trees.set(key, makeTreeAt(x, y));
  }

  // scattered across the whole map, not just the oasis ring — see
  // buildCactusScatter's comment in worldgen.ts
  const cactusRng = mulberry32(seed ^ CACTUS_PLACEMENT_SALT);
  const cactusExclude = new Set<string>([
    ...stones,
    ...oasis,
    ...bushes,
    ...treeCells,
  ]);
  const cactusCells = buildCactusScatter(
    cactusRng,
    MAP_W,
    MAP_H,
    cactusExclude,
    SPAWN_X,
    SPAWN_Y,
    CACTUS_SPAWN_SAFETY_R,
    CACTUS_SPAWN_CHANCE,
  );
  const cacti = new Map<string, Cactus>();
  for (const key of cactusCells) {
    obstacles.set(key, 'cactus');
    const [x, y] = key.split(',').map(Number);
    cacti.set(key, makeCactusAt(x, y));
  }

  const structures = findRegions(stones, MAP_W, MAP_H);
  const rng = mulberry32(seed ^ RESOURCE_PLACEMENT_SALT);
  const resourceItems: Item[] = [];

  for (const structure of structures) {
    if (structure.length < MIN_STRUCTURE_SIZE) continue;
    for (const cell of interiorCells(structure, stones)) {
      if (rng() < ORE_SPAWN_CHANCE)
        resourceItems.push({ x: cell.x, y: cell.y, type: 'ore' });
    }
  }
  return { floor, obstacles, trees, cacti, berryBushes, resourceItems };
}

// records one sand-trail mark at (x,y), the tile the player is stepping off
// of — called on every successful player step (see tryPlayerStep in
// systems/player-actions.ts), not the generic startStep primitive shared
// with enemies, since the trail is player-only. Bounded to FOOTPRINT_MAX so
// a long walk doesn't grow the array forever — the oldest mark is dropped
// first, same as it'd have faded out anyway.
export function leaveFootprint(state: GameState, x: number, y: number): void {
  state.footprints.push({ x, y, born: performance.now() });
  if (state.footprints.length > FOOTPRINT_MAX) state.footprints.shift();
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

  state.map = buildMap(MAP_W, MAP_H);
  const { floor, obstacles, trees, cacti, berryBushes, resourceItems } =
    buildWorldLayers(newSeed, state.map, state.tick);
  state.floor = floor;
  state.obstacles = obstacles;
  state.trees = trees;
  state.cacti = cacti;
  state.berryBushes = berryBushes;
  buildGroundAtlas(state.refs, state.map, state.floor, state.obstacles);
  buildWorldMapAtlas(state.refs, state.map, state.floor, state.obstacles);
  state.items.clear();
  state.seeds.clear();
  state.smelters.clear();
  state.furnaces.clear();
  state.projectiles.length = 0;
  state.footprints.length = 0;
  for (const item of resourceItems)
    state.items.set(item.x + ',' + item.y, item);
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
  const { floor, obstacles, trees, cacti, berryBushes, resourceItems } =
    buildWorldLayers(seed, map, 0);

  const state: GameState = {
    refs,
    tick: 0,
    seed,
    rng,
    map,
    floor,
    obstacles,
    items: new Map(),
    seeds: new Map(),
    smelters: new Map(),
    furnaces: new Map(),
    trees,
    cacti,
    berryBushes,
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
      pendingUse: false,
      attacked: false,
      attackTarget: null,
      nextAttackAt: 0,
      nextMoveAt: 0,
      hp: PLAYER_MAX_HP,
      maxHp: PLAYER_MAX_HP,
      flashUntil: 0,
    },
    floatingTexts: [],
    projectiles: [],
    footprints: [],
    zoomIndex: 0,
    VP_W: 0,
    VP_H: 0,
    mapOpen: false,
    hoveredTile: null,
  };

  buildGroundAtlas(refs, map, floor, obstacles);
  buildWorldMapAtlas(refs, map, floor, obstacles);
  for (const item of resourceItems)
    state.items.set(item.x + ',' + item.y, item);
  spawnEnemies(state);

  return state;
}
