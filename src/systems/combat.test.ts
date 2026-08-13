import { describe, expect, it, vi } from 'vitest';
import {
  createTestEnemy,
  createTestGameState,
  createTestHudRefs,
} from '../test/fixtures';
import {
  ENEMY_COUNT,
  HIT_FLASH_MS,
  PLAYER_ATK_HP_COST,
  PLAYER_MOVE_HP_COST,
  PROJECTILE_TILES_PER_TICK,
  SPAWN_X,
  SPAWN_Y,
  TICK_MS,
} from '../constants';
import {
  damageEnemy,
  damagePlayer,
  fireProjectile,
  killEnemy,
  spendAttackHp,
  spendMoveHp,
  updateProjectiles,
} from './combat';

// combat.ts's death path (damagePlayer/spendMoveHp hitting 0 hp) calls
// resetGame -> state/state.ts's regenerateWorld -> buildGroundAtlas, which
// paints every tile of the map to a real canvas context. Mocking the
// render/ground-atlas module boundary keeps these tests about state-reset
// logic rather than canvas internals, and lets state.refs stay an inert
// stub (see createTestRefs in test/fixtures.ts).
vi.mock('../render/ground-atlas', () => ({
  buildGroundAtlas: vi.fn(),
  patchGroundAtlasTile: vi.fn(),
}));

function assertWorldWasReset(state: ReturnType<typeof createTestGameState>) {
  const { player } = state;
  expect(player.tileX).toBe(SPAWN_X);
  expect(player.tileY).toBe(SPAWN_Y);
  expect(player.hp).toBe(player.maxHp);
  expect(player.held).toBeNull();
  expect(player.pendingAction).toBeNull();
  expect(player.attackTarget).toBeNull();
  expect(player.path).toEqual([]);
  expect(player.attacked).toBe(false);
  expect(player.flashUntil).toBe(0);
  expect(state.seeds.size).toBe(0);
  expect(state.smelters.size).toBe(0);
  expect(state.furnaces.size).toBe(0);
  // spawnEnemies always places the training dummy plus up to ENEMY_COUNT
  // wandering enemies using the seeded rng, so the exact wandering count is
  // deterministic but not asserted here to avoid coupling this test to
  // worldgen/spawn-placement internals
  expect(state.enemies.length).toBeGreaterThan(0);
  expect(state.enemies.length).toBeLessThanOrEqual(ENEMY_COUNT + 1);
  expect(state.enemies.some((e) => e.stationary)).toBe(true);
  expect(state.groundItems.size).toBeGreaterThan(0);
  expect(state.projectiles).toEqual([]);
}

describe('damagePlayer', () => {
  it('reduces hp by amount and updates the hud', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    damagePlayer(state, hud, 10, 1000);
    expect(state.player.hp).toBe(state.player.maxHp - 10);
    expect(hud.statHp.textContent).toBe(
      `${state.player.maxHp - 10}/${state.player.maxHp}`,
    );
  });

  it('sets flashUntil to now + HIT_FLASH_MS on a hit', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    damagePlayer(state, hud, 10, 1000);
    expect(state.player.flashUntil).toBe(1000 + HIT_FLASH_MS);
  });

  it('is a no-op when hp is already at or below 0', () => {
    const state = createTestGameState();
    state.player.hp = 0;
    const hud = createTestHudRefs();
    damagePlayer(state, hud, 10, 1000);
    expect(state.player.hp).toBe(0);
  });

  it('treats an overkill amount the same as an exact-lethal one (both floor to 0 and reset)', () => {
    // hp is floored via Math.max(0, ...) before the <= 0 check, but that
    // floored value is never independently observable here: hp <= 0 always
    // triggers the same immediate resetGame(), which overwrites hp back to
    // maxHp before this function returns.
    const state = createTestGameState();
    state.player.hp = 5;
    const hud = createTestHudRefs();
    damagePlayer(state, hud, 999, 1000);
    assertWorldWasReset(state);
  });

  it('sets attacked = true on a non-lethal hit', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    damagePlayer(state, hud, 10, 1000);
    expect(state.player.attacked).toBe(true);
  });

  it('does not set attacked = true on a lethal hit', () => {
    const state = createTestGameState();
    state.player.hp = 5;
    const hud = createTestHudRefs();
    damagePlayer(state, hud, 999, 1000);
    expect(state.player.attacked).toBe(false);
  });

  it('retaliates against the attacker on a non-lethal hit, interrupting any pending path/action', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const attacker = createTestEnemy(5, 5);
    state.player.path = [{ x: 1, y: 1 }];
    state.player.pendingAction = { type: 'pickup', x: 2, y: 2 };
    damagePlayer(state, hud, 10, 1000, attacker);
    expect(state.player.attackTarget).toBe(attacker);
    expect(state.player.path).toEqual([]);
    expect(state.player.pendingAction).toBeNull();
  });

  it('does not set attackTarget when no attacker is passed', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    damagePlayer(state, hud, 10, 1000);
    expect(state.player.attackTarget).toBeNull();
  });

  it('resets the world when hp hits exactly 0', () => {
    const state = createTestGameState();
    state.player.hp = 10;
    const hud = createTestHudRefs();
    damagePlayer(state, hud, 10, 1000);
    assertWorldWasReset(state);
  });
});

