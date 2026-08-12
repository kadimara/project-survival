// Player action resolution: movement, picking up/placing obstacles and
// food, and attacking enemies. Raw key tracking (which keys are currently
// held) lives in input/player-input.ts.
import type { Dir, GameState, HudRefs, ItemType, Point } from '../types/types';
import {
  carryColor,
  ENERGY_HEAL_AMOUNT,
  ENERGY_SEED_GROW_TICKS,
  PLAYER_ATK_COOLDOWN_TICKS,
  PLAYER_ATK_DAMAGE,
  TICK_MS,
  TILE_DEFS,
  WEAPON_DEFS,
} from '../constants';
import {
  isEnemyAt,
  occupantAt,
  openForGroundItem,
  setOccupant,
  setTile,
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
import { damageEnemy, spendAttackHp, spendMoveHp } from './combat';
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
  player.moveDur = TICK_MS;
  startStep(player, nx, ny, dir);
  spendMoveHp(state, hud);
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

// consumes the held item, if it's usable. Currently only energy does
// anything (heals); anything else just declines with a toast, since it's
// not food. Triggered by the "Use item" button, which is only shown while
// something is held.
export function useHeldItem(state: GameState, hud: HudRefs): void {
  const { player } = state;
  if (!player.held) return;
  if (player.held !== 'energy') {
    showToast(hud, "You can't use that");
    return;
  }
  player.hp = Math.min(player.maxHp, player.hp + ENERGY_HEAL_AMOUNT);
  player.held = null;
  spawnFloatingText(state, player, '+' + ENERGY_HEAL_AMOUNT, '#7fd47f');
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

  // a ground item (e.g. energy a seed grew) sits on top of the tile layer,
  // so it takes priority: picking up harvests the item and leaves the tile
  // (and any seed underneath it) behind
  const item = state.groundItems.get(key);
  if (item) {
    state.groundItems.delete(key);
    player.held = item.type;
    // harvesting the energy a seed produced restarts its grow timer, so
    // the same seed keeps producing as long as it's kept picked
    const producingSeed = state.seeds.get(key);
    if (producingSeed)
      producingSeed.readyAt = state.tick + ENERGY_SEED_GROW_TICKS;
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
  // planted seed is reachable and pickable in its own right
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

  const tile = state.tiles.get(key);
  if (!tile || !TILE_DEFS[tile].pickable) return;
  setTile(state, x, y, null);
  player.held = tile;
  spawnFloatingText(state, player, 'picked up ' + tile, carryColor(tile));
  updateHud(state, hud);
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

  // soil and furnace both allow a ground item to drop straight onto them
  // without needing an empty cell or a combine recipe. A furnace dump is
  // consumed — what's left depends on the item, see systems/smelting.ts.
  // On soil, an energySeed gets planted (tracked separately, see
  // systems/farming.ts) and anything else just sits there as a plain loose
  // item, same as any other ground item.
  if (!(held in TILE_DEFS) && openForGroundItem(state, x, y)) {
    const item = held as ItemType;
    if (state.tiles.get(x + ',' + y) === 'furnace') {
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
      if (item === 'energySeed') {
        plantSeed(state, x, y);
      } else {
        state.groundItems.set(x + ',' + y, { x, y, type: item });
      }
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
  const dropsOnSoil =
    !(player.held in TILE_DEFS) && openForGroundItem(state, x, y);
  if (!dropsOnSoil) {
    const target = occupantAt(state, x, y);
    if (target !== null && tryCombine(player.held, target) === null) return;
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

// ---- attack a targeted enemy ----
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
  damageEnemy(state, hud, t, damage, now);
  spendAttackHp(state, hud);
}
