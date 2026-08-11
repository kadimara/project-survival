// Furnace-based smelting: any item can be dumped onto an empty furnace
// tile (gated by openForGroundItem in state/state.ts, same as soil),
// tracked in state.smelters rather than state.groundItems — mirrors how
// systems/farming.ts tracks a planted seed separately from the energy it
// grows. While a job is running the player can pick the original item
// straight back up (see doPickup in player-actions.ts), canceling it. Once
// its timer fires: SMELTS_TO_INGOT items (ore, and a sword melted back
// down) become an ingot, a survivor (currently just ingot) reappears
// unchanged, and anything else melts away with nothing left.
import type { GameState, ItemType } from '../types/types';
import { ITEM_MELT_MS, ORE_SMELT_MS } from '../constants';

export type FurnaceOutcome = 'smelting' | 'survived' | 'destroyed';

// items not listed here (energy, energySeed) melt away with nothing left
const FURNACE_SURVIVORS: ReadonlySet<ItemType> = new Set(['ingot']);
// items that resolve into a fresh ingot once their timer fires — the
// ore -> ingot -> sword lineage is reversible via the furnace
const SMELTS_TO_INGOT: ReadonlySet<ItemType> = new Set(['ore', 'sword']);

function outcomeFor(item: ItemType): FurnaceOutcome {
  if (SMELTS_TO_INGOT.has(item)) return 'smelting';
  return FURNACE_SURVIVORS.has(item) ? 'survived' : 'destroyed';
}

export function dumpInFurnace(
  state: GameState,
  x: number,
  y: number,
  item: ItemType,
  now: number,
): FurnaceOutcome {
  const ms = SMELTS_TO_INGOT.has(item) ? ORE_SMELT_MS : ITEM_MELT_MS;
  state.smelters.set(x + ',' + y, { x, y, item, readyAt: now + ms });
  return outcomeFor(item);
}

// per-tick: any job past its timer resolves and is removed — a
// SMELTS_TO_INGOT item becomes an ingot, a survivor reappears as itself,
// anything else just vanishes.
export function updateSmelters(state: GameState, now: number): void {
  for (const [key, job] of state.smelters) {
    if (now < job.readyAt) continue;
    const outcome = outcomeFor(job.item);
    if (outcome !== 'destroyed') {
      const type = SMELTS_TO_INGOT.has(job.item) ? 'ingot' : job.item;
      state.groundItems.set(key, { x: job.x, y: job.y, type });
    }
    state.smelters.delete(key);
  }
}
