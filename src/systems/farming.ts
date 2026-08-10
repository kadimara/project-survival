// Soil-planted energy growth: small -> full over a timer, harvesting full
// regrows a new small planting at the same cell. Wild/death-drop energy
// never gets a `stage`, so it's untouched by any of this.
import type { GameState, ItemType } from '../types/types';
import { ENERGY_GROW_MS } from '../constants';

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
    readyAt: now + ENERGY_GROW_MS,
  });
}

// per-tick: any 'small' item whose timer elapsed snaps to 'full' — instant
// swap, no interpolation. Items with stage === undefined (wild/death-drop
// energy) are skipped automatically.
export function updateGrowth(state: GameState, now: number): void {
  for (const item of state.groundItems.values()) {
    if (
      item.stage === 'small' &&
      item.readyAt !== undefined &&
      now >= item.readyAt
    ) {
      item.stage = 'full';
    }
  }
}
