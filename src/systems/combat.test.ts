import { describe, expect, it, vi } from 'vitest';
import {
  createTestCactus,
  createTestEnemy,
  createTestGameState,
  createTestHudRefs,
  createTestTree,
} from '../test/fixtures';
import {
  ENEMY_DEFS,
  HIT_FLASH_MS,
  JERBOA_COUNT,
  PLAYER_ATK_HP_COST,
  PLAYER_MOVE_HP_COST,
  PROJECTILE_TILES_PER_TICK,
  SPAWN_X,
  SPAWN_Y,
  TICK_MS,
} from '../constants';
import {
  damageCactus,
  damageEnemy,
  damagePlayer,
  damageTree,
  destroyCactus,
  fellTree,
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
  buildWorldMapAtlas: vi.fn(),
  patchWorldMapAtlasTile: vi.fn(),
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
  // spawnEnemies places up to JERBOA_COUNT wandering 'jerboa' enemies using
  // the seeded rng, so the exact count is deterministic but not asserted
  // here to avoid coupling this test to worldgen/spawn-placement internals.
  // Separately, it also seeds 'boulderGuardian' enemies tied to whichever
  // boulder-cluster structures the regenerated world happens to contain —
  // real, seed-dependent, and deliberately not asserted here either, for
  // the same reason.
  expect(
    state.enemies.filter((e) => e.type === 'jerboa').length,
  ).toBeLessThanOrEqual(JERBOA_COUNT);
  expect(state.items.size).toBeGreaterThan(0);
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

  it('drops carried food on a non-lethal hit and clears carrying', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const enemy = createTestEnemy(10, 10, { carrying: 'berry' });
    state.enemies.push(enemy);

    damageEnemy(state, hud, enemy, 1, 1000);

    expect(enemy.carrying).toBeNull();
    // lands on the +1,0 ring tile, not the enemy's own (10,10): the enemy
    // is still alive and standing there, so placeItemNear's isEnemyAt check
    // blocks the origin, same as it would for any other occupied tile
    expect(state.items.get('11,10')).toEqual({ x: 11, y: 10, type: 'berry' });
    expect(state.enemies).toContain(enemy); // non-lethal — still alive
  });

  it('drops both the carried food and the normal death-drop item on a lethal hit', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const enemy = createTestEnemy(10, 10, { carrying: 'berry' });
    state.enemies.push(enemy);

    damageEnemy(state, hud, enemy, enemy.hp + 999, 1000);

    expect(enemy.carrying).toBeNull();
    // the carried food lands on the enemy's own tile (dropped first, while
    // it's still "there"); the unconditional death-drop (killEnemy) finds
    // that tile taken and falls back to a ring tile
    expect(state.items.get('10,10')).toEqual({ x: 10, y: 10, type: 'berry' });
    expect(state.items.get('11,10')).toEqual({
      x: 11,
      y: 10,
      type: ENEMY_DEFS[enemy.type].dropItem,
    });
  });

  it('drops nothing extra on a hit when not carrying anything', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const enemy = createTestEnemy(10, 10); // carrying: null (makeEnemy's default)
    state.enemies.push(enemy);

    damageEnemy(state, hud, enemy, 1, 1000);

    expect(state.items.size).toBe(0);
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
    expect(state.items.get('10,10')).toEqual({
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
    state.items.set('5,5', { x: 5, y: 5, type: 'ore' });
    killEnemy(state, hud, enemy);
    expect(state.items.get('6,5')).toEqual({
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
    state.items.set('5,5', { x: 5, y: 5, type: 'ore' });
    state.items.set('6,5', { x: 6, y: 5, type: 'ore' });
    killEnemy(state, hud, enemy);
    expect(state.items.get('4,5')).toEqual({
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
    expect(state.items.get('10,10')).toEqual({
      x: 10,
      y: 10,
      type: 'energy',
    });
  });
});

describe('damageTree', () => {
  it('reduces hp by amount and sets flashUntil', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const tree = createTestTree(10, 10);
    state.trees.set('10,10', tree);

    damageTree(state, hud, tree, 3, 1000);

    expect(tree.hp).toBe(tree.maxHp - 3);
    expect(tree.flashUntil).toBe(1000 + HIT_FLASH_MS);
  });

  it('pushes a damage floating text at the tree', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const tree = createTestTree(10, 10);
    state.trees.set('10,10', tree);

    damageTree(state, hud, tree, 3, 1000);

    const text = state.floatingTexts.at(-1);
    expect(text?.text).toBe('-3');
    expect(text?.color).toBe('#e8a838');
  });

  it('does not fell the tree on a non-lethal hit', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const tree = createTestTree(10, 10);
    state.trees.set('10,10', tree);
    state.obstacles.set('10,10', 'tree');

    damageTree(state, hud, tree, tree.hp - 1, 1000);

    expect(state.obstacles.get('10,10')).toBe('tree');
  });

  it('floors hp at 0 and fells the tree on a lethal hit', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const tree = createTestTree(10, 10);
    state.trees.set('10,10', tree);
    state.obstacles.set('10,10', 'tree');

    damageTree(state, hud, tree, tree.hp + 999, 1000);

    expect(tree.hp).toBe(0);
    expect(state.obstacles.get('10,10')).toBe('wood');
  });
});

