/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 *
 * Direction bits written into the pathfinder's back-trace grid.
 */
const NORTH = 0x1
const EAST = 0x2
const SOUTH = 0x4
const WEST = 0x8

export const DirectionFlag = {
  NORTH,
  EAST,
  SOUTH,
  WEST,
  SOUTH_WEST: WEST | SOUTH,
  NORTH_WEST: WEST | NORTH,
  SOUTH_EAST: EAST | SOUTH,
  NORTH_EAST: EAST | NORTH,
} as const
export type DirectionFlag = (typeof DirectionFlag)[keyof typeof DirectionFlag]
