// Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
//
// Enumerations of the skeletal ("animaya") animation format in index 22.

/** What a curve drives: a bone transform, a legacy label group, or face alpha. */
export const SkeletalTransformType = {
  Type0: 0,
  Bone: 1,
  Type2: 2,
  Type3: 3,
  Alpha: 4,
  Type5: 5,
} as const
export type SkeletalTransformType = (typeof SkeletalTransformType)[keyof typeof SkeletalTransformType]

export function skeletalTransformTypeForId(id: number): SkeletalTransformType {
  if (id < 0 || id > SkeletalTransformType.Type5) {
    return SkeletalTransformType.Type0
  }
  return id as SkeletalTransformType
}

/** Number of curve slots each transform type owns (bone: rx ry rz tx ty tz sx sy sz). */
const CURVE_COUNTS = [0, 9, 3, 6, 1, 3]

export function skeletalCurveCount(type: SkeletalTransformType): number {
  return CURVE_COUNTS[type]!
}

/** Curve "channel" ids (1..9 bone rotate/translate/scale xyz, 10..15 label group, 16 alpha). */
export function curveTypeForId(id: number): number {
  if (id < 0 || id > 16) {
    return 0
  }
  return id
}

/** Slot index of a curve type within its transform's curve array (-1 for type 0). */
const CURVE_INDICES = [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 1, 2, 3, 4, 5, 0]

export function curveIndexForType(type: number): number {
  return CURVE_INDICES[type] ?? -1
}

/** How a curve extrapolates before its first / after its last key. */
export const CurveInterpType = {
  /** Hold the end value. */
  Constant: 0,
  /** Continue the end tangent. */
  Linear: 1,
  /** Repeat. */
  Cycle: 2,
  /** Repeat with offset. */
  CycleOffset: 3,
  /** Ping-pong. */
  Oscillate: 4,
} as const
export type CurveInterpType = (typeof CurveInterpType)[keyof typeof CurveInterpType]

export function curveInterpTypeForId(id: number): CurveInterpType {
  if (id < 0 || id > CurveInterpType.Oscillate) {
    return CurveInterpType.Constant
  }
  return id as CurveInterpType
}
