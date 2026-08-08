// Local demo board: 4 rooms + corridors, walkable 3x3 tile grids, smooth
// continuous movement (WASD/arrows + click-to-walk), camera follow, fog of
// war, and a Rug button. No chain calls — this is a client-only prototype
// for the board layout, movement feel, and sprite layering.

import { roomImage } from './assets';
import { audio } from './audio';
import {
  BOARD_H,
  BOARD_W,
  ROOM_INSET,
  ROOMS,
  ROOM_PX,
  ROOM_TILES,
  TASK_TILES,
  buildRoutePath,
  corridorRects,
  isAdjacent,
  neighborsOf,
  roomInterior,
  roomRect,
  tileCenter as mapTileCenter,
  walkableRects,
  type Rect,
  type Tile,
} from './map-data';
import { TICKERS, type TickerEntry } from './tickers';
import type { RoomName } from './assets';

const TILE_PX = (ROOM_PX - 2 * 40) / 3; // matches ROOM_INSET in map-data.ts
const VIEWPORT_PX = 720;
const COIN_PX = TILE_PX * 0.8;

const SPEED_PX_S = 280;
const FOG_RADIUS = 380;
const CAMERA_LERP = 0.1;
const STEP_SFX_MS = 350;
const WANDER_MIN_MS = 2000;
const WANDER_MAX_MS = 4000;
const ARRIVE_EPS = 2;
const WANDER_FAR_CHANCE = 0.2;

// Spectator view fits the whole (large) board into a fixed-size viewport via a scale transform.
const SPECTATOR_MAX_PX = 860;
const SPECTATOR_SCALE = Math.min(SPECTATOR_MAX_PX / BOARD_W, SPECTATOR_MAX_PX / BOARD_H);
const SPECTATOR_W = BOARD_W * SPECTATOR_SCALE;
const SPECTATOR_H = BOARD_H * SPECTATOR_SCALE;

type Point = { x: number; y: number };

interface Coin {
  id: string;
  ticker: TickerEntry;
  room: RoomName;
  pos: Point;
  facingLeft: boolean;
  rugged: boolean;
  path: Point[];
  isBot: boolean;
  nextWanderAt: number;
  moving: boolean;
}

function tileCenter(room: RoomName, tile: Tile): Point {
  return mapTileCenter(room, tile);
}

const coins: Coin[] = [
  { id: 'c0', ticker: TICKERS[0], room: 'conference', pos: tileCenter('conference', { x: 1, y: 1 }), facingLeft: false, rugged: false, path: [], isBot: false, nextWanderAt: 0, moving: false },
  { id: 'c1', ticker: TICKERS[1], room: 'gulfstream', pos: tileCenter('gulfstream', { x: 2, y: 0 }), facingLeft: true, rugged: false, path: [], isBot: true, nextWanderAt: 0, moving: false },
  { id: 'c2', ticker: TICKERS[2], room: 'gossip', pos: tileCenter('gossip', { x: 0, y: 2 }), facingLeft: false, rugged: false, path: [], isBot: true, nextWanderAt: 0, moving: false },
  { id: 'c3', ticker: TICKERS[3], room: 'poh', pos: tileCenter('poh', { x: 2, y: 2 }), facingLeft: true, rugged: false, path: [], isBot: true, nextWanderAt: 0, moving: false },
];

let selectedCoinId: string = coins[0].id;
let spectator = false;
const heldKeys = new Set<string>();
const camera: Point = { x: 0, y: 0 };
let lastStepSfxAt = 0;
let boardEl: HTMLElement | null = null;
let viewportEl: HTMLElement | null = null;
let fogEl: HTMLElement | null = null;

function ownCoin(): Coin {
  return coins.find((c) => c.id === selectedCoinId) ?? coins[0];
}

