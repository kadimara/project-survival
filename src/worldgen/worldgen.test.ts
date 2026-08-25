import { describe, expect, it } from 'vitest';
import {
  buildOasisPatch,
  buildVegetationRing,
  type Cell,
  findClusterBorderTiles,
  mulberry32,
  planGuardianClusters,
  shuffleGuardianCandidates,
} from './worldgen';

describe('buildOasisPatch', () => {
  it('stays within the max wobble radius of the chosen center', () => {
    const rng = mulberry32(42);
    const radius = 3;
    const maxR = radius * 1.2; // matches OASIS_WOBBLE's 0.12 + 0.08 cap
    const cells = buildOasisPatch(rng, 300, 300, 150, 150, 100, radius);
    // the wobbly outline isn't a perfect circle, so instead of recovering
    // the exact center, verify the patch's bounding extent is no wider than
    // one wobble diameter, which only holds if every cell stays within
    // `maxR` of a single shared center
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const key of cells) {
      const [x, y] = key.split(',').map(Number);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    expect(maxX - minX).toBeLessThanOrEqual(Math.ceil(maxR) * 2);
    expect(maxY - minY).toBeLessThanOrEqual(Math.ceil(maxR) * 2);
  });

  it('places the patch roughly at the requested distance from the origin', () => {
    const rng = mulberry32(7);
    const distance = 100;
    const radius = 3;
    const cells = buildOasisPatch(rng, 300, 300, 150, 150, distance, radius);
    let sumX = 0,
      sumY = 0,
      n = 0;
    for (const key of cells) {
      const [x, y] = key.split(',').map(Number);
      sumX += x;
      sumY += y;
      n++;
    }
    const centerX = sumX / n,
      centerY = sumY / n;
    const dist = Math.hypot(centerX - 150, centerY - 150);
    // generous tolerance since the wobbly outline shifts the cell centroid
    // away from the exact placement center by up to about a radius
    expect(dist).toBeGreaterThan(distance - radius * 2);
    expect(dist).toBeLessThan(distance + radius * 2);
  });

  it('is deterministic for the same rng sequence', () => {
    const a = buildOasisPatch(mulberry32(99), 300, 300, 150, 150, 100, 3);
    const b = buildOasisPatch(mulberry32(99), 300, 300, 150, 150, 100, 3);
    expect(Array.from(a).sort()).toEqual(Array.from(b).sort());
  });

  it('clamps the center so the patch stays on the map when distance would push it off-map', () => {
    const rng = mulberry32(1);
    const radius = 3;
    const cells = buildOasisPatch(rng, 20, 20, 10, 10, 1000, radius);
    for (const key of cells) {
      const [x, y] = key.split(',').map(Number);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(20);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(20);
    }
    expect(cells.size).toBeGreaterThan(0);
  });
});

describe('buildVegetationRing', () => {
  // a single-cell "oasis" at a fixed point makes ring distance equal to
  // Chebyshev-free 4-directional grid distance from that one point, easy to
  // check by hand below
  const oasis = new Set(['10,10']);

  it('only places reeds within the given ring-distance band from the oasis', () => {
    const { reeds } = buildVegetationRing(
      mulberry32(1),
      oasis,
      300,
      300,
      { min: 1, max: 2, chance: 0 }, // bushes disabled so they never steal a reed's cell
      { min: 2, max: 5, chance: 0 }, // trees disabled likewise
      { min: 1, max: 1, chance: 1 }, // reeds always claim their one ring
    );
    expect(reeds.size).toBeGreaterThan(0);
    for (const key of reeds) {
      const [x, y] = key.split(',').map(Number);
      const dist = Math.abs(x - 10) + Math.abs(y - 10);
      expect(dist).toBe(1);
    }
  });

  it('lets reed claim an oasis (ring-0) cell, but never bush/tree even when their band nominally covers 0', () => {
    const { bushes, trees, reeds } = buildVegetationRing(
      mulberry32(3),
      oasis,
      300,
      300,
      { min: 0, max: 2, chance: 1 }, // would claim ring 0 too if not guarded
      { min: 0, max: 5, chance: 1 }, // same
      { min: 0, max: 0, chance: 1 }, // reed's real-world band — water itself
    );
    expect(reeds.has('10,10')).toBe(true);
    expect(bushes.has('10,10')).toBe(false);
    expect(trees.has('10,10')).toBe(false);
  });

  it('never lets a cell be claimed by more than one of bushes/trees/reeds', () => {
    const { bushes, trees, reeds } = buildVegetationRing(
      mulberry32(5),
      oasis,
      300,
      300,
      { min: 1, max: 2, chance: 0.9 },
      { min: 1, max: 3, chance: 0.9 },
      { min: 1, max: 3, chance: 0.9 },
    );
    for (const key of reeds) {
      expect(bushes.has(key)).toBe(false);
      expect(trees.has(key)).toBe(false);
    }
    for (const key of bushes) expect(trees.has(key)).toBe(false);
  });

  it('is deterministic for the same rng sequence', () => {
    const bands = [
      { min: 1, max: 2, chance: 0.15 },
      { min: 2, max: 5, chance: 0.05 },
      { min: 1, max: 1, chance: 0.2 },
    ] as const;
    const a = buildVegetationRing(
      mulberry32(42),
      oasis,
      300,
      300,
      bands[0],
      bands[1],
      bands[2],
    );
    const b = buildVegetationRing(
      mulberry32(42),
      oasis,
      300,
      300,
      bands[0],
      bands[1],
      bands[2],
    );
    expect(Array.from(a.reeds).sort()).toEqual(Array.from(b.reeds).sort());
    expect(Array.from(a.bushes).sort()).toEqual(Array.from(b.bushes).sort());
    expect(Array.from(a.trees).sort()).toEqual(Array.from(b.trees).sort());
  });
});

