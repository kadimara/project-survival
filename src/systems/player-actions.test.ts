import { describe, expect, it, vi } from 'vitest';
import {
  createTestEnemy,
  createTestGameState,
  createTestHudRefs,
  createTestTree,
} from '../test/fixtures';
import {
  PLAYER_ATK_COOLDOWN_TICKS,
  PLAYER_ATK_DAMAGE,
  PLAYER_ATK_HP_COST,
} from '../constants';
import { walkable } from '../state/state';
import {
  attemptPlayerAttack,
  doPickup,
  doPlace,
  tryPlaceAt,
  tryPlayerStep,
  trySelectPickup,
} from './player-actions';

// doPickup's setObstacle call patches the ground atlas, which paints to a
// real canvas context — see combat.test.ts for the same reasoning. Only
// the adjacent-pickup test below actually calls setObstacle.
vi.mock('../render/ground-atlas', () => ({
  buildGroundAtlas: vi.fn(),
  patchGroundAtlasTile: vi.fn(),
  buildWorldMapAtlas: vi.fn(),
  patchWorldMapAtlasTile: vi.fn(),
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

  it('deals unarmed damage to a tree target instead of an enemy', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const tree = createTestTree(10, 10);
    state.trees.set('10,10', tree);
    state.player.attackTarget = tree;

    attemptPlayerAttack(state, hud, 1000);

    expect(tree.hp).toBe(tree.maxHp - PLAYER_ATK_DAMAGE);
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

describe('tryPlayerStep', () => {
  it('leaves a footprint on the tile being left, not the one walked onto', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const { tileX, tileY } = state.player;
    const walkableFn = (x: number, y: number) => walkable(state, x, y);

    const moved = tryPlayerStep(
      state,
      hud,
      tileX + 1,
      tileY,
      'right',
      walkableFn,
    );

    expect(moved).toBe(true);
    expect(state.footprints).toHaveLength(1);
    expect(state.footprints[0]).toMatchObject({ x: tileX, y: tileY });
  });

  it('does not move or leave a footprint when the destination is blocked', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const { tileX, tileY } = state.player;
    state.obstacles.set(tileX + 1 + ',' + tileY, 'stone');
    const walkableFn = (x: number, y: number) => walkable(state, x, y);

    const moved = tryPlayerStep(
      state,
      hud,
      tileX + 1,
      tileY,
      'right',
      walkableFn,
    );

    expect(moved).toBe(false);
    expect(state.footprints).toHaveLength(0);
  });
});

describe('trySelectPickup', () => {
  it('clears an in-progress attackTarget when queueing a walk to a distant item', () => {
    const state = createTestGameState();
    const enemy = createTestEnemy(10, 10);
    state.player.attackTarget = enemy;
    state.obstacles.set('20,20', 'wood');
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
    state.obstacles.set(tileX + 1 + ',' + tileY, 'wood');
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

describe('doPickup', () => {
  it('picks up a floor tile when no obstacle is present, revealing bare ground', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    state.floor.set('5,5', 'dirt');

    doPickup(state, hud, 5, 5);

    expect(state.player.held).toBe('dirt');
    expect(state.floor.get('5,5')).toBeUndefined();
  });

  it('picking up an obstacle sitting on a floor tile leaves the floor intact', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    state.floor.set('5,5', 'dirt');
    state.obstacles.set('5,5', 'wood');

    doPickup(state, hud, 5, 5);

    expect(state.player.held).toBe('wood');
    expect(state.obstacles.get('5,5')).toBeUndefined();
    expect(state.floor.get('5,5')).toBe('dirt');
  });

  it('a non-pickable obstacle blocks reaching the floor underneath it', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    state.floor.set('5,5', 'dirt');
    state.obstacles.set('5,5', 'tree');

    doPickup(state, hud, 5, 5);

    expect(state.player.held).toBeNull();
    expect(state.obstacles.get('5,5')).toBe('tree');
    expect(state.floor.get('5,5')).toBe('dirt');
  });
});

describe('doPlace', () => {
  it('places a held floor tile onto an empty cell', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    state.player.held = 'dirt';

    doPlace(state, hud, 5, 5);

    expect(state.floor.get('5,5')).toBe('dirt');
    expect(state.player.held).toBeNull();
  });

  it('fails to place a held floor tile onto a cell that already has one', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    state.floor.set('5,5', 'dirt');
    state.player.held = 'dirt';

    doPlace(state, hud, 5, 5);

    expect(state.player.held).toBe('dirt'); // stays in hand
  });
});