function injectStyles(): void {
  const style = document.createElement('style');
  style.textContent = `
    :root { color-scheme: dark; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
      padding: 24px;
      background: #0b0d14;
      font-family: system-ui, sans-serif;
      color: #e8e8f0;
    }
    #board-app { display: flex; flex-direction: column; align-items: center; gap: 16px; }
    .toolbar { display: flex; gap: 12px; align-items: center; }
    .toolbar button {
      background: #1a1c28;
      color: #e8e8f0;
      border: 1px solid #3a3c50;
      border-radius: 6px;
      padding: 8px 14px;
      cursor: pointer;
      font-size: 14px;
    }
    .toolbar button:hover { background: #2a2c3c; }
    .toolbar button.rug { border-color: #a33; color: #ff8080; }
    .toolbar button.active { outline: 2px solid #7cf; }
    .coin-select { display: flex; gap: 6px; }
    .coin-select button.active { outline: 2px solid #fff; }
    .hint { font-size: 12px; color: #8a8ea8; }

    .viewport {
      position: relative;
      width: ${VIEWPORT_PX}px;
      height: ${VIEWPORT_PX}px;
      max-width: 100%;
      overflow: hidden;
      border-radius: 8px;
      background: #05060a;
    }
    .viewport.spectator {
      width: ${SPECTATOR_W}px;
      height: ${SPECTATOR_H}px;
    }

    .board {
      position: absolute;
      left: 0;
      top: 0;
      width: ${BOARD_W}px;
      height: ${BOARD_H}px;
      background: #05060a;
      transform-origin: top left;
    }
    .room {
      position: absolute;
      width: ${ROOM_PX}px;
      height: ${ROOM_PX}px;
      background-size: cover;
      background-position: center;
      border: 2px solid #4a4e68;
      border-radius: 10px;
      box-shadow: 0 0 18px rgba(120, 140, 255, 0.25), inset 0 0 30px rgba(0,0,0,0.5);
    }

    .room-label {
      position: absolute;
      top: 4px; left: 8px;
      font-size: 12px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: #cfd2ff;
      text-shadow: 0 1px 3px #000;
      pointer-events: none;
    }

    .corridor {
      position: absolute;
      background: #14161f;
      border: 1px dashed #4a4e68;
    }

    .tile {
      position: absolute;
      width: ${TILE_PX}px;
      height: ${TILE_PX}px;
      background: transparent;
      border: 1px solid rgba(255,255,255,0.06);
      cursor: pointer;
      padding: 0;
    }
    .tile:hover { background: rgba(255,255,255,0.12); }
    .tile.task::after {
      content: attr(data-task);
      position: absolute;
      bottom: 2px;
      left: 2px;
      right: 2px;
      font-size: 8px;
      text-align: center;
      color: #ffe27a;
      text-shadow: 0 1px 2px #000;
      pointer-events: none;
    }
    .tile.task { background: rgba(255, 226, 122, 0.08); }

    .coin {
      position: absolute;
      width: ${COIN_PX}px;
      height: ${COIN_PX}px;
      pointer-events: none;
      opacity: 1;
      transition: opacity 300ms ease;
    }
    .coin-sprite {
      position: absolute;
      inset: 0;
    }
    .coin.walking .coin-sprite {
      animation: walk-bob 300ms ease-in-out infinite alternate;
    }
    @keyframes walk-bob {
      from { transform: translateY(0); }
      to { transform: translateY(-4px); }
    }
    .coin .coin-body {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: contain;
      filter: hue-rotate(var(--tint, 0deg)) saturate(1.4);
      transition: transform 200ms ease;
    }
    .coin .coin-face {
      position: absolute;
      inset: 18%;
      width: 64%;
      height: 64%;
      border-radius: 50%;
      object-fit: cover;
      border: 1px solid rgba(255,255,255,0.6);
      transition: transform 200ms ease;
    }
    .coin .coin-ticker {
      position: absolute;
      bottom: -14px;
      left: 50%;
      transform: translateX(-50%);
      font-size: 9px;
      font-weight: 700;
      color: #fff;
      text-shadow: 0 1px 2px #000;
      white-space: nowrap;
    }
    .coin.facing-left .coin-body { transform: scaleX(-1); }
    .coin.facing-left .coin-face { transform: scaleX(-1); }
    .coin.selected .coin-body { outline: 2px solid #7cf; outline-offset: 2px; }

    .fog {
      position: absolute;
      left: 0; top: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 5;
    }
    .fog.hidden { display: none; }
  `;
  document.head.appendChild(style);
}

