import { describe, expect, it, vi } from 'vitest';
import {
  createTestEnemy,
  createTestGameState,
  createTestHudRefs,
} from '../test/fixtures';
import {
  PLAYER_ATK_COOLDOWN,
  PLAYER_ATK_DAMAGE,
  PLAYER_ATK_HP_COST,
} from '../constants';
import { walkable } from '../state/state';
import {
  attemptPlayerAttack,
  tryPlaceAt,
  trySelectPickup,
} from './player-actions';

// doPickup's setTile call patches the ground atlas, which paints to a real
// canvas context — see combat.test.ts for the same reasoning. Only the
// adjacent-pickup test below actually calls setTile.
vi.mock('../render/ground-atlas', () => ({
  buildGroundAtlas: vi.fn(),
  patchGroundAtlasTile: vi.fn(),
}));

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

  it('costs PLAYER_ATK_HP_COST hp on a landed attack', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const enemy = createTestEnemy(10, 10);
    state.player.attackTarget = enemy;
    const hpBefore = state.player.hp;

    attemptPlayerAttack(state, hud, 1000);

    expect(state.player.hp).toBe(hpBefore - PLAYER_ATK_HP_COST);
  });

  it('does not spend hp when the attack is blocked by cooldown', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const enemy = createTestEnemy(10, 10);
    state.player.attackTarget = enemy;

    attemptPlayerAttack(state, hud, 1000);
    const hpAfterFirstHit = state.player.hp;
    attemptPlayerAttack(state, hud, 1000 + PLAYER_ATK_COOLDOWN - 1);

    expect(state.player.hp).toBe(hpAfterFirstHit);
  });
});

describe('trySelectPickup', () => {
  it('clears an in-progress attackTarget when queueing a walk to a distant item', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const enemy = createTestEnemy(10, 10);
    state.player.attackTarget = enemy;
    state.tiles.set('20,20', 'wood');
    const walkableFn = (x: number, y: number) => walkable(state, x, y);

    trySelectPickup(state, hud, 20, 20, walkableFn);

    expect(state.player.attackTarget).toBeNull();
    expect(state.player.pendingAction).toEqual({
      type: 'pickup',
      x: 20,
      y: 20,
    });
  });

  it('clears an in-progress attackTarget on an immediate adjacent pickup', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const enemy = createTestEnemy(10, 10);
    state.player.attackTarget = enemy;
    const { tileX, tileY } = state.player;
    state.tiles.set(tileX + 1 + ',' + tileY, 'wood');
    const walkableFn = (x: number, y: number) => walkable(state, x, y);

    trySelectPickup(state, hud, tileX + 1, tileY, walkableFn);

    expect(state.player.attackTarget).toBeNull();
    expect(state.player.held).toBe('wood');
  });
});

describe('tryPlaceAt', () => {
  it('clears an in-progress attackTarget when queueing a walk to place a held item', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const enemy = createTestEnemy(10, 10);
    state.player.attackTarget = enemy;
    state.player.held = 'ore';
    const walkableFn = (x: number, y: number) => walkable(state, x, y);

    tryPlaceAt(state, hud, 20, 20, walkableFn);

    expect(state.player.attackTarget).toBeNull();
    expect(state.player.pendingAction).toEqual({ type: 'place', x: 20, y: 20 });
  });
});
