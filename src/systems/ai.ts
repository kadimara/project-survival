// Enemy AI: wander (searching for food, for a type that forages) until the
// player is sighted, then either chase+attack or flee, depending on the
// type (see ENEMY_DEFS.fleesOnSight in constants.ts).
import type { Enemy, GameState, HudRefs, Item, Player } from '../types/types';
import {
  DUMMY_ATK_COOLDOWN_TICKS,
  ENEMY_DEFS,
  ENEMY_LOSE_AGGRO_MS,
  ENEMY_REPATH_MS,
  FOOD_HEAL_AMOUNTS,
  HIT_FLASH_MS,
} from '../constants';
import { isSolid, itemAt, spawnFloatingText } from '../state/state';
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

// nearest loose food item within `radius` (see FOOD_HEAL_AMOUNTS in
// constants.ts for what counts as food) — used by a foraging type's wander
// branch below. No line-of-sight requirement: this is a "smell", not a
// sight check, unlike findNearestTarget above.
function findNearestFoodItem(
  state: GameState,
  fromX: number,
  fromY: number,
  radius: number,
): Item | null {
  let best: Item | null = null;
  let bestDist = Infinity;
  for (const item of state.items.values()) {
    if (FOOD_HEAL_AMOUNTS[item.type] === undefined) continue;
    const d = Math.hypot(item.x - fromX, item.y - fromY);
    if (d <= radius && d < bestDist) {
      best = item;
      bestDist = d;
    }
  }
  return best;
}

// a flee carrying stolen food ends by eating it (see the flee stop
// condition in updateEnemy below) — heals the same amount the item would
// have healed the player (FOOD_HEAL_AMOUNTS), same floating-text color as
// the player's own eat-to-heal (see useHeldItem in player-actions.ts).
function resolveEat(state: GameState, enemy: Enemy): void {
  const healAmount = FOOD_HEAL_AMOUNTS[enemy.carrying!] ?? 0;
  enemy.hp = Math.min(enemy.maxHp, enemy.hp + healAmount);
  spawnFloatingText(state, enemy, '+' + healAmount, '#7fd47f');
  enemy.carrying = null;
}

function attemptEnemyAttack(
  state: GameState,
  hud: HudRefs,
  enemy: Enemy,
  now: number,
): void {
  const def = ENEMY_DEFS[enemy.type];
  const cooldownTicks = enemy.stationary
    ? DUMMY_ATK_COOLDOWN_TICKS
    : def.atkCooldownTicks;
  // gated against state.tick, not `now` — see PLAYER_ATK_COOLDOWN_TICKS's
  // comment in constants.ts
  if (state.tick < enemy.nextAttackAt) return;
  enemy.nextAttackAt = state.tick + cooldownTicks;
  enemy.flashUntil = now + HIT_FLASH_MS;
  damagePlayer(state, hud, def.atkDamage, now, enemy);
}

