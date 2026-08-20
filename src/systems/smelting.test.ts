import { describe, expect, it } from 'vitest';
import { createTestGameState } from '../test/fixtures';
import { ITEM_MELT_TICKS, ORE_SMELT_TICKS } from '../constants';
import { dumpInFurnace, updateSmelters } from './smelting';

describe('dumpInFurnace', () => {
  it.each(['ore', 'sword'] as const)('uses ORE_SMELT_TICKS for %s', (item) => {
    const state = createTestGameState({ tick: 1000 });
    dumpInFurnace(state, 1, 1, item);
    expect(state.smelters.get('1,1')?.readyAt).toBe(1000 + ORE_SMELT_TICKS);
  });

  it.each(['ingot', 'energy', 'energySeed'] as const)(
    'uses ITEM_MELT_TICKS for %s',
    (item) => {
      const state = createTestGameState({ tick: 1000 });
      dumpInFurnace(state, 1, 1, item);
      expect(state.smelters.get('1,1')?.readyAt).toBe(1000 + ITEM_MELT_TICKS);
    },
  );

  it('predicts the resolved outcome per item type', () => {
    const state = createTestGameState();
    expect(dumpInFurnace(state, 0, 0, 'ore')).toBe('smelting');
    expect(dumpInFurnace(state, 1, 0, 'sword')).toBe('smelting');
    expect(dumpInFurnace(state, 4, 0, 'ingot')).toBe('survived');
    expect(dumpInFurnace(state, 2, 0, 'energy')).toBe('destroyed');
    expect(dumpInFurnace(state, 3, 0, 'energySeed')).toBe('destroyed');
  });

  it('overwrites an existing job at the same cell with no guard', () => {
    const state = createTestGameState({ tick: 1000 });
    dumpInFurnace(state, 1, 1, 'ore');
    state.tick = 2000;
    dumpInFurnace(state, 1, 1, 'ingot');
    expect(state.smelters.get('1,1')).toEqual({
      x: 1,
      y: 1,
      item: 'ingot',
      readyAt: 2000 + ITEM_MELT_TICKS,
    });
  });
});

describe('updateSmelters', () => {
  it('does nothing before the job is ready', () => {
    const state = createTestGameState({ tick: 1000 });
    dumpInFurnace(state, 1, 1, 'ore');
    state.tick = 1000 + ORE_SMELT_TICKS - 1;
    updateSmelters(state);
    expect(state.smelters.has('1,1')).toBe(true);
    expect(state.items.has('1,1')).toBe(false);
  });

  it('resolves exactly at readyAt (inclusive boundary)', () => {
    const state = createTestGameState({ tick: 1000 });
    dumpInFurnace(state, 1, 1, 'ore');
    state.tick = 1000 + ORE_SMELT_TICKS;
    updateSmelters(state);
    expect(state.smelters.has('1,1')).toBe(false);
  });

  it.each(['ore', 'sword'] as const)(
    'turns %s into an ingot ground item',
    (item) => {
      const state = createTestGameState({ tick: 1000 });
      dumpInFurnace(state, 1, 1, item);
      state.tick = 1000 + ORE_SMELT_TICKS;
      updateSmelters(state);
      expect(state.items.get('1,1')).toEqual({
        x: 1,
        y: 1,
        type: 'ingot',
      });
    },
  );

  it('lets a survivor (ingot) reappear unchanged', () => {
    const state = createTestGameState({ tick: 1000 });
    dumpInFurnace(state, 1, 1, 'ingot');
    state.tick = 1000 + ITEM_MELT_TICKS;
    updateSmelters(state);
    expect(state.items.get('1,1')).toEqual({ x: 1, y: 1, type: 'ingot' });
  });

  it.each(['energy', 'energySeed'] as const)(
    'leaves nothing behind when %s is destroyed',
    (item) => {
      const state = createTestGameState({ tick: 1000 });
      dumpInFurnace(state, 1, 1, item);
      state.tick = 1000 + ITEM_MELT_TICKS;
      updateSmelters(state);
      expect(state.items.has('1,1')).toBe(false);
    },
  );

  it('always removes the smelter entry on resolution, including the destroyed case', () => {
    const state = createTestGameState({ tick: 1000 });
    dumpInFurnace(state, 1, 1, 'energy');
    state.tick = 1000 + ITEM_MELT_TICKS;
    updateSmelters(state);
    expect(state.smelters.has('1,1')).toBe(false);
  });

  it('resolves multiple jobs independently', () => {
    const state = createTestGameState({ tick: 0 });
    dumpInFurnace(state, 1, 1, 'ore'); // readyAt = ORE_SMELT_TICKS
    state.tick = 4000;
    dumpInFurnace(state, 2, 2, 'ore'); // readyAt = 4000 + ORE_SMELT_TICKS

    state.tick = ORE_SMELT_TICKS;
    updateSmelters(state);

    expect(state.smelters.has('1,1')).toBe(false);
    expect(state.smelters.has('2,2')).toBe(true);
    expect(state.items.has('1,1')).toBe(true);
    expect(state.items.has('2,2')).toBe(false);
  });
});