describe('spendMoveHp', () => {
  it('subtracts PLAYER_MOVE_HP_COST', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const hpBefore = state.player.hp;
    spendMoveHp(state, hud);
    expect(state.player.hp).toBe(hpBefore - PLAYER_MOVE_HP_COST);
  });

  it('resets the world when called on a player already at 0 hp', () => {
    // same reasoning as damagePlayer's overkill case: the floored-at-0
    // value is immediately overwritten by resetGame's full hp restore
    const state = createTestGameState();
    state.player.hp = 0;
    const hud = createTestHudRefs();
    spendMoveHp(state, hud);
    assertWorldWasReset(state);
  });

  it('resets the world when hp hits exactly 0', () => {
    const state = createTestGameState();
    state.player.hp = PLAYER_MOVE_HP_COST;
    const hud = createTestHudRefs();
    spendMoveHp(state, hud);
    assertWorldWasReset(state);
  });
});

describe('spendAttackHp', () => {
  it('subtracts PLAYER_ATK_HP_COST', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const hpBefore = state.player.hp;
    spendAttackHp(state, hud);
    expect(state.player.hp).toBe(hpBefore - PLAYER_ATK_HP_COST);
  });

  it('resets the world when hp hits exactly 0', () => {
    const state = createTestGameState();
    state.player.hp = PLAYER_ATK_HP_COST;
    const hud = createTestHudRefs();
    spendAttackHp(state, hud);
    assertWorldWasReset(state);
  });
});

describe('damageEnemy', () => {
  it('reduces hp by amount and sets flashUntil', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const enemy = createTestEnemy(10, 10);
    state.enemies.push(enemy);

    damageEnemy(state, hud, enemy, 3, 1000);

    expect(enemy.hp).toBe(enemy.maxHp - 3);
    expect(enemy.flashUntil).toBe(1000 + HIT_FLASH_MS);
  });

  it('pushes a damage floating text at the enemy tile', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const enemy = createTestEnemy(10, 10);
    state.enemies.push(enemy);

    damageEnemy(state, hud, enemy, 3, 1000);

    const text = state.floatingTexts.at(-1);
    expect(text?.text).toBe('-3');
    expect(text?.color).toBe('#e8a838');
  });

  it('does not kill the enemy on a non-lethal hit', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const enemy = createTestEnemy(10, 10);
    state.enemies.push(enemy);

    damageEnemy(state, hud, enemy, enemy.hp - 1, 1000);

    expect(state.enemies).toContain(enemy);
  });

  it('floors hp at 0 and kills the enemy on a lethal hit, removing it from state.enemies', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const enemy = createTestEnemy(10, 10);
    state.enemies.push(enemy);

    damageEnemy(state, hud, enemy, enemy.hp + 999, 1000);

    expect(enemy.hp).toBe(0);
    expect(state.enemies).not.toContain(enemy);
  });

  it('clears player.attackTarget when it was targeting the enemy that died', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const enemy = createTestEnemy(10, 10);
    state.enemies.push(enemy);
    state.player.attackTarget = enemy;

    damageEnemy(state, hud, enemy, enemy.hp, 1000);

    expect(state.player.attackTarget).toBeNull();
  });

  it('leaves player.attackTarget alone when it was targeting a different enemy', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const enemy = createTestEnemy(10, 10);
    const otherTarget = createTestEnemy(1, 1);
    state.enemies.push(enemy, otherTarget);
    state.player.attackTarget = otherTarget;

    damageEnemy(state, hud, enemy, enemy.hp, 1000);

    expect(state.player.attackTarget).toBe(otherTarget);
  });
});

