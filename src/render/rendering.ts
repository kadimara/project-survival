// Low-level canvas drawing primitives: tiles, obstacles, entity squares, and
// HP bars. Each function only takes the canvas context plus the primitive
// values it needs to draw one thing, so none of it depends on the game's
// entity/state model.
import { DIRT, OASIS } from '../worldgen/worldgen';
import { OBSTACLE_DEFS } from '../constants';
import type { ItemType, ObstacleType } from '../types/types';

// desert sand checkerboard — subtle warm-tone banding rather than a flat
// fill, same "two-tone alternating tile" convention drawTile already used
// for the old cave-dirt palette. OASIS is translucent (alpha < 1) on
// purpose — drawTile always paints the sand pair underneath first, so the
// water blends with it rather than fully covering it, like shallow water
// over sand.
export const COLORS: Record<number, [string, string]> = {
  [DIRT]: ['#b9ac87', '#b2a47c'],
  [OASIS]: ['rgba(58,124,165,0.55)', 'rgba(47,102,144,0.55)'],
};

export function drawTile(
  ctx: CanvasRenderingContext2D,
  TILE: number,
  type: number,
  sx: number,
  sy: number,
): void {
  const tx = sx / TILE,
    ty = sy / TILE;
  const parity = (tx + ty) % 2 === 0 ? 0 : 1;
  const sand = COLORS[DIRT];
  ctx.fillStyle = sand[parity];
  ctx.fillRect(sx, sy, TILE, TILE);
  if (type !== DIRT) {
    const pair = COLORS[type] || sand;
    ctx.fillStyle = pair[parity];
    ctx.fillRect(sx, sy, TILE, TILE);
  }
}

export function drawObstacle(
  ctx: CanvasRenderingContext2D,
  TILE: number,
  sx: number,
  sy: number,
  type: ObstacleType,
): void {
  drawTile(ctx, TILE, DIRT, sx, sy);
  drawObstacleOverlay(ctx, TILE, sx, sy, OBSTACLE_DEFS[type].colors);
}

// the nested-square "obstacle" look, without clearing a base underneath it
// first — split out from drawObstacle so ground-atlas.ts can paint a floor
// tile's own overlay as the base, then an obstacle's overlay on top of
// that, letting the floor's texture peek through the obstacle's inset
// border instead of being erased by drawObstacle's own DIRT clear. Takes
// colors directly (not an ObstacleType) so it works for both OBSTACLE_DEFS
// and FLOOR_DEFS without this module needing to know which table a caller
// is drawing from.
export function drawObstacleOverlay(
  ctx: CanvasRenderingContext2D,
  TILE: number,
  sx: number,
  sy: number,
  colors: { primary: string; secondary: string },
): void {
  const { primary, secondary } = colors;
  const m1 = Math.max(1, Math.round(TILE * 0.09));
  const m2 = Math.max(1, Math.round(TILE * 0.16));
  ctx.fillStyle = secondary;
  ctx.fillRect(sx + m1, sy + m1, TILE - m1 * 2, TILE - m1 * 2);
  ctx.fillStyle = primary;
  ctx.fillRect(sx + m2, sy + m2, TILE - m2 * 2, TILE - m2 * 2);
}

// the tree trunk — narrower and shorter than the standard obstacle square
// so it reads as a slim trunk rather than a same-shape copy of every other
// obstacle: a fixed 12x12px outer square plus an 8x8px inner accent, both
// centered on the tile — same centering formula as drawTreeCanopy, so it
// comes out as a uniform 2px border all the way around.
export function drawTreeTrunk(
  ctx: CanvasRenderingContext2D,
  TILE: number,
  sx: number,
  sy: number,
  colors: { primary: string; secondary: string },
): void {
  const { primary, secondary } = colors;
  const outerW = 12,
    outerH = 12;
  const innerW = 8,
    innerH = 8;
  const oxm = (TILE - outerW) / 2,
    oym = (TILE - outerH) / 2;
  const ixm = (TILE - innerW) / 2,
    iym = (TILE - innerH) / 2;
  ctx.fillStyle = secondary;
  ctx.fillRect(sx + oxm, sy + oym, outerW, outerH);
  ctx.fillStyle = primary;
  ctx.fillRect(sx + ixm, sy + iym, innerW, innerH);
}

