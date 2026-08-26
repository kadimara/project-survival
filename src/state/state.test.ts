import { describe, expect, it } from 'vitest';
import { createTestGameState } from '../test/fixtures';
import { OASIS } from '../worldgen/worldgen';
import { isWater } from './state';

describe('isWater', () => {
  it('is false for an ordinary (non-oasis) tile', () => {
    const state = createTestGameState();
    expect(isWater(state, 5, 5)).toBe(false);
  });

  it('is true for a tile painted OASIS', () => {
    const state = createTestGameState();
    state.map[5][5] = OASIS;
    expect(isWater(state, 5, 5)).toBe(true);
  });

  it('is false out of bounds', () => {
    const state = createTestGameState();
    expect(isWater(state, -1, -1)).toBe(false);
    expect(isWater(state, 999999, 999999)).toBe(false);
  });
});
