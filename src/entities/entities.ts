// Entity factories (enemies) and the generic actor-movement primitives
// shared by the player and enemies. Placement uses state/state.ts's
// occupancy queries; nothing in state/ imports back from here (spawnEnemies
// is injected into state's createGameState/regenerateWorld as a callback
// instead) so there's no import cycle between the two.
import type {
  Actor,
  Dir,
  Enemy,
  EnemyType,
  GameState,
  Point,
} from '../types/types';
import {
  ENEMY_DEFS,
  ENEMY_SPAWN_MIN_DIST,
  GUARDIAN_INHABIT_CHANCE,
  GUARDIAN_MAX_PER_CLUSTER,
  GUARDIAN_MIN_CLUSTER_SIZE,
  GUARDIAN_PLACEMENT_SALT,
  GUARDIAN_TILES_PER_GUARDIAN,
  JERBOA_COUNT,
  MAP_H,
  MAP_W,
  SPAWN_X,
  SPAWN_Y,
  TICK_MS,
  TILE,
} from '../constants';
import { randomOpenTile, walkable } from '../state/state';
import {
  type Cell,
  findClusterBorderTiles,
  mulberry32,
  planGuardianClusters,
  shuffleGuardianCandidates,
} from '../worldgen/worldgen';

export function makeEnemy(
  type: EnemyType,
  x: number,
  y: number,
  home: Point | null = null,
): Enemy {
  const def = ENEMY_DEFS[type];
  return {
    kind: 'enemy',
    type,
    tileX: x,
    tileY: y,
    px: x * TILE,
    py: y * TILE,
    dir: 'down',
    moving: false,
    moveStart: 0,
    moveDur: TICK_MS,
    fromX: x,
    fromY: y,
    toX: x,
    toY: y,
    path: [],
    hp: def.maxHp,
    maxHp: def.maxHp,
    state: 'wander',
    target: null,
    home,
    carrying: null,
    nextWanderAt:
      performance.now() +
      def.wanderMinMs +
      Math.random() * (def.wanderMaxMs - def.wanderMinMs),
    nextRepathAt: 0,
    nextAttackAt: 0,
    aggroUntil: 0,
    flashUntil: 0,
    stationary: false,
  };
}

// the fixed training dummy near spawn: infinite hp so it never dies, and
// `stationary` tells systems/ai.ts's updateEnemy to skip wander/chase/flee
// entirely — it only retaliates (on a slow cooldown) when the player stands
// next to it. Built from 'boulderGuardian' rather than 'jerboa': stationary
// short-circuits before wander/chase/flee either way, but attemptEnemyAttack
// still reads its damage from ENEMY_DEFS[type] fresh each retaliation, and a
// jerboa's atkDamage is deliberately 0 (it never fights) — boulderGuardian
// is the type that actually hits back, so the dummy borrows its stats.
export function makeDummyEnemy(x: number, y: number): Enemy {
  return {
    ...makeEnemy('boulderGuardian', x, y),
    hp: Infinity,
    maxHp: Infinity,
    stationary: true,
  };
}

// `structures` is buildWorldLayers' already-computed list of connected
// boulder-cluster structures (see findRegions in worldgen.ts), threaded
// through createGameState/regenerateWorld's spawnEnemies callback so this
// doesn't have to re-run a second full-map flood fill.
export function spawnEnemies(state: GameState, structures: Cell[][]): void {
  state.enemies.length = 0;
  // the training dummy is disabled for now — makeDummyEnemy is left intact
  // above so it's a one-line re-add, not a re-implementation
  for (let i = 0; i < JERBOA_COUNT; i++) {
    let spot: Point | null = null;
    for (let tries = 0; tries < 30; tries++) {
      const s = randomOpenTile(state);
      if (!s) break;
      if (Math.hypot(s.x - SPAWN_X, s.y - SPAWN_Y) >= ENEMY_SPAWN_MIN_DIST) {
        spot = s;
        break;
      }
    }
    if (spot) state.enemies.push(makeEnemy('jerboa', spot.x, spot.y));
  }

  // boulder guardians: a salted RNG stream, independent of both the terrain
  // noise's own seed usage and gameplay's state.rng, matching every other
  // world-gen placement pass (see OASIS_PLACEMENT_SALT et al. in
  // constants.ts) rather than the jerboa loop's live state.rng above.
  const stones = new Set<string>();
  for (const structure of structures)
    for (const cell of structure) stones.add(cell.x + ',' + cell.y);
  const guardianRng = mulberry32(state.seed ^ GUARDIAN_PLACEMENT_SALT);
  const plans = planGuardianClusters(
    guardianRng,
    structures,
    GUARDIAN_MIN_CLUSTER_SIZE,
    GUARDIAN_INHABIT_CHANCE,
    GUARDIAN_TILES_PER_GUARDIAN,
    GUARDIAN_MAX_PER_CLUSTER,
  );
  for (const { structure, count } of plans) {
    const border = findClusterBorderTiles(structure, stones, MAP_W, MAP_H);
    const candidates = shuffleGuardianCandidates(guardianRng, border);
    let placed = 0;
    for (const spot of candidates) {
      if (placed >= count) break;
      if (!walkable(state, spot.x, spot.y)) continue;
      state.enemies.push(makeEnemy('boulderGuardian', spot.x, spot.y, spot));
      placed++;
    }
  }
}

// ---- generic actor movement primitives (shared by player/enemy) ----
export function dirBetween(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): Dir {
  if (toX > fromX) return 'right';
  if (toX < fromX) return 'left';
  if (toY > fromY) return 'down';
  return 'up';
}

export function startStep(
  actor: Actor,
  nx: number,
  ny: number,
  dir: Dir,
): void {
  actor.dir = dir;
  actor.fromX = actor.tileX;
  actor.fromY = actor.tileY;
  actor.toX = nx;
  actor.toY = ny;
  actor.tileX = nx;
  actor.tileY = ny;
  actor.moving = true;
  actor.moveStart = performance.now();
}

export function updateActorAnimation(actor: Actor, now: number): void {
  if (!actor.moving) return;
  const t = Math.min(1, (now - actor.moveStart) / actor.moveDur);
  actor.px = (actor.fromX + (actor.toX - actor.fromX) * t) * TILE;
  actor.py = (actor.fromY + (actor.toY - actor.fromY) * t) * TILE;
  if (t >= 1) {
    actor.moving = false;
    actor.px = actor.toX * TILE;
    actor.py = actor.toY * TILE;
  }
}
