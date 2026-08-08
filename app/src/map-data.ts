// Static map data for the four-room board (matches rugged-core room graph).
// Rooms sit in a 2x2 layout; corridors connect adjacent rooms only.

import type { RoomName } from './assets';

export interface RoomDef {
  id: RoomName;
  label: string;
  /** Grid position within the 2x2 room layout. */
  col: 0 | 1;
  row: 0 | 1;
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
  name: string;
}

export const ROOMS: RoomDef[] = [
  { id: 'turbine', label: 'Turbine Room', col: 0, row: 0 },
  { id: 'gulfstream', label: 'Gulfstream', col: 1, row: 0 },
  { id: 'gossip', label: 'Gossip Corner', col: 0, row: 1 },
  { id: 'poh', label: 'Proof of History', col: 1, row: 1 },
];

// Matches rugged-core's adjacency graph.
export const EDGES: EdgeDef[] = [
  { from: 'turbine', to: 'gulfstream' },
  { from: 'turbine', to: 'gossip' },
  { from: 'gulfstream', to: 'poh' },
  { from: 'gossip', to: 'poh' },
];

/** Every 3x3 room grid is walkable in the prototype; kept explicit for future per-tile blocking. */
export const ROOM_TILES: Tile[] = [
  { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 },
  { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 },
  { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 2, y: 2 },
];

export const TASK_TILES: Record<RoomName, TaskTile> = {
  gulfstream: { x: 1, y: 1, name: 'Pump your coin' },
  gossip: { x: 1, y: 1, name: 'Shill' },
  turbine: { x: 1, y: 1, name: 'Farm airdrops' },
  poh: { x: 1, y: 1, name: 'Stake' },
};

export function isAdjacent(a: RoomName, b: RoomName): boolean {
  if (a === b) return true;
  return EDGES.some((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
}

export function neighborsOf(room: RoomName): RoomName[] {
  return EDGES.filter((e) => e.from === room || e.to === room).map((e) => (e.from === room ? e.to : e.from));
}
