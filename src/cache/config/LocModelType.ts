/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 *
 * Loc "shape" ids: how a loc's model is placed on a tile. Stored in the map
 * loc files (attribute byte >> 2) and in LocType.types.
 */
export const LocModelType = {
  WALL: 0,
  WALL_TRI_CORNER: 1,
  WALL_CORNER: 2,
  WALL_RECT_CORNER: 3,

  WALL_DECORATION_INSIDE: 4,
  WALL_DECORATION_OUTSIDE: 5,
  WALL_DECORATION_DIAGONAL_OUTSIDE: 6,
  WALL_DECORATION_DIAGONAL_INSIDE: 7,
  WALL_DECORATION_DIAGONAL_DOUBLE: 8,

  WALL_DIAGONAL: 9,

  NORMAL: 10,
  NORMAL_DIAGONAL: 11,

  ROOF_SLOPED: 12,
  ROOF_SLOPED_OUTER_CORNER: 13,
  ROOF_SLOPED_INNER_CORNER: 14,
  ROOF_SLOPED_HARD_INNER_CORNER: 15,
  ROOF_SLOPED_HARD_OUTER_CORNER: 16,
  ROOF_FLAT: 17,
  ROOF_SLOPED_OVERHANG: 18,
  ROOF_SLOPED_OVERHANG_OUTER_CORNER: 19,
  ROOF_SLOPED_OVERHANG_INNER_CORNER: 20,
  ROOF_SLOPED_OVERHANG_HARD_OUTER_CORNER: 21,

  FLOOR_DECORATION: 22,
} as const
export type LocModelType = (typeof LocModelType)[keyof typeof LocModelType]

export function isWallLocModelType(type: number): boolean {
  return type <= LocModelType.WALL_RECT_CORNER || type === LocModelType.WALL_DIAGONAL
}

export function isWallDecorationLocModelType(type: number): boolean {
  return type >= LocModelType.WALL_DECORATION_INSIDE && type <= LocModelType.WALL_DECORATION_DIAGONAL_DOUBLE
}

export function isRoofLocModelType(type: number): boolean {
  return type >= LocModelType.ROOF_SLOPED && type <= LocModelType.ROOF_SLOPED_OVERHANG_HARD_OUTER_CORNER
}