function tileTint(index: number): string {
  return `${(index * 90) % 360}deg`;
}

function roomContaining(pos: Point): RoomName | null {
  for (const room of ROOMS) {
    const r = roomRect(room.id);
    if (pos.x >= r.left && pos.x <= r.right && pos.y >= r.top && pos.y <= r.bottom) return room.id;
  }
  return null;
}

function buildPath(coin: Coin, destRoom: RoomName, dest: Point): Point[] | null {
  return buildRoutePath(coin.room, destRoom, dest);
}

// --- Collision: walkable surface = union of room interiors + corridor rects. ---

const WALKABLE = walkableRects();

function insideRect(pos: Point, r: Rect): boolean {
  return pos.x >= r.left && pos.x <= r.right && pos.y >= r.top && pos.y <= r.bottom;
}

function isWalkable(pos: Point): boolean {
  return WALKABLE.some((r) => insideRect(pos, r));
}

/** Clamps a move onto the walkable surface: full move if walkable, else slide per-axis (try x-only, then y-only), else stay put. */
function clampToWalkable(from: Point, to: Point): Point {
  if (isWalkable(to)) return to;
  const xOnly: Point = { x: to.x, y: from.y };
  if (isWalkable(xOnly)) return xOnly;
  const yOnly: Point = { x: from.x, y: to.y };
  if (isWalkable(yOnly)) return yOnly;
  return from;
}

function renderBoard(): HTMLElement {
  const board = document.createElement('div');
  board.className = 'board';
  boardEl = board;

  for (const room of ROOMS) {
    const roomEl = document.createElement('div');
    roomEl.className = 'room';
    roomEl.dataset.room = room.id;
    roomEl.style.left = `${room.x}px`;
    roomEl.style.top = `${room.y}px`;
    roomEl.style.backgroundImage = `url(${roomImage(room.id)})`;

    const label = document.createElement('div');
    label.className = 'room-label';
    label.textContent = room.label;
    roomEl.appendChild(label);

    const task = TASK_TILES[room.id];
    for (const tile of ROOM_TILES) {
      const tileEl = document.createElement('button');
      tileEl.className = 'tile';
      tileEl.type = 'button';
      tileEl.style.left = `${ROOM_INSET + tile.x * TILE_PX}px`;
      tileEl.style.top = `${ROOM_INSET + tile.y * TILE_PX}px`;
      tileEl.dataset.room = room.id;
      tileEl.dataset.x = String(tile.x);
      tileEl.dataset.y = String(tile.y);
      if (task && task.x === tile.x && task.y === tile.y) {
        tileEl.classList.add('task');
        tileEl.dataset.task = task.name;
      }
      tileEl.addEventListener('click', () => onTileClick(room.id, tile));
      roomEl.appendChild(tileEl);
    }

    board.appendChild(roomEl);
  }

  for (const rect of corridorRects()) {
    const el = document.createElement('div');
    el.className = 'corridor';
    el.style.left = `${rect.left}px`;
    el.style.top = `${rect.top}px`;
    el.style.width = `${rect.right - rect.left}px`;
    el.style.height = `${rect.bottom - rect.top}px`;
    board.appendChild(el);
  }

  for (const coin of coins) {
    board.appendChild(renderCoin(coin));
  }

  return board;
}

