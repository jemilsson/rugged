// Local demo board: 14-room Skeld topology, walkable 3x3 tile grids, smooth
// continuous movement (WASD/arrows + click-to-walk), camera follow, fog of
// war, tasks, rug/report keybinds, and fullscreen. No chain calls — this is
// a client-only prototype for board layout, movement feel, and sprite
// layering.

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
  roomRect,
  tileCenter as mapTileCenter,
  walkableRects,
  type Rect,
  type Tile,
} from './map-data';
import { TICKERS, type TickerEntry } from './tickers';
import type { RoomName } from './assets';

const TILE_PX = (ROOM_PX - 2 * 40) / 3; // matches ROOM_INSET in map-data.ts
const DEFAULT_VIEWPORT_PX = 720;
const COIN_PX = 115;

const SPEED_PX_S = 280;
const FOG_RADIUS = 380;
const CAMERA_LERP = 0.1;
const STEP_SFX_MS = 350;
const WANDER_MIN_MS = 2000;
const WANDER_MAX_MS = 4000;
const ARRIVE_EPS = 2;
const WANDER_FAR_CHANCE = 0.2;

const TASK_HOLD_MS = 3000;
const RUG_RANGE_PX = 120;
const RUG_COOLDOWN_MS = 25000;
const REPORT_RANGE_PX = 150;
const LEGEND_IDLE_MS = 10000;
const RECOGNIZED_KEYS = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'e', 'q', 'r', 'f']);

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

