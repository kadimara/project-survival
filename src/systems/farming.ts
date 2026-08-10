// Soil-planted energy growth: small -> medium -> full over two timed steps,
// harvesting full regrows a new small planting at the same cell.
// Wild/death-drop energy never gets a `stage`, so it's untouched by any of
// this.
import type { GameState, ItemType } from '../types/types';
import { ENERGY_GROW_STAGE_MS } from '../constants';

// plants a 'small'-stage ground item at (x,y), arming its grow timer —
// shared by doPlace's soil-bypass branch (first planting) and doPickup's
// full-harvest branch (regrow)
export function plantGrowingItem(
  state: GameState,
  x: number,
  y: number,
  type: ItemType,
  now: number,
): void {
  state.groundItems.set(x + ',' + y, {
    x,
    y,
    type,
    stage: 'small',
    readyAt: now + ENERGY_GROW_STAGE_MS,
  });
}

// per-tick: advances a growing item one stage once its timer elapses —
// small -> medium (re-arms the timer for the next step), then
// medium -> full (done growing, no more timer needed). Instant swap, no
// interpolation. Items with stage === undefined (wild/death-drop energy)
// are skipped automatically.
export function updateGrowth(state: GameState, now: number): void {
  for (const item of state.groundItems.values()) {
    if (item.readyAt === undefined || now < item.readyAt) continue;
    if (item.stage === 'small') {
      item.stage = 'medium';
      item.readyAt = now + ENERGY_GROW_STAGE_MS;
    } else if (item.stage === 'medium') {
      item.stage = 'full';
    }
  }
}
