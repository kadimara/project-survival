// Campfire-based cooking: the furnace's cooler sibling (see
// OBSTACLE_DEFS.campfire and systems/smelting.ts, which this closely
// mirrors). Unlike a furnace, a campfire also accepts an obstacle (wood)
// dumped onto it, not just items, so a job's `item` is a CarryType — see
// CampfireJob in types.ts. Jobs are tracked in state.campfireJobs rather
// than state.items, same reason as state.smelters. While a job is running
// the player can pick the original item back up (see doPickup in
// player-actions.ts), canceling it. Once its timer fires: rawMeat cooks
// into meat and rawFish cooks into fish (see COOKS_TO below, each on its
// own COOK_TICKS duration), meat/fish/wood burns down to coal, and anything
// else is destroyed with nothing left — no survivor case, unlike the
// furnace's ingot.
import type { CarryType, GameState, ItemType } from '../types/types';
import {
  CAMPFIRE_BURN_TICKS,
  CAMPFIRE_DESTROY_TICKS,
  RAW_FISH_COOK_TICKS,
  RAW_MEAT_COOK_TICKS,
} from '../constants';

export type CampfireOutcome = 'cooking' | 'burning' | 'destroyed';

// raw food -> its cooked form, and how long each takes — a Map (not a flat
// constant) so a new cookable item is a one-line data addition here rather
// than touching outcomeFor/updateCampfireJobs
const COOKS_TO: Partial<Record<CarryType, ItemType>> = {
  rawMeat: 'meat',
  rawFish: 'fish',
};
const COOK_TICKS: Partial<Record<CarryType, number>> = {
  rawMeat: RAW_MEAT_COOK_TICKS,
  rawFish: RAW_FISH_COOK_TICKS,
};
const BURNS_TO_COAL: ReadonlySet<CarryType> = new Set(['meat', 'fish', 'wood']);

function outcomeFor(item: CarryType): CampfireOutcome {
  if (item in COOKS_TO) return 'cooking';
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
      ? COOK_TICKS[item]!
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
// resolves to its own COOKS_TO output, burning becomes coal, anything else
// just vanishes.
export function updateCampfireJobs(state: GameState): void {
  for (const [key, job] of state.campfireJobs) {
    if (state.tick < job.readyAt) continue;
    const outcome = outcomeFor(job.item);
    if (outcome !== 'destroyed') {
      const type = outcome === 'cooking' ? COOKS_TO[job.item]! : 'coal';
      state.items.set(key, { x: job.x, y: job.y, type });
    }
    state.campfireJobs.delete(key);
  }
}
