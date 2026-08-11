// Orchestrator: builds the game state and DOM refs, wires every DOM event
// listener, and drives the tick/render loop. Behavior itself lives in the
// other modules — this file only connects them.
import type { GameRefs } from './types/types';
import {
  DEFAULT_ZOOM_INDEX,
  MAP_H,
  MAP_W,
  TILE,
  WORLD_TILE,
} from './constants';
import {
  createGameState,
  occupantAt,
  regenerateWorld,
  walkable as stateWalkable,
} from './state/state';
import { loadGame, saveGame } from './state/persistence';
import {
  dirBetween,
  spawnEnemies,
  updateActorAnimation,
} from './entities/entities';
import { applyZoom, fitCanvasDisplaySize, screenToTile } from './render/camera';
import { bfsToAdjacent, isAdjacent } from './systems/pathfinding';
import {
  attemptPlayerAttack,
  computeClickPath,
  handlePlayerAttacked,
  onPlayerArrived,
  tryMove,
  tryPlaceAt,
  tryPlayerStep,
  trySelectPickup,
  useHeldItem,
} from './systems/player-actions';
import { heldDir, setupPlayerInput } from './input/player-input';
import { updateEnemy } from './systems/ai';
import { updateSeeds } from './systems/farming';
import { updateSmelters } from './systems/smelting';
import {
  createHudRefs,
  enableDragPan,
  setMapOpen,
  showToast,
  updateHud,
} from './ui/hud';
import { render, renderWorldMap } from './render/render';

let started = false;

