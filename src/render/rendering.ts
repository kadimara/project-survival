// Low-level canvas drawing primitives: tiles, obstacles, entity squares, and
// HP bars. Each function only takes the canvas context plus the primitive
// values it needs to draw one thing, so none of it depends on the game's
// entity/state model.
import { DIRT, DIRT2 } from '../worldgen/worldgen';
import { TILE_DEFS } from '../constants';
import type { TileType } from '../types/types';

export const COLORS: Record<number, [string, string]> = {
  [DIRT]: ['#4a331d', '#402c19'],
  [DIRT2]: ['#523823', '#472f1d'],
};

export function drawTile(
  ctx: CanvasRenderingContext2D,
  TILE: number,
  type: number,
  sx: number,
  sy: number,
): void {
  const pair = COLORS[type] || COLORS[DIRT];
  ctx.fillStyle = pair[0];
  ctx.fillRect(sx, sy, TILE, TILE);
  ctx.fillStyle = pair[1];
  ctx.fillRect(sx, sy, TILE / 2, TILE / 2);
  ctx.fillRect(sx + TILE / 2, sy + TILE / 2, TILE / 2, TILE / 2);
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
  [3, 3],
  [12, 4],
  [6, 12],
];

export function drawScatteredDots(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  color: string,
): void {
  ctx.fillStyle = color;
  for (const [ox, oy] of SCATTERED_DOT_OFFSETS) {
    ctx.fillRect(sx + ox, sy + oy, 1, 1);
  }
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
