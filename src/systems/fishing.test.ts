import { describe, expect, it } from 'vitest';
import { createTestGameState } from '../test/fixtures';
import { updateFishingJobs } from './fishing';

describe('updateFishingJobs', () => {
  it('does nothing before a job is ready', () => {
    const state = createTestGameState({ tick: 0 });
    state.fishingJobs.set('3,4', { x: 3, y: 4, readyAt: 10 });
    state.tick = 9;
    updateFishingJobs(state);
    expect(state.items.has('3,4')).toBe(false);
    expect(state.fishingJobs.has('3,4')).toBe(true);
  });

  it('resolves into a rawFish ground item exactly at readyAt (inclusive boundary)', () => {
    const state = createTestGameState({ tick: 0 });
    state.fishingJobs.set('3,4', { x: 3, y: 4, readyAt: 10 });
    state.tick = 10;
    updateFishingJobs(state);
    expect(state.items.get('3,4')).toEqual({ x: 3, y: 4, type: 'rawFish' });
  });

  it('removes the job entry once resolved', () => {
    const state = createTestGameState({ tick: 0 });
    state.fishingJobs.set('3,4', { x: 3, y: 4, readyAt: 0 });
    updateFishingJobs(state);
    expect(state.fishingJobs.has('3,4')).toBe(false);
  });

  it('resolves multiple jobs independently', () => {
    const state = createTestGameState({ tick: 0 });
    state.fishingJobs.set('3,4', { x: 3, y: 4, readyAt: 0 });
    state.fishingJobs.set('8,2', { x: 8, y: 2, readyAt: 5 });
    state.tick = 5;
    updateFishingJobs(state);
    expect(state.items.get('3,4')).toEqual({ x: 3, y: 4, type: 'rawFish' });
    expect(state.items.get('8,2')).toEqual({ x: 8, y: 2, type: 'rawFish' });
    expect(state.fishingJobs.size).toBe(0);
  });

  it('falls back to a neighboring open tile when the fished cell is occupied', () => {
    const state = createTestGameState({ tick: 0 });
    state.items.set('3,4', { x: 3, y: 4, type: 'ore' });
    state.fishingJobs.set('3,4', { x: 3, y: 4, readyAt: 0 });
    updateFishingJobs(state);
    // the original cell keeps its existing item; the rawFish lands on a
    // neighboring ring tile via placeItemNear
    expect(state.items.get('3,4')).toEqual({ x: 3, y: 4, type: 'ore' });
    const neighbors = [
      [4, 4],
      [2, 4],
      [3, 5],
      [3, 3],
      [4, 5],
      [2, 5],
      [4, 3],
      [2, 3],
    ];
    const placed = neighbors.some(
      ([x, y]) => state.items.get(x + ',' + y)?.type === 'rawFish',
    );
    expect(placed).toBe(true);
  });
});
