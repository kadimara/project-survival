import { describe, expect, it } from 'vitest';
import { createTestGameState } from '../test/fixtures';
import {
  CAMPFIRE_BURN_TICKS,
  CAMPFIRE_DESTROY_TICKS,
  RAW_MEAT_COOK_TICKS,
} from '../constants';
import { dumpInCampfire, updateCampfireJobs } from './cooking';

describe('dumpInCampfire', () => {
  it('uses RAW_MEAT_COOK_TICKS for rawMeat', () => {
    const state = createTestGameState({ tick: 1000 });
    dumpInCampfire(state, 1, 1, 'rawMeat');
    expect(state.campfireJobs.get('1,1')?.readyAt).toBe(
      1000 + RAW_MEAT_COOK_TICKS,
    );
  });

  it.each(['meat', 'wood'] as const)(
    'uses CAMPFIRE_BURN_TICKS for %s',
    (item) => {
      const state = createTestGameState({ tick: 1000 });
      dumpInCampfire(state, 1, 1, item);
      expect(state.campfireJobs.get('1,1')?.readyAt).toBe(
        1000 + CAMPFIRE_BURN_TICKS,
      );
    },
  );

  it.each(['berry', 'ore', 'stone'] as const)(
    'uses CAMPFIRE_DESTROY_TICKS for %s',
    (item) => {
      const state = createTestGameState({ tick: 1000 });
      dumpInCampfire(state, 1, 1, item);
      expect(state.campfireJobs.get('1,1')?.readyAt).toBe(
        1000 + CAMPFIRE_DESTROY_TICKS,
      );
    },
  );

  it('predicts the resolved outcome per item type', () => {
    const state = createTestGameState();
    expect(dumpInCampfire(state, 0, 0, 'rawMeat')).toBe('cooking');
    expect(dumpInCampfire(state, 1, 0, 'meat')).toBe('burning');
    expect(dumpInCampfire(state, 2, 0, 'wood')).toBe('burning');
    expect(dumpInCampfire(state, 3, 0, 'berry')).toBe('destroyed');
  });

  it('accepts a held obstacle (wood), not just an item', () => {
    const state = createTestGameState();
    expect(dumpInCampfire(state, 0, 0, 'wood')).toBe('burning');
    expect(state.campfireJobs.get('0,0')?.item).toBe('wood');
  });

  it('overwrites an existing job at the same cell with no guard', () => {
    const state = createTestGameState({ tick: 1000 });
    dumpInCampfire(state, 1, 1, 'rawMeat');
    state.tick = 2000;
    dumpInCampfire(state, 1, 1, 'meat');
    expect(state.campfireJobs.get('1,1')).toEqual({
      x: 1,
      y: 1,
      item: 'meat',
      readyAt: 2000 + CAMPFIRE_BURN_TICKS,
    });
  });
});

describe('updateCampfireJobs', () => {
  it('does nothing before the job is ready', () => {
    const state = createTestGameState({ tick: 1000 });
    dumpInCampfire(state, 1, 1, 'rawMeat');
    state.tick = 1000 + RAW_MEAT_COOK_TICKS - 1;
    updateCampfireJobs(state);
    expect(state.campfireJobs.has('1,1')).toBe(true);
    expect(state.items.has('1,1')).toBe(false);
  });

  it('resolves exactly at readyAt (inclusive boundary)', () => {
    const state = createTestGameState({ tick: 1000 });
    dumpInCampfire(state, 1, 1, 'rawMeat');
    state.tick = 1000 + RAW_MEAT_COOK_TICKS;
    updateCampfireJobs(state);
    expect(state.campfireJobs.has('1,1')).toBe(false);
  });

  it('turns rawMeat into a meat ground item', () => {
    const state = createTestGameState({ tick: 1000 });
    dumpInCampfire(state, 1, 1, 'rawMeat');
    state.tick = 1000 + RAW_MEAT_COOK_TICKS;
    updateCampfireJobs(state);
    expect(state.items.get('1,1')).toEqual({ x: 1, y: 1, type: 'meat' });
  });

  it.each(['meat', 'wood'] as const)(
    'turns %s into a coal ground item',
    (item) => {
      const state = createTestGameState({ tick: 1000 });
      dumpInCampfire(state, 1, 1, item);
      state.tick = 1000 + CAMPFIRE_BURN_TICKS;
      updateCampfireJobs(state);
      expect(state.items.get('1,1')).toEqual({ x: 1, y: 1, type: 'coal' });
    },
  );

  it('leaves nothing behind when an unrecognized item is destroyed', () => {
    const state = createTestGameState({ tick: 1000 });
    dumpInCampfire(state, 1, 1, 'berry');
    state.tick = 1000 + CAMPFIRE_DESTROY_TICKS;
    updateCampfireJobs(state);
    expect(state.items.has('1,1')).toBe(false);
  });

  it('always removes the job entry on resolution, including the destroyed case', () => {
    const state = createTestGameState({ tick: 1000 });
    dumpInCampfire(state, 1, 1, 'berry');
    state.tick = 1000 + CAMPFIRE_DESTROY_TICKS;
    updateCampfireJobs(state);
    expect(state.campfireJobs.has('1,1')).toBe(false);
  });

  it('resolves multiple jobs independently', () => {
    const state = createTestGameState({ tick: 0 });
    dumpInCampfire(state, 1, 1, 'rawMeat'); // readyAt = RAW_MEAT_COOK_TICKS
    state.tick = 4000;
    dumpInCampfire(state, 2, 2, 'rawMeat'); // readyAt = 4000 + RAW_MEAT_COOK_TICKS

    state.tick = RAW_MEAT_COOK_TICKS;
    updateCampfireJobs(state);

    expect(state.campfireJobs.has('1,1')).toBe(false);
    expect(state.campfireJobs.has('2,2')).toBe(true);
    expect(state.items.has('1,1')).toBe(true);
    expect(state.items.has('2,2')).toBe(false);
  });
});