function renderCoin(coin: Coin): HTMLElement {
  const el = document.createElement('div');
  el.className = 'coin';
  el.id = `coin-${coin.id}`;
  el.style.setProperty('--tint', tileTint(coins.indexOf(coin)));

  const sprite = document.createElement('div');
  sprite.className = 'coin-sprite';

  const body = document.createElement('img');
  body.className = 'coin-body';
  body.src = coin.rugged ? '/img/coin-rugged.png' : '/img/coin-base.png';
  sprite.appendChild(body);

  const face = document.createElement('img');
  face.className = 'coin-face';
  face.src = coin.ticker.sprite;
  sprite.appendChild(face);

  el.appendChild(sprite);

  const ticker = document.createElement('div');
  ticker.className = 'coin-ticker';
  ticker.textContent = coin.ticker.ticker;
  el.appendChild(ticker);

  el.addEventListener('click', (ev) => {
    ev.stopPropagation();
    selectCoin(coin.id);
  });

  syncCoinPosition(el, coin);
  return el;
}

function syncCoinPosition(el: HTMLElement, coin: Coin): void {
  el.style.left = `${coin.pos.x - COIN_PX / 2}px`;
  el.style.top = `${coin.pos.y - COIN_PX / 2}px`;
  el.classList.toggle('facing-left', coin.facingLeft);
  el.classList.toggle('selected', coin.id === selectedCoinId);
  el.classList.toggle('walking', coin.moving);
}

function selectCoin(id: string): void {
  selectedCoinId = id;
  for (const coin of coins) {
    const el = document.getElementById(`coin-${coin.id}`);
    if (el) el.classList.toggle('selected', coin.id === id);
  }
  renderToolbar();
}

function onTileClick(room: RoomName, tile: Tile): void {
  const coin = ownCoin();
  if (coin.rugged) return;
  const dest = tileCenter(room, tile);
  const path = buildPath(coin, room, dest);
  if (!path) return;
  coin.path = path;
}

function nearestCoinTo(coin: Coin): Coin | null {
  const others = coins.filter((c) => c.id !== coin.id && !c.rugged);
  if (others.length === 0) return null;
  const sameRoom = others.filter((c) => c.room === coin.room);
  const pool = sameRoom.length > 0 ? sameRoom : others;
  return pool.reduce((best, c) => {
    const d = Math.hypot(c.pos.x - coin.pos.x, c.pos.y - coin.pos.y);
    const bd = Math.hypot(best.pos.x - coin.pos.x, best.pos.y - coin.pos.y);
    return d < bd ? c : best;
  });
}

function rugNearest(): void {
  const selected = ownCoin();
  const target = nearestCoinTo(selected);
  if (!target) return;

  target.rugged = true;
  target.path = [];
  audio.play('rug');
  const el = document.getElementById(`coin-${target.id}`);
  const body = el?.querySelector<HTMLImageElement>('.coin-body');
  if (body) body.src = '/img/coin-rugged.png';
}

let toolbarEl: HTMLElement | null = null;

function renderToolbar(): void {
  if (!toolbarEl) return;
  toolbarEl.innerHTML = '';

  const select = document.createElement('div');
  select.className = 'coin-select';
  for (const coin of coins) {
    const btn = document.createElement('button');
    btn.textContent = coin.ticker.ticker;
    btn.className = coin.id === selectedCoinId ? 'active' : '';
    btn.disabled = coin.rugged;
    btn.addEventListener('click', () => selectCoin(coin.id));
    select.appendChild(btn);
  }
  toolbarEl.appendChild(select);

  const rugBtn = document.createElement('button');
  rugBtn.className = 'rug';
  rugBtn.textContent = 'Rug';
  rugBtn.addEventListener('click', rugNearest);
  toolbarEl.appendChild(rugBtn);

  const musicBtn = document.createElement('button');
  musicBtn.textContent = audio.isMuted() ? 'Music: off' : 'Music: on';
  musicBtn.addEventListener('click', () => {
    const muted = audio.toggleMute();
    if (!muted) audio.music('lobby');
    musicBtn.textContent = muted ? 'Music: off' : 'Music: on';
  });
  toolbarEl.appendChild(musicBtn);

  const spectatorBtn = document.createElement('button');
  spectatorBtn.className = spectator ? 'active' : '';
  spectatorBtn.textContent = 'Spectator (S)';
  spectatorBtn.addEventListener('click', toggleSpectator);
  toolbarEl.appendChild(spectatorBtn);

  const hint = document.createElement('span');
  hint.className = 'hint';
  hint.textContent = 'WASD/arrows to walk, click a tile to walk there';
  toolbarEl.appendChild(hint);
}

