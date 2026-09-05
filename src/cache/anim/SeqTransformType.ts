// Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.

/** Transform group types of a frame map (index 1). */
export const SeqTransformType = {
  /** Sets the pivot for following rotate/scale groups. */
  Origin: 0,
  Translate: 1,
  Rotate: 2,
  Scale: 3,
  Alpha: 5,
  /** Hue/saturation/lightness shift of the faces in the group. */
  Light: 7,
} as const
export type SeqTransformType = (typeof SeqTransformType)[keyof typeof SeqTransformType]
