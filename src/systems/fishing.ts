// Rod-based fishing: clicking with a held fishingRod on any oasis water
// tile starts a job tracked in state.fishingJobs (see FishingJob in
// types.ts) — the rod itself is never consumed (see doPlace's fishing
// branch in systems/player-actions.ts). One-shot per click, not
// auto-repeating like a berry bush: the player clicks again to start
// another catch. No RNG miss-chance — always resolves to a rawFish, same
// determinism as smelting/cooking/farming.
import type { GameState } from '../types/types';
import { placeItemNear } from '../state/state';

// per-tick: any job past its timer resolves and is removed — a rawFish
// appears at the fished tile (falling back to a neighboring open tile via
// placeItemNear if it's occupied by the time the job resolves).
export function updateFishingJobs(state: GameState): void {
  for (const [key, job] of state.fishingJobs) {
    if (state.tick < job.readyAt) continue;
    placeItemNear(state, job.x, job.y, 'rawFish');
    state.fishingJobs.delete(key);
  }
}
