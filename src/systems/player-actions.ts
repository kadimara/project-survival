// Player action resolution: movement, picking up/placing obstacles and
// food, and attacking enemies. Raw key tracking (which keys are currently
// held) lives in input/player-input.ts.
import type {
  Dir,
  FloorType,
  GameState,
  Hand,
  HudRefs,
  ItemType,
  Point,
} from '../types/types';
import {
  BERRY_BUSH_GROW_TICKS,
  carryColor,
  carryColors,
  FISHING_CATCH_TICKS,
  FLOOR_DEFS,
  FOOD_HEAL_AMOUNTS,
  OBSTACLE_DEFS,
  PLAYER_ATK_COOLDOWN_TICKS,
  PLAYER_ATK_DAMAGE,
  PLAYER_WATER_MOVE_TICKS,
  TICK_MS,
  weaponRange,
  WEAPON_DEFS,
} from '../constants';
import {
  clearAttackTarget,
  floorAt,
  getHeld,
  isEnemyAt,
  isWater,
  leaveFootprint,
  occupantAt,
  openForItem,
  placeItemNear,
  setFloor,
  setHeld,
  setObstacle,
  setOccupant,
  spawnFloatingText,
  terrainWalkable,
} from '../state/state';
import { startStep } from '../entities/entities';
import {
  bfsToAdjacent,
  findPath,
  isAdjacent,
  type Walkable,
} from './pathfinding';
import {
  damageCactus,
  damageEnemy,
  damageTree,
  fireProjectile,
  spendAttackHp,
  spendMoveHp,
} from './combat';
import { tryCombine } from './combine';
import { dumpInCampfire } from './cooking';
import { dumpInFurnace } from './smelting';
import { showToast, updateHud } from '../ui/hud';

// advances the player one tile onto open ground, spending move hp. Returns
// false if the tile is blocked, so callers can bail out of whatever path
// they were following.
export function tryPlayerStep(
  state: GameState,
  hud: HudRefs,
  nx: number,
  ny: number,
  dir: Dir,
  walkable: Walkable,
): boolean {
  const { player } = state;
  if (!walkable(nx, ny)) return false;
  const enteringWater = isWater(state, nx, ny);
  // both the glide animation and the tick-gate below (nextMoveAt) use the
  // same water-slowed duration, so the extra time reads as one smooth slow
  // glide through the water rather than a normal-speed step followed by a
  // stall (moveDur alone controls only the visual lerp — see
  // updateActorAnimation in entities/entities.ts — so leaving it at TICK_MS
  // while nextMoveAt held the player back for longer was what produced the
  // stutter this replaces)
  player.moveDur = TICK_MS * (enteringWater ? PLAYER_WATER_MOVE_TICKS : 1);
  // recorded before startStep overwrites tileX/tileY, so the mark lands on
  // the tile being left rather than the one being walked onto (never
  // directly under the player). On water this same mark renders as a wake
  // instead of a sand darkening (see render.ts), so walking through the
  // oasis leaves a trailing stream of marks behind the player rather than
  // under or ahead of them.
  leaveFootprint(state, player.tileX, player.tileY);
  startStep(player, nx, ny, dir);
  spendMoveHp(state, hud);
  // gates when game.ts's simulateTick is allowed to issue the player's next
  // step (see Player.nextMoveAt in types.ts) — stepping onto water takes
  // PLAYER_WATER_MOVE_TICKS instead of the normal 1, so wading through the
  // oasis takes twice as long in real time without changing the underlying
  // tick rate
  player.nextMoveAt =
    state.tick + (enteringWater ? PLAYER_WATER_MOVE_TICKS : 1);
  return true;
}

export function tryMove(
  state: GameState,
  hud: HudRefs,
  dir: Dir,
  walkable: Walkable,
): void {
  let dx = 0,
    dy = 0;
  if (dir === 'up') dy = -1;
  else if (dir === 'down') dy = 1;
  else if (dir === 'left') dx = -1;
  else if (dir === 'right') dx = 1;
  const { player } = state;
  tryPlayerStep(
    state,
    hud,
    player.tileX + dx,
    player.tileY + dy,
    dir,
    walkable,
  );
}

