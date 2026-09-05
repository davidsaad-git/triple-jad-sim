/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 *
 * The 23 loc placement types stored in the map loc file (attributes >> 2).
 */
export const LocModelType = {
  Wall: 0,
  WallTriCorner: 1,
  WallCorner: 2,
  WallRectCorner: 3,

  WallDecorationInside: 4,
  WallDecorationOutside: 5,
  WallDecorationDiagonalOutside: 6,
  WallDecorationDiagonalInside: 7,
  WallDecorationDiagonalDouble: 8,

  WallDiagonal: 9,

  Normal: 10,
  NormalDiagonal: 11,

  RoofSloped: 12,
  RoofSlopedOuterCorner: 13,
  RoofSlopedInnerCorner: 14,
  RoofSlopedHardInnerCorner: 15,
  RoofSlopedHardOuterCorner: 16,
  RoofFlat: 17,
  RoofSlopedOverhang: 18,
  RoofSlopedOverhangOuterCorner: 19,
  RoofSlopedOverhangInnerCorner: 20,
  RoofSlopedOverhangHardOuterCorner: 21,

  FloorDecoration: 22,
} as const
export type LocModelType = (typeof LocModelType)[keyof typeof LocModelType]

/** Coarse classification of a loc type, used by the scene to pick a slot on the tile. */
export const LocKind = {
  Wall: 'wall',
  WallDecoration: 'wallDecoration',
  Loc: 'loc',
  Roof: 'roof',
  FloorDecoration: 'floorDecoration',
} as const
export type LocKind = (typeof LocKind)[keyof typeof LocKind]

export function locKind(type: number): LocKind {
  if (type <= LocModelType.WallRectCorner) return LocKind.Wall
  if (type <= LocModelType.WallDecorationDiagonalDouble) return LocKind.WallDecoration
  if (type === LocModelType.WallDiagonal || type === LocModelType.Normal || type === LocModelType.NormalDiagonal) {
    return LocKind.Loc
  }
  if (type === LocModelType.FloorDecoration) return LocKind.FloorDecoration
  return LocKind.Roof
}
