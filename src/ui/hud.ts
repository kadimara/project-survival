// HUD stat bar, toast messages, and the world-map overlay: DOM refs plus
// pure render/open/close functions.
import type { CarryType, GameState, HudRefs, ItemType } from '../types/types';
import { FOOD_HEAL_AMOUNTS, WORLD_TILE } from '../constants';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} element`);
  return el as T;
}

export function createHudRefs(): HudRefs {
  return {
    statHp: byId('stat-hp'),
    statCarryLeft: byId('stat-carry-left'),
    statCarryRight: byId('stat-carry-right'),
    toastEl: byId('toast'),
    useItemLeftBtn: byId('use-item-left-btn'),
    useItemRightBtn: byId('use-item-right-btn'),

    worldMapOverlay: byId('world-map-overlay'),
    worldMapCloseBtn: byId('world-map-close'),
    mapToggleBtn: byId('map-toggle-btn'),
    worldMapScroll: byId('worldmap-scroll'),

    seedInput: byId<HTMLInputElement>('seed-input'),
    seedLoadBtn: byId('seed-load-btn'),
    seedRandomBtn: byId('seed-random-btn'),
    zoomInBtn: byId('zoom-in-btn'),
    zoomOutBtn: byId('zoom-out-btn'),
  };
}

// shows the "use item" button only for a hand holding something usable
// (i.e. has a FOOD_HEAL_AMOUNTS entry) — holding e.g. a sword now hides the
// button outright rather than showing one that just toasts an error
function updateUseButton(btn: HTMLElement, held: CarryType | null): void {
  const usable = held != null && FOOD_HEAL_AMOUNTS[held as ItemType] != null;
  if (usable) {
    btn.textContent = 'Use item: ' + held;
    btn.style.display = 'flex';
  } else {
    btn.style.display = 'none';
  }
}

export function updateHud(state: GameState, hud: HudRefs): void {
  const { player } = state;
  hud.statHp.textContent = player.hp + '/' + player.maxHp;
  hud.statCarryLeft.textContent = player.heldLeft ?? 'nothing';
  hud.statCarryRight.textContent = player.heldRight ?? 'nothing';
  updateUseButton(hud.useItemLeftBtn, player.heldLeft);
  updateUseButton(hud.useItemRightBtn, player.heldRight);
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;
export function showToast(hud: HudRefs, msg: string): void {
  hud.toastEl.textContent = msg;
  hud.toastEl.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hud.toastEl.classList.remove('show'), 1800);
}

export function setMapOpen(
  state: GameState,
  hud: HudRefs,
  open: boolean,
  renderWorldMap: () => void,
): void {
  state.mapOpen = open;
  hud.worldMapOverlay.style.display = open ? 'flex' : 'none';
  if (open) {
    renderWorldMap();
    // center the scroll view on the player's current position
    const px = state.player.tileX * WORLD_TILE * 2;
    const py = state.player.tileY * WORLD_TILE * 2;
    hud.worldMapScroll.scrollLeft = px - hud.worldMapScroll.clientWidth / 2;
    hud.worldMapScroll.scrollTop = py - hud.worldMapScroll.clientHeight / 2;
  }
}

// drag-to-pan support for the world map (in addition to native scrollbars/trackpad/touch)
export function enableDragPan(el: HTMLElement): void {
  let isDown = false,
    startX = 0,
    startY = 0,
    startLeft = 0,
    startTop = 0;
  el.addEventListener('mousedown', (e) => {
    isDown = true;
    el.classList.add('dragging');
    startX = e.pageX;
    startY = e.pageY;
    startLeft = el.scrollLeft;
    startTop = el.scrollTop;
  });
  window.addEventListener('mouseup', () => {
    isDown = false;
    el.classList.remove('dragging');
  });
  window.addEventListener('mousemove', (e) => {
    if (!isDown) return;
    e.preventDefault();
    el.scrollLeft = startLeft - (e.pageX - startX);
    el.scrollTop = startTop - (e.pageY - startY);
  });
}