// consumes the held item, if it's usable (heals). Triggered by the "Use
// item" button, which is only shown while something is held. Eating while
// already at max hp can't heal, so the food isn't just wasted — it's
// digested into a poop item dropped at the player's feet instead (see
// placeItemNear), which combines with dirt to make more soil (see RECIPES
// in systems/combine.ts). Anything else held just declines with a toast,
// since it's not food (see FOOD_HEAL_AMOUNTS in constants.ts).
export function useHeldItem(state: GameState, hud: HudRefs, hand: Hand): void {
  const { player } = state;
  const held = getHeld(player, hand);
  if (!held) return;
  const healAmount = FOOD_HEAL_AMOUNTS[held as ItemType];
  if (healAmount === undefined) {
    showToast(hud, "You can't use that");
    return;
  }
  setHeld(player, hand, null);
  if (player.hp >= player.maxHp) {
    placeItemNear(state, player.tileX, player.tileY, 'poop');
    spawnFloatingText(state, player, 'poop', carryColor('poop'));
  } else {
    player.hp = Math.min(player.maxHp, player.hp + healAmount);
    spawnFloatingText(state, player, '+' + healAmount, '#7fd47f');
  }
  updateHud(state, hud);
}

export function computeClickPath(
  state: GameState,
  x: number,
  y: number,
  walkable: Walkable,
): Point[] {
  const { player } = state;
  return findPath(player.tileX, player.tileY, x, y, walkable);
}

export function doPickup(
  state: GameState,
  hud: HudRefs,
  x: number,
  y: number,
  hand: Hand,
): void {
  const { player } = state;
  const key = x + ',' + y;

  // a loose item (e.g. a berry a bush grew) sits on top of the obstacle
  // layer, so it takes priority: picking up harvests the item and leaves
  // whatever produced it (a berryBush) behind
  const item = state.items.get(key);
  if (item) {
    state.items.delete(key);
    setHeld(player, hand, item.type);
    // harvesting a berry restarts its still-standing berryBush's grow
    // timer, so the same bush keeps producing as long as it's kept picked
    const producingBush = state.berryBushes.get(key);
    if (producingBush)
      producingBush.readyAt = state.tick + BERRY_BUSH_GROW_TICKS;
    spawnFloatingText(
      state,
      player,
      'picked up ' + item.type,
      carryColor(item.type),
    );
    updateHud(state, hud);
    return;
  }

  // an item mid-smelt/mid-melt on a furnace can be reclaimed as-is any
  // time before its timer fires, canceling the job
  const job = state.smelters.get(key);
  if (job) {
    state.smelters.delete(key);
    setHeld(player, hand, job.item);
    spawnFloatingText(
      state,
      player,
      'picked up ' + job.item,
      carryColor(job.item),
    );
    updateHud(state, hud);
    return;
  }

  // same cancel-in-progress-job pickup as the furnace above, for a campfire
  const campfireJob = state.campfireJobs.get(key);
  if (campfireJob) {
    state.campfireJobs.delete(key);
    setHeld(player, hand, campfireJob.item);
    spawnFloatingText(
      state,
      player,
      'picked up ' + campfireJob.item,
      carryColor(campfireJob.item),
    );
    updateHud(state, hud);
    return;
  }

  // an obstacle here — pickable or not — is the topmost thing at this
  // cell, so it's the end of the line either way: a non-pickable obstacle
  // (e.g. a tree) blocks reaching the floor underneath it, same as a
  // pickable one leaving the floor exposed only once it's actually removed
  const obstacle = state.obstacles.get(key);
  if (obstacle) {
    if (OBSTACLE_DEFS[obstacle].pickable) {
      setObstacle(state, x, y, null);
      setHeld(player, hand, obstacle);
      spawnFloatingText(
        state,
        player,
        'picked up ' + obstacle,
        carryColor(obstacle),
      );
      updateHud(state, hud);
    }
    return;
  }

  const floor = floorAt(state, x, y);
  if (floor && FLOOR_DEFS[floor].pickable) {
    setFloor(state, x, y, null);
    setHeld(player, hand, floor);
    spawnFloatingText(state, player, 'picked up ' + floor, carryColor(floor));
    updateHud(state, hud);
  }
}

