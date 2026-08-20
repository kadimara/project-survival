// Pre-rendered full-map ground+stone layer. Painting every visible tile with
// fillRect calls each frame is the dominant cost at far zoom (thousands of
// tiles/frame); instead we paint the whole map once into an offscreen canvas
// and the main render loop blits the visible sub-rect with a single
// drawImage call. Deliberately state-agnostic (plain refs/map/floor/
// obstacles params, not GameState) so state.ts can call into this without
// an import cycle.
//
// The same bake-once/patch/blit idea is reused below at WORLD_TILE
// resolution for the world-map overview panel (buildWorldMapAtlas/
// patchWorldMapAtlasTile) — that panel used to redraw every tile with a
// fillRect loop on every animation frame it was open, which scales with
// map area same as the reasoning above.
import {
  FLOOR_DEFS,
  ITEM_DEFS,
  MAP_H,
  MAP_W,
  OBSTACLE_DEFS,
  TILE,
  WORLD_TILE,
} from '../constants';
import type { FloorType, GameRefs, ObstacleType } from '../types/types';
import {
  COLORS,
  drawBerryBushBody,
  drawCactusBody,
  drawFloorOverlay,
  drawObstacle,
  drawObstacleOverlay,
  drawTile,
  drawTreeTrunk,
} from './rendering';
import { DIRT } from '../worldgen/worldgen';

export function patchGroundAtlasTile(
  refs: GameRefs,
  map: number[][],
  floor: Map<string, FloorType>,
  x: number,
  y: number,
  type: ObstacleType | undefined,
): void {
  const sx = x * TILE,
    sy = y * TILE;
  const ctx = refs.groundAtlasCtx;
  const floorType = floor.get(x + ',' + y);
  if (floorType) {
    // flat, borderless floor fill is the base here — an obstacle sitting on
    // top (drawn next, overlay-only) paints its own bordered square over
    // it, so the floor's flat color still peeks through around the edges
    drawFloorOverlay(ctx, TILE, sx, sy, FLOOR_DEFS[floorType].colors);
    // the furnace body bakes in as plain stone — only its firebox glow is
    // drawn per-frame on top, so it can flicker (see render.ts)
    const obstacleType = type === 'furnace' ? 'stone' : type;
    if (obstacleType === 'tree')
      drawTreeTrunk(ctx, TILE, sx, sy, OBSTACLE_DEFS.tree.colors);
    else if (obstacleType === 'cactus')
      drawCactusBody(
        ctx,
        TILE,
        sx,
        sy,
        OBSTACLE_DEFS.cactus.colors,
        ITEM_DEFS.cactusFruit.colors,
      );
    else if (obstacleType === 'berryBush')
      drawBerryBushBody(ctx, TILE, sx, sy, OBSTACLE_DEFS.berryBush.colors);
    else if (obstacleType)
      drawObstacleOverlay(
        ctx,
        TILE,
        sx,
        sy,
        OBSTACLE_DEFS[obstacleType].colors,
      );
    return;
  }
  if (type === 'furnace') drawObstacle(ctx, TILE, sx, sy, 'stone');
  else if (type === 'tree') {
    drawTile(ctx, TILE, DIRT, sx, sy);
    drawTreeTrunk(ctx, TILE, sx, sy, OBSTACLE_DEFS.tree.colors);
  } else if (type === 'cactus') {
    drawTile(ctx, TILE, DIRT, sx, sy);
    drawCactusBody(
      ctx,
      TILE,
      sx,
      sy,
      OBSTACLE_DEFS.cactus.colors,
      ITEM_DEFS.cactusFruit.colors,
    );
  } else if (type === 'berryBush') {
    // the normal case for a wild bush — world-gen places it on no floor at
    // all (see buildWorldLayers in state/state.ts), so it's inert until
    // picked up and placed on soil; the plain sand/dirt background here
    // keeps the body legible either way
    drawTile(ctx, TILE, DIRT, sx, sy);
    drawBerryBushBody(ctx, TILE, sx, sy, OBSTACLE_DEFS.berryBush.colors);
  } else if (type) drawObstacle(ctx, TILE, sx, sy, type);
  else drawTile(ctx, TILE, map[y][x], sx, sy);
}

export function buildGroundAtlas(
  refs: GameRefs,
  map: number[][],
  floor: Map<string, FloorType>,
  obstacles: Map<string, ObstacleType>,
): void {
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      patchGroundAtlasTile(refs, map, floor, x, y, obstacles.get(x + ',' + y));
    }
  }
}

export function patchWorldMapAtlasTile(
  refs: GameRefs,
  map: number[][],
  floor: Map<string, FloorType>,
  x: number,
  y: number,
  type: ObstacleType | undefined,
): void {
  const ctx = refs.worldAtlasCtx;
  const px = x * WORLD_TILE,
    py = y * WORLD_TILE;
  if (type) {
    ctx.fillStyle = OBSTACLE_DEFS[type].colors.primary;
    ctx.fillRect(px, py, WORLD_TILE, WORLD_TILE);
    return;
  }
  const floorType = floor.get(x + ',' + y);
  if (floorType) {
    ctx.fillStyle = FLOOR_DEFS[floorType].colors.primary;
    ctx.fillRect(px, py, WORLD_TILE, WORLD_TILE);
    return;
  }
  // sand base first, same as drawTile — a translucent background variant
  // (e.g. OASIS, see rendering.ts) blends with it instead of covering it
  // outright, so the minimap shows the same "shallow water over sand" look
  // as the main canvas rather than a flat opaque color
  ctx.fillStyle = COLORS[DIRT][0];
  ctx.fillRect(px, py, WORLD_TILE, WORLD_TILE);
  const bg = map[y][x];
  if (bg !== DIRT) {
    ctx.fillStyle = COLORS[bg]?.[0] ?? COLORS[DIRT][0];
    ctx.fillRect(px, py, WORLD_TILE, WORLD_TILE);
  }
}

export function buildWorldMapAtlas(
  refs: GameRefs,
  map: number[][],
  floor: Map<string, FloorType>,
  obstacles: Map<string, ObstacleType>,
): void {
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      patchWorldMapAtlasTile(
        refs,
        map,
        floor,
        x,
        y,
        obstacles.get(x + ',' + y),
      );
    }
  }
}
