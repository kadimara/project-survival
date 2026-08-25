import { describe, expect, it } from 'vitest';
import type { CarryType } from '../types/types';
import { RECIPES, tryCombine } from './combine';

const ALL_CARRY_TYPES: CarryType[] = [
  'stone',
  'soil',
  'dirt',
  'furnace',
  'campfire',
  'wood',
  'berryBush',
  'reed',
  'rawMeat',
  'meat',
  'coal',
  'ingot',
  'ore',
  'sword',
  'bow',
  'berry',
  'poop',
  'rope',
  'fishingRod',
];

describe('tryCombine', () => {
  it('resolves the wood + stone recipe to campfire', () => {
    expect(tryCombine('wood', 'stone')).toBe('campfire');
  });

  it('resolves the coal + stone recipe to furnace', () => {
    expect(tryCombine('coal', 'stone')).toBe('furnace');
  });

  it('resolves the ingot + ingot recipe to sword', () => {
    expect(tryCombine('ingot', 'ingot')).toBe('sword');
  });

  it('resolves the wood + rope recipe to bow', () => {
    expect(tryCombine('wood', 'rope')).toBe('bow');
  });

  it('resolves the dirt + poop recipe to soil', () => {
    expect(tryCombine('dirt', 'poop')).toBe('soil');
  });

  it('resolves the reed + reed recipe to rope', () => {
    expect(tryCombine('reed', 'reed')).toBe('rope');
  });

  it('resolves the reed + rope recipe to fishingRod', () => {
    expect(tryCombine('reed', 'rope')).toBe('fishingRod');
  });

  it('returns null for non-matching pairs', () => {
    expect(tryCombine('rawMeat', 'ore')).toBeNull();
    expect(tryCombine('furnace', 'furnace')).toBeNull();
    expect(tryCombine('soil', 'stone')).toBeNull();
    expect(tryCombine('wood', 'ingot')).toBeNull(); // retired since rope took over bow's recipe
    expect(tryCombine('poop', 'dirt')).toBeNull();
    expect(tryCombine('stone', 'stone')).toBeNull();
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

  it('treats held/target order as significant for a non-symmetric recipe (wood + rope)', () => {
    expect(tryCombine('wood', 'rope')).toBe('bow');
    expect(tryCombine('rope', 'wood')).toBeNull();
  });
});
