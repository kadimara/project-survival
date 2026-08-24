// Campfire-based cooking: the furnace's cooler sibling (see
// OBSTACLE_DEFS.campfire and systems/smelting.ts, which this closely
// mirrors). Unlike a furnace, a campfire also accepts an obstacle (wood)
// dumped onto it, not just items, so a job's `item` is a CarryType — see
// CampfireJob in types.ts. Jobs are tracked in state.campfireJobs rather
// than state.items, same reason as state.smelters. While a job is running
// the player can pick the original item back up (see doPickup in
// player-actions.ts), canceling it. Once its timer fires: rawMeat cooks
// into meat, meat or wood burns down to coal, and anything else is
// destroyed with nothing left — no survivor case, unlike the furnace's
// ingot.
import type { CarryType, GameState } from '../types/types';
import {
  CAMPFIRE_BURN_TICKS,
  CAMPFIRE_DESTROY_TICKS,
  RAW_MEAT_COOK_TICKS,
} from '../constants';

export type CampfireOutcome = 'cooking' | 'burning' | 'destroyed';

const COOKS_TO_MEAT: ReadonlySet<CarryType> = new Set(['rawMeat']);
const BURNS_TO_COAL: ReadonlySet<CarryType> = new Set(['meat', 'wood']);

function outcomeFor(item: CarryType): CampfireOutcome {
  if (COOKS_TO_MEAT.has(item)) return 'cooking';
  return BURNS_TO_COAL.has(item) ? 'burning' : 'destroyed';
}

export function dumpInCampfire(
  state: GameState,
  x: number,
  y: number,
  item: CarryType,
): CampfireOutcome {
  const outcome = outcomeFor(item);
  const ticks =
    outcome === 'cooking'
      ? RAW_MEAT_COOK_TICKS
      : outcome === 'burning'
        ? CAMPFIRE_BURN_TICKS
        : CAMPFIRE_DESTROY_TICKS;
  state.campfireJobs.set(x + ',' + y, {
    x,
    y,
    item,
    readyAt: state.tick + ticks,
  });
  return outcome;
}

// per-tick: any job past its timer resolves and is removed — cooking
// becomes meat, burning becomes coal, anything else just vanishes.
export function updateCampfireJobs(state: GameState): void {
  for (const [key, job] of state.campfireJobs) {
    if (state.tick < job.readyAt) continue;
    const outcome = outcomeFor(job.item);
    if (outcome !== 'destroyed') {
      const type = outcome === 'cooking' ? 'meat' : 'coal';
      state.items.set(key, { x: job.x, y: job.y, type });
    }
    state.campfireJobs.delete(key);
  }
}