// a flat run of cells is enough to exercise the size/count math below —
// planGuardianClusters only ever reads `.length`, it doesn't care whether
// the cells are actually connected
function fakeStructure(size: number): Cell[] {
  return Array.from({ length: size }, (_, i) => ({ x: i, y: 0 }));
}

describe('planGuardianClusters', () => {
  it('never plans a guardian for a structure below minClusterSize, even at 100% inhabit chance', () => {
    const plans = planGuardianClusters(
      mulberry32(1),
      [fakeStructure(14)],
      15,
      1,
      20,
      3,
    );
    expect(plans).toEqual([]);
  });

  it('plans nothing at 0% inhabit chance, even for an eligible structure', () => {
    const plans = planGuardianClusters(
      mulberry32(1),
      [fakeStructure(30)],
      15,
      0,
      20,
      3,
    );
    expect(plans).toEqual([]);
  });

  it('scales guardian count with cluster size, clamped to at least 1 and at most maxPerCluster', () => {
    // inhabitChance 1 makes every eligible structure inhabited, isolating the
    // count formula from the inhabit roll
    const [exactlyOne, roundsDown, capped] = [
      planGuardianClusters(mulberry32(1), [fakeStructure(20)], 15, 1, 20, 3),
      planGuardianClusters(mulberry32(1), [fakeStructure(45)], 15, 1, 20, 3),
      planGuardianClusters(mulberry32(1), [fakeStructure(1000)], 15, 1, 20, 3),
    ];
    expect(exactlyOne[0].count).toBe(1); // floor(20/20) = 1
    expect(roundsDown[0].count).toBe(2); // floor(45/20) = 2
    expect(capped[0].count).toBe(3); // floor(1000/20) = 50, clamped to maxPerCluster
  });

  it('still guarantees at least 1 guardian when size/tilesPerGuardian floors to 0', () => {
    // just at minClusterSize, but tilesPerGuardian is much larger — the raw
    // formula would floor to 0, which would silently mean "inhabited but
    // empty"
    const plans = planGuardianClusters(
      mulberry32(1),
      [fakeStructure(15)],
      15,
      1,
      100,
      3,
    );
    expect(plans[0].count).toBe(1);
  });

  it('is deterministic for the same rng seed', () => {
    const structures = [
      fakeStructure(20),
      fakeStructure(50),
      fakeStructure(10),
    ];
    const a = planGuardianClusters(mulberry32(7), structures, 15, 0.5, 20, 3);
    const b = planGuardianClusters(mulberry32(7), structures, 15, 0.5, 20, 3);
    expect(a).toEqual(b);
  });
});

describe('findClusterBorderTiles', () => {
  it('never returns a tile that is itself a member of `stones`', () => {
    // a solid 3x3 block
    const structure: Cell[] = [];
    const stones = new Set<string>();
    for (let y = 5; y <= 7; y++)
      for (let x = 5; x <= 7; x++) {
        structure.push({ x, y });
        stones.add(x + ',' + y);
      }
    const border = findClusterBorderTiles(structure, stones, 300, 300);
    expect(border.length).toBeGreaterThan(0);
    for (const { x, y } of border) expect(stones.has(x + ',' + y)).toBe(false);
  });

  it('never returns duplicate tiles for a structure with multiple shared neighbors', () => {
    const structure: Cell[] = [
      { x: 5, y: 5 },
      { x: 6, y: 5 },
    ];
    const stones = new Set(structure.map((c) => c.x + ',' + c.y));
    const border = findClusterBorderTiles(structure, stones, 300, 300);
    const keys = border.map((c) => c.x + ',' + c.y);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('stays in-bounds for a structure touching the map edge', () => {
    const structure: Cell[] = [{ x: 0, y: 0 }];
    const stones = new Set(['0,0']);
    const border = findClusterBorderTiles(structure, stones, 10, 10);
    for (const { x, y } of border) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(10);
      expect(y).toBeLessThan(10);
    }
  });
});

describe('shuffleGuardianCandidates', () => {
  it('returns a permutation of the input — same elements, possibly reordered', () => {
    const tiles: Cell[] = Array.from({ length: 20 }, (_, i) => ({
      x: i,
      y: 0,
    }));
    const shuffled = shuffleGuardianCandidates(mulberry32(3), tiles);
    expect(shuffled).toHaveLength(tiles.length);
    expect([...shuffled].sort((a, b) => a.x - b.x)).toEqual(
      [...tiles].sort((a, b) => a.x - b.x),
    );
  });

  it('is deterministic for the same rng seed', () => {
    const tiles: Cell[] = Array.from({ length: 20 }, (_, i) => ({
      x: i,
      y: 0,
    }));
    const a = shuffleGuardianCandidates(mulberry32(9), tiles);
    const b = shuffleGuardianCandidates(mulberry32(9), tiles);
    expect(a).toEqual(b);
  });
});
