import { describe, expect, it, vi } from 'vitest';
import {
  createTestEnemy,
  createTestGameState,
  createTestHudRefs,
} from '../test/fixtures';
import {
  PLAYER_ATK_COOLDOWN_TICKS,
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
    // nextAttackAt tracks state.tick, not the `now` wall-clock arg — see
    // PLAYER_ATK_COOLDOWN_TICKS's comment in constants.ts
    expect(state.player.nextAttackAt).toBe(
      state.tick + PLAYER_ATK_COOLDOWN_TICKS,
    );
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
    state.tick = PLAYER_ATK_COOLDOWN_TICKS - 1;
    attemptPlayerAttack(state, hud, 1000);

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
    state.tick = PLAYER_ATK_COOLDOWN_TICKS - 1;
    attemptPlayerAttack(state, hud, 1000);

    expect(state.player.hp).toBe(hpAfterFirstHit);
  });

  it('fires a delayed-hit projectile instead of applying damage instantly when a ranged weapon is held', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const enemy = createTestEnemy(10, 10);
    state.player.attackTarget = enemy;
    state.player.held = 'bow';

    attemptPlayerAttack(state, hud, 1000);

    expect(enemy.hp).toBe(enemy.maxHp); // no instant damage
    expect(state.projectiles).toHaveLength(1);
    expect(state.projectiles[0].target).toBe(enemy);
  });

  it('still spends attack hp immediately on a ranged shot, same as melee', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const enemy = createTestEnemy(10, 10);
    state.player.attackTarget = enemy;
    state.player.held = 'bow';
    const hpBefore = state.player.hp;

    attemptPlayerAttack(state, hud, 1000);

    expect(state.player.hp).toBe(hpBefore - PLAYER_ATK_HP_COST);
  });
});

describe('trySelectPickup', () => {
  it('clears an in-progress attackTarget when queueing a walk to a distant item', () => {
    const state = createTestGameState();
    const enemy = createTestEnemy(10, 10);
    state.player.attackTarget = enemy;
    state.tiles.set('20,20', 'wood');
    const walkableFn = (x: number, y: number) => walkable(state, x, y);

    trySelectPickup(state, 20, 20, walkableFn);

    expect(state.player.attackTarget).toBeNull();
    expect(state.player.pendingAction).toEqual({
      type: 'pickup',
      x: 20,
      y: 20,
    });
  });

  // resolution is deferred to a simulation tick (see game.ts's simulateTick)
  // even when already adjacent, so nothing is picked up synchronously here
  it('sets a pendingAction (not an immediate pickup) even when already adjacent', () => {
    const state = createTestGameState();
    const enemy = createTestEnemy(10, 10);
    state.player.attackTarget = enemy;
    const { tileX, tileY } = state.player;
    state.tiles.set(tileX + 1 + ',' + tileY, 'wood');
    const walkableFn = (x: number, y: number) => walkable(state, x, y);

    trySelectPickup(state, tileX + 1, tileY, walkableFn);

    expect(state.player.attackTarget).toBeNull();
    expect(state.player.pendingAction).toEqual({
      type: 'pickup',
      x: tileX + 1,
      y: tileY,
    });
    expect(state.player.held).toBeNull();
  });
});

describe('tryPlaceAt', () => {
  it('clears an in-progress attackTarget when queueing a walk to place a held item', () => {
    const state = createTestGameState();
    const enemy = createTestEnemy(10, 10);
    state.player.attackTarget = enemy;
    state.player.held = 'ore';
    const walkableFn = (x: number, y: number) => walkable(state, x, y);

    tryPlaceAt(state, 20, 20, walkableFn);

    expect(state.player.attackTarget).toBeNull();
    expect(state.player.pendingAction).toEqual({ type: 'place', x: 20, y: 20 });
  });

  // same deferred-resolution note as trySelectPickup above
  it('sets a pendingAction (not an immediate place) even when already adjacent', () => {
    const state = createTestGameState();
    const enemy = createTestEnemy(10, 10);
    state.player.attackTarget = enemy;
    state.player.held = 'ore';
    const { tileX, tileY } = state.player;
    const walkableFn = (x: number, y: number) => walkable(state, x, y);

    tryPlaceAt(state, tileX + 1, tileY, walkableFn);

    expect(state.player.attackTarget).toBeNull();
    expect(state.player.pendingAction).toEqual({
      type: 'place',
      x: tileX + 1,
      y: tileY,
    });
    expect(state.player.held).toBe('ore');
  });
});