describe('fellTree', () => {
  it("swaps the tree's obstacle cell for 'wood'", () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const tree = createTestTree(10, 10);
    state.trees.set('10,10', tree);
    state.obstacles.set('10,10', 'tree');

    fellTree(state, hud, tree);

    expect(state.obstacles.get('10,10')).toBe('wood');
  });

  it('removes the tree from state.trees', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const tree = createTestTree(10, 10);
    state.trees.set('10,10', tree);
    state.obstacles.set('10,10', 'tree');

    fellTree(state, hud, tree);

    expect(state.trees.has('10,10')).toBe(false);
  });

  it('pushes a "felled!" floating text', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const tree = createTestTree(10, 10);
    state.obstacles.set('10,10', 'tree');

    fellTree(state, hud, tree);

    const text = state.floatingTexts.at(-1);
    expect(text?.text).toBe('felled!');
    expect(text?.color).toBe('#c1633c');
  });

  it('clears player.attackTarget when it was targeting the felled tree', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const tree = createTestTree(10, 10);
    state.obstacles.set('10,10', 'tree');
    state.player.attackTarget = tree;

    fellTree(state, hud, tree);

    expect(state.player.attackTarget).toBeNull();
  });

  it('leaves player.attackTarget alone when it was targeting something else', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const tree = createTestTree(10, 10);
    const otherTarget = createTestEnemy(1, 1);
    state.obstacles.set('10,10', 'tree');
    state.player.attackTarget = otherTarget;

    fellTree(state, hud, tree);

    expect(state.player.attackTarget).toBe(otherTarget);
  });
});

describe('damageCactus', () => {
  it('reduces hp by amount and sets flashUntil', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const cactus = createTestCactus(10, 10);
    state.cacti.set('10,10', cactus);

    damageCactus(state, hud, cactus, 3, 1000);

    expect(cactus.hp).toBe(cactus.maxHp - 3);
    expect(cactus.flashUntil).toBe(1000 + HIT_FLASH_MS);
  });

  it('pushes a damage floating text at the cactus', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const cactus = createTestCactus(10, 10);
    state.cacti.set('10,10', cactus);

    damageCactus(state, hud, cactus, 3, 1000);

    const text = state.floatingTexts.at(-1);
    expect(text?.text).toBe('-3');
    expect(text?.color).toBe('#e8a838');
  });

  it('does not destroy the cactus on a non-lethal hit', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const cactus = createTestCactus(10, 10);
    state.cacti.set('10,10', cactus);
    state.obstacles.set('10,10', 'cactus');

    damageCactus(state, hud, cactus, cactus.hp - 1, 1000);

    expect(state.obstacles.get('10,10')).toBe('cactus');
  });

  it('floors hp at 0 and destroys the cactus on a lethal hit', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const cactus = createTestCactus(10, 10);
    state.cacti.set('10,10', cactus);
    state.obstacles.set('10,10', 'cactus');

    damageCactus(state, hud, cactus, cactus.hp + 999, 1000);

    expect(cactus.hp).toBe(0);
    expect(state.obstacles.has('10,10')).toBe(false);
  });
});

describe('destroyCactus', () => {
  it("clears the cactus's obstacle cell", () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const cactus = createTestCactus(10, 10);
    state.cacti.set('10,10', cactus);
    state.obstacles.set('10,10', 'cactus');

    destroyCactus(state, hud, cactus);

    expect(state.obstacles.has('10,10')).toBe(false);
  });

  it('removes the cactus from state.cacti', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const cactus = createTestCactus(10, 10);
    state.cacti.set('10,10', cactus);
    state.obstacles.set('10,10', 'cactus');

    destroyCactus(state, hud, cactus);

    expect(state.cacti.has('10,10')).toBe(false);
  });

  it('drops a cactusFruit item at the cactus tile', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const cactus = createTestCactus(10, 10);
    state.obstacles.set('10,10', 'cactus');

    destroyCactus(state, hud, cactus);

    expect(state.items.get('10,10')).toEqual({
      x: 10,
      y: 10,
      type: 'cactusFruit',
    });
  });

  it('pushes a "destroyed!" floating text', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const cactus = createTestCactus(10, 10);
    state.obstacles.set('10,10', 'cactus');

    destroyCactus(state, hud, cactus);

    const text = state.floatingTexts.at(-1);
    expect(text?.text).toBe('destroyed!');
    expect(text?.color).toBe('#c1633c');
  });

  it('clears player.attackTarget when it was targeting the destroyed cactus', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const cactus = createTestCactus(10, 10);
    state.obstacles.set('10,10', 'cactus');
    state.player.attackTarget = cactus;

    destroyCactus(state, hud, cactus);

    expect(state.player.attackTarget).toBeNull();
  });

  it('leaves player.attackTarget alone when it was targeting something else', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const cactus = createTestCactus(10, 10);
    const otherTarget = createTestEnemy(1, 1);
    state.obstacles.set('10,10', 'cactus');
    state.player.attackTarget = otherTarget;

    destroyCactus(state, hud, cactus);

    expect(state.player.attackTarget).toBe(otherTarget);
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