function toggleSpectator(): void {
  spectator = !spectator;
  viewportEl?.classList.toggle('spectator', spectator);
  fogEl?.classList.toggle('hidden', spectator);
  renderToolbar();
}

// --- Movement ---

// Note: 's' is reserved for the spectator toggle, so down-movement is
// arrow-key only; w/a/d cover the other three WASD directions.
function keyDirection(): Point {
  let dx = 0;
  let dy = 0;
  if (heldKeys.has('arrowleft') || heldKeys.has('a')) dx -= 1;
  if (heldKeys.has('arrowright') || heldKeys.has('d')) dx += 1;
  if (heldKeys.has('arrowup') || heldKeys.has('w')) dy -= 1;
  if (heldKeys.has('arrowdown')) dy += 1;
  if (dx === 0 && dy === 0) return { x: 0, y: 0 };
  const len = Math.hypot(dx, dy);
  return { x: dx / len, y: dy / len };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

function stepAlongPath(coin: Coin, distance: number): boolean {
  let remaining = distance;
  let moved = false;
  while (remaining > 0 && coin.path.length > 0) {
    const target = coin.path[0];
    const dx = target.x - coin.pos.x;
    const dy = target.y - coin.pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= ARRIVE_EPS) {
      coin.pos = { ...target };
      coin.path.shift();
      continue;
    }
    if (dist <= remaining) {
      coin.pos = { ...target };
      coin.path.shift();
      remaining -= dist;
      moved = true;
    } else {
      if (dx !== 0) coin.facingLeft = dx < 0;
      coin.pos = { x: coin.pos.x + (dx / dist) * remaining, y: coin.pos.y + (dy / dist) * remaining };
      remaining = 0;
      moved = true;
    }
  }
  return moved;
}

function scheduleWander(coin: Coin, now: number): void {
  coin.nextWanderAt = now + WANDER_MIN_MS + Math.random() * (WANDER_MAX_MS - WANDER_MIN_MS);
}

function updateBot(coin: Coin, now: number): void {
  if (coin.rugged) return;
  if (coin.path.length === 0 && now >= coin.nextWanderAt) {
    // Mostly bias to the current/adjacent rooms; occasionally roam anywhere on the 14-room map.
    const candidates: RoomName[] = Math.random() < WANDER_FAR_CHANCE ? ROOMS.map((r) => r.id) : [coin.room, ...neighborsOf(coin.room)];
    const destRoom = candidates[Math.floor(Math.random() * candidates.length)];
    const tile = ROOM_TILES[Math.floor(Math.random() * ROOM_TILES.length)];
    const dest = tileCenter(destRoom, tile);
    const path = buildPath(coin, destRoom, dest);
    if (path) coin.path = path;
    scheduleWander(coin, now);
  }
}

function updateCoin(coin: Coin, dt: number, now: number, isOwn: boolean): void {
  if (coin.rugged) {
    coin.moving = false;
    return;
  }

  let moved = false;
  const distance = SPEED_PX_S * dt;

  if (isOwn) {
    const dir = keyDirection();
    if (dir.x !== 0 || dir.y !== 0) {
      coin.path = [];
      if (dir.x !== 0) coin.facingLeft = dir.x < 0;
      const attempted: Point = { x: coin.pos.x + dir.x * distance, y: coin.pos.y + dir.y * distance };
      const next = clampToWalkable(coin.pos, attempted);
      moved = next.x !== coin.pos.x || next.y !== coin.pos.y;
      coin.pos = next;
    } else if (coin.path.length > 0) {
      moved = stepAlongPath(coin, distance);
    }
  } else {
    updateBot(coin, now);
    if (coin.path.length > 0) moved = stepAlongPath(coin, distance);
  }

  coin.moving = moved;
  const containingRoom = roomContaining(coin.pos);
  if (containingRoom) coin.room = containingRoom;

  if (isOwn && moved && now - lastStepSfxAt > STEP_SFX_MS) {
    audio.play('step');
    lastStepSfxAt = now;
  }
}