export function initColonyGame(): void {
  if (started) return;
  started = true;

  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const worldCanvas = document.getElementById(
    'worldmap-canvas',
  ) as HTMLCanvasElement;
  const worldCtx = worldCanvas.getContext('2d')!;
  worldCtx.imageSmoothingEnabled = false;

  const groundAtlas = document.createElement('canvas');
  groundAtlas.width = MAP_W * TILE;
  groundAtlas.height = MAP_H * TILE;
  const groundAtlasCtx = groundAtlas.getContext('2d')!;
  groundAtlasCtx.imageSmoothingEnabled = false;

  const refs: GameRefs = {
    canvas,
    ctx,
    worldCanvas,
    worldCtx,
    groundAtlas,
    groundAtlasCtx,
  };
  const loaded = loadGame(refs);
  const state = loaded ?? createGameState(refs, spawnEnemies);
  const hud = createHudRefs();

  worldCanvas.width = MAP_W * WORLD_TILE;
  worldCanvas.height = MAP_H * WORLD_TILE;
  worldCanvas.style.width = worldCanvas.width * 2 + 'px';
  worldCanvas.style.height = worldCanvas.height * 2 + 'px';

  applyZoom(state, loaded ? state.zoomIndex : DEFAULT_ZOOM_INDEX);
  if (loaded) showToast(hud, 'Loaded saved game');

  // ---- autosave: periodic snapshot plus a last-chance save whenever the
  // tab is about to lose focus/close, since beforeunload alone is
  // unreliable on mobile browsers ----
  const AUTOSAVE_MS = 5000;
  setInterval(() => saveGame(state), AUTOSAVE_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveGame(state);
  });
  window.addEventListener('beforeunload', () => saveGame(state));

  // keep the canvas the largest square that fits on screen, no matter how
  // the window is resized or the surrounding HUD text reflows
  const canvasStage = canvas.parentElement?.parentElement;
  if (canvasStage) {
    new ResizeObserver(() => fitCanvasDisplaySize(state)).observe(canvasStage);
  }

  const walkableFn = (x: number, y: number) => stateWalkable(state, x, y);

  // ---- zoom ----
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      applyZoom(state, state.zoomIndex + (e.deltaY < 0 ? -1 : 1));
    },
    { passive: false },
  );
  hud.zoomInBtn.addEventListener('click', () =>
    applyZoom(state, state.zoomIndex - 1),
  );
  hud.zoomOutBtn.addEventListener('click', () =>
    applyZoom(state, state.zoomIndex + 1),
  );

  // ---- player movement input ----
  setupPlayerInput(state);

  // ---- use held item ----
  hud.useItemBtn.addEventListener('click', () => useHeldItem(state, hud));

  // ---- hover + click on the main canvas ----
  canvas.addEventListener('mousemove', (e) => {
    state.hoveredTile = screenToTile(state, e.clientX, e.clientY);
  });
  canvas.addEventListener('mouseleave', () => {
    state.hoveredTile = null;
  });

  canvas.addEventListener('click', (e) => {
    const { player } = state;
    const { x, y } = screenToTile(state, e.clientX, e.clientY);

    if (player.held) {
      tryPlaceAt(state, hud, x, y, walkableFn);
      return;
    }
    if (occupantAt(state, x, y)) {
      trySelectPickup(state, hud, x, y, walkableFn);
      return;
    }
    const enemyHit = state.enemies.find(
      (en) => en.hp > 0 && en.tileX === x && en.tileY === y,
    );
    if (enemyHit) {
      player.attackTarget = enemyHit;
      player.pendingAction = null;
      return;
    }

    const path = computeClickPath(state, x, y, walkableFn);
    if (path.length) {
      player.pendingAction = null;
      player.attackTarget = null;
      player.path = path;
    }
  });

  // ---- world map ----
  enableDragPan(hud.worldMapScroll);
  hud.mapToggleBtn.addEventListener('click', () =>
    setMapOpen(state, hud, !state.mapOpen, () => renderWorldMap(state)),
  );
  hud.worldMapCloseBtn.addEventListener('click', () =>
    setMapOpen(state, hud, false, () => renderWorldMap(state)),
  );

  // ---- seed controls ----
  hud.seedInput.value = String(state.seed);
  hud.seedLoadBtn.addEventListener('click', () => {
    const v = parseInt(hud.seedInput.value, 10);
    if (Number.isFinite(v)) {
      regenerateWorld(state, v, spawnEnemies);
      hud.seedInput.value = String(state.seed);
      updateHud(state, hud);
      saveGame(state);
    }
  });
  hud.seedRandomBtn.addEventListener('click', () => {
    regenerateWorld(state, Math.floor(Math.random() * 1e9), spawnEnemies);
    hud.seedInput.value = String(state.seed);
    updateHud(state, hud);
    saveGame(state);
  });

  // ---- keyboard shortcuts ----
  window.addEventListener('keydown', (e) => {
    if (e.key === '+' || e.key === '=') applyZoom(state, state.zoomIndex - 1);
    if (e.key === '-' || e.key === '_') applyZoom(state, state.zoomIndex + 1);
    if (e.key === 'm' || e.key === 'M')
      setMapOpen(state, hud, !state.mapOpen, () => renderWorldMap(state));
    if (e.key === 'Escape') {
      setMapOpen(state, hud, false, () => renderWorldMap(state));
    }
  });

  // ---- main loop ----
  function tick(now: number): void {
    const { player } = state;
    handlePlayerAttacked(state);
    if (player.moving) {
      updateActorAnimation(player, now);
      if (!player.moving) onPlayerArrived(state, hud);
    } else {
      const dir = heldDir();
      if (dir) {
        player.path = [];
        player.pendingAction = null;
        player.attackTarget = null;
        tryMove(state, hud, dir, walkableFn);
      } else if (player.attackTarget && player.attackTarget.hp > 0) {
        const t = player.attackTarget;
        if (isAdjacent(player.tileX, player.tileY, t.tileX, t.tileY)) {
          player.dir = dirBetween(player.tileX, player.tileY, t.tileX, t.tileY);
          attemptPlayerAttack(state, hud, now);
        } else {
          if (player.path.length === 0) {
            const p = bfsToAdjacent(
              player.tileX,
              player.tileY,
              t.tileX,
              t.tileY,
              walkableFn,
            );
            if (p.length) player.path = p;
            else player.attackTarget = null;
          }
          if (player.path.length) {
            const next = player.path.shift()!;
            const dir = dirBetween(player.tileX, player.tileY, next.x, next.y);
            if (!tryPlayerStep(state, hud, next.x, next.y, dir, walkableFn))
              player.path = [];
          }
        }
      } else if (player.path.length) {
        const next = player.path.shift()!;
        const dir = dirBetween(player.tileX, player.tileY, next.x, next.y);
        if (!tryPlayerStep(state, hud, next.x, next.y, dir, walkableFn))
          player.path = [];
      }
    }

    updateSeeds(state, now);
    updateSmelters(state, now);
    for (const enemy of state.enemies)
      updateEnemy(state, hud, enemy, now, walkableFn);

    render(state, now);
    if (state.mapOpen) renderWorldMap(state);
    requestAnimationFrame(tick);
  }

  updateHud(state, hud);
  requestAnimationFrame(tick);
}