export function doPlace(
  state: GameState,
  hud: HudRefs,
  x: number,
  y: number,
  hand: Hand,
): void {
  const { player } = state;
  const held = getHeld(player, hand);
  if (!terrainWalkable(state, x, y) || isEnemyAt(state, x, y) || !held) return;
  const key = x + ',' + y;

  // a fishingRod is a tool, never consumed by placing it (same convention
  // as sword/bow never being consumed by attacking) — clicking it onto any
  // oasis water tile starts a timed catch instead of falling through to the
  // generic "drop as a loose item" tail below (see systems/fishing.ts).
  // One-shot: a tile already mid-job is left alone rather than restarted.
  if (held === 'fishingRod' && isWater(state, x, y)) {
    if (!state.fishingJobs.has(key)) {
      state.fishingJobs.set(key, {
        x,
        y,
        readyAt: state.tick + FISHING_CATCH_TICKS,
      });
      spawnFloatingText(state, player, 'fishing...', carryColor('fishingRod'));
      updateHud(state, hud);
    }
    return;
  }

  // a held floor tile is placed onto the floor layer, not the
  // obstacle/item layers — checked first since 'dirt'/'soil' aren't keys in
  // OBSTACLE_DEFS, and falling through to the generic item-drop branch
  // below would wrongly stash it in state.items as a fake ItemType. The one
  // exception is a matching combine target already sitting here as a loose
  // item (dirt + poop -> soil, see RECIPES in systems/combine.ts) — checked
  // first so that recipe can fire; an obstacle occupying the cell doesn't
  // block floor placement either way, since floor/obstacle are independent
  // layers.
  if (held in FLOOR_DEFS) {
    const targetItem = state.items.get(key);
    if (targetItem) {
      const resultType = tryCombine(held, targetItem.type);
      if (resultType !== null) {
        setOccupant(state, x, y, resultType);
        spawnFloatingText(
          state,
          player,
          'combined into ' + resultType,
          carryColor(resultType),
        );
        setHeld(player, hand, null);
        updateHud(state, hud);
        return;
      }
    }
    if (floorAt(state, x, y)) return; // already has a floor tile, stays in hand
    setFloor(state, x, y, held as FloorType);
    spawnFloatingText(state, player, 'placed ' + held, carryColor(held));
    setHeld(player, hand, null);
    updateHud(state, hud);
    return;
  }

  // furnace/campfire both allow an item to drop straight onto them without
  // needing an empty cell or a combine recipe — the dump is consumed, what's
  // left depends on the item (see systems/smelting.ts, systems/cooking.ts).
  // A campfire additionally accepts a held obstacle (wood — see
  // BURNS_TO_COAL in cooking.ts), so it's checked before the item-only
  // furnace/plain-drop cases below. Anything else held that reaches here
  // (an item not dumped anywhere) just sits as a plain loose item.
  if (openForItem(state, x, y)) {
    const targetObstacle = state.obstacles.get(key);
    if (targetObstacle === 'campfire') {
      const outcome = dumpInCampfire(state, x, y, held);
      const text =
        outcome === 'cooking'
          ? 'cooking ' + held
          : outcome === 'burning'
            ? 'burning ' + held
            : 'burning up ' + held;
      spawnFloatingText(
        state,
        player,
        text,
        outcome === 'destroyed' ? '#ff6b35' : carryColors(held).primary,
      );
      setHeld(player, hand, null);
      updateHud(state, hud);
      return;
    }
    if (!(held in OBSTACLE_DEFS)) {
      const item = held as ItemType;
      if (targetObstacle === 'furnace') {
        const outcome = dumpInFurnace(state, x, y, item);
        const text =
          outcome === 'smelting'
            ? 'smelting ' + item
            : outcome === 'survived'
              ? 'placed ' + item
              : 'melting ' + item;
        spawnFloatingText(
          state,
          player,
          text,
          outcome === 'destroyed' ? '#ff6b35' : carryColor(item),
        );
      } else {
        state.items.set(key, { x, y, type: item });
        spawnFloatingText(state, player, 'placed ' + item, '#ecdfc4');
      }
      setHeld(player, hand, null);
      updateHud(state, hud);
      return;
    }
    // held is an obstacle (e.g. wood) but the target isn't a campfire — not
    // a valid dump, falls through to the combine/occupancy tail below
  }

  const target = occupantAt(state, x, y);

  if (target === null) {
    setOccupant(state, x, y, held);
    spawnFloatingText(state, player, 'placed ' + held, '#ecdfc4');
    setHeld(player, hand, null);
    updateHud(state, hud);
    return;
  }

  const resultType = tryCombine(held, target);
  if (resultType === null) return; // occupied, no matching recipe: stays in hand

  setOccupant(state, x, y, resultType);
  spawnFloatingText(
    state,
    player,
    'combined into ' + resultType,
    carryColor(resultType),
  );
  setHeld(player, hand, null);
  updateHud(state, hud);
}

