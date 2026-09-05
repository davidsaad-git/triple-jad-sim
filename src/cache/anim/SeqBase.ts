// Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
//
// A frame map ("base", index 1): the list of transform groups a family of
// frames refers to, each with a type and the label ids it moves. Newer
// bases carry a trailing skeleton for animaya sequences.

import { ByteReader } from '../ByteReader'
import { SeqTransformType } from './SeqTransformType'
import { floatView } from './skeletal/Curve'
import { SkeletalBase } from './skeletal/SkeletalBase'

export class SeqBase {
  readonly id: number
  readonly count: number
  /** Transform type per group (SeqTransformType). */
  readonly types: Uint8Array
  /** Label ids per group. */
  readonly labels: number[][]
  readonly skeletalBase: SkeletalBase | undefined

  constructor(id: number, count: number, types: Uint8Array, labels: number[][], skeletalBase?: SkeletalBase) {
    this.id = id
    this.count = count
    this.types = types
    this.labels = labels
    this.skeletalBase = skeletalBase
  }

  static decode(id: number, data: Uint8Array): SeqBase {
    const r = new ByteReader(data)
    const count = r.u8()
    const types = new Uint8Array(count)
    const labels: number[][] = new Array<number[]>(count)

    for (let i = 0; i < count; i++) {
      let type = r.u8()
      if (type === 6) {
        type = SeqTransformType.Rotate
      }
      types[i] = type
    }
    for (let i = 0; i < count; i++) {
      labels[i] = new Array<number>(r.u8())
    }
    for (let i = 0; i < count; i++) {
      const group = labels[i]!
      for (let l = 0; l < group.length; l++) {
        group[l] = r.u8()
      }
    }

    let skeletalBase: SkeletalBase | undefined
    if (r.remaining > 0) {
      const boneCount = r.u16()
      if (boneCount > 0) {
        skeletalBase = new SkeletalBase(r, floatView(r), boneCount)
      }
    }
    return new SeqBase(id, count, types, labels, skeletalBase)
  }
}