describe('killEnemy', () => {
  it('removes the enemy from state.enemies', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const enemy = createTestEnemy(10, 10);
    state.enemies.push(enemy);
    killEnemy(state, hud, enemy);
    expect(state.enemies).not.toContain(enemy);
  });

  it('pushes a "defeated!" floating text', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const enemy = createTestEnemy(10, 10);
    state.enemies.push(enemy);
    killEnemy(state, hud, enemy);
    const text = state.floatingTexts.at(-1);
    // deliberately not asserting on `born`: spawnFloatingText uses
    // performance.now() directly rather than any value passed into killEnemy
    expect(text?.text).toBe('defeated!');
    expect(text?.color).toBe('#c1633c');
  });

  it("drops an energy item at the enemy's own tile when open", () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const enemy = createTestEnemy(10, 10);
    state.enemies.push(enemy);
    killEnemy(state, hud, enemy);
    expect(state.groundItems.get('10,10')).toEqual({
      x: 10,
      y: 10,
      type: 'energy',
    });
  });

  it('falls back to the +1,0 ring tile when the enemy tile is occupied', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const enemy = createTestEnemy(5, 5);
    state.enemies.push(enemy);
    state.groundItems.set('5,5', { x: 5, y: 5, type: 'ore' });
    killEnemy(state, hud, enemy);
    expect(state.groundItems.get('6,5')).toEqual({
      x: 6,
      y: 5,
      type: 'energy',
    });
  });

  it('falls back to the -1,0 ring tile when both the enemy tile and +1,0 are occupied', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const enemy = createTestEnemy(5, 5);
    state.enemies.push(enemy);
    state.groundItems.set('5,5', { x: 5, y: 5, type: 'ore' });
    state.groundItems.set('6,5', { x: 6, y: 5, type: 'ore' });
    killEnemy(state, hud, enemy);
    expect(state.groundItems.get('4,5')).toEqual({
      x: 4,
      y: 5,
      type: 'energy',
    });
  });

  it('still fires its side effects for an enemy not present in state.enemies', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const other = createTestEnemy(1, 1);
    state.enemies.push(other);
    const notInArray = createTestEnemy(10, 10);

    killEnemy(state, hud, notInArray);

    // documented existing behavior: killEnemy doesn't guard on the enemy
    // actually being present — splice silently no-ops via indexOf === -1,
    // but the floating text/drop/hud-update still happen unconditionally
    expect(state.enemies).toEqual([other]);
    expect(state.floatingTexts.at(-1)?.text).toBe('defeated!');
    expect(state.groundItems.get('10,10')).toEqual({
      x: 10,
      y: 10,
      type: 'energy',
    });
  });
});

describe('fireProjectile', () => {
  it('pushes a projectile carrying the target and damage', () => {
    const state = createTestGameState();
    const enemy = createTestEnemy(SPAWN_X + 2, SPAWN_Y);
    state.enemies.push(enemy);

    fireProjectile(state, state.player, enemy, 5, 1000);

    expect(state.projectiles).toHaveLength(1);
    expect(state.projectiles[0].target).toBe(enemy);
    expect(state.projectiles[0].damage).toBe(5);
  });

  it('lands after ceil(distance / PROJECTILE_TILES_PER_TICK) ticks', () => {
    const state = createTestGameState();
    // distance PROJECTILE_TILES_PER_TICK + 1 rounds up to 2 ticks, not 1
    const enemy = createTestEnemy(
      SPAWN_X + PROJECTILE_TILES_PER_TICK + 1,
      SPAWN_Y,
    );
    state.enemies.push(enemy);

    fireProjectile(state, state.player, enemy, 5, 1000);

    const p = state.projectiles[0];
    expect(p.landTick).toBe(state.tick + 2);
    expect(p.landAt).toBe(1000 + 2 * TICK_MS);
  });

  it('takes a minimum of 1 tick to land, even at melee distance', () => {
    const state = createTestGameState();
    const enemy = createTestEnemy(SPAWN_X + 1, SPAWN_Y);
    state.enemies.push(enemy);

    fireProjectile(state, state.player, enemy, 5, 1000);

    expect(state.projectiles[0].landTick).toBe(state.tick + 1);
  });
});

describe('updateProjectiles', () => {
  it('does not apply damage before landTick', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const enemy = createTestEnemy(10, 10);
    state.enemies.push(enemy);
    state.tick = 3;
    state.projectiles.push({
      target: enemy,
      damage: 5,
      fromPx: 0,
      fromPy: 0,
      toPx: 0,
      toPy: 0,
      spawnAt: 0,
      landAt: 1000,
      landTick: 5,
    });

    updateProjectiles(state, hud, 500);

    expect(enemy.hp).toBe(enemy.maxHp);
    expect(state.projectiles).toHaveLength(1);
  });

  it('applies damage and removes the projectile once landTick is reached', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const enemy = createTestEnemy(10, 10);
    state.enemies.push(enemy);
    state.tick = 5;
    state.projectiles.push({
      target: enemy,
      damage: 5,
      fromPx: 0,
      fromPy: 0,
      toPx: 0,
      toPy: 0,
      spawnAt: 0,
      landAt: 1000,
      landTick: 5,
    });

    updateProjectiles(state, hud, 1000);

    expect(enemy.hp).toBe(enemy.maxHp - 5);
    expect(state.projectiles).toEqual([]);
  });

  it('fizzles quietly when the target already died before the shot lands', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const enemy = createTestEnemy(10, 10);
    enemy.hp = 0; // e.g. killed by a different hit while this shot was in flight
    state.tick = 5;
    state.projectiles.push({
      target: enemy,
      damage: 5,
      fromPx: 0,
      fromPy: 0,
      toPx: 0,
      toPy: 0,
      spawnAt: 0,
      landAt: 1000,
      landTick: 5,
    });

    updateProjectiles(state, hud, 1000);

    expect(state.floatingTexts).toEqual([]);
    expect(state.projectiles).toEqual([]);
  });
});