// Sets pendingAction unconditionally, even when already adjacent — the
// player-actions.ts one-tile-per-decision convention (see attemptPlayerAttack,
// tryPlayerStep) means the actual pickup only resolves once game.ts's
// simulateTick sees the pendingAction on a tick, not synchronously here.
export function trySelectPickup(
  state: GameState,
  x: number,
  y: number,
  walkable: (x: number, y: number) => boolean,
  hand: Hand,
): void {
  const { player } = state;
  clearAttackTarget(player);
  if (isAdjacent(player.tileX, player.tileY, x, y)) {
    player.pendingAction = { type: 'pickup', x, y, hand };
    return;
  }
  const path = bfsToAdjacent(player.tileX, player.tileY, x, y, walkable);
  if (path.length) {
    player.pendingAction = { type: 'pickup', x, y, hand };
    player.path = path;
  }
}

// same deferred-resolution note as trySelectPickup above
export function tryPlaceAt(
  state: GameState,
  x: number,
  y: number,
  walkable: (x: number, y: number) => boolean,
  hand: Hand,
): void {
  const { player } = state;
  const held = getHeld(player, hand);
  if (!terrainWalkable(state, x, y) || !held) return;
  // furnace/campfire-dump bypass — occupantAt reports a bare allowItem
  // obstacle (furnace, campfire) as occupied even with nothing dumped in it
  // yet, which would otherwise wrongly block a drop there via the
  // tryCombine check below. A campfire additionally accepts a held obstacle
  // (wood), not just an item, so it gets its own unconditional check rather
  // than reusing dropsOnItem's `!(held in OBSTACLE_DEFS)` guard (see doPlace).
  const dropsOnCampfire =
    state.obstacles.get(x + ',' + y) === 'campfire' && openForItem(state, x, y);
  const dropsOnItem = !(held in OBSTACLE_DEFS) && openForItem(state, x, y);
  if (!dropsOnCampfire && !dropsOnItem) {
    const target = occupantAt(state, x, y);
    if (target !== null && tryCombine(held, target) === null) return;
  }
  clearAttackTarget(player);
  if (isAdjacent(player.tileX, player.tileY, x, y)) {
    player.pendingAction = { type: 'place', x, y, hand };
    return;
  }
  const path = bfsToAdjacent(player.tileX, player.tileY, x, y, walkable);
  if (path.length) {
    player.pendingAction = { type: 'place', x, y, hand };
    player.path = path;
  }
}

// consumes the attack interrupt: the player is meant to stand and fight, not
// flee, so getting hit doesn't change anything about the current action.
export function handlePlayerAttacked(state: GameState): void {
  state.player.attacked = false;
}

// ---- attack a targeted enemy or tree ----
export function attemptPlayerAttack(
  state: GameState,
  hud: HudRefs,
  now: number,
): void {
  const { player } = state;
  const t = player.attackTarget;
  if (!t || t.hp <= 0) return;
  // which hand initiated this attack — set alongside attackTarget by
  // setAttackTarget (state/state.ts) when the player clicked the target;
  // defaults to 'left' as a defensive fallback, though attackHand should
  // always be non-null whenever attackTarget is
  const hand = player.attackHand ?? 'left';
  const held = getHeld(player, hand);
  // a weapon in-hand (see WEAPON_DEFS in constants.ts) overrides the
  // unarmed damage/cooldown; anything else held (or nothing) attacks unarmed
  const weapon = held ? WEAPON_DEFS[held as ItemType] : undefined;
  const damage = weapon?.damage ?? PLAYER_ATK_DAMAGE;
  const cooldownTicks = weapon?.cooldownTicks ?? PLAYER_ATK_COOLDOWN_TICKS;
  // gated against state.tick, not `now`, so cadence is exact regardless of
  // frame timing — see PLAYER_ATK_COOLDOWN_TICKS's comment in constants.ts
  if (state.tick < player.nextAttackAt) return;
  player.nextAttackAt = state.tick + cooldownTicks;
  // a ranged weapon (WEAPON_DEFS' optional `range`, > 1) fires a
  // delayed-hit projectile instead of applying damage instantly — see
  // fireProjectile's comment in combat.ts. game.ts's attack-chase loop
  // already confirmed the target is in range (and, for range > 1, in line
  // of sight) before calling this, so no geometry check is needed here.
  if (weaponRange(held) > 1) {
    fireProjectile(state, player, t, damage, now);
  } else if (t.kind === 'enemy') {
    damageEnemy(state, hud, t, damage, now);
  } else if (t.kind === 'tree') {
    damageTree(state, hud, t, damage, now);
  } else {
    damageCactus(state, hud, t, damage, now);
  }
  spendAttackHp(state, hud);
}