function updateCamera(): void {
  const own = ownCoin();
  const targetX = clamp(own.pos.x - VIEWPORT_PX / 2, 0, Math.max(0, BOARD_W - VIEWPORT_PX));
  const targetY = clamp(own.pos.y - VIEWPORT_PX / 2, 0, Math.max(0, BOARD_H - VIEWPORT_PX));
  if (spectator) {
    camera.x = 0;
    camera.y = 0;
    if (boardEl) boardEl.style.transform = `scale(${SPECTATOR_SCALE})`;
  } else {
    camera.x += (targetX - camera.x) * CAMERA_LERP;
    camera.y += (targetY - camera.y) * CAMERA_LERP;
    if (boardEl) boardEl.style.transform = `translate(${-camera.x}px, ${-camera.y}px)`;
  }
}

function updateFog(): void {
  const own = ownCoin();
  if (spectator) {
    for (const coin of coins) {
      const el = document.getElementById(`coin-${coin.id}`);
      if (el) el.style.opacity = '1';
    }
    return;
  }
  const screenX = own.pos.x - camera.x;
  const screenY = own.pos.y - camera.y;
  if (fogEl) {
    fogEl.style.background = `radial-gradient(${FOG_RADIUS}px circle at ${screenX}px ${screenY}px, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 40%, rgba(3,4,8,0.6) 72%, rgba(2,3,7,0.97) 100%)`;
  }
  for (const coin of coins) {
    const el = document.getElementById(`coin-${coin.id}`);
    if (!el) continue;
    if (coin.id === own.id) {
      el.style.opacity = '1';
      continue;
    }
    const dist = Math.hypot(coin.pos.x - own.pos.x, coin.pos.y - own.pos.y);
    const visible = dist <= FOG_RADIUS && isAdjacent(own.room, coin.room);
    el.style.opacity = visible ? '1' : '0';
  }
}

let lastFrame: number | null = null;

function frame(ts: number): void {
  if (lastFrame === null) lastFrame = ts;
  const dt = Math.min((ts - lastFrame) / 1000, 0.1);
  lastFrame = ts;

  for (const coin of coins) {
    updateCoin(coin, dt, ts, coin.id === selectedCoinId);
    const el = document.getElementById(`coin-${coin.id}`);
    if (el) syncCoinPosition(el, coin);
  }

  updateCamera();
  updateFog();

  requestAnimationFrame(frame);
}

function main(): void {
  injectStyles();
  audio.preload();

  const app = document.getElementById('board-app');
  if (!app) return;

  toolbarEl = document.createElement('div');
  toolbarEl.className = 'toolbar';
  app.appendChild(toolbarEl);
  renderToolbar();

  viewportEl = document.createElement('div');
  viewportEl.className = 'viewport';
  viewportEl.appendChild(renderBoard());

  fogEl = document.createElement('div');
  fogEl.className = 'fog';
  viewportEl.appendChild(fogEl);

  app.appendChild(viewportEl);

  window.addEventListener('keydown', (ev) => {
    const key = ev.key.toLowerCase();
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'w', 'a', 'd'].includes(key)) {
      heldKeys.add(key);
      ev.preventDefault();
    } else if (key === 's') {
      if (!ev.repeat) toggleSpectator();
      ev.preventDefault();
    }
  });
  window.addEventListener('keyup', (ev) => {
    heldKeys.delete(ev.key.toLowerCase());
  });

  const now = performance.now();
  for (const coin of coins) if (coin.isBot) scheduleWander(coin, now);

  requestAnimationFrame(frame);
}

main();
