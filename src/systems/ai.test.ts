import { describe, expect, it } from 'vitest';
import {
  createTestEnemy,
  createTestGameState,
  createTestHudRefs,
} from '../test/fixtures';
import {
  DUMMY_ATK_COOLDOWN,
  ENEMY_ATK_COOLDOWN,
  ENEMY_ATK_DAMAGE,
} from '../constants';
import { updateEnemy } from './ai';

const alwaysWalkable = () => true;

describe('updateEnemy: stationary (training dummy)', () => {
  it('never moves, even when the player is out of range', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const dummy = createTestEnemy(10, 10, {
      stationary: true,
      hp: Infinity,
      maxHp: Infinity,
    });
    state.player.tileX = 0;
    state.player.tileY = 0;

    updateEnemy(state, hud, dummy, 1000, alwaysWalkable);

    expect(dummy.tileX).toBe(10);
    expect(dummy.tileY).toBe(10);
    expect(dummy.moving).toBe(false);
    expect(dummy.path).toEqual([]);
  });

  it('does not path toward the player even when sighted but not adjacent', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const dummy = createTestEnemy(10, 10, {
      stationary: true,
      hp: Infinity,
      maxHp: Infinity,
    });
    state.player.tileX = 11; // within aggro radius, but not adjacent (2 tiles away)
    state.player.tileY = 12;

    updateEnemy(state, hud, dummy, 1000, alwaysWalkable);

    expect(dummy.tileX).toBe(10);
    expect(dummy.tileY).toBe(10);
    expect(dummy.path).toEqual([]);
  });

  it('retaliates when the player is adjacent', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const dummy = createTestEnemy(10, 10, {
      stationary: true,
      hp: Infinity,
      maxHp: Infinity,
    });
    state.player.tileX = 11;
    state.player.tileY = 10;
    const hpBefore = state.player.hp;

    // lastAttack starts at 0, so `now` needs to clear DUMMY_ATK_COOLDOWN
    // before the first retaliation is allowed to land
    updateEnemy(state, hud, dummy, DUMMY_ATK_COOLDOWN, alwaysWalkable);

    expect(state.player.hp).toBe(hpBefore - ENEMY_ATK_DAMAGE);
    expect(dummy.lastAttack).toBe(DUMMY_ATK_COOLDOWN);
  });

  it('uses DUMMY_ATK_COOLDOWN (slower than a regular enemy) between retaliations', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const dummy = createTestEnemy(10, 10, {
      stationary: true,
      hp: Infinity,
      maxHp: Infinity,
    });
    state.player.tileX = 11;
    state.player.tileY = 10;

    updateEnemy(state, hud, dummy, DUMMY_ATK_COOLDOWN, alwaysWalkable);
    const hpAfterFirstHit = state.player.hp;

    // long enough to beat a regular enemy's cooldown, but not the dummy's
    updateEnemy(
      state,
      hud,
      dummy,
      DUMMY_ATK_COOLDOWN + ENEMY_ATK_COOLDOWN + 1,
      alwaysWalkable,
    );
    expect(state.player.hp).toBe(hpAfterFirstHit); // still on cooldown, no second hit

    updateEnemy(state, hud, dummy, DUMMY_ATK_COOLDOWN * 2, alwaysWalkable);
    expect(state.player.hp).toBe(hpAfterFirstHit - ENEMY_ATK_DAMAGE);
  });

  it('never dies from damage — hp stays Infinity', () => {
    const dummy = createTestEnemy(10, 10, {
      stationary: true,
      hp: Infinity,
      maxHp: Infinity,
    });
    dummy.hp -= 999999;
    expect(dummy.hp).toBe(Infinity);
  });
});
