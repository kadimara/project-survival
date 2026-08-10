// Player action resolution: movement, picking up/placing obstacles and
// food, and attacking enemies. Raw key tracking (which keys are currently
// held) lives in input/player-input.ts.
import type { Dir, GameState, HudRefs, ItemType, Point } from '../types/types';
import {
  BASE_MOVE_DUR,
  carryColor,
  PLAYER_ATK_COOLDOWN,
  PLAYER_ATK_DAMAGE,
  PLAYER_CARRY_MOVE_DUR,
  TILE,
  TILE_DEFS,
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
import { killEnemy } from './combat';
import { tryCombine } from './combine';
import { plantGrowingItem } from './farming';
import { updateHud } from '../ui/hud';

// advances the player one tile onto open ground. Returns false if the tile
// is blocked, so callers can bail out of whatever path they were following.
export function tryPlayerStep(
  state: GameState,
  nx: number,
  ny: number,
  dir: Dir,
  walkable: Walkable,
): boolean {
  const { player } = state;
  if (!walkable(nx, ny)) return false;
  player.moveDur = player.held ? PLAYER_CARRY_MOVE_DUR : BASE_MOVE_DUR;
  startStep(player, nx, ny, dir);
  return true;
}

export function tryMove(state: GameState, dir: Dir, walkable: Walkable): void {
  let dx = 0,
    dy = 0;
  if (dir === 'up') dy = -1;
  else if (dir === 'down') dy = 1;
  else if (dir === 'left') dx = -1;
  else if (dir === 'right') dx = 1;
  const { player } = state;
  tryPlayerStep(state, player.tileX + dx, player.tileY + dy, dir, walkable);
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

  // a ground item (e.g. a crop on soil) sits on top of the tile layer, so it
  // takes priority: picking up harvests the item and leaves the tile behind
  const item = state.groundItems.get(key);
  if (item) {
    state.groundItems.delete(key);
    player.held = item.type;
    // a fully-grown planting regrows a fresh small one on the same soil
    // cell; harvesting early (still small) or a wild/death-drop item
    // (no stage) just gives the energy with nothing left behind
    if (item.stage === 'full') {
      plantGrowingItem(state, x, y, item.type, performance.now());
    }
    spawnFloatingText(
      state,
      player,
      'picked up ' + item.type,
      carryColor(item.type),
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

  // soil doesn't block ground items, so a carried item drops straight onto
  // it without needing an empty cell or a combine recipe, planted as a
  // small growing item rather than a plain one-shot pickup
  if (!(held in TILE_DEFS) && openForGroundItem(state, x, y)) {
    plantGrowingItem(state, x, y, held as ItemType, performance.now());
    spawnFloatingText(state, player, 'placed ' + held, '#ecdfc4');
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

export function trySelectPickup(
  state: GameState,
  hud: HudRefs,
  x: number,
  y: number,
  walkable: (x: number, y: number) => boolean,
): void {
  const { player } = state;
  if (isAdjacent(player.tileX, player.tileY, x, y)) {
    doPickup(state, hud, x, y);
    return;
  }
  const path = bfsToAdjacent(player.tileX, player.tileY, x, y, walkable);
  if (path.length) {
    player.pendingAction = { type: 'pickup', x, y };
    player.path = path;
  }
}

export function tryPlaceAt(
  state: GameState,
  hud: HudRefs,
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
  if (isAdjacent(player.tileX, player.tileY, x, y)) {
    doPlace(state, hud, x, y);
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
  if (now - player.lastAttack < PLAYER_ATK_COOLDOWN) return;
  player.lastAttack = now;
  t.hp -= PLAYER_ATK_DAMAGE;
  t.flashUntil = now + 140;
  spawnFloatingText(
    state,
    { px: t.tileX * TILE, py: t.tileY * TILE },
    '-' + PLAYER_ATK_DAMAGE,
    '#e8a838',
  );
  if (t.hp <= 0) {
    t.hp = 0;
    player.attackTarget = null;
    killEnemy(state, hud, t);
  }
}

export function onPlayerArrived(state: GameState, hud: HudRefs): void {
  const { player } = state;
  if (!player.pendingAction) return;
  const pa = player.pendingAction;
  if (isAdjacent(player.tileX, player.tileY, pa.x, pa.y)) {
    if (pa.type === 'pickup') doPickup(state, hud, pa.x, pa.y);
    else doPlace(state, hud, pa.x, pa.y);
    player.pendingAction = null;
  } else if (player.path.length === 0) {
    // path exhausted without ever reaching adjacency — give up quietly
    player.pendingAction = null;
  }
  // otherwise: still mid-walk toward the target, keep pendingAction for the next step
}
