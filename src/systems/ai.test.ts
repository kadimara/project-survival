import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTestEnemy,
  createTestGameState,
  createTestHudRefs,
} from '../test/fixtures';
import {
  DUMMY_ATK_COOLDOWN_TICKS,
  ENEMY_DEFS,
  FOOD_HEAL_AMOUNTS,
} from '../constants';
import { updateEnemy } from './ai';

const alwaysWalkable = () => true;

describe('updateEnemy: stationary (training dummy)', () => {
  it('never moves, even when the player is out of range', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const dummy = createTestEnemy(10, 10, {
      type: 'boulderGuardian',
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
      type: 'boulderGuardian',
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
      type: 'boulderGuardian',
      stationary: true,
      hp: Infinity,
      maxHp: Infinity,
    });
    state.player.tileX = 11;
    state.player.tileY = 10;
    const hpBefore = state.player.hp;

    // nextAttackAt starts at tick 0, same as state.tick, so the first
    // retaliation is never blocked by cooldown — cooldowns are gated on
    // state.tick, not the `now` wall-clock param, so cadence stays exact
    // regardless of frame timing
    updateEnemy(state, hud, dummy, 1000, alwaysWalkable);

    expect(state.player.hp).toBe(
      hpBefore - ENEMY_DEFS.boulderGuardian.atkDamage,
    );
    expect(dummy.nextAttackAt).toBe(DUMMY_ATK_COOLDOWN_TICKS);
  });

  it('uses DUMMY_ATK_COOLDOWN_TICKS (slower than a regular enemy) between retaliations', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const dummy = createTestEnemy(10, 10, {
      type: 'boulderGuardian',
      stationary: true,
      hp: Infinity,
      maxHp: Infinity,
    });
    state.player.tileX = 11;
    state.player.tileY = 10;

    updateEnemy(state, hud, dummy, 1000, alwaysWalkable); // first hit at tick 0
    const hpAfterFirstHit = state.player.hp;

    // long enough to beat a regular enemy's cooldown, but not the dummy's
    // (nextAttackAt is DUMMY_ATK_COOLDOWN_TICKS after the first hit)
    state.tick = ENEMY_DEFS.boulderGuardian.atkCooldownTicks + 1;
    updateEnemy(state, hud, dummy, 1000, alwaysWalkable);
    expect(state.player.hp).toBe(hpAfterFirstHit); // still on cooldown, no second hit

    state.tick = DUMMY_ATK_COOLDOWN_TICKS;
    updateEnemy(state, hud, dummy, 1000, alwaysWalkable);
    expect(state.player.hp).toBe(
      hpAfterFirstHit - ENEMY_DEFS.boulderGuardian.atkDamage,
    );
  });

  it('never dies from damage — hp stays Infinity', () => {
    const dummy = createTestEnemy(10, 10, {
      type: 'boulderGuardian',
      stationary: true,
      hp: Infinity,
      maxHp: Infinity,
    });
    dummy.hp -= 999999;
    expect(dummy.hp).toBe(Infinity);
  });
});

describe('updateEnemy: wander anchoring', () => {
  // ai.ts's wander branch draws its offset from plain Math.random() (not an
  // injectable rng), so pin it to its max value — offset = +wanderRadius in
  // both axes — to get a deterministic, guaranteed-nonzero displacement from
  // the anchor instead of a ~1-in-(2r+1)^2 chance of landing back on the
  // anchor tile itself (which would leave path empty and make this flaky).
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('anchors the wander target to `home` when set, not the current tile', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const state = createTestGameState();
    const hud = createTestHudRefs();
    state.player.hp = 0; // never sighted, so this stays in the wander branch
    const home = { x: 10, y: 10 };
    const guardian = createTestEnemy(100, 100, {
      type: 'boulderGuardian',
      home,
      nextWanderAt: 0,
    });

    updateEnemy(state, hud, guardian, 1000, alwaysWalkable);

    expect(guardian.path.length).toBeGreaterThan(0);
    const dest = guardian.path[guardian.path.length - 1];
    const r = ENEMY_DEFS.boulderGuardian.wanderRadius;
    expect(Math.abs(dest.x - home.x)).toBeLessThanOrEqual(r);
    expect(Math.abs(dest.y - home.y)).toBeLessThanOrEqual(r);
  });

  it('anchors to its own current tile when `home` is null (jerboa regression)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    const state = createTestGameState();
    const hud = createTestHudRefs();
    state.player.hp = 0;
    const guardian = createTestEnemy(50, 50, {
      type: 'jerboa',
      home: null,
      nextWanderAt: 0,
    });

    updateEnemy(state, hud, guardian, 1000, alwaysWalkable);

    expect(guardian.path.length).toBeGreaterThan(0);
    const dest = guardian.path[guardian.path.length - 1];
    const r = ENEMY_DEFS.jerboa.wanderRadius;
    expect(Math.abs(dest.x - 50)).toBeLessThanOrEqual(r);
    expect(Math.abs(dest.y - 50)).toBeLessThanOrEqual(r);
  });
});

describe('updateEnemy: leash', () => {
  it('breaks off a chase once pulled past leashRadius from home, even while still sighted', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const guardian = createTestEnemy(20, 0, {
      type: 'boulderGuardian',
      home: { x: 0, y: 0 }, // 20 tiles away — well past leashRadius (6)
    });
    state.player.tileX = 21;
    state.player.tileY = 0; // adjacent, well within aggroRadius (4) — still sighted

    updateEnemy(state, hud, guardian, 1000, alwaysWalkable);

    expect(guardian.state).toBe('wander');
    expect(guardian.target).toBeNull();
    expect(guardian.path).toEqual([]);
  });

  it('keeps chasing while still within leashRadius of home', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const guardian = createTestEnemy(20, 0, {
      type: 'boulderGuardian',
      home: { x: 19, y: 0 }, // 1 tile away — well within leashRadius (6)
    });
    state.player.tileX = 23;
    state.player.tileY = 0; // 3 tiles away — within aggroRadius (4), not adjacent

    updateEnemy(state, hud, guardian, 1000, alwaysWalkable);

    expect(guardian.state).toBe('chase');
    expect(guardian.target).not.toBeNull();
  });
});