// the tree canopy — a fixed 20x24px outer square (wider and noticeably
// taller than its own tile, centered over it) so it reads as a broad
// canopy rather than a same-size copy of the trunk below it, plus a
// 16x20px inner accent — 4px less than the outer in each dimension, same
// centering formula as the outer so it comes out as a uniform 2px border.
export function drawTreeCanopy(
  ctx: CanvasRenderingContext2D,
  TILE: number,
  sx: number,
  sy: number,
  colors: { primary: string; secondary: string },
): void {
  const { primary, secondary } = colors;
  const outerW = 20,
    outerH = 24;
  const innerW = 16,
    innerH = 20;
  const oxm = (TILE - outerW) / 2,
    oym = (TILE - outerH) / 2;
  const ixm = (TILE - innerW) / 2,
    iym = (TILE - innerH) / 2;
  ctx.fillStyle = secondary;
  ctx.fillRect(sx + oxm, sy + oym, outerW, outerH);
  ctx.fillStyle = primary;
  ctx.fillRect(sx + ixm, sy + iym, innerW, innerH);
}

// a cactus: the same nested-square "obstacle" body as any other obstacle
// (drawObstacleOverlay, in the berryBush-like green passed as `colors`),
// plus a small red fruit blob layered on top near the top of the tile so it
// reads as growing out of the body rather than replacing it — `fruitColors`
// is ITEM_DEFS.cactusFruit's own palette (see ground-atlas.ts), the same
// item this obstacle drops once destroyed (see destroyCactus in
// systems/combat.ts). Unlike the tree canopy above, this whole thing fits
// within its own tile, so it's baked into the ground atlas rather than
// drawn per-frame — see patchGroundAtlasTile in render/ground-atlas.ts.
export function drawCactusBody(
  ctx: CanvasRenderingContext2D,
  TILE: number,
  sx: number,
  sy: number,
  colors: { primary: string; secondary: string },
  fruitColors: { primary: string; secondary: string },
): void {
  drawObstacleOverlay(ctx, TILE, sx, sy, colors);
  const fruitSize = Math.max(3, Math.round(TILE * 0.28));
  const fx = sx + (TILE - fruitSize) / 2;
  const fy = sy + Math.round(TILE * 0.18);
  ctx.fillStyle = fruitColors.secondary;
  ctx.fillRect(fx - 1, fy - 1, fruitSize + 2, fruitSize + 2);
  ctx.fillStyle = fruitColors.primary;
  ctx.fillRect(fx, fy, fruitSize, fruitSize);
}

// a berryBush: the same nested-square "obstacle" body as any other obstacle
// (drawObstacleOverlay), plus 4 small 1x1px preview dots at
// BERRY_DOT_OFFSETS marking where berries grow while it's standing on soil
// (see updateBerryBushes in systems/farming.ts) — a muted accent rather
// than full berry red, so they read as a hint rather than already-ripe
// fruit. The ripe berry item itself (drawBerryDots below) draws bigger dots
// at these same 4 spots, so the preview "blooms" into it once ready.
export function drawBerryBushBody(
  ctx: CanvasRenderingContext2D,
  TILE: number,
  sx: number,
  sy: number,
  colors: { primary: string; secondary: string },
): void {
  drawObstacleOverlay(ctx, TILE, sx, sy, colors);
  ctx.fillStyle = BERRY_SPOT_PREVIEW_COLOR;
  for (const [ox, oy] of BERRY_DOT_OFFSETS) {
    ctx.fillRect(sx + ox, sy + oy, 1, 1);
  }
}

// flat, full-tile, single-color fill for the floor layer — unlike
// drawObstacleOverlay's inset "bordered square" look (which reads as a
// solid thing sitting on the ground), floor tiles are walkable, so they're
// filled edge-to-edge with no border and no checkerboard, just a uniform
// color per FloorType.
export function drawFloorOverlay(
  ctx: CanvasRenderingContext2D,
  TILE: number,
  sx: number,
  sy: number,
  colors: { primary: string; secondary: string },
): void {
  ctx.fillStyle = colors.primary;
  ctx.fillRect(sx, sy, TILE, TILE);
}

