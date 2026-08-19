// Low-level canvas drawing primitives: tiles, obstacles, entity squares, and
// HP bars. Each function only takes the canvas context plus the primitive
// values it needs to draw one thing, so none of it depends on the game's
// entity/state model.
import { DIRT } from '../worldgen/worldgen';
import { TILE_DEFS } from '../constants';
import type { ItemType, TileType } from '../types/types';

export const COLORS: Record<number, [string, string]> = {
  [DIRT]: ['#393939', '#363636'],
};

export function drawTile(
  ctx: CanvasRenderingContext2D,
  TILE: number,
  type: number,
  sx: number,
  sy: number,
): void {
  const pair = COLORS[type] || COLORS[DIRT];
  const tx = sx / TILE,
    ty = sy / TILE;
  ctx.fillStyle = (tx + ty) % 2 === 0 ? pair[0] : pair[1];
  ctx.fillRect(sx, sy, TILE, TILE);
}

export function drawObstacle(
  ctx: CanvasRenderingContext2D,
  TILE: number,
  sx: number,
  sy: number,
  type: TileType,
): void {
  drawTile(ctx, TILE, DIRT, sx, sy);
  const { primary, secondary } = TILE_DEFS[type].colors;
  const m1 = Math.max(1, Math.round(TILE * 0.09));
  const m2 = Math.max(1, Math.round(TILE * 0.16));
  ctx.fillStyle = secondary;
  ctx.fillRect(sx + m1, sy + m1, TILE - m1 * 2, TILE - m1 * 2);
  ctx.fillStyle = primary;
  ctx.fillRect(sx + m2, sy + m2, TILE - m2 * 2, TILE - m2 * 2);
}

// three fixed dots scattered around a tile, avoiding the dead center where
// a regular item's centered square would render — used for a planted seed
// (see farming.ts) so it stays visually distinct even when an energy item
// it produced sits on the same cell
const SCATTERED_DOT_OFFSETS: [number, number][] = [
  [5, 5],
  [10, 5],
  [7, 10],
];

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
  const { primary } = TILE_DEFS.furnace.colors;
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
// state.groundItems and an in-progress furnace job (state.smelters) so a
// job renders exactly like the item it started from, see render.ts
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
  const size = Math.max(4, Math.round(TILE * 0.4));
  const ix = sx + (TILE - size) / 2,
    iy = sy + (TILE - size) / 2;
  ctx.fillStyle = colors.secondary;
  ctx.fillRect(ix - 1, iy - 1, size + 2, size + 2);
  ctx.fillStyle = colors.primary;
  ctx.fillRect(ix, iy, size, size);
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
