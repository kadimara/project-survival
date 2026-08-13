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
import {
  drawFurnaceGlow,
  drawHpBar,
  drawItemIcon,
  drawProjectile,
  drawScatteredDots,
  drawSquareEntity,
  drawSwordIcon,
} from './rendering';

// per-tile pseudo-random phase so several furnaces don't flicker in lockstep
function furnacePhase(x: number, y: number): number {
  return (x * 12.9898 + y * 78.233) % (Math.PI * 2);
}

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

  // the furnace body is baked into the atlas above as plain stone; only
  // its firebox glow is redrawn each frame here so it can flicker
  for (const furnace of state.furnaces.values()) {
    const sx = furnace.x * TILE - camX,
      sy = furnace.y * TILE - camY;
    if (sx < -TILE || sy < -TILE || sx > canvas.width || sy > canvas.height)
      continue;
    drawFurnaceGlow(ctx, TILE, sx, sy, now, furnacePhase(furnace.x, furnace.y));
  }

  for (const step of player.path) {
    const cx = step.x * TILE + TILE / 2 - camX,
      cy = step.y * TILE + TILE / 2 - camY;
    ctx.fillStyle = 'rgba(236,223,196,0.7)';
    ctx.beginPath();
    ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // drawn before groundItems so a seed's scattered dots sit visually
  // "under" the energy square it produces, when both are on the same cell
  for (const seed of state.seeds.values()) {
    const sx = seed.x * TILE - camX,
      sy = seed.y * TILE - camY;
    if (sx < -TILE || sy < -TILE || sx > canvas.width || sy > canvas.height)
      continue;
    drawScatteredDots(ctx, sx, sy, ITEM_DEFS.energySeed.colors.primary);
  }

  // a furnace job mid-timer renders exactly like the item it started
  // from, so the cell reads as "still that item, just working" until it
  // resolves into whatever's left (see systems/smelting.ts)
  for (const smelter of state.smelters.values()) {
    const sx = smelter.x * TILE - camX,
      sy = smelter.y * TILE - camY;
    if (sx < -TILE || sy < -TILE || sx > canvas.width || sy > canvas.height)
      continue;
    drawItemIcon(
      ctx,
      TILE,
      sx,
      sy,
      smelter.item,
      ITEM_DEFS[smelter.item].colors,
    );
  }

  for (const item of state.groundItems.values()) {
    const sx = item.x * TILE - camX,
      sy = item.y * TILE - camY;
    if (sx < -TILE || sy < -TILE || sx > canvas.width || sy > canvas.height)
      continue;
    drawItemIcon(ctx, TILE, sx, sy, item.type, ITEM_DEFS[item.type].colors);
  }

  // in-flight ranged shots: lerp between fire-time and land-time positions
  // by wall-clock progress, same interpolation idea as
  // entities.ts's updateActorAnimation
  for (const p of state.projectiles) {
    const frac = Math.min(
      1,
      Math.max(0, (now - p.spawnAt) / (p.landAt - p.spawnAt)),
    );
    const wx = p.fromPx + (p.toPx - p.fromPx) * frac,
      wy = p.fromPy + (p.toPy - p.fromPy) * frac;
    const sx = wx - camX,
      sy = wy - camY;
    if (sx < -TILE || sy < -TILE || sx > canvas.width || sy > canvas.height)
      continue;
    drawProjectile(ctx, sx, sy, ITEM_DEFS.bow.colors.primary);
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
    drawSquareEntity(
      ctx,
      TILE,
      sx,
      sy,
      PLAYER_COLOR,
      PLAYER_EDGE,
      PLAYER_INSET,
    );
    if (player.flashUntil && now < player.flashUntil) {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(sx + 2, sy + 2, TILE - 4, TILE - 4);
    }
    if (player.held === 'sword') {
      const box = Math.round(TILE * 0.6);
      drawSwordIcon(
        ctx,
        box,
        sx + TILE / 2 - box / 2,
        sy - box,
        ITEM_DEFS.sword.colors,
      );
    } else if (player.held) {
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
