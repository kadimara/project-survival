import { describe, expect, it } from 'vitest';
import { createTestGameState } from '../test/fixtures';
import { ENERGY_SEED_GROW_MS } from '../constants';
import { plantSeed, updateSeeds } from './farming';

describe('plantSeed', () => {
  it('sets a seed with readyAt = now + ENERGY_SEED_GROW_MS', () => {
    const state = createTestGameState();
    plantSeed(state, 3, 4, 1000);
    expect(state.seeds.get('3,4')).toEqual({
      x: 3,
      y: 4,
      readyAt: 1000 + ENERGY_SEED_GROW_MS,
    });
  });

  it('overwrites an existing seed at the same cell unconditionally', () => {
    const state = createTestGameState();
    plantSeed(state, 3, 4, 1000);
    plantSeed(state, 3, 4, 5000);
    expect(state.seeds.get('3,4')?.readyAt).toBe(5000 + ENERGY_SEED_GROW_MS);
  });
});

describe('updateSeeds', () => {
  it('does nothing before the seed is ready', () => {
    const state = createTestGameState();
    plantSeed(state, 3, 4, 1000);
    updateSeeds(state, 1000 + ENERGY_SEED_GROW_MS - 1);
    expect(state.groundItems.has('3,4')).toBe(false);
  });

  it('spawns an energy ground item exactly at readyAt (inclusive boundary)', () => {
    const state = createTestGameState();
    plantSeed(state, 3, 4, 1000);
    updateSeeds(state, 1000 + ENERGY_SEED_GROW_MS);
    expect(state.groundItems.get('3,4')).toEqual({ x: 3, y: 4, type: 'energy' });
  });

  it('skips a ready seed whose cell already has a ground item', () => {
    const state = createTestGameState();
    plantSeed(state, 3, 4, 1000);
    state.groundItems.set('3,4', { x: 3, y: 4, type: 'ore' });
    updateSeeds(state, 1000 + ENERGY_SEED_GROW_MS);
    expect(state.groundItems.get('3,4')).toEqual({ x: 3, y: 4, type: 'ore' });
  });

  it('resolves multiple seeds independently', () => {
    const state = createTestGameState();
    plantSeed(state, 1, 1, 0); // readyAt = ENERGY_SEED_GROW_MS
    plantSeed(state, 2, 2, 5000); // readyAt = 5000 + ENERGY_SEED_GROW_MS

    updateSeeds(state, ENERGY_SEED_GROW_MS);

    expect(state.groundItems.has('1,1')).toBe(true);
    expect(state.groundItems.has('2,2')).toBe(false);
  });

  it('leaves the seed entry in place after it fires (re-arming happens elsewhere)', () => {
    const state = createTestGameState();
    plantSeed(state, 3, 4, 1000);
    updateSeeds(state, 1000 + ENERGY_SEED_GROW_MS);
    expect(state.seeds.has('3,4')).toBe(true);
  });
});