describe('updateEnemy: per-type stats', () => {
  it("uses the boulderGuardian's own damage/cooldown, not the jerboa's", () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const guardian = createTestEnemy(5, 5, {
      type: 'boulderGuardian',
      home: { x: 5, y: 5 },
    });
    state.player.tileX = 6;
    state.player.tileY = 5; // adjacent
    const hpBefore = state.player.hp;

    updateEnemy(state, hud, guardian, 1000, alwaysWalkable);

    expect(state.player.hp).toBe(
      hpBefore - ENEMY_DEFS.boulderGuardian.atkDamage,
    );
    expect(ENEMY_DEFS.boulderGuardian.atkDamage).not.toBe(
      ENEMY_DEFS.jerboa.atkDamage,
    );
    expect(guardian.nextAttackAt).toBe(
      state.tick + ENEMY_DEFS.boulderGuardian.atkCooldownTicks,
    );
  });
});

describe('updateEnemy: jerboa flee/forage', () => {
  it('flees instead of chasing/attacking when sighted, moving away from the player', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const jerboa = createTestEnemy(10, 10, { type: 'jerboa' });
    state.player.tileX = 12;
    state.player.tileY = 10; // within aggroRadius (5)
    const distBefore = Math.hypot(
      jerboa.tileX - state.player.tileX,
      jerboa.tileY - state.player.tileY,
    );

    updateEnemy(state, hud, jerboa, 1000, alwaysWalkable);

    expect(jerboa.state).toBe('flee');
    const distAfter = Math.hypot(
      jerboa.tileX - state.player.tileX,
      jerboa.tileY - state.player.tileY,
    );
    expect(distAfter).toBeGreaterThan(distBefore);
  });

  it('picks up food on its own tile and starts fleeing, even when the player is unsighted', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const jerboa = createTestEnemy(10, 10, { type: 'jerboa' });
    state.items.set('10,10', { x: 10, y: 10, type: 'energy' });
    // 6 tiles away: outside aggroRadius (5), so not sighted, but inside
    // fleeRadius (7), so the flee this triggers doesn't immediately resolve
    // (eat) within the same tick
    state.player.tileX = 16;
    state.player.tileY = 10;

    updateEnemy(state, hud, jerboa, 1000, alwaysWalkable);

    expect(state.items.has('10,10')).toBe(false);
    expect(jerboa.carrying).toBe('energy');
    expect(jerboa.state).toBe('flee');
  });

  it('eats stolen food once fled far enough, healing and clearing carrying', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const jerboa = createTestEnemy(0, 0, {
      type: 'jerboa',
      state: 'flee',
      carrying: 'energy',
      hp: 1,
    });
    state.player.tileX = 20; // well past fleeRadius (7)
    state.player.tileY = 0;

    updateEnemy(state, hud, jerboa, 1000, alwaysWalkable);

    expect(jerboa.hp).toBe(
      Math.min(jerboa.maxHp, 1 + FOOD_HEAL_AMOUNTS.energy!),
    );
    expect(jerboa.carrying).toBeNull();
    expect(jerboa.state).toBe('wander');
    const text = state.floatingTexts.at(-1);
    expect(text?.text).toBe('+' + FOOD_HEAL_AMOUNTS.energy);
    expect(text?.color).toBe('#7fd47f');
  });

  it('boulderGuardian never forages or flees (regression guard)', () => {
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const guardian = createTestEnemy(10, 10, {
      type: 'boulderGuardian',
      home: { x: 10, y: 10 },
    });
    state.items.set('10,10', { x: 10, y: 10, type: 'energy' });
    state.player.tileX = 11;
    state.player.tileY = 10; // adjacent — sighted

    updateEnemy(state, hud, guardian, 1000, alwaysWalkable);

    expect(state.items.has('10,10')).toBe(true); // never picked up
    expect(guardian.carrying).toBeNull();
    expect(guardian.state).toBe('chase'); // not flee
  });
});

describe('updateEnemy: mid-move (tick-based)', () => {
  it('still makes a decision even while a previous step is visually animating', () => {
    // tileX/tileY update instantly at step-start (see entities.ts's
    // startStep) — `moving` only gates the cosmetic tween, which is now
    // advanced centrally, once per rendered frame, from game.ts's frame().
    // updateEnemy itself must run its decision logic unconditionally, once
    // per simulation tick, regardless of `moving`: otherwise a frame hitch
    // that lets more than one tick drain at once would silently waste every
    // tick after the first (moving has no chance to reset mid-drain, since
    // it's only updated once per frame, after all drained ticks run).
    const state = createTestGameState();
    const hud = createTestHudRefs();
    const dummy = createTestEnemy(10, 10, {
      type: 'boulderGuardian',
      stationary: true,
      moving: true,
      hp: Infinity,
      maxHp: Infinity,
    });
    state.player.tileX = 11;
    state.player.tileY = 10;
    const hpBefore = state.player.hp;

    updateEnemy(state, hud, dummy, 1000, alwaysWalkable);

    expect(state.player.hp).toBe(
      hpBefore - ENEMY_DEFS.boulderGuardian.atkDamage,
    );
    expect(dummy.moving).toBe(true); // animation state is untouched by this function
  });
});
