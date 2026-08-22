// Player action resolution: movement, picking up/placing obstacles and
// food, and attacking enemies. Raw key tracking (which keys are currently
// held) lives in input/player-input.ts.
import type {
  Dir,
  FloorType,
  GameState,
  HudRefs,
  ItemType,
  Point,
} from '../types/types';
import {
  BERRY_BUSH_GROW_TICKS,
  carryColor,
  ENERGY_SEED_GROW_TICKS,
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
  floorAt,
  isEnemyAt,
  leaveFootprint,
  occupantAt,
  openForItem,
  placeItemNear,
  setFloor,
  setObstacle,
  setOccupant,
  spawnFloatingText,
  terrainWalkable,
} from '../state/state';
import { OASIS } from '../worldgen/worldgen';
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
import { plantSeed } from './farming';
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
  const enteringWater = state.map[ny]?.[nx] === OASIS;
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
export function useHeldItem(state: GameState, hud: HudRefs): void {
  const { player } = state;
  if (!player.held) return;
  const healAmount = FOOD_HEAL_AMOUNTS[player.held as ItemType];
  if (healAmount === undefined) {
    showToast(hud, "You can't use that");
    return;
  }
  player.held = null;
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
): void {
  const { player } = state;
  const key = x + ',' + y;

  // an item (e.g. energy a seed grew, or a berry a bush grew) sits on top
  // of the obstacle layer, so it takes priority: picking up harvests the
  // item and leaves the seed/bush that produced it behind
  const item = state.items.get(key);
  if (item) {
    state.items.delete(key);
    player.held = item.type;
    // harvesting the energy a seed produced restarts its grow timer, so
    // the same seed keeps producing as long as it's kept picked
    const producingSeed = state.seeds.get(key);
    if (producingSeed)
      producingSeed.readyAt = state.tick + ENERGY_SEED_GROW_TICKS;
    // same idea for a berry harvested off a still-standing berryBush
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
    player.held = job.item;
    spawnFloatingText(
      state,
      player,
      'picked up ' + job.item,
      carryColor(job.item),
    );
    updateHud(state, hud);
    return;
  }

  // no loose item here — a bare (not-yet-grown, or already-harvested)
  // planted energySeed is reachable and pickable in its own right
  const seed = state.seeds.get(key);
  if (seed) {
    state.seeds.delete(key);
    player.held = 'energySeed';
    spawnFloatingText(
      state,
      player,
      'picked up energySeed',
      carryColor('energySeed'),
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
      player.held = obstacle;
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
    player.held = floor;
    spawnFloatingText(state, player, 'picked up ' + floor, carryColor(floor));
    updateHud(state, hud);
  }
}

export function doPlace(
  state: GameState,
  hud: HudRefs,
  x: number,
  y: number,
): void {
  const { player } = state;
  if (!terrainWalkable(state, x, y) || isEnemyAt(state, x, y) || !player.held)
    return;
  const held = player.held;
  const key = x + ',' + y;

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
        player.held = null;
        updateHud(state, hud);
        return;
      }
    }
    if (floorAt(state, x, y)) return; // already has a floor tile, stays in hand
    setFloor(state, x, y, held as FloorType);
    spawnFloatingText(state, player, 'placed ' + held, carryColor(held));
    player.held = null;
    updateHud(state, hud);
    return;
  }

  // planting an energySeed requires bare soil floor with nothing else on
  // the cell — checked before the generic obstacle/combine tail below
  // since energySeed has no combine recipe, so it would otherwise land as
  // a plain loose item there instead of getting planted (see
  // systems/farming.ts). berryBush needs no equivalent branch — it's
  // placed as a normal obstacle (see the tail below/setObstacle) and grows
  // berries on its own once standing on soil, see updateBerryBushes.
  if (
    held === 'energySeed' &&
    floorAt(state, x, y) === 'soil' &&
    !state.obstacles.has(key) &&
    !state.items.has(key) &&
    !state.seeds.has(key) &&
    !state.smelters.has(key)
  ) {
    plantSeed(state, x, y);
    spawnFloatingText(state, player, 'planted ' + held, carryColor(held));
    player.held = null;
    updateHud(state, hud);
    return;
  }

  // furnace allows an item to drop straight onto it without needing an
  // empty cell or a combine recipe — the dump is consumed, what's left
  // depends on the item, see systems/smelting.ts. Anything else held that
  // reaches here (an item not planted or dumped) just sits as a plain loose
  // item.
  if (!(held in OBSTACLE_DEFS) && openForItem(state, x, y)) {
    const item = held as ItemType;
    if (state.obstacles.get(key) === 'furnace') {
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
    player.held = null;
    updateHud(state, hud);
    return;
  }

  const target = occupantAt(state, x, y);

  if (target === null) {
    setOccupant(state, x, y, held);
    spawnFloatingText(state, player, 'placed ' + held, '#ecdfc4');
    player.held = null;
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
  player.held = null;
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
): void {
  const { player } = state;
  player.attackTarget = null;
  if (isAdjacent(player.tileX, player.tileY, x, y)) {
    player.pendingAction = { type: 'pickup', x, y };
    return;
  }
  const path = bfsToAdjacent(player.tileX, player.tileY, x, y, walkable);
  if (path.length) {
    player.pendingAction = { type: 'pickup', x, y };
    player.path = path;
  }
}

// same deferred-resolution note as trySelectPickup above
export function tryPlaceAt(
  state: GameState,
  x: number,
  y: number,
  walkable: (x: number, y: number) => boolean,
): void {
  const { player } = state;
  if (!terrainWalkable(state, x, y) || !player.held) return;
  const held = player.held;
  // furnace-dump bypass — occupantAt reports a bare allowItem obstacle
  // (furnace) as occupied even with nothing dumped in it yet, which would
  // otherwise wrongly block a plain item drop there via the tryCombine
  // check below. Planting an energySeed on bare soil needs no equivalent
  // bypass: soil is a FloorType, so occupantAt already reports an empty
  // soil cell as unoccupied (see its comment in state/state.ts), and an
  // already-planted one as 'energySeed' — either way the gate below
  // resolves correctly on its own.
  const dropsOnSoil = !(held in OBSTACLE_DEFS) && openForItem(state, x, y);
  if (!dropsOnSoil) {
    const target = occupantAt(state, x, y);
    if (target !== null && tryCombine(held, target) === null) return;
  }
  player.attackTarget = null;
  if (isAdjacent(player.tileX, player.tileY, x, y)) {
    player.pendingAction = { type: 'place', x, y };
    return;
  }
  const path = bfsToAdjacent(player.tileX, player.tileY, x, y, walkable);
  if (path.length) {
    player.pendingAction = { type: 'place', x, y };
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
  // a weapon in-hand (see WEAPON_DEFS in constants.ts) overrides the
  // unarmed damage/cooldown; anything else held (or nothing) attacks unarmed
  const weapon = player.held ? WEAPON_DEFS[player.held as ItemType] : undefined;
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
  if (weaponRange(player.held) > 1) {
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
