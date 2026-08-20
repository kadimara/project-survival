// Soil-planted energySeed: periodically spawns a separate energy item on
// the same cell, tracked in state.seeds rather than state.items so the
// seed and the energy it produces can coexist at one position. The spawned
// energy is an ordinary state.items entry — pickup/placement/rendering for
// it need no seed-awareness at all.
import type { GameState } from '../types/types';
import { ENERGY_SEED_GROW_TICKS } from '../constants';

export function plantSeed(state: GameState, x: number, y: number): void {
  state.seeds.set(x + ',' + y, {
    x,
    y,
    readyAt: state.tick + ENERGY_SEED_GROW_TICKS,
  });
}

// per-tick: any seed past its timer with no energy currently on its cell
// spawns one there. A seed with an unharvested energy just waits — this
// `has(key)` guard is what keeps a cell capped at one seed + one energy,
// no over-production. The timer itself is re-armed at harvest time (in
// doPickup), not here.
export function updateSeeds(state: GameState): void {
  for (const seed of state.seeds.values()) {
    if (state.tick < seed.readyAt) continue;
    const key = seed.x + ',' + seed.y;
    if (state.items.has(key)) continue;
    state.items.set(key, { x: seed.x, y: seed.y, type: 'energy' });
  }
}
