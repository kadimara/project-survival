// Enemy AI: wander until the player is sighted, then chase and attack.
import type { Enemy, GameState, HudRefs, Player } from '../types/types';
import {
  DUMMY_ATK_COOLDOWN_TICKS,
  ENEMY_AGGRO_RADIUS,
  ENEMY_ATK_COOLDOWN_TICKS,
  ENEMY_ATK_DAMAGE,
  ENEMY_LOSE_AGGRO_MS,
  ENEMY_REPATH_MS,
  ENEMY_WANDER_MAX_MS,
  ENEMY_WANDER_MIN_MS,
  ENEMY_WANDER_RADIUS,
  HIT_FLASH_MS,
} from '../constants';
import { isSolid } from '../state/state';
import { dirBetween, startStep } from '../entities/entities';
import {
  bfsToAdjacent,
  findPath,
  hasLineOfSight,
  isAdjacent,
  type Walkable,
} from './pathfinding';
import { damagePlayer } from './combat';

// finds the player if within aggro range and line of sight
function findNearestTarget(
  state: GameState,
  fromX: number,
  fromY: number,
  radius: number,
): Player | null {
  const { player } = state;
  if (player.hp <= 0) return null;
  const d = Math.hypot(player.tileX - fromX, player.tileY - fromY);
  if (
    d <= radius &&
    hasLineOfSight(fromX, fromY, player.tileX, player.tileY, (x, y) =>
      isSolid(state, x, y),
    )
  )
    return player;
  return null;
}

function attemptEnemyAttack(
  state: GameState,
  hud: HudRefs,
  enemy: Enemy,
  now: number,
): void {
  const cooldownTicks = enemy.stationary
    ? DUMMY_ATK_COOLDOWN_TICKS
    : ENEMY_ATK_COOLDOWN_TICKS;
  // gated against state.tick, not `now` — see PLAYER_ATK_COOLDOWN_TICKS's
  // comment in constants.ts
  if (state.tick < enemy.nextAttackAt) return;
  enemy.nextAttackAt = state.tick + cooldownTicks;
  enemy.flashUntil = now + HIT_FLASH_MS;
  damagePlayer(state, hud, ENEMY_ATK_DAMAGE, now, enemy);
}

// ---- enemy AI: wander, then chase + attack on sight ----
export function updateEnemy(
  state: GameState,
  hud: HudRefs,
  enemy: Enemy,
  now: number,
  walkable: Walkable,
): void {
  if (enemy.hp <= 0) return;
  // animation is advanced centrally, once per rendered frame, from game.ts's
  // frame() — this function only makes decisions, once per simulation tick.
  // It runs unconditionally even if a previous step is still visually
  // animating: tileX/tileY already update instantly at step-start (see
  // entities.ts's startStep), so each tick is free to act regardless of
  // `moving`, which only gates the cosmetic tween. This matters when a
  // frame hitch lets more than one tick drain at once — gating on `moving`
  // here would silently waste every tick after the first in that drain.

  // the training dummy never wanders or chases — it just stands there and
  // retaliates if the player is standing next to it
  if (enemy.stationary) {
    const { player } = state;
    if (
      player.hp > 0 &&
      isAdjacent(enemy.tileX, enemy.tileY, player.tileX, player.tileY)
    ) {
      enemy.dir = dirBetween(
        enemy.tileX,
        enemy.tileY,
        player.tileX,
        player.tileY,
      );
      attemptEnemyAttack(state, hud, enemy, now);
    }
    return;
  }

  if (enemy.target && enemy.target.hp <= 0) enemy.target = null;
  const sighted = findNearestTarget(
    state,
    enemy.tileX,
    enemy.tileY,
    ENEMY_AGGRO_RADIUS,
  );
  if (sighted) {
    enemy.target = sighted;
    enemy.state = 'chase';
    enemy.aggroUntil = now + ENEMY_LOSE_AGGRO_MS;
  } else if (enemy.state === 'chase' && now > enemy.aggroUntil) {
    enemy.state = 'wander';
    enemy.target = null;
    enemy.path = [];
    enemy.nextWanderAt = now + 300;
  }

  if (enemy.state === 'chase' && enemy.target) {
    const pos = { x: enemy.target.tileX, y: enemy.target.tileY };
    if (isAdjacent(enemy.tileX, enemy.tileY, pos.x, pos.y)) {
      enemy.dir = dirBetween(enemy.tileX, enemy.tileY, pos.x, pos.y);
      attemptEnemyAttack(state, hud, enemy, now);
      return;
    }
    if (now >= enemy.nextRepathAt || enemy.path.length === 0) {
      enemy.path = bfsToAdjacent(
        enemy.tileX,
        enemy.tileY,
        pos.x,
        pos.y,
        walkable,
      );
      enemy.nextRepathAt = now + ENEMY_REPATH_MS;
    }
    if (enemy.path.length) {
      const next = enemy.path.shift()!;
      if (walkable(next.x, next.y))
        startStep(
          enemy,
          next.x,
          next.y,
          dirBetween(enemy.tileX, enemy.tileY, next.x, next.y),
        );
      else enemy.path = [];
    }
    return;
  }

  // wander: occasionally pick a nearby spot and walk to it
  if (now >= enemy.nextWanderAt && enemy.path.length === 0) {
    const tx =
      enemy.tileX +
      Math.floor(Math.random() * (ENEMY_WANDER_RADIUS * 2 + 1)) -
      ENEMY_WANDER_RADIUS;
    const ty =
      enemy.tileY +
      Math.floor(Math.random() * (ENEMY_WANDER_RADIUS * 2 + 1)) -
      ENEMY_WANDER_RADIUS;
    if (walkable(tx, ty)) {
      const p = findPath(enemy.tileX, enemy.tileY, tx, ty, walkable);
      if (p.length) enemy.path = p;
    }
    enemy.nextWanderAt =
      now +
      ENEMY_WANDER_MIN_MS +
      Math.random() * (ENEMY_WANDER_MAX_MS - ENEMY_WANDER_MIN_MS);
  }
  if (enemy.path.length) {
    const next = enemy.path.shift()!;
    if (walkable(next.x, next.y))
      startStep(
        enemy,
        next.x,
        next.y,
        dirBetween(enemy.tileX, enemy.tileY, next.x, next.y),
      );
    else enemy.path = [];
  }
}
