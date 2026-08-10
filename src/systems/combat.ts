// Damage and death resolution shared by player actions and AI: applying
// damage to the player/enemies, and the consequences of death (dropping
// food, removing the corpse, respawning the player). Kept separate from
// player-actions.ts and ai.ts so neither has to import the other.
import type { Enemy, GameState, HudRefs } from '../types/types';
import {
  PLAYER_HIT_INVULN_MS,
  PLAYER_RESPAWN_INVULN_MS,
  SPAWN_X,
  SPAWN_Y,
  TILE,
} from '../constants';
import { placeGroundItemNear, spawnFloatingText } from '../state/state';
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

export function respawnPlayer(
  state: GameState,
  hud: HudRefs,
  now: number,
): void {
  const { player } = state;
  player.hp = player.maxHp;
  player.tileX = SPAWN_X;
  player.tileY = SPAWN_Y;
  player.px = SPAWN_X * TILE;
  player.py = SPAWN_Y * TILE;
  player.path = [];
  player.pendingAction = null;
  player.attackTarget = null;
  player.moving = false;
  player.invulnUntil = now + PLAYER_RESPAWN_INVULN_MS;
  updateHud(state, hud);
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
    placeGroundItemNear(state, player.tileX, player.tileY, 'energy');
    showToast(hud, 'You were defeated — respawning');
    respawnPlayer(state, hud, now);
    return;
  }
  player.attacked = true;
}
