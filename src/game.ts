// Orchestrator: builds the game state and DOM refs, wires every DOM event
// listener, and drives the tick/render loop. Behavior itself lives in the
// other modules — this file only connects them.
import type { GameRefs } from './types/types';
import {
  DEFAULT_ZOOM_INDEX,
  MAP_H,
  MAP_W,
  TICK_MS,
  TILE,
  weaponRange,
  WORLD_TILE,
} from './constants';
import {
  createGameState,
  isSolid,
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
import { bfsToAdjacent, inRange, isAdjacent } from './systems/pathfinding';
import {
  attemptPlayerAttack,
  computeClickPath,
  doPickup,
  doPlace,
  handlePlayerAttacked,
  tryMove,
  tryPlaceAt,
  tryPlayerStep,
  trySelectPickup,
  useHeldItem,
} from './systems/player-actions';
import { heldDir, setupPlayerInput } from './input/player-input';
import { updateEnemy } from './systems/ai';
import { updateProjectiles } from './systems/combat';
import { updateSeeds } from './systems/farming';
import { updateSmelters } from './systems/smelting';
import { createTickClock, drainTicks } from './systems/ticker';
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

  const worldAtlas = document.createElement('canvas');
  worldAtlas.width = MAP_W * WORLD_TILE;
  worldAtlas.height = MAP_H * WORLD_TILE;
  const worldAtlasCtx = worldAtlas.getContext('2d')!;
  worldAtlasCtx.imageSmoothingEnabled = false;

  const refs: GameRefs = {
    canvas,
    ctx,
    worldCanvas,
    worldCtx,
    groundAtlas,
    groundAtlasCtx,
    worldAtlas,
    worldAtlasCtx,
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
  hud.useItemBtn.addEventListener('click', () => {
    state.player.pendingUse = true;
  });

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

    // an enemy under the cursor always means attack, whether or not the
    // player is holding something to place/drop, and even with ctrl held —
    // ctrl only suppresses pickup/place, not attacking
    const enemyHit = state.enemies.find(
      (en) => en.hp > 0 && en.tileX === x && en.tileY === y,
    );
    if (enemyHit) {
      player.attackTarget = enemyHit;
      player.pendingAction = null;
      player.path = [];
      return;
    }

    // holding ctrl forces a plain walk to the clicked tile, bypassing
    // pickup/place so the player can pass through busy areas without
    // interacting with what's there
    if (!e.ctrlKey) {
      if (player.held) {
        tryPlaceAt(state, x, y, walkableFn);
        return;
      }
      if (occupantAt(state, x, y)) {
        trySelectPickup(state, x, y, walkableFn);
        return;
      }
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
  // Simulation (movement/attack/AI decisions) resolves on a fixed tick,
  // OSRS-style; rendering still runs every animation frame and interpolates
  // smoothly between tick states via updateActorAnimation. How many ticks
  // are due each frame is worked out by systems/ticker.ts's drainTicks — a
  // pure function kept separate from this DOM-wired loop specifically so
  // the pacing algorithm itself has unit test coverage (see ticker.test.ts).
  const clock = createTickClock();

  // Runs one tick's worth of decisions unconditionally — tileX/tileY update
  // instantly at step-start (see entities.ts's startStep), so a tick is free
  // to act even if the previous tick's step is still visually animating;
  // `moving` only gates the cosmetic tween in frame() below. This matters
  // when a frame hitch lets the accumulator drain more than one tick at
  // once: gating on `moving` here would silently waste every tick after the
  // first in that drain, since the animation flag has no chance to reset
  // mid-drain (it's only updated once per frame, after the loop).
  function simulateTick(now: number): void {
    state.tick++;
    const { player } = state;
    handlePlayerAttacked(state);
    // resolved unconditionally, every tick, independent of the
    // movement/attack/pendingAction chain below — using an item (e.g.
    // healing) must work even mid-chase or mid-attack, not get starved by
    // them the way a pickup/place pendingAction would
    if (player.pendingUse) {
      useHeldItem(state, hud);
      player.pendingUse = false;
    }
    // stepping onto water leaves the player unable to move again for a few
    // extra ticks (see Player.nextMoveAt in types.ts, set by tryPlayerStep)
    // — every path-consuming branch below only shifts a step off
    // player.path once it knows the step will actually be taken, so a tick
    // that's still on cooldown leaves the path untouched instead of
    // silently dropping the queued step
    const canStepNow = state.tick >= player.nextMoveAt;
    const dir = heldDir();
    if (dir) {
      player.path = [];
      player.pendingAction = null;
      player.attackTarget = null;
      if (canStepNow) tryMove(state, hud, dir, walkableFn);
    } else if (player.attackTarget && player.attackTarget.hp > 0) {
      const t = player.attackTarget;
      // a ranged weapon (weaponRange > 1, see WEAPON_DEFS in constants.ts)
      // can attack without closing to adjacency — inRange checks distance
      // plus, beyond melee's exact range of 1, line of sight, so the player
      // naturally stops advancing (see the bfsToAdjacent branch below) the
      // moment a shot is possible instead of always walking all the way up
      if (
        inRange(
          player.tileX,
          player.tileY,
          t.tileX,
          t.tileY,
          weaponRange(player.held),
          (x, y) => isSolid(state, x, y),
        )
      ) {
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
        if (player.path.length && canStepNow) {
          const next = player.path[0];
          const dir = dirBetween(player.tileX, player.tileY, next.x, next.y);
          if (tryPlayerStep(state, hud, next.x, next.y, dir, walkableFn))
            player.path.shift();
          else player.path = [];
        }
      }
    } else if (player.pendingAction) {
      // click-to-pickup/place: same shape as the attack-chase branch above —
      // adjacent already means resolve now, otherwise take one step toward
      // it and let a later tick re-check adjacency. The path itself was
      // already computed once, at click time (see trySelectPickup/
      // tryPlaceAt), since the target tile doesn't move.
      const pa = player.pendingAction;
      if (isAdjacent(player.tileX, player.tileY, pa.x, pa.y)) {
        if (pa.type === 'pickup') doPickup(state, hud, pa.x, pa.y);
        else doPlace(state, hud, pa.x, pa.y);
        player.pendingAction = null;
      } else if (player.path.length) {
        if (canStepNow) {
          const next = player.path[0];
          const dir = dirBetween(player.tileX, player.tileY, next.x, next.y);
          if (tryPlayerStep(state, hud, next.x, next.y, dir, walkableFn))
            player.path.shift();
          else player.path = [];
        }
      } else {
        // path exhausted without ever reaching adjacency — give up quietly
        player.pendingAction = null;
      }
    } else if (player.path.length && canStepNow) {
      const next = player.path[0];
      const dir = dirBetween(player.tileX, player.tileY, next.x, next.y);
      if (tryPlayerStep(state, hud, next.x, next.y, dir, walkableFn))
        player.path.shift();
      else player.path = [];
    }

    updateSeeds(state);
    updateSmelters(state);
    updateProjectiles(state, hud, now);
    for (const enemy of state.enemies)
      updateEnemy(state, hud, enemy, now, walkableFn);
  }

  function frame(now: number): void {
    const ticksDue = drainTicks(clock, now, TICK_MS);
    for (let i = 0; i < ticksDue; i++) simulateTick(now);

    const { player } = state;
    if (player.moving) updateActorAnimation(player, now);
    for (const enemy of state.enemies)
      if (enemy.moving) updateActorAnimation(enemy, now);

    render(state, now);
    if (state.mapOpen) renderWorldMap(state);
    requestAnimationFrame(frame);
  }

  updateHud(state, hud);
  requestAnimationFrame(frame);
}
