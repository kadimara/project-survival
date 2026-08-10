// The main canvas draw loop plus the world-map overview panel. Reads
// GameState and draws it using the low-level primitives in rendering.ts —
// no game logic lives here, only presentation.
import type { GameState, Point } from '../types/types';
import {
  carryColor,
  ITEM_DEFS,
  MAP_H,
  MAP_W,
  PLAYER_COLOR,
  PLAYER_EDGE,
  PLAYER_INSET,
  TILE,
  TILE_DEFS,
  WORLD_TILE,
} from '../constants';
import { getClampedCamX, getClampedCamY } from './camera';
import { tileAt } from '../state/state';
import { drawHpBar, drawSquareEntity } from './rendering';

export function renderWorldMap(state: GameState): void {
  const { worldCanvas, worldCtx } = state.refs;
  worldCtx.fillStyle = '#402c19';
  worldCtx.fillRect(0, 0, worldCanvas.width, worldCanvas.height);
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const type = tileAt(state, x, y);
      worldCtx.fillStyle = type ? TILE_DEFS[type].colors.primary : '#4a331d';
      worldCtx.fillRect(x * WORLD_TILE, y * WORLD_TILE, WORLD_TILE, WORLD_TILE);
    }
  }
  for (const item of state.groundItems.values()) {
    worldCtx.fillStyle = ITEM_DEFS[item.type].colors.primary;
    worldCtx.fillRect(
      item.x * WORLD_TILE,
      item.y * WORLD_TILE,
      WORLD_TILE,
      WORLD_TILE,
    );
  }
  worldCtx.fillStyle = '#8b3fae';
  for (const en of state.enemies) {
    if (en.hp <= 0) continue;
    worldCtx.fillRect(
      en.tileX * WORLD_TILE - 1,
      en.tileY * WORLD_TILE - 1,
      WORLD_TILE + 2,
      WORLD_TILE + 2,
    );
  }
  worldCtx.fillStyle = PLAYER_COLOR;
  worldCtx.fillRect(
    state.player.tileX * WORLD_TILE - 1,
    state.player.tileY * WORLD_TILE - 1,
    WORLD_TILE + 2,
    WORLD_TILE + 2,
  );
}

export function render(state: GameState, now: number): void {
  const { canvas, ctx } = state.refs;
  const { player } = state;
  const camX = getClampedCamX(state),
    camY = getClampedCamY(state);
  ctx.drawImage(
    state.refs.groundAtlas,
    camX,
    camY,
    canvas.width,
    canvas.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  for (const step of player.path) {
    const cx = step.x * TILE + TILE / 2 - camX,
      cy = step.y * TILE + TILE / 2 - camY;
    ctx.fillStyle = 'rgba(236,223,196,0.7)';
    ctx.beginPath();
    ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const item of state.groundItems.values()) {
    const sx = item.x * TILE - camX,
      sy = item.y * TILE - camY;
    if (sx < -TILE || sy < -TILE || sx > canvas.width || sy > canvas.height)
      continue;
    const fullSize = Math.max(4, Math.round(TILE * 0.4));
    const size =
      item.stage === 'small'
        ? Math.max(2, Math.round(fullSize * 0.55))
        : fullSize;
    const ix = sx + (TILE - size) / 2,
      iy = sy + (TILE - size) / 2;
    const { primary, secondary } = ITEM_DEFS[item.type].colors;
    ctx.fillStyle = secondary;
    ctx.fillRect(ix - 1, iy - 1, size + 2, size + 2);
    ctx.fillStyle = primary;
    ctx.fillRect(ix, iy, size, size);
  }

  for (const enemy of state.enemies) {
    const sx = enemy.px - camX,
      sy = enemy.py - camY;
    if (sx < -TILE || sy < -TILE || sx > canvas.width || sy > canvas.height)
      continue;
    drawSquareEntity(ctx, TILE, sx, sy, '#8b3fae', '#43205a', 2);
    if (enemy.flashUntil && now < enemy.flashUntil) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(sx + 2, sy + 2, TILE - 4, TILE - 4);
    }
    if (enemy.hp < enemy.maxHp)
      drawHpBar(ctx, TILE, sx, sy, enemy.hp / enemy.maxHp);
  }

  {
    const sx = player.px - camX,
      sy = player.py - camY;
    if (player.invulnUntil && now < player.invulnUntil) ctx.globalAlpha = 0.55;
    drawSquareEntity(
      ctx,
      TILE,
      sx,
      sy,
      PLAYER_COLOR,
      PLAYER_EDGE,
      PLAYER_INSET,
    );
    ctx.globalAlpha = 1;
    if (player.held) {
      ctx.fillStyle = carryColor(player.held);
      ctx.fillRect(sx + TILE / 2 - 2, sy - 5, 4, 4);
    }
    if (player.hp < player.maxHp)
      drawHpBar(ctx, TILE, sx, sy, player.hp / player.maxHp);
  }

  const hovered: Point | null = state.hoveredTile;
  if (
    hovered &&
    hovered.x >= 0 &&
    hovered.y >= 0 &&
    hovered.x < MAP_W &&
    hovered.y < MAP_H
  ) {
    const hx = hovered.x * TILE - camX,
      hy = hovered.y * TILE - camY;
    const hoveredType = tileAt(state, hovered.x, hovered.y);
    ctx.strokeStyle = hoveredType
      ? TILE_DEFS[hoveredType].colors.primary
      : '#ffffff';
    ctx.lineWidth = 1;
    ctx.strokeRect(hx + 0.5, hy + 0.5, TILE - 1, TILE - 1);
  }

  for (let i = state.floatingTexts.length - 1; i >= 0; i--) {
    const ft = state.floatingTexts[i];
    const age = now - ft.born;
    if (age > 700) {
      state.floatingTexts.splice(i, 1);
      continue;
    }
    const alpha = 1 - age / 700,
      yOff = (age / 700) * 9;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = ft.color;
    ctx.font = 'bold 6px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(ft.text, ft.worldX - camX, ft.worldY - camY - yOff);
    ctx.globalAlpha = 1;
  }

  const grad = ctx.createRadialGradient(
    canvas.width / 2,
    canvas.height / 2,
    canvas.height / 2.2,
    canvas.width / 2,
    canvas.height / 2,
    canvas.height / 1.1,
  );
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}
