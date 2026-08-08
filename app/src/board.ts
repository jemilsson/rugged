// Local demo board: 4 rooms + corridors, walkable 3x3 tile grids, 4 draggable-by-click
// coins, and a Rug button. No chain calls — this is a client-only prototype for the
// board layout and sprite layering.

import { roomImage } from './assets';
import { audio } from './audio';
import { EDGES, ROOMS, ROOM_TILES, TASK_TILES, isAdjacent, type RoomDef, type Tile } from './map-data';
import { TICKERS, type TickerEntry } from './tickers';
import type { RoomName } from './assets';

const ROOM_PX = 300;
const TILE_PX = ROOM_PX / 3;
const CORRIDOR_PX = 90;
const BOARD_PX = ROOM_PX * 2 + CORRIDOR_PX;

interface Coin {
  id: string;
  ticker: TickerEntry;
  room: RoomName;
  tile: Tile;
  facingLeft: boolean;
  rugged: boolean;
}

const roomById = new Map<RoomName, RoomDef>(ROOMS.map((r) => [r.id, r]));

const coins: Coin[] = [
  { id: 'c0', ticker: TICKERS[0], room: 'turbine', tile: { x: 0, y: 0 }, facingLeft: false, rugged: false },
  { id: 'c1', ticker: TICKERS[1], room: 'gulfstream', tile: { x: 2, y: 0 }, facingLeft: true, rugged: false },
  { id: 'c2', ticker: TICKERS[2], room: 'gossip', tile: { x: 0, y: 2 }, facingLeft: false, rugged: false },
  { id: 'c3', ticker: TICKERS[3], room: 'poh', tile: { x: 2, y: 2 }, facingLeft: true, rugged: false },
];

