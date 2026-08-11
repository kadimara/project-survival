import { describe, expect, it } from 'vitest';
import {
  createTestEnemy,
  createTestGameState,
  createTestHudRefs,
} from '../test/fixtures';
import { PLAYER_ATK_COOLDOWN, PLAYER_ATK_DAMAGE } from '../constants';
import { attemptPlayerAttack } from './player-actions';

describe('attemptPlayerAttack', () => {
  it('deals unarmed damage when nothing is held', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const enemy = createTestEnemy(10, 10);
    state.player.attackTarget = enemy;

    attemptPlayerAttack(state, hud, 1000);

    expect(enemy.hp).toBe(enemy.maxHp - PLAYER_ATK_DAMAGE);
  });

  it('deals the sword damage bonus and uses its own cooldown when a sword is held', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const enemy = createTestEnemy(10, 10);
    state.player.attackTarget = enemy;
    state.player.held = 'sword';

    attemptPlayerAttack(state, hud, 1000);

    expect(enemy.hp).toBe(enemy.maxHp - 6);
    expect(state.player.lastAttack).toBe(1000);
  });

  it('falls back to unarmed stats for a held item with no WEAPON_DEFS entry', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const enemy = createTestEnemy(10, 10);
    state.player.attackTarget = enemy;
    state.player.held = 'ore';

    attemptPlayerAttack(state, hud, 1000);

    expect(enemy.hp).toBe(enemy.maxHp - PLAYER_ATK_DAMAGE);
  });

  it('respects the unarmed cooldown between hits', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const enemy = createTestEnemy(10, 10);
    state.player.attackTarget = enemy;

    attemptPlayerAttack(state, hud, 1000);
    attemptPlayerAttack(state, hud, 1000 + PLAYER_ATK_COOLDOWN - 1);

    expect(enemy.hp).toBe(enemy.maxHp - PLAYER_ATK_DAMAGE); // second hit was too soon
  });
});