// ---- enemy AI: wander/forage, then chase+attack or flee on sight ----
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

  // the training dummy never wanders/chases/flees — it just stands there
  // and retaliates if the player is standing next to it. Checked before
  // anything else, so a dummy built from a foraging type (see
  // makeDummyEnemy in entities.ts) never reaches the forage/flee logic below.
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

  const def = ENEMY_DEFS[enemy.type];

  // forage: standing on a loose food item (and not already carrying one)
  // picks it up and starts a flee immediately — regardless of whether the
  // player is currently sighted, since a successful thief bolts on
  // principle, not just when chased. Checked every tick, before sighting,
  // so this can't be preempted by the sighted/aggro block below.
  if (!enemy.carrying && def.foodSenseRadius > 0) {
    const here = itemAt(state, enemy.tileX, enemy.tileY);
    if (here && FOOD_HEAL_AMOUNTS[here.type] !== undefined) {
      state.items.delete(enemy.tileX + ',' + enemy.tileY);
      enemy.carrying = here.type;
      enemy.state = 'flee';
      enemy.path = [];
      enemy.nextRepathAt = 0;
    }
  }

  if (enemy.target && enemy.target.hp <= 0) enemy.target = null;
  const sighted = findNearestTarget(
    state,
    enemy.tileX,
    enemy.tileY,
    def.aggroRadius,
  );
  if (sighted) {
    enemy.target = sighted;
    enemy.state = def.fleesOnSight ? 'flee' : 'chase';
    enemy.aggroUntil = now + ENEMY_LOSE_AGGRO_MS;
  } else if (enemy.state === 'chase' && now > enemy.aggroUntil) {
    enemy.state = 'wander';
    enemy.target = null;
    enemy.path = [];
    enemy.nextWanderAt = now + 300;
  }

  // leash: a guardian tethered to a home tile gives up a chase once it's
  // been pulled far enough away to feel real (leashRadius, deliberately
  // bigger than both wanderRadius and aggroRadius) — checked even while
  // still sighted, so this can override the chase the same tick rather than
  // waiting for aggro to time out. No dedicated "returning home" state: the
  // very next wander cycle re-anchors to `home` (see below), which is what
  // naturally walks it back. Never fires for a jerboa — home is always null.
  if (enemy.home && enemy.state === 'chase') {
    const distFromHome = Math.hypot(
      enemy.tileX - enemy.home.x,
      enemy.tileY - enemy.home.y,
    );
    if (distFromHome > def.leashRadius) {
      enemy.state = 'wander';
      enemy.target = null;
      enemy.path = [];
      enemy.nextWanderAt = now + 300;
    }
  }

  // flee stop condition: unlike the chase leash above, this is purely
  // distance-from-the-player-based, not tied to aggroUntil/sighting at all
  // — deliberately, since a flee can start with no sighted target at all
  // (the forage-triggered theft above always sets state='flee' but may
  // leave `target` null). Checked before the flee-movement block below, so
  // the same tick that crosses fleeRadius also stops movement, same as the
  // leash check above stops a chase the tick it fires.
  if (enemy.state === 'flee') {
    const distFromPlayer = Math.hypot(
      enemy.tileX - state.player.tileX,
      enemy.tileY - state.player.tileY,
    );
    if (distFromPlayer >= def.fleeRadius) {
      if (enemy.carrying) resolveEat(state, enemy);
      enemy.state = 'wander';
      enemy.target = null;
      enemy.path = [];
      enemy.nextWanderAt = now + 300;
    }
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

  // flee movement: mirrors the chase block above but direction-inverted —
  // path to a point roughly fleeRadius tiles away from the player along the
  // enemy->player vector, reversed, recomputed on the same repath cadence
  // (best-effort: an unreachable/unwalkable destination just means no path
  // this cycle, same tolerance the chase/wander logic already has).
  if (enemy.state === 'flee') {
    if (now >= enemy.nextRepathAt || enemy.path.length === 0) {
      const dx = enemy.tileX - state.player.tileX;
      const dy = enemy.tileY - state.player.tileY;
      const dist = Math.hypot(dx, dy) || 1; // avoid div-by-zero standing on the player's tile
      const destX = Math.round(enemy.tileX + (dx / dist) * def.fleeRadius);
      const destY = Math.round(enemy.tileY + (dy / dist) * def.fleeRadius);
      enemy.path = findPath(enemy.tileX, enemy.tileY, destX, destY, walkable);
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

  // wander: occasionally pick a spot near `home` (or, for a jerboa with no
  // home, near its own current tile — identical to this file's previous
  // behavior) and walk to it. Anchoring to `home` rather than re-centering
  // on the current tile each cycle is what keeps a guardian visibly active
  // around its own boulders instead of slowly random-walking away over
  // time. A foraging type (foodSenseRadius > 0) prefers a sensed food item
  // over the random offset, if one's in range.
  if (now >= enemy.nextWanderAt && enemy.path.length === 0) {
    const food =
      !enemy.carrying && def.foodSenseRadius > 0
        ? findNearestFoodItem(
            state,
            enemy.tileX,
            enemy.tileY,
            def.foodSenseRadius,
          )
        : null;
    let tx: number, ty: number;
    if (food) {
      tx = food.x;
      ty = food.y;
    } else {
      const anchor = enemy.home ?? { x: enemy.tileX, y: enemy.tileY };
      tx =
        anchor.x +
        Math.floor(Math.random() * (def.wanderRadius * 2 + 1)) -
        def.wanderRadius;
      ty =
        anchor.y +
        Math.floor(Math.random() * (def.wanderRadius * 2 + 1)) -
        def.wanderRadius;
    }
    if (walkable(tx, ty)) {
      const p = findPath(enemy.tileX, enemy.tileY, tx, ty, walkable);
      if (p.length) enemy.path = p;
    }
    enemy.nextWanderAt =
      now +
      def.wanderMinMs +
      Math.random() * (def.wanderMaxMs - def.wanderMinMs);
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
