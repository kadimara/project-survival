// Entity factories (enemies) and the generic actor-movement primitives
// shared by the player and enemies. Placement uses state/state.ts's
// occupancy queries; nothing in state/ imports back from here (spawnEnemies
// is injected into state's createGameState/regenerateWorld as a callback
// instead) so there's no import cycle between the two.
import type { Actor, Dir, Enemy, GameState, Point } from '../types/types';
import {
  ENEMY_COUNT,
  ENEMY_MAX_HP,
  ENEMY_MOVE_DUR,
  ENEMY_SPAWN_MIN_DIST,
  ENEMY_WANDER_MAX_MS,
  ENEMY_WANDER_MIN_MS,
  SPAWN_X,
  SPAWN_Y,
  TILE,
} from '../constants';
import { randomOpenTile } from '../state/state';

function makeEnemy(x: number, y: number): Enemy {
  return {
    tileX: x,
    tileY: y,
    px: x * TILE,
    py: y * TILE,
    dir: 'down',
    moving: false,
    moveStart: 0,
    moveDur: ENEMY_MOVE_DUR,
    fromX: x,
    fromY: y,
    toX: x,
    toY: y,
    hp: ENEMY_MAX_HP,
    maxHp: ENEMY_MAX_HP,
    state: 'wander',
    target: null,
    path: [],
    nextWanderAt:
      performance.now() +
      ENEMY_WANDER_MIN_MS +
      Math.random() * (ENEMY_WANDER_MAX_MS - ENEMY_WANDER_MIN_MS),
    nextRepathAt: 0,
    lastAttack: 0,
    aggroUntil: 0,
    flashUntil: 0,
  };
}

export function spawnEnemies(state: GameState): void {
  state.enemies.length = 0;
  for (let i = 0; i < ENEMY_COUNT; i++) {
    let spot: Point | null = null;
    for (let tries = 0; tries < 30; tries++) {
      const s = randomOpenTile(state);
      if (!s) break;
      if (Math.hypot(s.x - SPAWN_X, s.y - SPAWN_Y) >= ENEMY_SPAWN_MIN_DIST) {
        spot = s;
        break;
      }
    }
    if (spot) state.enemies.push(makeEnemy(spot.x, spot.y));
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
