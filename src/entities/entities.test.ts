// Covers spawnEnemies' boulder-guardian orchestration (cluster eligibility,
// home selection, wiring the salted RNG stream through to placed Enemy
// instances). The size-vs-count formula and border-tile geometry themselves
// are unit-tested directly in worldgen/worldgen.test.ts (planGuardianClusters/
// findClusterBorderTiles) — this file only covers what's unique to
// spawnEnemies' own orchestration.
import { describe, expect, it } from 'vitest';
import { createTestGameState } from '../test/fixtures';
import { FISH_COUNT, GUARDIAN_MIN_CLUSTER_SIZE } from '../constants';
import { OASIS, type Cell } from '../worldgen/worldgen';
import { spawnEnemies } from './entities';

function buildBlock(ox: number, oy: number, w: number, h: number): Cell[] {
  const cells: Cell[] = [];
  for (let dy = 0; dy < h; dy++)
    for (let dx = 0; dx < w; dx++) cells.push({ x: ox + dx, y: oy + dy });
  return cells;
}

// far off-map, so isPlayerAt never collides with any real structure/border
// tile below — keeps this file's structure placement free to ignore where
// the player happens to spawn
function farAwayPlayerState() {
  const state = createTestGameState();
  state.player.tileX = -9999;
  state.player.tileY = -9999;
  return state;
}

describe('spawnEnemies: boulder guardians', () => {
  it('never spawns a guardian for a structure below GUARDIAN_MIN_CLUSTER_SIZE, regardless of seed', () => {
    const structure = buildBlock(10, 10, GUARDIAN_MIN_CLUSTER_SIZE - 1, 1);
    for (const seed of [1, 2, 3, 4, 5]) {
      const state = farAwayPlayerState();
      state.seed = seed;
      spawnEnemies(state, [structure]);
      expect(state.enemies.some((e) => e.type === 'boulderGuardian')).toBe(
        false,
      );
    }
  });

  it("never places a guardian's home on a stone tile, and never stacks two guardians on the same tile", () => {
    // many independent, well-separated eligible structures make it
    // effectively certain (well under 1e-6 failure chance) that at least
    // one gets inhabited, without needing to control the inhabit-chance
    // roll directly
    const structures: Cell[][] = [];
    for (let col = 0; col < 8; col++)
      for (let row = 0; row < 5; row++)
        structures.push(buildBlock(10 + col * 10, 10 + row * 10, 6, 5));

    const state = farAwayPlayerState();
    spawnEnemies(state, structures);

    const stones = new Set<string>();
    for (const s of structures) for (const c of s) stones.add(c.x + ',' + c.y);

    const guardians = state.enemies.filter((e) => e.type === 'boulderGuardian');
    expect(guardians.length).toBeGreaterThan(0);

    const homeKeys = new Set<string>();
    for (const g of guardians) {
      expect(g.home).not.toBeNull();
      const key = g.home!.x + ',' + g.home!.y;
      expect(stones.has(key)).toBe(false);
      expect(homeKeys.has(key)).toBe(false); // no two guardians share a tile
      homeKeys.add(key);
      // a guardian spawns exactly on its own home tile
      expect(g.tileX).toBe(g.home!.x);
      expect(g.tileY).toBe(g.home!.y);
    }
  });

  it('is deterministic for the same seed and structures', () => {
    const structures: Cell[][] = [];
    for (let col = 0; col < 8; col++)
      for (let row = 0; row < 5; row++)
        structures.push(buildBlock(10 + col * 10, 10 + row * 10, 6, 5));

    const a = farAwayPlayerState();
    a.seed = 42;
    spawnEnemies(a, structures);

    const b = farAwayPlayerState();
    b.seed = 42;
    spawnEnemies(b, structures);

    const summarize = (state: typeof a) =>
      state.enemies
        .map((e) => ({ type: e.type, x: e.tileX, y: e.tileY, home: e.home }))
        .sort((x, y) => x.x - y.x || x.y - y.y);

    expect(summarize(a)).toEqual(summarize(b));
  });
});

// paints a small block of OASIS cells directly into a fixture's state.map
// (createTestGameState's default map has no oasis — paintOasis is never
// called by the fixture) so spawnEnemies' fish-spawn scan has water to find
function paintWater(
  state: ReturnType<typeof createTestGameState>,
  ox: number,
  oy: number,
  w: number,
  h: number,
): Set<string> {
  const cells = new Set<string>();
  for (let dy = 0; dy < h; dy++)
    for (let dx = 0; dx < w; dx++) {
      const x = ox + dx,
        y = oy + dy;
      state.map[y][x] = OASIS;
      cells.add(x + ',' + y);
    }
  return cells;
}

describe('spawnEnemies: fish', () => {
  it('spawns one fish per water cell when the pool is smaller than FISH_COUNT', () => {
    const state = farAwayPlayerState();
    const water = paintWater(state, 20, 20, 3, 1); // 3 cells, well under FISH_COUNT
    spawnEnemies(state, []);

    const fish = state.enemies.filter((e) => e.type === 'fish');
    expect(fish.length).toBe(water.size);
    const positions = new Set(fish.map((f) => f.tileX + ',' + f.tileY));
    expect(positions.size).toBe(fish.length); // no two fish share a tile
    for (const f of fish) expect(water.has(f.tileX + ',' + f.tileY)).toBe(true);
  });

  it('caps spawns at FISH_COUNT when the water pool is larger', () => {
    const state = farAwayPlayerState();
    paintWater(state, 20, 20, 10, 10); // 100 cells, well over FISH_COUNT
    spawnEnemies(state, []);

    const fish = state.enemies.filter((e) => e.type === 'fish');
    expect(fish.length).toBe(FISH_COUNT);
  });

  it('never spawns a fish on a solid (e.g. reed-covered) water tile', () => {
    const state = farAwayPlayerState();
    const water = paintWater(state, 20, 20, 1, 1); // exactly one water cell
    state.obstacles.set('20,20', 'reed'); // solid, see OBSTACLE_DEFS.reed
    spawnEnemies(state, []);

    expect(water.size).toBe(1);
    expect(state.enemies.some((e) => e.type === 'fish')).toBe(false);
  });

  it('is deterministic for the same seed', () => {
    const a = farAwayPlayerState();
    a.seed = 42;
    paintWater(a, 20, 20, 10, 10);
    spawnEnemies(a, []);

    const b = farAwayPlayerState();
    b.seed = 42;
    paintWater(b, 20, 20, 10, 10);
    spawnEnemies(b, []);

    const summarize = (state: typeof a) =>
      state.enemies
        .filter((e) => e.type === 'fish')
        .map((e) => ({ x: e.tileX, y: e.tileY }))
        .sort((x, y) => x.x - y.x || x.y - y.y);

    expect(summarize(a)).toEqual(summarize(b));
  });
});
