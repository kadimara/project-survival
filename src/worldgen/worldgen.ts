// World generation: seeded RNG, simplex noise, and the procedural cave-stone
// pass that turns noise into a walkable/solid tile map.

export type Rng = () => number;
export type Noise2D = (x: number, y: number) => number;
export type Cell = { x: number; y: number };

export function mulberry32(seed: number): Rng {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 2D simplex noise (public-domain reference algorithm, seeded permutation)
export function makeSimplex2D(noiseSeed: number): Noise2D {
  const noiseRng = mulberry32(noiseSeed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(noiseRng() * (i + 1));
    const tmp = p[i];
    p[i] = p[j];
    p[j] = tmp;
  }
  const perm = new Uint8Array(512);
  const permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    permMod12[i] = perm[i] % 12;
  }
  const grad3 = [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
    [1, 0],
    [-1, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [0, 1],
    [0, -1],
  ];
  const F2 = 0.5 * (Math.sqrt(3) - 1);
  const G2 = (3 - Math.sqrt(3)) / 6;
  return function noise2D(xin: number, yin: number): number {
    let n0 = 0,
      n1 = 0,
      n2 = 0;
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const X0 = i - t,
      Y0 = j - t;
    const x0 = xin - X0,
      y0 = yin - Y0;
    let i1, j1;
    if (x0 > y0) {
      i1 = 1;
      j1 = 0;
    } else {
      i1 = 0;
      j1 = 1;
    }
    const x1 = x0 - i1 + G2,
      y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2,
      y2 = y0 - 1 + 2 * G2;
    const ii = i & 255,
      jj = j & 255;
    const gi0 = permMod12[ii + perm[jj]];
    const gi1 = permMod12[ii + i1 + perm[jj + j1]];
    const gi2 = permMod12[ii + 1 + perm[jj + 1]];
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      t0 *= t0;
      n0 = t0 * t0 * (grad3[gi0][0] * x0 + grad3[gi0][1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      t1 *= t1;
      n1 = t1 * t1 * (grad3[gi1][0] * x1 + grad3[gi1][1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      t2 *= t2;
      n2 = t2 * t2 * (grad3[gi2][0] * x2 + grad3[gi2][1] * y2);
    }
    return 70 * (n0 + n1 + n2); // ~[-1, 1]
  };
}

export function fbm(
  noise2D: Noise2D,
  x: number,
  y: number,
  octaves: number,
  persistence: number,
  lacunarity: number,
  scale: number,
): number {
  let total = 0,
    amplitude = 1,
    frequency = 1 / scale,
    maxValue = 0;
  for (let o = 0; o < octaves; o++) {
    total += noise2D(x * frequency, y * frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return total / maxValue;
}

// preset tuned in tools/noise-lab.html against this game's real seed/spawn
// point — walkable ground is deliberately rare (~6% of the map) and forms
// separated island-shaped blobs rather than one connected cave, so reaching
// most resources means digging through long stretches of solid stone. Low
// octave count keeps island edges smooth/chunky instead of speckled with
// tiny 1-2 tile noise artifacts. See buildStones' spawn-safety carve below
// for why this doesn't risk stranding the player with no dig path out.
export const CAVE_PRESET = {
  scale: 50,
  octaves: 3,
  persistence: 1,
  lacunarity: 2,
  threshold: -0.5,
};

// ground tile variant (aesthetic, not walkability)
export const DIRT = 0;

export function buildMap(mapW: number, mapH: number): number[][] {
  const map: number[][] = [];
  for (let y = 0; y < mapH; y++) {
    const row: number[] = [];
    for (let x = 0; x < mapW; x++) row.push(DIRT);
    map.push(row);
  }
  return map;
}

// generates the solid-stone set for a mapW x mapH cave from fbm noise, then
// carves out a safety bubble around the spawn point so the player never
// spawns sealed inside solid stone
export function buildStones(
  seed: number,
  mapW: number,
  mapH: number,
  spawnX: number,
  spawnY: number,
): Set<string> {
  const stones = new Set<string>();
  const noise2D = makeSimplex2D(seed);
  const { scale, octaves, persistence, lacunarity, threshold } = CAVE_PRESET;
  // direct 1:1 mapping: one noise sample per tile. Solid below the
  // threshold, walkable at or above it (matches the map generator tool's
  // "walkable below" convention, flipped).
  for (let y = 0; y < mapH; y++) {
    for (let x = 0; x < mapW; x++) {
      const n = fbm(noise2D, x, y, octaves, persistence, lacunarity, scale);
      if (n < threshold) stones.add(x + ',' + y);
    }
  }
  const carve = (x: number, y: number) => {
    if (x > 0 && y > 0 && x < mapW - 1 && y < mapH - 1)
      stones.delete(x + ',' + y);
  };
  const SPAWN_SAFETY_R = 3;
  for (let y = spawnY - SPAWN_SAFETY_R; y <= spawnY + SPAWN_SAFETY_R; y++) {
    for (let x = spawnX - SPAWN_SAFETY_R; x <= spawnX + SPAWN_SAFETY_R; x++) {
      if (Math.abs(x - spawnX) + Math.abs(y - spawnY) <= SPAWN_SAFETY_R)
        carve(x, y);
    }
  }
  return stones;
}

// enumerates the separated walkable landmasses buildStones' noise pass
// produces — a 4-directional flood fill over the walkable complement of
// `stones` (the same set buildStones returns, already including its
// spawn-safety carve). Each returned island is the full list of tile
// coordinates in that connected region; used by state.ts to decide which
// islands are big enough to scavenge and where within them to place
// resources.
export function findIslands(
  stones: Set<string>,
  mapW: number,
  mapH: number,
): Cell[][] {
  const seen = new Set<string>();
  const islands: Cell[][] = [];
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (let y = 0; y < mapH; y++) {
    for (let x = 0; x < mapW; x++) {
      const key = x + ',' + y;
      if (stones.has(key) || seen.has(key)) continue;
      const island: Cell[] = [];
      const stack: Cell[] = [{ x, y }];
      seen.add(key);
      while (stack.length) {
        const cur = stack.pop()!;
        island.push(cur);
        for (const [dx, dy] of dirs) {
          const nx = cur.x + dx,
            ny = cur.y + dy;
          if (nx < 0 || ny < 0 || nx >= mapW || ny >= mapH) continue;
          const nk = nx + ',' + ny;
          if (stones.has(nk) || seen.has(nk)) continue;
          seen.add(nk);
          stack.push({ x: nx, y: ny });
        }
      }
      islands.push(island);
    }
  }
  return islands;
}

// picks up to `count` distinct cells at random from `cells` (partial
// Fisher-Yates via swap-and-pop) — used to reserve non-overlapping
// placement tiles for resources within one island.
export function pickDistinctCells(
  cells: Cell[],
  count: number,
  rng: Rng,
): Cell[] {
  const pool = cells.slice();
  const n = Math.min(count, pool.length);
  const picked: Cell[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(rng() * pool.length);
    picked.push(pool[idx]);
    pool[idx] = pool[pool.length - 1];
    pool.pop();
  }
  return picked;
}