// three fixed dots scattered around a tile, avoiding the dead center where
// a regular item's centered square would render — used for a planted
// energySeed (see farming.ts) so it stays visually distinct even when the
// energy item it produced sits on the same cell
const SCATTERED_DOT_OFFSETS: [number, number][] = [
  [5, 5],
  [10, 5],
  [7, 10],
];

// four irregularly-scattered spots within a tile a berryBush's berries grow
// at — same "fixed, non-uniform offsets" idea as SCATTERED_DOT_OFFSETS/
// ORE_DOT_OFFSETS above rather than a neat symmetric grid, so it reads as
// organic growth. Shared by the bush's own preview dots (drawBerryBushBody
// above) and the ripe berry item itself (drawItemIcon below), so the two
// line up visually — the preview dots "bloom" into bigger berry dots at
// the exact same spots once ready.
const BERRY_DOT_OFFSETS: [number, number][] = [
  [5, 5],
  [10, 6],
  [6, 10],
  [10, 10],
];
const BERRY_SPOT_PREVIEW_COLOR = '#3a4a24';

// furnace: the body bakes into the ground atlas as a plain stone tile (see
// ground-atlas.ts, which draws it via drawObstacle(..., 'stone')) — only
// the firebox glow below is drawn fresh each frame, over that baked body,
// so it can flicker
const FURNACE_GLOW_DIM: [number, number, number] = [196, 90, 48];
const FURNACE_GLOW_BRIGHT: [number, number, number] = [255, 210, 130];

function lerpColor(
  c1: [number, number, number],
  c2: [number, number, number],
  t: number,
): string {
  const r = Math.round(c1[0] + (c2[0] - c1[0]) * t);
  const g = Math.round(c1[1] + (c2[1] - c1[1]) * t);
  const b = Math.round(c1[2] + (c2[2] - c1[2]) * t);
  return `rgb(${r},${g},${b})`;
}

// two out-of-phase sine waves so the flicker doesn't read as a metronome;
// `seed` offsets the phase per-furnace so several don't pulse in lockstep
function flickerT(now: number, seed: number): number {
  const a = Math.sin(now / 140 + seed) * 0.5 + 0.5;
  const b = Math.sin(now / 55 + seed * 1.7) * 0.5 + 0.5;
  return a * 0.65 + b * 0.35;
}

// firebox opening: a square glowing mouth centered on the furnace body,
// like a lit hearth — the rim stays a fixed ember color, only the core
// flickers
export function drawFurnaceGlow(
  ctx: CanvasRenderingContext2D,
  TILE: number,
  sx: number,
  sy: number,
  now: number,
  seed: number,
): void {
  const { primary } = OBSTACLE_DEFS.furnace.colors;
  // kept even so (TILE - outer) / 2 divides evenly — an odd outer would
  // round the left/right centering offsets unevenly by a pixel
  const outerRaw = Math.max(4, Math.round(TILE * 0.7));
  const outer = outerRaw - (outerRaw % 2);
  const ox = sx + (TILE - outer) / 2;
  const oy = sy + (TILE - outer) / 2;
  ctx.fillStyle = primary;
  ctx.fillRect(ox, oy, outer, outer);
  ctx.fillStyle = lerpColor(
    FURNACE_GLOW_DIM,
    FURNACE_GLOW_BRIGHT,
    flickerT(now, seed),
  );
  const core = Math.max(2, outer - 4);
  const inset = (outer - core) / 2;
  ctx.fillRect(ox + inset, oy + inset, core, core);
}

// ore ground item: a handful of bigger flecks scattered across the cell —
// the same "loose dots" idea as a planted seed (drawScatteredDots below)
// but chunkier, since ore sits on top of whatever stone tile it was mined
// from rather than drawing its own tile background
const ORE_DOT_OFFSETS: [number, number, number][] = [
  [2, 2, 5],
  [10, 2, 3],
  [3, 10, 3],
  [10, 9, 5],
];