interface TaskDef {
  id: string;
  name: string;
  room: RoomName | null; // null = whitepaper, available anywhere, instant
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

const TASKS: TaskDef[] = [
  ...Object.entries(TASK_TILES).map(([room, t]) => ({ id: t!.id, name: t!.name, room: room as RoomName })),
  { id: 'whitepaper', name: 'Update whitepaper', room: null },
];

let selectedCoinId: string = coins[0].id;
let spectator = false;
const heldKeys = new Set<string>();
const camera: Point = { x: 0, y: 0 };
let lastStepSfxAt = 0;
let boardEl: HTMLElement | null = null;
let viewportEl: HTMLElement | null = null;
let stageEl: HTMLElement | null = null;
let fogEl: HTMLElement | null = null;
let ringEl: HTMLElement | null = null;
let chartEl: SVGSVGElement | null = null;
let legendEl: HTMLElement | null = null;
let taskListEl: HTMLElement | null = null;
let progressBarEl: HTMLElement | null = null;
let winEl: HTMLElement | null = null;
let meetingEl: HTMLElement | null = null;
let rugBtnEl: HTMLButtonElement | null = null;
let fullscreenBtnEl: HTMLButtonElement | null = null;

const tasksDone = new Set<string>();
let holdTaskId: string | null = null;
let holdStartedAt = 0;
let mouseHoldTaskId: string | null = null;
let chartPoints: number[] = [];
let lastChartTickAt = 0;
let lastShillEmoteAt = 0;
let lastRugAt = -Infinity;
let meetingOpen = false;
let lastInputAt = 0;

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
    .toolbar button.active { outline: 2px solid #7cf; }
    .coin-select { display: flex; gap: 6px; }
    .coin-select button.active { outline: 2px solid #fff; }
    .hint { font-size: 12px; color: #8a8ea8; }

    .stage {
      position: relative;
      width: min(${DEFAULT_VIEWPORT_PX}px, 92vw);
    }
    .stage:fullscreen, .stage:-webkit-full-screen {
      width: 100vw;
      height: 100vh;
      background: #05060a;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .stage:fullscreen .viewport, .stage:-webkit-full-screen .viewport {
      width: 96vw;
      height: 96vh;
    }

    .viewport {
      position: relative;
      width: 100%;
      aspect-ratio: 1 / 1;
      max-height: 78vh;
      overflow: hidden;
      border-radius: 8px;
      background: #05060a;
    }
    .viewport.spectator {
      width: ${SPECTATOR_W}px;
      height: ${SPECTATOR_H}px;
      max-width: 100%;
      aspect-ratio: auto;
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
      filter: drop-shadow(0 0 6px var(--tint, #7cf));
      transition: transform 200ms ease;
    }
    .coin.selected .coin-body {
      filter: drop-shadow(0 0 12px var(--tint, #7cf)) drop-shadow(0 0 4px var(--tint, #7cf));
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

    /* --- Task ring + mini chart + emotes --- */
    .task-ring {
      position: absolute;
      width: ${COIN_PX + 30}px;
      height: ${COIN_PX + 30}px;
      border-radius: 50%;
      pointer-events: none;
      z-index: 6;
      display: none;
      background: conic-gradient(#ffe27a var(--pct, 0%), rgba(255,255,255,0.12) 0);
      -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 5px));
      mask: radial-gradient(farthest-side, transparent calc(100% - 5px), #000 calc(100% - 5px));
    }
    .task-ring.active { display: block; }

    .mini-chart {
      position: absolute;
      width: 90px;
      height: 48px;
      background: rgba(5,8,6,0.85);
      border: 1px solid #3ef07a;
      border-radius: 4px;
      pointer-events: none;
      z-index: 7;
      display: none;
    }
    .mini-chart.active { display: block; }

    .shill-emote {
      position: absolute;
      font-size: 18px;
      pointer-events: none;
      z-index: 7;
      animation: emote-float 900ms ease-out forwards;
    }
    @keyframes emote-float {
      from { transform: translate(-50%, 0); opacity: 1; }
      to { transform: translate(-50%, -46px); opacity: 0; }
    }

    /* --- HUD: task list top-left --- */
    .task-hud {
      position: absolute;
      top: 10px; left: 10px;
      z-index: 8;
      background: rgba(8,9,14,0.82);
      border: 1px solid #3a3c50;
      border-radius: 8px;
      padding: 8px 12px;
      font-size: 12px;
      min-width: 168px;
      pointer-events: none;
    }
    .task-hud h3 { margin: 0 0 6px; font-size: 11px; letter-spacing: 0.06em; color: #9aa0c4; text-transform: uppercase; }
    .task-hud ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
    .task-hud li { color: #b8bce0; }
    .task-hud li.done { color: #7effa0; text-decoration: line-through; text-decoration-color: rgba(126,255,160,0.5); }
    .task-hud li .mark { display: inline-block; width: 14px; }

    /* --- Global task progress bar top-center --- */
    .progress-wrap {
      position: absolute;
      top: 10px; left: 50%;
      transform: translateX(-50%);
      z-index: 8;
      width: 46%;
      min-width: 180px;
      pointer-events: none;
    }
    .progress-track {
      height: 10px;
      border-radius: 6px;
      background: rgba(255,255,255,0.08);
      border: 1px solid #3a3c50;
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #3ef07a, #ffe27a);
      width: 0%;
      transition: width 300ms ease;
    }
    .progress-label {
      text-align: center;
      font-size: 10px;
      color: #9aa0c4;
      margin-top: 3px;
    }

    /* --- Win screen --- */
    .win-overlay {
      position: absolute;
      inset: 0;
      z-index: 20;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(4,6,10,0.92);
      text-align: center;
    }
    .win-overlay.active { display: flex; }
    .win-overlay .win-title {
      font-size: 28px;
      font-weight: 800;
      color: #7effa0;
      text-shadow: 0 0 20px rgba(126,255,160,0.6);
      letter-spacing: 0.03em;
    }

    /* --- Meeting overlay --- */
    .meeting-overlay {
      position: absolute;
      inset: 0;
      z-index: 22;
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 18px;
      background: rgba(4,6,10,0.94);
    }
    .meeting-overlay.active { display: flex; }
    .meeting-title { font-size: 20px; font-weight: 700; color: #ff8080; letter-spacing: 0.05em; }
    .portrait-row { display: flex; gap: 14px; flex-wrap: wrap; justify-content: center; max-width: 90%; }
    .portrait {
      width: 64px; height: 64px;
      border-radius: 50%;
      border: 2px solid #4a4e68;
      object-fit: contain;
      background: #12131c;
    }
    .portrait.is-rugged { border-color: #a33; filter: grayscale(1) brightness(0.6); }
    .skip-vote {
      background: #1a1c28;
      color: #e8e8f0;
      border: 1px solid #7cf;
      border-radius: 6px;
      padding: 10px 22px;
      font-size: 14px;
      cursor: pointer;
    }
    .skip-vote:hover { background: #2a2c3c; }

    /* --- Controls legend bottom-left --- */
    .legend {
      position: absolute;
      bottom: 10px; left: 10px;
      z-index: 9;
      background: rgba(4,10,6,0.85);
      border: 1px solid #2f7a4a;
      border-radius: 4px;
      padding: 6px 10px;
      font-family: 'Courier New', monospace;
      font-size: 11px;
      color: #6ef08a;
      text-shadow: 0 0 4px rgba(110,240,138,0.4);
      opacity: 1;
      transition: opacity 600ms ease;
      pointer-events: none;
    }
    .legend.dim { opacity: 0.25; }
    .legend.flash { border-color: #ffe27a; color: #ffe27a; }

    /* --- Action buttons bottom-right --- */
    .action-buttons {
      position: absolute;
      bottom: 10px; right: 10px;
      z-index: 9;
      display: flex;
      gap: 8px;
    }
    .action-btn {
      position: relative;
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: #1a1c28;
      border: 1px solid #3a3c50;
      color: #e8e8f0;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }
    .action-btn .key-hint {
      position: absolute;
      bottom: 2px; right: 4px;
      font-size: 8px;
      color: #8a8ea8;
      font-weight: 400;
    }
    .action-btn.rug { border-color: #a33; color: #ff8080; }
    .action-btn.rug:disabled { color: #6a4a4a; border-color: #4a3232; cursor: not-allowed; }
    .action-btn .cd-ring {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      background: conic-gradient(rgba(0,0,0,0.65) var(--cd, 0%), transparent 0);
      pointer-events: none;
    }
    .action-btn:disabled { opacity: 0.55; }
  `;
  document.head.appendChild(style);
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

// --- Tasks ---

/** The task tile the coin is currently standing on, if any. */
function taskTileAt(coin: Coin): TaskDef | null {
  const tile = TASK_TILES[coin.room];
  if (!tile) return null;
  const r = roomRect(coin.room);
  const cellX = Math.floor((coin.pos.x - r.left - ROOM_INSET) / TILE_PX);
  const cellY = Math.floor((coin.pos.y - r.top - ROOM_INSET) / TILE_PX);
  return cellX === tile.x && cellY === tile.y ? { id: tile.id, name: tile.name, room: coin.room } : null;
}

function completeTask(id: string): void {
  if (tasksDone.has(id)) return;
  tasksDone.add(id);
  audio.play('rug'); // reuse existing sfx as a completion chime (no dedicated asset yet)
  renderTaskHud();
  if (tasksDone.size >= TASKS.length) showWin();
}

function renderTaskHud(): void {
  if (taskListEl) {
    taskListEl.innerHTML = '';
    for (const task of TASKS) {
      const li = document.createElement('li');
      const done = tasksDone.has(task.id);
      li.className = done ? 'done' : '';
      const mark = document.createElement('span');
      mark.className = 'mark';
      mark.textContent = done ? '✓' : '·';
      li.appendChild(mark);
      li.appendChild(document.createTextNode(task.name));
      taskListEl.appendChild(li);
    }
  }
  if (progressBarEl) {
    const pct = Math.round((tasksDone.size / TASKS.length) * 100);
    const fill = progressBarEl.querySelector<HTMLElement>('.progress-fill');
    const label = progressBarEl.querySelector<HTMLElement>('.progress-label');
    if (fill) fill.style.width = `${pct}%`;
    if (label) label.textContent = `Crew tasks ${tasksDone.size}/${TASKS.length}`;
  }
}

function showWin(): void {
  winEl?.classList.add('active');
}

function updateTaskHold(coin: Coin, dt: number, now: number): void {
  if (coin.rugged || meetingOpen) {
    holdTaskId = null;
    if (ringEl) ringEl.classList.remove('active');
    if (chartEl) chartEl.parentElement?.classList.remove('active');
    return;
  }
  const onTile = taskTileAt(coin);
  const eHeld = heldKeys.has('e');
  const activeId = mouseHoldTaskId ?? (eHeld && onTile ? onTile.id : null);

  if (activeId && !tasksDone.has(activeId)) {
    if (holdTaskId !== activeId) {
      holdTaskId = activeId;
      holdStartedAt = now;
      chartPoints = [24];
      lastChartTickAt = now;
    }
    const elapsed = now - holdStartedAt;
    const pct = Math.min(100, (elapsed / TASK_HOLD_MS) * 100);
    if (ringEl) {
      ringEl.classList.add('active');
      ringEl.style.setProperty('--pct', `${pct}%`);
      ringEl.style.left = `${coin.pos.x - (COIN_PX + 30) / 2}px`;
      ringEl.style.top = `${coin.pos.y - (COIN_PX + 30) / 2}px`;
    }
    if (TASK_TILES.trading?.id === activeId) {
      renderMiniChart(coin, now);
    } else if (chartEl) {
      chartEl.parentElement?.classList.remove('active');
    }
    if (TASK_TILES.gossip?.id === activeId && now - lastShillEmoteAt > 250) {
      spawnShillEmote(coin);
      lastShillEmoteAt = now;
    }
    if (elapsed >= TASK_HOLD_MS) {
      completeTask(activeId);
      holdTaskId = null;
      mouseHoldTaskId = null;
      if (ringEl) ringEl.classList.remove('active');
      if (chartEl) chartEl.parentElement?.classList.remove('active');
    }
  } else {
    holdTaskId = null;
    if (ringEl) ringEl.classList.remove('active');
    if (chartEl) chartEl.parentElement?.classList.remove('active');
  }
}

function renderMiniChart(coin: Coin, now: number): void {
  if (!chartEl) return;
  const wrap = chartEl.parentElement;
  if (!wrap) return;
  wrap.classList.add('active');
  wrap.style.left = `${coin.pos.x + COIN_PX / 2 + 6}px`;
  wrap.style.top = `${coin.pos.y - 60}px`;
  if (now - lastChartTickAt > 120) {
    const last = chartPoints[chartPoints.length - 1] ?? 24;
    chartPoints.push(Math.min(46, last + Math.random() * 6));
    if (chartPoints.length > 14) chartPoints.shift();
    lastChartTickAt = now;
  }
  const w = 90;
  const h = 48;
  const step = w / Math.max(1, chartPoints.length - 1);
  const pts = chartPoints.map((v, i) => `${i * step},${h - v}`).join(' ');
  chartEl.innerHTML = `<polyline points="${pts}" fill="none" stroke="#3ef07a" stroke-width="2" /><text x="4" y="12" font-size="9" fill="#3ef07a">📈</text>`;
}

function spawnShillEmote(coin: Coin): void {
  if (!boardEl) return;
  const el = document.createElement('div');
  el.className = 'shill-emote';
  el.textContent = '🚀';
  el.style.left = `${coin.pos.x + (Math.random() * 30 - 15)}px`;
  el.style.top = `${coin.pos.y - COIN_PX / 2}px`;
  boardEl.appendChild(el);
  setTimeout(() => el.remove(), 950);
}

function attemptWhitepaper(coin: Coin): void {
  if (coin.rugged || meetingOpen) return;
  if (taskTileAt(coin)) return; // E on a room task tile drives the hold flow instead
  if (tasksDone.has('whitepaper')) return;
  completeTask('whitepaper');
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
      const isTaskTile = !!task && task.x === tile.x && task.y === tile.y;
      if (isTaskTile) {
        tileEl.classList.add('task');
        tileEl.dataset.task = task!.name;
        tileEl.addEventListener('mousedown', () => {
          const own = ownCoin();
          if (own.room === room.id && taskTileAt(own)?.id === task!.id) mouseHoldTaskId = task!.id;
        });
        const clearHold = () => {
          if (mouseHoldTaskId === task!.id) mouseHoldTaskId = null;
        };
        tileEl.addEventListener('mouseup', clearHold);
        tileEl.addEventListener('mouseleave', clearHold);
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

  ringEl = document.createElement('div');
  ringEl.className = 'task-ring';
  board.appendChild(ringEl);

  const chartWrap = document.createElement('div');
  chartWrap.className = 'mini-chart';
  chartEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
  chartEl.setAttribute('viewBox', '0 0 90 48');
  chartEl.setAttribute('width', '90');
  chartEl.setAttribute('height', '48');
  chartWrap.appendChild(chartEl);
  board.appendChild(chartWrap);

  return board;
}

function renderCoin(coin: Coin): HTMLElement {
  const el = document.createElement('div');
  el.className = 'coin';
  el.id = `coin-${coin.id}`;
  el.style.setProperty('--tint', coin.ticker.color);

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
  if (coin.rugged || meetingOpen) return;
  const dest = tileCenter(room, tile);
  const path = buildPath(coin, room, dest);
  if (!path) return;
  coin.path = path;
}

function nearestCoinTo(coin: Coin, maxRange = Infinity): Coin | null {
  const others = coins.filter((c) => c.id !== coin.id && !c.rugged);
  const inRange = others.filter((c) => Math.hypot(c.pos.x - coin.pos.x, c.pos.y - coin.pos.y) <= maxRange);
  if (inRange.length === 0) return null;
  return inRange.reduce((best, c) => {
    const d = Math.hypot(c.pos.x - coin.pos.x, c.pos.y - coin.pos.y);
    const bd = Math.hypot(best.pos.x - coin.pos.x, best.pos.y - coin.pos.y);
    return d < bd ? c : best;
  });
}

function rugCooldownRemaining(now: number): number {
  return Math.max(0, RUG_COOLDOWN_MS - (now - lastRugAt));
}

function canRug(now: number): { target: Coin | null; ready: boolean } {
  const target = nearestCoinTo(ownCoin(), RUG_RANGE_PX);
  return { target, ready: target !== null && rugCooldownRemaining(now) <= 0 };
}

function attemptRug(now: number): void {
  if (meetingOpen) return;
  const { target, ready } = canRug(now);
  if (!ready || !target) return;

  target.rugged = true;
  target.path = [];
  lastRugAt = now;
  audio.play('rug');
  const el = document.getElementById(`coin-${target.id}`);
  const body = el?.querySelector<HTMLImageElement>('.coin-body');
  if (body) body.src = '/img/coin-rugged.png';
}

function attemptReport(now: number): void {
  if (meetingOpen) return;
  const own = ownCoin();
  const corpse = coins
    .filter((c) => c.rugged)
    .find((c) => Math.hypot(c.pos.x - own.pos.x, c.pos.y - own.pos.y) <= REPORT_RANGE_PX);
  if (!corpse) return;
  void now;
  openMeeting();
}

function openMeeting(): void {
  meetingOpen = true;
  if (!meetingEl) return;
  const row = meetingEl.querySelector<HTMLElement>('.portrait-row');
  if (row) {
    row.innerHTML = '';
    for (const coin of coins) {
      const img = document.createElement('img');
      img.className = `portrait${coin.rugged ? ' is-rugged' : ''}`;
      img.src = coin.rugged ? coin.ticker.sprite.replace('/tokens/', '/tokens/').replace('.png', '-glow.png') : coin.ticker.sprite;
      img.title = coin.ticker.ticker;
      row.appendChild(img);
    }
  }
  meetingEl.classList.add('active');
}

function closeMeeting(): void {
  meetingOpen = false;
  meetingEl?.classList.remove('active');
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

  const musicBtn = document.createElement('button');
  musicBtn.textContent = audio.isMuted() ? 'Music: off' : 'Music: on';
  musicBtn.addEventListener('click', () => {
    const muted = audio.toggleMute();
    if (!muted) audio.music('lobby');
    musicBtn.textContent = muted ? 'Music: off' : 'Music: on';
  });
  toolbarEl.appendChild(musicBtn);

  const hint = document.createElement('span');
  hint.className = 'hint';
  hint.textContent = 'WASD/arrows to walk, click a tile to walk there';
  toolbarEl.appendChild(hint);
}

function toggleSpectator(): void {
  spectator = !spectator;
  viewportEl?.classList.toggle('spectator', spectator);
  fogEl?.classList.toggle('hidden', spectator);
  const btn = document.querySelector<HTMLButtonElement>('.action-btn.spectator');
  btn?.classList.toggle('active', spectator);
}

function toggleFullscreen(): void {
  if (!stageEl) return;
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    stageEl.requestFullscreen().catch(() => {});
  }
}

// --- Action buttons + legend ---

function renderActionButtons(container: HTMLElement): void {
  const wrap = document.createElement('div');
  wrap.className = 'action-buttons';

  const makeBtn = (cls: string, label: string, keyHint: string, onClick: () => void): HTMLButtonElement => {
    const btn = document.createElement('button');
    btn.className = `action-btn ${cls}`;
    btn.type = 'button';
    const ring = document.createElement('div');
    ring.className = 'cd-ring';
    btn.appendChild(ring);
    const text = document.createElement('span');
    text.textContent = label;
    btn.appendChild(text);
    const hint = document.createElement('span');
    hint.className = 'key-hint';
    hint.textContent = keyHint;
    btn.appendChild(hint);
    btn.addEventListener('click', onClick);
    wrap.appendChild(btn);
    return btn;
  };

  makeBtn('task', 'E', 'task', () => attemptWhitepaper(ownCoin()));
  rugBtnEl = makeBtn('rug', 'Q', 'rug', () => attemptRug(performance.now()));
  makeBtn('report', 'R', 'report', () => attemptReport(performance.now()));
  makeBtn('spectator', 'S', 'spectate', toggleSpectator);
  fullscreenBtnEl = makeBtn('fullscreen', 'F', 'full', toggleFullscreen);

  container.appendChild(wrap);
}

function renderLegend(container: HTMLElement): void {
  legendEl = document.createElement('div');
  legendEl.className = 'legend';
  legendEl.textContent = 'WASD move · E task · Q rug · R report · F fullscreen · S spectator';
  container.appendChild(legendEl);
}

function updateLegendIdle(now: number): void {
  if (!legendEl) return;
  legendEl.classList.toggle('dim', now - lastInputAt > LEGEND_IDLE_MS);
}

function updateActionButtons(now: number): void {
  const { target, ready } = canRug(now);
  if (rugBtnEl) {
    rugBtnEl.disabled = !ready;
    const cd = rugCooldownRemaining(now);
    const cdPct = target === null && cd <= 0 ? 0 : (cd / RUG_COOLDOWN_MS) * 100;
    rugBtnEl.style.setProperty('--cd', `${cdPct}%`);
  }
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
  if (meetingOpen) {
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
  if (!viewportEl) return;
  const own = ownCoin();
  const vw = viewportEl.clientWidth || DEFAULT_VIEWPORT_PX;
  const vh = viewportEl.clientHeight || DEFAULT_VIEWPORT_PX;
  const targetX = clamp(own.pos.x - vw / 2, 0, Math.max(0, BOARD_W - vw));
  const targetY = clamp(own.pos.y - vh / 2, 0, Math.max(0, BOARD_H - vh));
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

  updateTaskHold(ownCoin(), dt, ts);
  updateCamera();
  updateFog();
  updateLegendIdle(ts);
  updateActionButtons(ts);

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

  stageEl = document.createElement('div');
  stageEl.className = 'stage';

  viewportEl = document.createElement('div');
  viewportEl.className = 'viewport';
  viewportEl.appendChild(renderBoard());

  fogEl = document.createElement('div');
  fogEl.className = 'fog';
  viewportEl.appendChild(fogEl);

  stageEl.appendChild(viewportEl);

  taskListEl = document.createElement('ul');
  const taskHud = document.createElement('div');
  taskHud.className = 'task-hud';
  const taskHeading = document.createElement('h3');
  taskHeading.textContent = 'Tasks';
  taskHud.appendChild(taskHeading);
  taskHud.appendChild(taskListEl);
  stageEl.appendChild(taskHud);

  progressBarEl = document.createElement('div');
  progressBarEl.className = 'progress-wrap';
  const track = document.createElement('div');
  track.className = 'progress-track';
  const fill = document.createElement('div');
  fill.className = 'progress-fill';
  track.appendChild(fill);
  progressBarEl.appendChild(track);
  const label = document.createElement('div');
  label.className = 'progress-label';
  progressBarEl.appendChild(label);
  stageEl.appendChild(progressBarEl);
  renderTaskHud();

  winEl = document.createElement('div');
  winEl.className = 'win-overlay';
  const winTitle = document.createElement('div');
  winTitle.className = 'win-title';
  winTitle.textContent = 'EPOCH COMPLETE — crew wins';
  winEl.appendChild(winTitle);
  stageEl.appendChild(winEl);

  meetingEl = document.createElement('div');
  meetingEl.className = 'meeting-overlay';
  const meetingTitle = document.createElement('div');
  meetingTitle.className = 'meeting-title';
  meetingTitle.textContent = 'EMERGENCY MEETING';
  meetingEl.appendChild(meetingTitle);
  const portraitRow = document.createElement('div');
  portraitRow.className = 'portrait-row';
  meetingEl.appendChild(portraitRow);
  const skipBtn = document.createElement('button');
  skipBtn.className = 'skip-vote';
  skipBtn.type = 'button';
  skipBtn.textContent = 'SKIP VOTE';
  skipBtn.addEventListener('click', closeMeeting);
  meetingEl.appendChild(skipBtn);
  stageEl.appendChild(meetingEl);

  renderActionButtons(stageEl);
  renderLegend(stageEl);

  app.appendChild(stageEl);

  window.addEventListener('keydown', (ev) => {
    const key = ev.key.toLowerCase();
    lastInputAt = performance.now();
    if (legendEl) {
      if (!RECOGNIZED_KEYS.has(key)) {
        legendEl.classList.add('flash');
        setTimeout(() => legendEl?.classList.remove('flash'), 400);
      }
      legendEl.classList.remove('dim');
    }
    if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'w', 'a', 'd'].includes(key)) {
      heldKeys.add(key);
      ev.preventDefault();
    } else if (key === 'e') {
      heldKeys.add('e');
      if (!ev.repeat) attemptWhitepaper(ownCoin());
      ev.preventDefault();
    } else if (key === 'q') {
      if (!ev.repeat) attemptRug(performance.now());
      ev.preventDefault();
    } else if (key === 'r') {
      if (!ev.repeat) attemptReport(performance.now());
      ev.preventDefault();
    } else if (key === 'f') {
      if (!ev.repeat) toggleFullscreen();
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
