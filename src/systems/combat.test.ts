import { describe, expect, it, vi } from 'vitest';
import {
  createTestEnemy,
  createTestGameState,
  createTestHudRefs,
} from '../test/fixtures';
import { PLAYER_HIT_INVULN_MS, PLAYER_MOVE_HP_COST, SPAWN_X, SPAWN_Y } from '../constants';
import { damagePlayer, killEnemy, spendMoveHp } from './combat';

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
  expect(player.invulnUntil).toBe(0);
  expect(state.seeds.size).toBe(0);
  expect(state.smelters.size).toBe(0);
  expect(state.furnaces.size).toBe(0);
  // only holds because ENEMY_COUNT is 0 in constants.ts today; spawnEnemies
  // uses Math.random() internally once that's raised, which would make this
  // assertion (and determinism generally) worth revisiting
  expect(state.enemies.length).toBe(0);
  expect(state.groundItems.size).toBeGreaterThan(0);
}

describe('damagePlayer', () => {
  it('reduces hp by amount and updates the hud', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    damagePlayer(state, hud, 10, 1000);
    expect(state.player.hp).toBe(state.player.maxHp - 10);
    expect(hud.statHp.textContent).toBe(`${state.player.maxHp - 10}/${state.player.maxHp}`);
  });

  it('sets invulnUntil to now + PLAYER_HIT_INVULN_MS on a hit', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    damagePlayer(state, hud, 10, 1000);
    expect(state.player.invulnUntil).toBe(1000 + PLAYER_HIT_INVULN_MS);
  });

  it('is a no-op while now is before invulnUntil', () => {
    const state = createTestGameState();
    state.player.invulnUntil = 5000;
    const hud = createTestHudRefs();
    const hpBefore = state.player.hp;
    damagePlayer(state, hud, 10, 1000);
    expect(state.player.hp).toBe(hpBefore);
    expect(state.player.invulnUntil).toBe(5000);
  });

  it('is a no-op when hp is already at or below 0', () => {
    const state = createTestGameState();
    state.player.hp = 0;
    const hud = createTestHudRefs();
    damagePlayer(state, hud, 10, 1000);
    expect(state.player.hp).toBe(0);
    expect(state.player.invulnUntil).toBe(0);
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

  it('resets the world when hp hits exactly 0', () => {
    const state = createTestGameState();
    state.player.hp = 10;
    const hud = createTestHudRefs();
    damagePlayer(state, hud, 10, 1000);
    assertWorldWasReset(state);
  });
});

describe('spendMoveHp', () => {
  it('subtracts PLAYER_MOVE_HP_COST unconditionally, ignoring invulnUntil', () => {
    const state = createTestGameState();
    state.player.invulnUntil = 1_000_000; // far in the future
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
    expect(state.groundItems.get('10,10')).toEqual({ x: 10, y: 10, type: 'energy' });
  });

  it('falls back to the +1,0 ring tile when the enemy tile is occupied', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const enemy = createTestEnemy(5, 5);
    state.enemies.push(enemy);
    state.groundItems.set('5,5', { x: 5, y: 5, type: 'ore' });
    killEnemy(state, hud, enemy);
    expect(state.groundItems.get('6,5')).toEqual({ x: 6, y: 5, type: 'energy' });
  });

  it('falls back to the -1,0 ring tile when both the enemy tile and +1,0 are occupied', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const enemy = createTestEnemy(5, 5);
    state.enemies.push(enemy);
    state.groundItems.set('5,5', { x: 5, y: 5, type: 'ore' });
    state.groundItems.set('6,5', { x: 6, y: 5, type: 'ore' });
    killEnemy(state, hud, enemy);
    expect(state.groundItems.get('4,5')).toEqual({ x: 4, y: 5, type: 'energy' });
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
    expect(state.groundItems.get('10,10')).toEqual({ x: 10, y: 10, type: 'energy' });
  });
});
