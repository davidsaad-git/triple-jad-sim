// Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
//
// The skeleton appended to a frame map (index 1) for animaya animations.

import type { ByteReader } from '../../ByteReader'
import { SkeletalBone } from './SkeletalBone'
import type { SkeletalSeq } from './SkeletalSeq'

export class SkeletalBase {
  readonly bones: SkeletalBone[]
  readonly poseCount: number

  constructor(r: ByteReader, view: DataView, boneCount: number) {
    this.poseCount = r.u8()
    this.bones = new Array<SkeletalBone>(boneCount)
    for (let i = 0; i < boneCount; i++) {
      this.bones[i] = new SkeletalBone(this.poseCount, r, view)
    }
    for (const bone of this.bones) {
      if (bone.parentId >= 0) {
        bone.parent = this.bones[bone.parentId]
      }
    }
  }

  /** Evaluate every bone at `frame` (optionally only the bones whose mask entry equals `mask`). */
  updateAnimMatrices(seq: SkeletalSeq, frame: number, masks?: readonly boolean[], mask = false): void {
    const poseId = seq.poseId
    for (let i = 0; i < this.bones.length; i++) {
      if (masks === undefined || masks[i] === mask) {
        seq.updateAnimMatrix(frame, this.bones[i]!, i, poseId)
      }
    }
  }

  get boneCount(): number {
    return this.bones.length
  }

  getBone(id: number): SkeletalBone | undefined {
    return this.bones[id]
  }
}
