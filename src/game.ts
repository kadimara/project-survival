// Orchestrator: builds the game state and DOM refs, wires every DOM event
// listener, and drives the tick/render loop. Behavior itself lives in the
// other modules — this file only connects them.
import type { GameRefs, GameState, Hand } from './types/types';
import {
  DEFAULT_ZOOM_INDEX,
  MAP_H,
  MAP_W,
  TICK_MS,
  TILE,
  TOUCH_LONG_PRESS_MS,
  TOUCH_MOVE_CANCEL_PX,
  weaponRange,
  WORLD_TILE,
} from './constants';
import {
  clearAttackTarget,
  createGameState,
  floorAt,
  getHeld,
  isSolid,
  isWater,
  occupantAt,
  regenerateWorld,
  setAttackTarget,
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
import { updateBerryBushes } from './systems/farming';
import { updateCampfireJobs } from './systems/cooking';
import { updateFishingJobs } from './systems/fishing';
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

// shared logic behind both the left-click ('left' hand) and right-click
// ('right' hand) canvas listeners below — same precedence either way:
// enemy > tree > cactus > ctrl-bypass > held-check > pickup-check > walk
// fallback, just scoped to whichever hand initiated the click.
function handleClick(
  state: GameState,
  x: number,
  y: number,
  hand: Hand,
  ctrlKey: boolean,
  walkable: (x: number, y: number) => boolean,
): void {
  const { player } = state;

  // an enemy under the cursor always means attack, whether or not the
  // player is holding something to place/drop, and even with ctrl held —
  // ctrl only suppresses pickup/place, not attacking. 'fish' is excluded
  // deliberately: it's ambient oasis wildlife, never a valid attack target
  // (see ENEMY_DEFS.fish's comment in constants.ts) — a click on one falls
  // through to the branches below instead, same as clicking any other water
  // tile (e.g. resolving as a rod-fishing click if fishingRod is held).
  const enemyHit = state.enemies.find(
    (en) => en.hp > 0 && en.type !== 'fish' && en.tileX === x && en.tileY === y,
  );
  if (enemyHit) {
    setAttackTarget(player, enemyHit, hand);
    player.pendingAction = null;
    player.path = [];
    return;
  }

  // same precedence as an enemy hit above — a tree always means chop it,
  // even over placing a held item on it
  const treeHit = state.trees.get(x + ',' + y);
  if (treeHit) {
    setAttackTarget(player, treeHit, hand);
    player.pendingAction = null;
    player.path = [];
    return;
  }

  // same precedence as a tree hit above — a cactus always means destroy
  // it (for the cactusFruit it drops), even over placing a held item on it
  const cactusHit = state.cacti.get(x + ',' + y);
  if (cactusHit) {
    setAttackTarget(player, cactusHit, hand);
    player.pendingAction = null;
    player.path = [];
    return;
  }

  // holding ctrl forces a plain walk to the clicked tile, bypassing
  // pickup/place so the player can pass through busy areas without
  // interacting with what's there
  if (!ctrlKey) {
    if (getHeld(player, hand)) {
      tryPlaceAt(state, x, y, walkable, hand);
      return;
    }
    if (occupantAt(state, x, y) || floorAt(state, x, y)) {
      trySelectPickup(state, x, y, walkable, hand);
      return;
    }
  }

  const path = computeClickPath(state, x, y, walkable);
  if (path.length) {
    player.pendingAction = null;
    clearAttackTarget(player);
    player.path = path;
  }
}

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
  // confines a 'fish' enemy's wander/chase/flee pathing to the oasis's
  // water — the only place this is enforced (see ENEMY_DEFS.fish's comment
  // in constants.ts); ai.ts's updateEnemy itself needs no changes, since its
  // wander block already gates a candidate target on `walkable(tx,ty)`
  // before pathing to it.
  const waterWalkableFn = (x: number, y: number) =>
    walkableFn(x, y) && isWater(state, x, y);

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

  // ---- use held item, one button per hand ----
  hud.useItemLeftBtn.addEventListener('click', () => {
    state.player.pendingUseLeft = true;
  });
  hud.useItemRightBtn.addEventListener('click', () => {
    state.player.pendingUseRight = true;
  });

  // ---- hover + click on the main canvas ----
  canvas.addEventListener('mousemove', (e) => {
    state.hoveredTile = screenToTile(state, e.clientX, e.clientY);
  });
  canvas.addEventListener('mouseleave', () => {
    state.hoveredTile = null;
  });

  canvas.addEventListener('click', (e) => {
    const { x, y } = screenToTile(state, e.clientX, e.clientY);
    handleClick(state, x, y, 'left', e.ctrlKey, walkableFn);
  });

  // right-click mirrors left-click exactly, scoped to the right hand — the
  // browser's own context menu is suppressed so the click reaches the game
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const { x, y } = screenToTile(state, e.clientX, e.clientY);
    handleClick(state, x, y, 'right', e.ctrlKey, walkableFn);
  });

  // ---- touch: tap mirrors left-click, long-press mirrors right-click ----
  // there's no Ctrl-equivalent modifier on touch, so the walk-bypass path
  // (handleClick's ctrlKey param) is unreachable from touch for now
  let touchStartX = 0;
  let touchStartY = 0;
  let touchMoved = false;
  let longPressFired = false;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;

  const clearLongPressTimer = () => {
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };

  canvas.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      const touch = e.touches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      touchMoved = false;
      longPressFired = false;
      state.hoveredTile = screenToTile(state, touchStartX, touchStartY);

      clearLongPressTimer();
      longPressTimer = setTimeout(() => {
        longPressFired = true;
        const { x, y } = screenToTile(state, touchStartX, touchStartY);
        handleClick(state, x, y, 'right', false, walkableFn);
      }, TOUCH_LONG_PRESS_MS);
    },
    { passive: false },
  );

  canvas.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      if (touchMoved) return;
      const touch = e.touches[0];
      const dx = touch.clientX - touchStartX,
        dy = touch.clientY - touchStartY;
      if (Math.hypot(dx, dy) > TOUCH_MOVE_CANCEL_PX) {
        touchMoved = true;
        clearLongPressTimer();
      }
    },
    { passive: false },
  );

  canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    clearLongPressTimer();
    if (!longPressFired && !touchMoved) {
      const { x, y } = screenToTile(state, touchStartX, touchStartY);
      handleClick(state, x, y, 'left', false, walkableFn);
    }
    state.hoveredTile = null;
  });

  canvas.addEventListener('touchcancel', () => {
    clearLongPressTimer();
    state.hoveredTile = null;
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
    // them the way a pickup/place pendingAction would. Both hands are
    // checked independently so a same-tick left+right use doesn't drop one.
    if (player.pendingUseLeft) {
      useHeldItem(state, hud, 'left');
      player.pendingUseLeft = false;
    }
    if (player.pendingUseRight) {
      useHeldItem(state, hud, 'right');
      player.pendingUseRight = false;
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
      clearAttackTarget(player);
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
          weaponRange(getHeld(player, player.attackHand ?? 'left')),
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
          else clearAttackTarget(player);
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
        if (pa.type === 'pickup') doPickup(state, hud, pa.x, pa.y, pa.hand);
        else doPlace(state, hud, pa.x, pa.y, pa.hand);
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

    updateBerryBushes(state);
    updateSmelters(state);
    updateCampfireJobs(state);
    updateFishingJobs(state);
    updateProjectiles(state, hud, now);
    for (const enemy of state.enemies)
      updateEnemy(
        state,
        hud,
        enemy,
        now,
        enemy.type === 'fish' ? waterWalkableFn : walkableFn,
      );
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
