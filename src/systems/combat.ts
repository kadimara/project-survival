// Damage and death resolution shared by player actions and AI: applying
// damage to the player/enemies, and the consequences of death (dropping
// food, removing the corpse, resetting the game on player death). Kept
// separate from player-actions.ts and ai.ts so neither has to import the
// other.
import type { Enemy, GameState, HudRefs } from '../types/types';
import { PLAYER_HIT_INVULN_MS, PLAYER_MOVE_HP_COST, TILE } from '../constants';
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

// spent on every tile the player steps onto (see tryPlayerStep in
// player-actions.ts) — unlike damagePlayer this ignores hit-invuln, since
// it's an exertion cost, not a combat hit
export function spendMoveHp(state: GameState, hud: HudRefs): void {
  const { player } = state;
  player.hp = Math.max(0, player.hp - PLAYER_MOVE_HP_COST);
  updateHud(state, hud);
  if (player.hp <= 0) {
    showToast(hud, 'You collapsed from exhaustion — resetting');
    resetGame(state, hud);
  }
}

export function damagePlayer(
  state: GameState,
  hud: HudRefs,
  amount: number,
  now: number,
): void {
  const { player } = state;
  if (now < player.invulnUntil || player.hp <= 0) return;
  player.hp = Math.max(0, player.hp - amount);
  player.invulnUntil = now + PLAYER_HIT_INVULN_MS;
  spawnFloatingText(state, player, '-' + amount, '#e05c5c');
  updateHud(state, hud);
  if (player.hp <= 0) {
    showToast(hud, 'You were defeated — resetting');
    resetGame(state, hud);
    return;
  }
  player.attacked = true;
}
