import { describe, expect, it } from 'vitest';
import { buildOasisPatch, mulberry32 } from './worldgen';

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
