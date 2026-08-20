// Two independent ways soil produces food, both readyAt-gated on
// state.tick rather than a wall-clock timer:
//
// - energySeed: planted explicitly by the player (see doPlace in
//   player-actions.ts), tracked in state.seeds separately from state.items
//   so the seed and the energy it produces can coexist at one position. The
//   seed stays put once planted — the player can't pick the bare plant back
//   up mid-grow the way a bush works below, only harvest what it produces.
// - berryBush: never "planted" — the obstacle itself is permanent (kept in
//   sync by setObstacle/buildWorldLayers in state/state.ts, see
//   makeBerryBushAt), and simply grows a berry whenever it happens to be
//   standing on soil floor. Moving one onto (or off of) soil just changes
//   whether it's currently producing, with no separate action needed.
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

// per-tick: any berryBush past its timer, standing on soil floor, with no
// berry currently on its cell spawns one there — same has(key)-guarded,
// re-armed-at-harvest shape as updateSeeds above. A bush not currently on
// soil (the normal state for a wild one — world-gen never places soil, see
// buildWorldLayers in state/state.ts) just sits idle rather than
// producing; nothing removes the bush itself.
export function updateBerryBushes(state: GameState): void {
  for (const bush of state.berryBushes.values()) {
    if (state.floor.get(bush.x + ',' + bush.y) !== 'soil') continue;
    if (state.tick < bush.readyAt) continue;
    const key = bush.x + ',' + bush.y;
    if (state.items.has(key)) continue;
    state.items.set(key, { x: bush.x, y: bush.y, type: 'berry' });
  }
}
