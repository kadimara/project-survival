// Damage and death resolution shared by player actions and AI: applying
// damage to the player/enemies, and the consequences of death (dropping
// food, removing the corpse, resetting the game on player death). Kept
// separate from player-actions.ts and ai.ts so neither has to import the
// other.
import type { Enemy, GameState, HudRefs } from '../types/types';
import {
  HIT_FLASH_MS,
  PLAYER_ATK_HP_COST,
  PLAYER_MOVE_HP_COST,
  TILE,
} from '../constants';
import {
  placeGroundItemNear,
  regenerateWorld,
  spawnFloatingText,
} from '../state/state';
import { spawnEnemies } from '../entities/entities';
import { showToast, updateHud } from '../ui/hud';

// enemy dies permanently (no respawn) and drops food on the ground where it fell
export function killEnemy(state: GameState, hud: HudRefs, enemy: Enemy): void {
  const idx = state.enemies.indexOf(enemy);
  if (idx !== -1) state.enemies.splice(idx, 1);
  spawnFloatingText(
    state,
    { px: enemy.tileX * TILE, py: enemy.tileY * TILE },
    'defeated!',
    '#c1633c',
  );
  placeGroundItemNear(state, enemy.tileX, enemy.tileY, 'energy');
  updateHud(state, hud);
}

// player death is a full retry, not a localized respawn: the whole world
// (tiles, ground items, seeds, smelters, enemies) rebuilds from the current
// seed, same as the seed-load/random controls. Anything just dropped by
// damagePlayer/spendMoveHp gets wiped by this along with everything else,
// so neither of them bothers placing a death-drop first.
function resetGame(state: GameState, hud: HudRefs): void {
  regenerateWorld(state, state.seed, spawnEnemies);
  updateHud(state, hud);
}

// shared exertion-cost mechanic: unlike damagePlayer this ignores
// hit-invuln, since it's spent by the player's own actions, not a combat hit
function spendExertionHp(state: GameState, hud: HudRefs, amount: number): void {
  const { player } = state;
  player.hp = Math.max(0, player.hp - amount);
  updateHud(state, hud);
  if (player.hp <= 0) {
    showToast(hud, 'You collapsed from exhaustion — resetting');
    resetGame(state, hud);
  }
}

// spent on every tile the player steps onto (see tryPlayerStep in
// player-actions.ts)
export function spendMoveHp(state: GameState, hud: HudRefs): void {
  spendExertionHp(state, hud, PLAYER_MOVE_HP_COST);
}

// spent on every landed attack (see attemptPlayerAttack in
// player-actions.ts)
export function spendAttackHp(state: GameState, hud: HudRefs): void {
  spendExertionHp(state, hud, PLAYER_ATK_HP_COST);
}

// applies attack damage to an enemy (see attemptPlayerAttack in
// player-actions.ts) and resolves death via killEnemy — the enemy-side
// counterpart to damagePlayer below
export function damageEnemy(
  state: GameState,
  hud: HudRefs,
  enemy: Enemy,
  amount: number,
  now: number,
): void {
  enemy.hp -= amount;
  enemy.flashUntil = now + HIT_FLASH_MS;
  spawnFloatingText(
    state,
    { px: enemy.tileX * TILE, py: enemy.tileY * TILE },
    '-' + amount,
    '#e8a838',
  );
  if (enemy.hp <= 0) {
    enemy.hp = 0;
    if (state.player.attackTarget === enemy) state.player.attackTarget = null;
    killEnemy(state, hud, enemy);
  }
}

export function damagePlayer(
  state: GameState,
  hud: HudRefs,
  amount: number,
  now: number,
  attacker?: Enemy,
): void {
  const { player } = state;
  if (player.hp <= 0) return;
  player.hp = Math.max(0, player.hp - amount);
  player.flashUntil = now + HIT_FLASH_MS;
  spawnFloatingText(state, player, '-' + amount, '#e05c5c');
  updateHud(state, hud);
  if (player.hp <= 0) {
    showToast(hud, 'You were defeated — resetting');
    resetGame(state, hud);
    return;
  }
  player.attacked = true;
  // retaliate against whoever just hit us, interrupting whatever the
  // player was doing (walking, hauling toward a pending pickup/place)
  if (attacker) {
    player.attackTarget = attacker;
    player.pendingAction = null;
    player.path = [];
  }
}
