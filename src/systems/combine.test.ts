import { describe, expect, it } from 'vitest';
import type { CarryType } from '../types/types';
import { RECIPES, tryCombine } from './combine';

const ALL_CARRY_TYPES: CarryType[] = [
  'stone',
  'soil',
  'furnace',
  'wood',
  'energy',
  'energySeed',
  'ingot',
  'ore',
  'sword',
];

describe('tryCombine', () => {
  it('resolves the stone + stone recipe to furnace', () => {
    expect(tryCombine('stone', 'stone')).toBe('furnace');
  });

  it('resolves the ingot + ingot recipe to sword', () => {
    expect(tryCombine('ingot', 'ingot')).toBe('sword');
  });

  it('returns null for non-matching pairs', () => {
    expect(tryCombine('energy', 'ore')).toBeNull();
    expect(tryCombine('furnace', 'furnace')).toBeNull();
    expect(tryCombine('soil', 'stone')).toBeNull();
    expect(tryCombine('ingot', 'wood')).toBeNull();
  });

  it('matches RECIPES for every held/target pair (future-proofs new recipes)', () => {
    for (const held of ALL_CARRY_TYPES) {
      for (const target of ALL_CARRY_TYPES) {
        const recipe = RECIPES.find(
          (r) => r.held === held && r.target === target,
        );
        expect(tryCombine(held, target)).toBe(recipe ? recipe.result : null);
      }
    }
  });

  // With only one recipe currently defined (stone+stone, which is
  // symmetric), there's no pair in RECIPES that demonstrates held/target
  // order actually mattering. When a non-symmetric recipe is added, add a
  // test here asserting tryCombine(a, b) !== tryCombine(b, a) for it.
});
