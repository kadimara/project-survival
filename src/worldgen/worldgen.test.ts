import { describe, expect, it } from 'vitest';
import {
  buildOasisPatch,
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
