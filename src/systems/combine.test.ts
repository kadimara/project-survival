import { describe, expect, it } from 'vitest';
import type { CarryType } from '../types/types';
import { RECIPES, tryCombine } from './combine';

const ALL_CARRY_TYPES: CarryType[] = [
  'stone',
  'soil',
  'dirt',
  'furnace',
  'wood',
  'berryBush',
  'energy',
  'energySeed',
  'ingot',
  'ore',
  'sword',
  'bow',
  'berry',
  'poop',
];

describe('tryCombine', () => {
  it('resolves the stone + stone recipe to furnace', () => {
    expect(tryCombine('stone', 'stone')).toBe('furnace');
  });

  it('resolves the ingot + ingot recipe to sword', () => {
    expect(tryCombine('ingot', 'ingot')).toBe('sword');
  });

  it('resolves the wood + ingot recipe to bow', () => {
    expect(tryCombine('wood', 'ingot')).toBe('bow');
  });

  it('resolves the dirt + poop recipe to soil', () => {
    expect(tryCombine('dirt', 'poop')).toBe('soil');
  });

  it('returns null for non-matching pairs', () => {
    expect(tryCombine('energy', 'ore')).toBeNull();
    expect(tryCombine('furnace', 'furnace')).toBeNull();
    expect(tryCombine('soil', 'stone')).toBeNull();
    expect(tryCombine('ingot', 'wood')).toBeNull();
    expect(tryCombine('poop', 'dirt')).toBeNull();
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

  it('treats held/target order as significant for a non-symmetric recipe (wood + ingot)', () => {
    expect(tryCombine('wood', 'ingot')).toBe('bow');
    expect(tryCombine('ingot', 'wood')).toBeNull();
  });
});