let selectedCoinId: string = coins[0].id;

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
    .coin-select { display: flex; gap: 6px; }
    .coin-select button.active { outline: 2px solid #fff; }

    .board {
      position: relative;
      width: ${BOARD_PX}px;
      height: ${BOARD_PX}px;
      background: #05060a;
      border-radius: 8px;
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
    .room[data-room="turbine"] { left: 0; top: 0; }
    .room[data-room="gulfstream"] { left: ${ROOM_PX + CORRIDOR_PX}px; top: 0; }
    .room[data-room="gossip"] { left: 0; top: ${ROOM_PX + CORRIDOR_PX}px; }
    .room[data-room="poh"] { left: ${ROOM_PX + CORRIDOR_PX}px; top: ${ROOM_PX + CORRIDOR_PX}px; }

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
    .corridor.h { width: ${CORRIDOR_PX}px; height: 40px; top: ${ROOM_PX / 2 - 20}px; }
    .corridor.v { height: ${CORRIDOR_PX}px; width: 40px; left: ${ROOM_PX / 2 - 20}px; }
    .corridor[data-edge="turbine-gulfstream"] { left: ${ROOM_PX}px; top: ${ROOM_PX / 2 - 20}px; }
    .corridor[data-edge="gossip-poh"] { left: ${ROOM_PX}px; top: ${ROOM_PX + CORRIDOR_PX + ROOM_PX / 2 - 20}px; }
    .corridor[data-edge="turbine-gossip"] { top: ${ROOM_PX}px; left: ${ROOM_PX / 2 - 20}px; }
    .corridor[data-edge="gulfstream-poh"] { top: ${ROOM_PX}px; left: ${ROOM_PX + CORRIDOR_PX + ROOM_PX / 2 - 20}px; }

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
      width: ${TILE_PX * 0.8}px;
      height: ${TILE_PX * 0.8}px;
      transition: left 400ms ease, top 400ms ease;
      pointer-events: none;
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
  `;
  document.head.appendChild(style);
}

function tileTint(index: number): string {
  return `${(index * 90) % 360}deg`;
}

function renderBoard(): HTMLElement {
  const board = document.createElement('div');
  board.className = 'board';

  for (const room of ROOMS) {
    const roomEl = document.createElement('div');
    roomEl.className = 'room';
    roomEl.dataset.room = room.id;
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
      tileEl.style.left = `${tile.x * TILE_PX}px`;
      tileEl.style.top = `${tile.y * TILE_PX}px`;
      tileEl.dataset.room = room.id;
      tileEl.dataset.x = String(tile.x);
      tileEl.dataset.y = String(tile.y);
      if (task.x === tile.x && task.y === tile.y) {
        tileEl.classList.add('task');
        tileEl.dataset.task = task.name;
      }
      tileEl.addEventListener('click', () => onTileClick(room.id, tile));
      roomEl.appendChild(tileEl);
    }

    board.appendChild(roomEl);
  }

  for (const edge of EDGES) {
    const el = document.createElement('div');
    const horizontal = new Set(['turbine-gulfstream', 'gossip-poh']);
    const key = `${edge.from}-${edge.to}`;
    el.className = `corridor ${horizontal.has(key) ? 'h' : 'v'}`;
    el.dataset.edge = key;
    board.appendChild(el);
  }

  for (const coin of coins) {
    board.appendChild(renderCoin(coin));
  }

  return board;
}

function roomOrigin(room: RoomName): { left: number; top: number } {
  const def = roomById.get(room)!;
  return {
    left: def.col === 0 ? 0 : ROOM_PX + CORRIDOR_PX,
    top: def.row === 0 ? 0 : ROOM_PX + CORRIDOR_PX,
  };
}

function coinPosition(coin: Coin): { left: number; top: number } {
  const origin = roomOrigin(coin.room);
  const pad = TILE_PX * 0.1;
  return {
    left: origin.left + coin.tile.x * TILE_PX + pad,
    top: origin.top + coin.tile.y * TILE_PX + pad,
  };
}

function renderCoin(coin: Coin): HTMLElement {
  const el = document.createElement('div');
  el.className = 'coin';
  el.id = `coin-${coin.id}`;
  el.style.setProperty('--tint', tileTint(coins.indexOf(coin)));
  syncCoinPosition(el, coin);

  const body = document.createElement('img');
  body.className = 'coin-body';
  body.src = coin.rugged ? '/img/coin-rugged.png' : '/img/coin-base.png';
  el.appendChild(body);

  const face = document.createElement('img');
  face.className = 'coin-face';
  face.src = coin.ticker.sprite;
  el.appendChild(face);

  const ticker = document.createElement('div');
  ticker.className = 'coin-ticker';
  ticker.textContent = coin.ticker.ticker;
  el.appendChild(ticker);

  el.addEventListener('click', (ev) => {
    ev.stopPropagation();
    selectCoin(coin.id);
  });

  return el;
}

function syncCoinPosition(el: HTMLElement, coin: Coin): void {
  const pos = coinPosition(coin);
  el.style.left = `${pos.left}px`;
  el.style.top = `${pos.top}px`;
  el.classList.toggle('facing-left', coin.facingLeft);
  el.classList.toggle('selected', coin.id === selectedCoinId);
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
  const coin = coins.find((c) => c.id === selectedCoinId);
  if (!coin || coin.rugged) return;
  if (!isAdjacent(coin.room, room)) return;

  const origin = roomOrigin(room);
  const currentOrigin = roomOrigin(coin.room);
  const destLeft = origin.left + tile.x * TILE_PX;
  const currentLeft = currentOrigin.left + coin.tile.x * TILE_PX;
  if (destLeft !== currentLeft) coin.facingLeft = destLeft < currentLeft;

  coin.room = room;
  coin.tile = tile;
  audio.play('step');

  const el = document.getElementById(`coin-${coin.id}`);
  if (el) syncCoinPosition(el, coin);
}

function nearestCoinTo(coin: Coin): Coin | null {
  const others = coins.filter((c) => c.id !== coin.id && !c.rugged);
  if (others.length === 0) return null;
  const sameRoom = others.filter((c) => c.room === coin.room);
  const pool = sameRoom.length > 0 ? sameRoom : others;
  return pool.reduce((best, c) => {
    const d = Math.hypot(c.tile.x - coin.tile.x, c.tile.y - coin.tile.y);
    const bd = Math.hypot(best.tile.x - coin.tile.x, best.tile.y - coin.tile.y);
    return d < bd ? c : best;
  });
}

function rugNearest(): void {
  const selected = coins.find((c) => c.id === selectedCoinId);
  if (!selected) return;
  const target = nearestCoinTo(selected);
  if (!target) return;

  target.rugged = true;
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

  app.appendChild(renderBoard());
}

main();
