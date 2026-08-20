import { describe, expect, it } from 'vitest';
import { createTestGameState } from '../test/fixtures';
import { ENERGY_SEED_GROW_TICKS } from '../constants';
import { plantSeed, updateSeeds } from './farming';

describe('plantSeed', () => {
  it('sets a seed with readyAt = state.tick + ENERGY_SEED_GROW_TICKS', () => {
    const state = createTestGameState({ tick: 1000 });
    plantSeed(state, 3, 4);
    expect(state.seeds.get('3,4')).toEqual({
      x: 3,
      y: 4,
      readyAt: 1000 + ENERGY_SEED_GROW_TICKS,
    });
  });

  it('overwrites an existing seed at the same cell unconditionally', () => {
    const state = createTestGameState({ tick: 1000 });
    plantSeed(state, 3, 4);
    state.tick = 5000;
    plantSeed(state, 3, 4);
    expect(state.seeds.get('3,4')?.readyAt).toBe(5000 + ENERGY_SEED_GROW_TICKS);
  });
});

describe('updateSeeds', () => {
  it('does nothing before the seed is ready', () => {
    const state = createTestGameState({ tick: 1000 });
    plantSeed(state, 3, 4);
    state.tick = 1000 + ENERGY_SEED_GROW_TICKS - 1;
    updateSeeds(state);
    expect(state.items.has('3,4')).toBe(false);
  });

  it('spawns an energy ground item exactly at readyAt (inclusive boundary)', () => {
    const state = createTestGameState({ tick: 1000 });
    plantSeed(state, 3, 4);
    state.tick = 1000 + ENERGY_SEED_GROW_TICKS;
    updateSeeds(state);
    expect(state.items.get('3,4')).toEqual({
      x: 3,
      y: 4,
      type: 'energy',
    });
  });

  it('skips a ready seed whose cell already has a ground item', () => {
    const state = createTestGameState({ tick: 1000 });
    plantSeed(state, 3, 4);
    state.items.set('3,4', { x: 3, y: 4, type: 'ore' });
    state.tick = 1000 + ENERGY_SEED_GROW_TICKS;
    updateSeeds(state);
    expect(state.items.get('3,4')).toEqual({ x: 3, y: 4, type: 'ore' });
  });

  it('resolves multiple seeds independently', () => {
    const state = createTestGameState({ tick: 0 });
    plantSeed(state, 1, 1); // readyAt = ENERGY_SEED_GROW_TICKS
    state.tick = 5000;
    plantSeed(state, 2, 2); // readyAt = 5000 + ENERGY_SEED_GROW_TICKS

    state.tick = ENERGY_SEED_GROW_TICKS;
    updateSeeds(state);

    expect(state.items.has('1,1')).toBe(true);
    expect(state.items.has('2,2')).toBe(false);
  });

  it('leaves the seed entry in place after it fires (re-arming happens elsewhere)', () => {
    const state = createTestGameState({ tick: 1000 });
    plantSeed(state, 3, 4);
    state.tick = 1000 + ENERGY_SEED_GROW_TICKS;
    updateSeeds(state);
    expect(state.seeds.has('3,4')).toBe(true);
  });
});
