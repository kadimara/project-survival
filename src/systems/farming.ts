// Soil farming: a berryBush obstacle standing on soil floor grows a berry
// item over time, readyAt-gated on state.tick rather than a wall-clock
// timer. The obstacle itself is permanent (kept in sync by
// setObstacle/buildWorldLayers in state/state.ts, see makeBerryBushAt) —
// moving one onto (or off of) soil just changes whether it's currently
// producing, with no separate action needed.
import type { GameState } from '../types/types';

// per-tick: any berryBush past its timer, standing on soil floor, with no
// berry currently on its cell spawns one there. The `has(key)` guard is
// what keeps a cell capped at one berry, no over-production — re-armed at
// harvest time (in doPickup), not here. A bush not currently on soil (the
// normal state for a wild one — world-gen never places soil, see
// buildWorldLayers in state/state.ts) just sits idle rather than producing;
// nothing removes the bush itself.
export function updateBerryBushes(state: GameState): void {
  for (const bush of state.berryBushes.values()) {
    if (state.floor.get(bush.x + ',' + bush.y) !== 'soil') continue;
    if (state.tick < bush.readyAt) continue;
    const key = bush.x + ',' + bush.y;
    if (state.items.has(key)) continue;
    state.items.set(key, { x: bush.x, y: bush.y, type: 'berry' });
  }
}