export function drawOreDots(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  color: string,
): void {
  ctx.fillStyle = color;
  for (const [ox, oy, size] of ORE_DOT_OFFSETS) {
    ctx.fillRect(sx + ox, sy + oy, size, size);
  }
}

export function drawScatteredDots(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  color: string,
): void {
  ctx.fillStyle = color;
  for (const [ox, oy] of SCATTERED_DOT_OFFSETS) {
    ctx.fillRect(sx + ox, sy + oy, 2, 2);
  }
}

// the ripe berry item: 4 dots (bigger than the 1px preview dots) at
// BERRY_DOT_OFFSETS (see its comment above) — visually "blooms" out of the
// small preview dots the berryBush itself draws at the same spots.
export function drawBerryDots(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  color: string,
): void {
  ctx.fillStyle = color;
  for (const [ox, oy] of BERRY_DOT_OFFSETS) {
    ctx.fillRect(sx + ox, sy + oy, 2, 2);
  }
}

// a small blade-shaped icon (blade, crossguard, handle, top to bottom)
// built from a handful of rects, matching the game's blocky art style
// elsewhere (drawFurnaceGlow, drawObstacle). `box` is the square footprint
// to draw within — the ground-item tile size for a dropped sword (see
// drawItemIcon below), or a smaller box for the held-item indicator drawn
// above the player's head (see render.ts) — so the same proportions read
// as a sword at either scale.
export function drawSwordIcon(
  ctx: CanvasRenderingContext2D,
  box: number,
  sx: number,
  sy: number,
  colors: { primary: string; secondary: string },
): void {
  const cx = sx + box / 2;
  const bladeW = Math.max(1, Math.round(box * 0.125));
  const bladeH = Math.max(2, Math.round(box * 0.5));
  const bladeY = sy + Math.round(box * 0.125);
  const guardW = Math.max(bladeW + 2, Math.round(box * 0.375));
  const guardH = Math.max(1, Math.round(box * 0.125));
  const guardY = bladeY + bladeH - guardH;
  const handleH = Math.max(1, Math.round(box * 0.1875));

  ctx.fillStyle = colors.primary;
  ctx.fillRect(cx - bladeW / 2, bladeY, bladeW, bladeH);
  ctx.fillStyle = colors.secondary;
  ctx.fillRect(cx - guardW / 2, guardY, guardW, guardH);
  ctx.fillRect(cx - bladeW / 2, guardY + guardH, bladeW, handleH);
}

// a small bow shape — a curved limb (a handful of rects bulging away from a
// taut string, tip to tip) built the same "handful of rects" blocky way as
// drawSwordIcon above, and reused at the same two scales for the same
// reason (see drawSwordIcon's comment)
export function drawBowIcon(
  ctx: CanvasRenderingContext2D,
  box: number,
  sx: number,
  sy: number,
  colors: { primary: string; secondary: string },
): void {
  const segments = 5;
  const segH = box / segments;
  // wide enough that consecutive segments always overlap horizontally
  // despite their bulge offset changing, so the limb reads as one solid
  // curve rather than a staircase with gaps
  const limbW = Math.max(2, Math.round(box * 0.22));
  const stringW = Math.max(1, Math.round(box * 0.1));
  const stringX = sx + Math.round(box * 0.3);
  // tip -> middle -> tip bulge offsets from the string, so the limb
  // segments read as a curve rather than a straight stack
  const bulge = [0, 0.14, 0.24, 0.14, 0];

  ctx.fillStyle = colors.secondary;
  ctx.fillRect(stringX - stringW, sy, stringW, box);

  ctx.fillStyle = colors.primary;
  for (let i = 0; i < segments; i++) {
    const bx = stringX + Math.round(box * bulge[i]);
    ctx.fillRect(bx, sy + Math.round(i * segH), limbW, Math.ceil(segH) + 1);
  }
}

