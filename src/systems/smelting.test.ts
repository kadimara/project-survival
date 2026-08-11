import { describe, expect, it } from 'vitest';
import { createTestGameState } from '../test/fixtures';
import { ITEM_MELT_MS, ORE_SMELT_MS } from '../constants';
import { dumpInFurnace, updateSmelters } from './smelting';

describe('dumpInFurnace', () => {
  it.each(['ore', 'sword'] as const)('uses ORE_SMELT_MS for %s', (item) => {
    const state = createTestGameState();
    dumpInFurnace(state, 1, 1, item, 1000);
    expect(state.smelters.get('1,1')?.readyAt).toBe(1000 + ORE_SMELT_MS);
  });

  it.each(['ingot', 'energy', 'energySeed'] as const)(
    'uses ITEM_MELT_MS for %s',
    (item) => {
      const state = createTestGameState();
      dumpInFurnace(state, 1, 1, item, 1000);
      expect(state.smelters.get('1,1')?.readyAt).toBe(1000 + ITEM_MELT_MS);
    },
  );

  it('predicts the resolved outcome per item type', () => {
    const state = createTestGameState();
    expect(dumpInFurnace(state, 0, 0, 'ore', 0)).toBe('smelting');
    expect(dumpInFurnace(state, 1, 0, 'sword', 0)).toBe('smelting');
    expect(dumpInFurnace(state, 4, 0, 'ingot', 0)).toBe('survived');
    expect(dumpInFurnace(state, 2, 0, 'energy', 0)).toBe('destroyed');
    expect(dumpInFurnace(state, 3, 0, 'energySeed', 0)).toBe('destroyed');
  });

  it('overwrites an existing job at the same cell with no guard', () => {
    const state = createTestGameState();
    dumpInFurnace(state, 1, 1, 'ore', 1000);
    dumpInFurnace(state, 1, 1, 'ingot', 2000);
    expect(state.smelters.get('1,1')).toEqual({
      x: 1,
      y: 1,
      item: 'ingot',
      readyAt: 2000 + ITEM_MELT_MS,
    });
  });
});

describe('updateSmelters', () => {
  it('does nothing before the job is ready', () => {
    const state = createTestGameState();
    dumpInFurnace(state, 1, 1, 'ore', 1000);
    updateSmelters(state, 1000 + ORE_SMELT_MS - 1);
    expect(state.smelters.has('1,1')).toBe(true);
    expect(state.groundItems.has('1,1')).toBe(false);
  });

  it('resolves exactly at readyAt (inclusive boundary)', () => {
    const state = createTestGameState();
    dumpInFurnace(state, 1, 1, 'ore', 1000);
    updateSmelters(state, 1000 + ORE_SMELT_MS);
    expect(state.smelters.has('1,1')).toBe(false);
  });

  it.each(['ore', 'sword'] as const)(
    'turns %s into an ingot ground item',
    (item) => {
      const state = createTestGameState();
      dumpInFurnace(state, 1, 1, item, 1000);
      updateSmelters(state, 1000 + ORE_SMELT_MS);
      expect(state.groundItems.get('1,1')).toEqual({
        x: 1,
        y: 1,
        type: 'ingot',
      });
    },
  );

  it('lets a survivor (ingot) reappear unchanged', () => {
    const state = createTestGameState();
    dumpInFurnace(state, 1, 1, 'ingot', 1000);
    updateSmelters(state, 1000 + ITEM_MELT_MS);
    expect(state.groundItems.get('1,1')).toEqual({ x: 1, y: 1, type: 'ingot' });
  });

  it.each(['energy', 'energySeed'] as const)(
    'leaves nothing behind when %s is destroyed',
    (item) => {
      const state = createTestGameState();
      dumpInFurnace(state, 1, 1, item, 1000);
      updateSmelters(state, 1000 + ITEM_MELT_MS);
      expect(state.groundItems.has('1,1')).toBe(false);
    },
  );

  it('always removes the smelter entry on resolution, including the destroyed case', () => {
    const state = createTestGameState();
    dumpInFurnace(state, 1, 1, 'energy', 1000);
    updateSmelters(state, 1000 + ITEM_MELT_MS);
    expect(state.smelters.has('1,1')).toBe(false);
  });

  it('resolves multiple jobs independently', () => {
    const state = createTestGameState();
    dumpInFurnace(state, 1, 1, 'ore', 0); // readyAt = ORE_SMELT_MS
    dumpInFurnace(state, 2, 2, 'ore', 4000); // readyAt = 4000 + ORE_SMELT_MS

    updateSmelters(state, ORE_SMELT_MS);

    expect(state.smelters.has('1,1')).toBe(false);
    expect(state.smelters.has('2,2')).toBe(true);
    expect(state.groundItems.has('1,1')).toBe(true);
    expect(state.groundItems.has('2,2')).toBe(false);
  });
});
