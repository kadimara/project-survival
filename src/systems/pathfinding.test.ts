import { describe, expect, it } from 'vitest';
import { bfsToAdjacent, findPath, hasLineOfSight, isAdjacent } from './pathfinding';

describe('isAdjacent', () => {
  it('is true for a horizontal neighbor', () => {
    expect(isAdjacent(5, 5, 6, 5)).toBe(true);
  });

  it('is true for a vertical neighbor', () => {
    expect(isAdjacent(5, 5, 5, 6)).toBe(true);
  });

  it('is false for a diagonal neighbor', () => {
    expect(isAdjacent(5, 5, 6, 6)).toBe(false);
  });

  it('is false for a distance-2 orthogonal point', () => {
    expect(isAdjacent(5, 5, 7, 5)).toBe(false);
  });

  it('is false for the same point', () => {
    expect(isAdjacent(5, 5, 5, 5)).toBe(false);
  });
});

// simple open-field walkable: everything within a bounding box is walkable
// unless explicitly listed as solid
function makeWalkable(solid: Iterable<string>, size = 20) {
  const solidSet = new Set(solid);
  return (x: number, y: number) =>
    x >= 0 && y >= 0 && x < size && y < size && !solidSet.has(x + ',' + y);
}

describe('findPath', () => {
  it('returns [] when start equals goal', () => {
    const walkable = makeWalkable([]);
    expect(findPath(3, 3, 3, 3, walkable)).toEqual([]);
  });

  it('returns [] when the goal tile is not walkable', () => {
    const walkable = makeWalkable(['3,3']);
    expect(findPath(0, 0, 3, 3, walkable)).toEqual([]);
  });

  it('returns [] when the goal is walled off', () => {
    // wall off (5, y) for all y, sealing off everything with x > 5
    const wall = Array.from({ length: 20 }, (_, y) => '5,' + y);
    const walkable = makeWalkable(wall);
    expect(findPath(0, 0, 6, 0, walkable)).toEqual([]);
  });

  it('returns a single-element path to an adjacent tile', () => {
    const walkable = makeWalkable([]);
    expect(findPath(0, 0, 1, 0, walkable)).toEqual([{ x: 1, y: 0 }]);
  });

  it('returns a straight-line path across open ground, excluding start and including goal', () => {
    const walkable = makeWalkable([]);
    const path = findPath(0, 0, 3, 0, walkable);
    expect(path).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
  });

  it('routes around a solid obstacle', () => {
    // a short wall from (1,0) to (1,2) blocks the direct route
    const walkable = makeWalkable(['1,0', '1,1', '1,2']);
    const path = findPath(0, 1, 2, 1, walkable);
    expect(path.length).toBeGreaterThan(0);
    expect(path[path.length - 1]).toEqual({ x: 2, y: 1 });
    for (const p of path) {
      expect(walkable(p.x, p.y)).toBe(true);
    }
  });
});

describe('bfsToAdjacent', () => {
  it('returns [] when start is already adjacent to goal', () => {
    const walkable = makeWalkable([]);
    expect(bfsToAdjacent(4, 5, 5, 5, walkable)).toEqual([]);
  });

  it('returns [] when all of the goal tile neighbors are solid', () => {
    const walkable = makeWalkable(['4,5', '6,5', '5,4', '5,6']);
    expect(bfsToAdjacent(0, 0, 5, 5, walkable)).toEqual([]);
  });

  it('succeeds even when the goal tile itself is solid/unwalkable', () => {
    // bfsToAdjacent never checks the goal tile's own walkability, only its
    // neighbors — unlike findPath, which requires the goal to be walkable
    const walkable = makeWalkable(['5,5']);
    const path = bfsToAdjacent(0, 5, 5, 5, walkable);
    expect(path.length).toBeGreaterThan(0);
    const last = path[path.length - 1];
    expect(isAdjacent(last.x, last.y, 5, 5)).toBe(true);
  });

  it('breaks ties in fixed up, down, left, right neighbor order', () => {
    // starting directly above the goal, both (goalX, goalY - 1) [up] and
    // paths via left/right are equally short; the up-neighbor is discovered
    // first per the dirs array order in pathfinding.ts
    const walkable = makeWalkable([]);
    const path = bfsToAdjacent(5, 3, 5, 5, walkable);
    expect(path).toEqual([{ x: 5, y: 4 }]);
  });
});

describe('hasLineOfSight', () => {
  it('is true for identical points', () => {
    expect(hasLineOfSight(3, 3, 3, 3, () => true)).toBe(true);
  });

  it('is true along a clear horizontal line', () => {
    expect(hasLineOfSight(0, 0, 5, 0, () => false)).toBe(true);
  });

  it('is true along a clear vertical line', () => {
    expect(hasLineOfSight(0, 0, 0, 5, () => false)).toBe(true);
  });

  it('is true along a clear diagonal line', () => {
    expect(hasLineOfSight(0, 0, 5, 5, () => false)).toBe(true);
  });

  it('is not blocked by a solid tile at the start endpoint', () => {
    const isSolid = (x: number, y: number) => x === 0 && y === 0;
    expect(hasLineOfSight(0, 0, 5, 0, isSolid)).toBe(true);
  });

  it('is not blocked by a solid tile at the end endpoint', () => {
    const isSolid = (x: number, y: number) => x === 5 && y === 0;
    expect(hasLineOfSight(0, 0, 5, 0, isSolid)).toBe(true);
  });

  it('is blocked by a solid tile strictly between the endpoints', () => {
    const isSolid = (x: number, y: number) => x === 2 && y === 0;
    expect(hasLineOfSight(0, 0, 5, 0, isSolid)).toBe(false);
  });

  it('can differ depending on direction for an asymmetric layout (documented existing behavior)', () => {
    // Bresenham's line from a->b need not retrace the same lattice points as
    // b->a; ai.ts only ever calls this one direction so the asymmetry has
    // never mattered in practice, but it's a real contract detail worth
    // pinning down rather than assuming symmetry.
    const isSolid = (x: number, y: number) => x === 0 && y === 1;
    const forward = hasLineOfSight(0, 0, 1, 2, isSolid);
    const backward = hasLineOfSight(1, 2, 0, 0, isSolid);
    expect(forward).toBe(true);
    expect(backward).toBe(false);
    expect(forward).not.toBe(backward);
  });
});
