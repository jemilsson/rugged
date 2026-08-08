// Static map data for the 14-room Skeld-style board (matches rugged-core room graph).
// Rooms sit at explicit pixel positions on a large board; corridors are
// computed rectangle segments (straight, or two-segment L-shapes) so every
// segment stays axis-aligned — no diagonal corridors.

import type { RoomName } from './assets';

export interface RoomDef {
  id: RoomName;
  label: string;
  /** Top-left position on the board, in board pixels. */
  x: number;
  y: number;
}

export interface EdgeDef {
  from: RoomName;
  to: RoomName;
}

export interface Tile {
  /** 0-2, 0-2 position within the room's 3x3 walkable grid. */
  x: 0 | 1 | 2;
  y: 0 | 1 | 2;
}

export interface TaskTile extends Tile {
  id: string;
  name: string;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const ROOM_PX = 400;
/** Interior inset from each wall, used for both the walkable collision box and the task/click tile grid. */
export const ROOM_INSET = 40; // 10% of ROOM_PX
export const CORRIDOR_W = 100;
/** How far a corridor rect reaches into its adjoining room's interior, so the two shapes overlap (never just touch). */
const CORRIDOR_OVERLAP = 80; // must exceed ROOM_INSET (40) or a non-walkable band blocks every doorway

export const ROOMS: RoomDef[] = [
  { id: 'poh', label: 'Proof of History', x: 100, y: 600 },
  { id: 'validator', label: 'The Validator Room', x: 550, y: 100 },
  { id: 'compliance', label: 'The Lockup', x: 550, y: 600 },
  { id: 'turbine', label: 'The Printer', x: 550, y: 1100 },
  { id: 'recovery', label: 'The Liquidity Pool', x: 1000, y: 100 },
  { id: 'server', label: 'The RPC Room', x: 1000, y: 1100 },
  { id: 'conference', label: 'The Conference Room', x: 1450, y: 100 },
  { id: 'governance', label: 'The Bridge', x: 1450, y: 600 },
  { id: 'vault', label: 'Cold Storage', x: 1450, y: 1100 },
  { id: 'trading', label: 'The Trading Desk', x: 1900, y: 100 },
  { id: 'airdrop', label: 'The Pumping Station', x: 1900, y: 600 },
  { id: 'firewall', label: 'The Sandwich Bar', x: 1900, y: 1100 },
  { id: 'gulfstream', label: 'The Launchpad', x: 2350, y: 600 },
  { id: 'gossip', label: 'The Gossip Room', x: 2350, y: 1100 },
];

export const BOARD_W = 2350 + ROOM_PX + 150;
export const BOARD_H = 1100 + ROOM_PX + 150;

// Matches rugged-core's adjacency graph.
export const EDGES: EdgeDef[] = [
  { from: 'poh', to: 'validator' },
  { from: 'poh', to: 'turbine' },
  { from: 'validator', to: 'compliance' },
  { from: 'turbine', to: 'compliance' },
  { from: 'compliance', to: 'recovery' },
  { from: 'compliance', to: 'server' },
  { from: 'recovery', to: 'conference' },
  { from: 'server', to: 'vault' },
  { from: 'conference', to: 'governance' },
  { from: 'vault', to: 'governance' },
  { from: 'conference', to: 'trading' },
  { from: 'vault', to: 'firewall' },
  { from: 'governance', to: 'airdrop' },
  { from: 'trading', to: 'airdrop' },
  { from: 'airdrop', to: 'firewall' },
  { from: 'trading', to: 'gulfstream' },
  { from: 'firewall', to: 'gossip' },
  { from: 'airdrop', to: 'gulfstream' },
  { from: 'gulfstream', to: 'gossip' },
];

/** Every 3x3 room interior grid is walkable in the prototype; kept explicit for future per-tile blocking. */
export const ROOM_TILES: Tile[] = [
  { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
  { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 },
  { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 },
];

/** 5 named degen tasks; remaining 9 rooms are taskless for now. */
export const TASK_TILES: Partial<Record<RoomName, TaskTile>> = {
  trading: { id: 'ape', x: 1, y: 1, name: 'Ape in' },
  gossip: { id: 'shill', x: 1, y: 1, name: 'Shill' },
  turbine: { id: 'farm', x: 1, y: 1, name: 'Farm airdrops' },
  poh: { id: 'stake', x: 1, y: 1, name: 'Stake' },
  airdrop: { id: 'pump', x: 1, y: 1, name: 'Pump your coin' },
  gulfstream: { id: 'launch', x: 1, y: 1, name: 'Launch your token' },
};

const roomById = new Map<RoomName, RoomDef>(ROOMS.map((r) => [r.id, r]));

export function roomRect(room: RoomName): Rect {
  const def = roomById.get(room)!;
  return { left: def.x, top: def.y, right: def.x + ROOM_PX, bottom: def.y + ROOM_PX };
}

/** Interior box used for the collision union and the task/click tile grid (inset from the walls). */
export function roomInterior(room: RoomName): Rect {
  const r = roomRect(room);
  return { left: r.left + ROOM_INSET, top: r.top + ROOM_INSET, right: r.right - ROOM_INSET, bottom: r.bottom - ROOM_INSET };
}

export function tileCenter(room: RoomName, tile: Tile): Point {
  const interior = roomInterior(room);
  const size = (interior.right - interior.left) / 3;
  return { x: interior.left + tile.x * size + size / 2, y: interior.top + tile.y * size + size / 2 };
}

function edgeKey(a: RoomName, b: RoomName): string {
  return [a, b].sort().join('-');
}

interface CorridorGeom {
  rects: Rect[];
  /** Waypoints walking from `a` to `b` (the sorted-pair order used as the map key). */
  waypoints: Point[];
}

/** Computes a corridor between two rooms: a single straight rect if they share a row/column band, otherwise a two-segment L (still axis-aligned — no diagonals). */
function computeCorridor(a: RoomName, b: RoomName): CorridorGeom {
  const ra = roomRect(a);
  const rb = roomRect(b);
  const half = CORRIDOR_W / 2;
  const rowOverlap = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
  const colOverlap = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);

  if (rowOverlap >= CORRIDOR_W) {
    const y = (Math.max(ra.top, rb.top) + Math.min(ra.bottom, rb.bottom)) / 2;
    const [left, right] = ra.left < rb.left ? [ra, rb] : [rb, ra];
    const rect: Rect = { left: left.right - CORRIDOR_OVERLAP, right: right.left + CORRIDOR_OVERLAP, top: y - half, bottom: y + half };
    const exitA: Point = { x: ra.left < rb.left ? ra.right : ra.left, y };
    const exitB: Point = { x: ra.left < rb.left ? rb.left : rb.right, y };
    return { rects: [rect], waypoints: ra.left < rb.left ? [exitA, exitB] : [exitB, exitA] };
  }

  if (colOverlap >= CORRIDOR_W) {
    const x = (Math.max(ra.left, rb.left) + Math.min(ra.right, rb.right)) / 2;
    const [top, bottom] = ra.top < rb.top ? [ra, rb] : [rb, ra];
    const rect: Rect = { top: top.bottom - CORRIDOR_OVERLAP, bottom: bottom.top + CORRIDOR_OVERLAP, left: x - half, right: x + half };
    const exitA: Point = { x, y: ra.top < rb.top ? ra.bottom : ra.top };
    const exitB: Point = { x, y: ra.top < rb.top ? rb.top : rb.bottom };
    return { rects: [rect], waypoints: ra.top < rb.top ? [exitA, exitB] : [exitB, exitA] };
  }

  // No shared row/column band: route as an L (horizontal leg out of `a`'s row, then vertical leg into `b`).
  const ca = { x: (ra.left + ra.right) / 2, y: (ra.top + ra.bottom) / 2 };
  const cb = { x: (rb.left + rb.right) / 2, y: (rb.top + rb.bottom) / 2 };
  const corner: Point = { x: cb.x, y: ca.y };
  const aExit: Point = { x: ca.x < cb.x ? ra.right : ra.left, y: ca.y };
  const bEntry: Point = { x: cb.x, y: ca.y < cb.y ? rb.top : rb.bottom };
  const horiz: Rect = {
    top: ca.y - half,
    bottom: ca.y + half,
    left: Math.min(aExit.x, corner.x) - CORRIDOR_OVERLAP,
    right: Math.max(aExit.x, corner.x) + CORRIDOR_OVERLAP,
  };
  const vert: Rect = {
    left: cb.x - half,
    right: cb.x + half,
    top: Math.min(corner.y, bEntry.y) - CORRIDOR_OVERLAP,
    bottom: Math.max(corner.y, bEntry.y) + CORRIDOR_OVERLAP,
  };
  return { rects: [horiz, vert], waypoints: [aExit, corner, bEntry] };
}

const corridorByEdge = new Map<string, CorridorGeom>(EDGES.map((e) => [edgeKey(e.from, e.to), computeCorridor(e.from, e.to)]));

export function corridorRects(): Rect[] {
  return EDGES.flatMap((e) => corridorByEdge.get(edgeKey(e.from, e.to))!.rects);
}

/** Waypoints walking from `from` to `to` (adjacent rooms only), in travel order. */
function corridorWaypoints(from: RoomName, to: RoomName): Point[] {
  const geom = corridorByEdge.get(edgeKey(from, to))!;
  const [sortedA] = [from, to].sort();
  return sortedA === from ? geom.waypoints : [...geom.waypoints].reverse();
}

/** Union of every room's interior box plus every corridor rect: the walkable collision surface. */
export function walkableRects(): Rect[] {
  return [...ROOMS.map((r) => roomInterior(r.id)), ...corridorRects()];
}

export function isAdjacent(a: RoomName, b: RoomName): boolean {
  if (a === b) return true;
  return EDGES.some((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
}

export function neighborsOf(room: RoomName): RoomName[] {
  return EDGES.filter((e) => e.from === room || e.to === room).map((e) => (e.from === room ? e.to : e.from));
}

/** Shortest room-to-room hop sequence via BFS over the adjacency graph, inclusive of both ends. Null if unreachable (shouldn't happen — the graph is connected). */
export function shortestRoomPath(from: RoomName, to: RoomName): RoomName[] | null {
  if (from === to) return [from];
  const visited = new Set<RoomName>([from]);
  const prev = new Map<RoomName, RoomName>();
  const queue: RoomName[] = [from];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const next of neighborsOf(cur)) {
      if (visited.has(next)) continue;
      visited.add(next);
      prev.set(next, cur);
      if (next === to) {
        const path: RoomName[] = [to];
        let node = to;
        while (node !== from) {
          node = prev.get(node)!;
          path.unshift(node);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

/** Full waypoint list to walk from `coin`'s current room to `dest` inside `destRoom`, routed room -> corridor -> room via the corridor waypoints computed above. Null if no route exists. */
export function buildRoutePath(fromRoom: RoomName, destRoom: RoomName, dest: Point): Point[] | null {
  if (fromRoom === destRoom) return [dest];
  const route = shortestRoomPath(fromRoom, destRoom);
  if (!route) return null;
  const waypoints: Point[] = [];
  for (let i = 0; i < route.length - 1; i++) {
    waypoints.push(...corridorWaypoints(route[i], route[i + 1]));
  }
  waypoints.push(dest);
  return waypoints;
}