// draws whichever visual `type` uses as a loose item — shared by
// state.items and an in-progress furnace job (state.smelters) so a job
// renders exactly like the item it started from, see render.ts
export function drawItemIcon(
  ctx: CanvasRenderingContext2D,
  TILE: number,
  sx: number,
  sy: number,
  type: ItemType,
  colors: { primary: string; secondary: string },
): void {
  if (type === 'energySeed') {
    drawScatteredDots(ctx, sx, sy, colors.primary);
    return;
  }
  if (type === 'ore') {
    drawOreDots(ctx, sx, sy, colors.primary);
    return;
  }
  if (type === 'sword') {
    drawSwordIcon(ctx, TILE, sx, sy, colors);
    return;
  }
  if (type === 'bow') {
    drawBowIcon(ctx, TILE, sx, sy, colors);
    return;
  }
  if (type === 'berry') {
    drawBerryDots(ctx, sx, sy, colors.primary);
    return;
  }
  const size = Math.max(4, Math.round(TILE * 0.4));
  const ix = sx + (TILE - size) / 2,
    iy = sy + (TILE - size) / 2;
  ctx.fillStyle = colors.secondary;
  ctx.fillRect(ix - 1, iy - 1, size + 2, size + 2);
  ctx.fillStyle = colors.primary;
  ctx.fillRect(ix, iy, size, size);
}

// one mark of the player's sand trail (see leaveFootprint in state/
// state.ts) — a plain darkening overlay inset within the tile (not covering
// it edge-to-edge), rather than a footprint-shaped print. `alpha` carries
// the fade (render.ts computes it from the mark's age).
export function drawStepDarken(
  ctx: CanvasRenderingContext2D,
  TILE: number,
  sx: number,
  sy: number,
  alpha: number,
): void {
  const inset = Math.round(TILE * 0.2);
  const size = TILE - inset * 2;
  ctx.fillStyle = `rgba(20,20,20,${alpha})`;
  ctx.fillRect(sx + inset, sy + inset, size, size);
}

// the water-tile counterpart to drawStepDarken above — same footprint mark
// (render.ts picks one or the other per mark, based on whether the tile the
// player stepped off of is OASIS or plain ground, see leaveFootprint in
// state/state.ts), but a light foam-colored fill instead of a dark inset —
// edge-to-edge (no inset) so consecutive marks along the player's path
// touch and read as one continuous stream rather than separate dots.
// `alpha` carries the fade (render.ts computes it from the mark's age,
// same as drawStepDarken's, but on its own shorter timer — see
// WAKE_FADE_MS in constants.ts).
export function drawWake(
  ctx: CanvasRenderingContext2D,
  TILE: number,
  sx: number,
  sy: number,
  alpha: number,
): void {
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  ctx.fillRect(sx, sy, TILE, TILE);
}

export function drawSquareEntity(
  ctx: CanvasRenderingContext2D,
  TILE: number,
  sx: number,
  sy: number,
  fill: string,
  edge: string,
  inset: number,
): void {
  const size = TILE - inset * 2;
  ctx.fillStyle = edge;
  ctx.fillRect(sx + inset - 1, sy + inset - 1, size + 2, size + 2);
  ctx.fillStyle = fill;
  ctx.fillRect(sx + inset, sy + inset, size, size);
}

// in-flight ranged shot (see state.projectiles/render.ts) — a plain dot at
// its current lerped position, matching the game's blocky, un-fussy art
// style elsewhere rather than a fully rendered arrow sprite
export function drawProjectile(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  color: string,
): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(sx, sy, 2, 0, Math.PI * 2);
  ctx.fill();
}

export function drawHpBar(
  ctx: CanvasRenderingContext2D,
  TILE: number,
  sx: number,
  sy: number,
  ratio: number,
): void {
  const margin = Math.max(1, Math.round(TILE * 0.16));
  const w = TILE - margin * 2,
    h = Math.max(1, Math.round(TILE * 0.125));
  const bx = sx + margin,
    by = sy - Math.round(TILE * 0.25);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(bx - 1, by - 1, w + 2, h + 2);
  let fill = '#4caf50';
  if (ratio <= 0.25) fill = '#e53935';
  else if (ratio <= 0.5) fill = '#f5a623';
  ctx.fillStyle = fill;
  ctx.fillRect(bx, by, Math.max(0, w * ratio), h);
}
