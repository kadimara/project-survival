// HUD stat bar, toast messages, and the world-map overlay: DOM refs plus
// pure render/open/close functions.
import type { GameState, HudRefs } from '../types/types';
import { WORLD_TILE } from '../constants';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} element`);
  return el as T;
}

export function createHudRefs(): HudRefs {
  return {
    statHp: byId('stat-hp'),
    statCarry: byId('stat-carry'),
    toastEl: byId('toast'),
    useItemBtn: byId('use-item-btn'),

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

export function updateHud(state: GameState, hud: HudRefs): void {
  hud.statHp.textContent = state.player.hp + '/' + state.player.maxHp;
  hud.statCarry.textContent = state.player.held ?? 'nothing';
  if (state.player.held) {
    hud.useItemBtn.textContent = 'Use item: ' + state.player.held;
    hud.useItemBtn.style.display = 'flex';
  } else {
    hud.useItemBtn.style.display = 'none';
  }
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
