// Tile/item combine recipes: what happens when the player places a held
// item onto an occupied cell instead of an empty one. Order matters — held
// and target are distinct roles, so a recipe is not automatically symmetric.
import type { CarryType } from '../types/types';

export interface CombineRecipe {
  held: CarryType;
  target: CarryType;
  result: CarryType;
}

// filled in as recipes are defined — empty is a valid, fully working state
export const RECIPES: CombineRecipe[] = [
  // place a stone obstacle, then carry the second ingredient onto it — the
  // furnace's cooler sibling (see OBSTACLE_DEFS.campfire in constants.ts
  // and systems/cooking.ts)
  { held: 'wood', target: 'stone', result: 'campfire' },
  // coal (a campfire byproduct — see systems/cooking.ts) is the furnace's
  // fuel, same "place stone, carry the second ingredient onto it" flow as
  // campfire above
  { held: 'coal', target: 'stone', result: 'furnace' },
  { held: 'ingot', target: 'ingot', result: 'sword' },
  // shaft + arrowhead => bow (see WEAPON_DEFS in constants.ts for its
  // ranged attack stats)
  { held: 'wood', target: 'ingot', result: 'bow' },
  // dig poop into dirt => soil, a floor result rather than the usual
  // obstacle/item one (see setOccupant in state/state.ts for how that's
  // routed) — the only source of soil in the game, since world-gen never
  // places any (see buildWorldLayers in state/state.ts); a berryBush
  // (see systems/farming.ts) has to be moved onto soil made this way
  { held: 'dirt', target: 'poop', result: 'soil' },
  // two reeds (gathered from the oasis's edge, see buildVegetationRing in
  // worldgen.ts) braid into rope — same "two of the same raw material"
  // shape as ingot + ingot => sword above
  { held: 'reed', target: 'reed', result: 'rope' },
];

function recipeKey(held: CarryType, target: CarryType): string {
  return held + '|' + target;
}

const recipeLookup = new Map<string, CarryType>(
  RECIPES.map((r) => [recipeKey(r.held, r.target), r.result]),
);

export function tryCombine(
  held: CarryType,
  target: CarryType,
): CarryType | null {
  return recipeLookup.get(recipeKey(held, target)) ?? null;
}
