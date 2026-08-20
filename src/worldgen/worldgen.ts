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
// point — solid stone is deliberately rare and forms separated
// boulder-cluster "structures" scattered across an otherwise open walkable
// wasteland, so most resources (embedded in those clusters, see
// buildWorldLayers in state/state.ts) mean seeking out and digging into a
// structure rather than just walking up to them. See buildStones' spawn-
// safety carve below for why the player never spawns inside one.
export const CAVE_PRESET = {
  scale: 50,
  octaves: 3,
  persistence: 1,
  lacunarity: 2,
  threshold: -0.5,
};

// ground tile variant (aesthetic, not walkability)
export const DIRT = 0;
// a second background variant, painted into a small patch of state.map for
// the one oasis (see paintOasis in state/state.ts) — purely cosmetic, like
// DIRT above; nothing here makes it solid or diggable
export const OASIS = 1;

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

// enumerates the connected components of `members` on a mapW x mapH grid —
// a generic 4-directional flood fill, parameterized on which cells count as
// "in" so it works for any single-layer region set (e.g. passing buildStones'
// own `stones` set directly enumerates the separated boulder-cluster
// structures; nothing here is specific to solid vs. walkable). Each
// returned region is the full list of tile coordinates in that connected
// area; used by state.ts to decide which structures are big enough to
// scavenge and where within them to place resources.
export function findRegions(
  members: Set<string>,
  mapW: number,
  mapH: number,
): Cell[][] {
  const seen = new Set<string>();
  const regions: Cell[][] = [];
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (let y = 0; y < mapH; y++) {
    for (let x = 0; x < mapW; x++) {
      const key = x + ',' + y;
      if (!members.has(key) || seen.has(key)) continue;
      const region: Cell[] = [];
      const stack: Cell[] = [{ x, y }];
      seen.add(key);
      while (stack.length) {
        const cur = stack.pop()!;
        region.push(cur);
        for (const [dx, dy] of dirs) {
          const nx = cur.x + dx,
            ny = cur.y + dy;
          if (nx < 0 || ny < 0 || nx >= mapW || ny >= mapH) continue;
          const nk = nx + ',' + ny;
          if (!members.has(nk) || seen.has(nk)) continue;
          seen.add(nk);
          stack.push({ x: nx, y: ny });
        }
      }
      regions.push(region);
    }
  }
  return regions;
}

// cells of `structure` whose 4-directional neighbors are all also members
// of `members` — i.e. cells that don't touch the structure's boundary.
// Structures are maximal connected components (see findRegions above), so
// checking a neighbor against the global `members` set is equivalent to
// checking it against the structure's own cells: any neighboring member
// cell is necessarily part of the same structure. Used by buildWorldLayers
// in state/state.ts to keep resource placement away from the edge.
export function interiorCells(structure: Cell[], members: Set<string>): Cell[] {
  return structure.filter(({ x, y }) => {
    return (
      members.has(x + 1 + ',' + y) &&
      members.has(x - 1 + ',' + y) &&
      members.has(x + ',' + (y + 1)) &&
      members.has(x + ',' + (y - 1))
    );
  });
}

// max wobble amplitude buildOasisPatch's two sine harmonics can add, as a
// fraction of the base radius — kept small and well under 1, so the shape
// reads as a circle with a bit of natural irregularity rather than a
// lopsided blob, and the boundary always stays a positive distance out in
// every direction (no pinched-off islands)
const OASIS_WOBBLE = 0.12 + 0.08;

// picks one irregular, pond-shaped patch of cells at a fixed distance from
// (originX, originY), in a uniformly random direction — used for the single
// oasis background patch (see paintOasis in state/state.ts). Distance is
// fixed, not noise-driven, matching how a spring/water-table feature can
// turn up anywhere in the wasteland rather than following a terrain
// gradient. The outline itself isn't a perfect circle — two sine harmonics
// at random phases wobble the radius per-angle, so it reads as a natural
// pond rather than a drawn disc.
export function buildOasisPatch(
  rng: Rng,
  mapW: number,
  mapH: number,
  originX: number,
  originY: number,
  distance: number,
  radius: number,
): Set<string> {
  const angle = rng() * Math.PI * 2;
  const maxR = radius * (1 + OASIS_WOBBLE);
  const margin = Math.ceil(maxR) + 1;
  const cx = Math.round(
    Math.min(
      mapW - 1 - margin,
      Math.max(margin, originX + Math.cos(angle) * distance),
    ),
  );
  const cy = Math.round(
    Math.min(
      mapH - 1 - margin,
      Math.max(margin, originY + Math.sin(angle) * distance),
    ),
  );

  const phase1 = rng() * Math.PI * 2;
  const phase2 = rng() * Math.PI * 2;
  const radiusAt = (theta: number): number =>
    radius *
    (1 +
      0.12 * Math.sin(theta * 3 + phase1) +
      0.08 * Math.sin(theta * 5 + phase2));

  const cells = new Set<string>();
  for (let y = cy - Math.ceil(maxR); y <= cy + Math.ceil(maxR); y++) {
    for (let x = cx - Math.ceil(maxR); x <= cx + Math.ceil(maxR); x++) {
      const dx = x - cx,
        dy = y - cy;
      const dist = Math.hypot(dx, dy);
      if (dist <= radiusAt(Math.atan2(dy, dx))) cells.add(x + ',' + y);
    }
  }
  return cells;
}

// scatters vegetation in a ring band around the oasis's actual (wobbly)
// cell set, rather than assuming a clean circle — a multi-source 4-
// directional BFS out from every oasis cell gives each nearby cell its grid
// distance to the *nearest* oasis cell, so the band hugs the pond's real
// noise-perturbed boundary the same way buildStones' spawn-safety carve
// hugs a fixed point (see SPAWN_SAFETY_R above). Bushes are checked first
// and claim their ring at the given chance; trees are only rolled on cells
// bushes didn't take, so a cell is never claimed by both.
export function buildVegetationRing(
  rng: Rng,
  oasis: Set<string>,
  mapW: number,
  mapH: number,
  bush: { min: number; max: number; chance: number },
  tree: { min: number; max: number; chance: number },
): { bushes: Set<string>; trees: Set<string> } {
  const maxRing = Math.max(bush.max, tree.max);
  const dist = new Map<string, number>();
  let frontier: Cell[] = [];
  for (const key of oasis) {
    const [x, y] = key.split(',').map(Number);
    dist.set(key, 0);
    frontier.push({ x, y });
  }
  const dirs: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (let d = 1; d <= maxRing; d++) {
    const next: Cell[] = [];
    for (const { x, y } of frontier) {
      for (const [dx, dy] of dirs) {
        const nx = x + dx,
          ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= mapW || ny >= mapH) continue;
        const nk = nx + ',' + ny;
        if (dist.has(nk)) continue;
        dist.set(nk, d);
        next.push({ x: nx, y: ny });
      }
    }
    frontier = next;
  }

  const bushes = new Set<string>();
  const trees = new Set<string>();
  for (const [key, d] of dist) {
    if (d === 0) continue; // an oasis cell itself, not a candidate
    if (d >= bush.min && d <= bush.max && rng() < bush.chance) {
      bushes.add(key);
    } else if (d >= tree.min && d <= tree.max && rng() < tree.chance) {
      trees.add(key);
    }
  }
  return { bushes, trees };
}
