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
  { held: 'stone', target: 'stone', result: 'furnace' },
  { held: 'ingot', target: 'ingot', result: 'sword' },
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
