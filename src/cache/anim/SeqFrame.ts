// Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
//
// One legacy animation frame (index 0): for each transform group of its base
// that is active this frame, an (x, y, z) triple. `resetOriginGroups` records
// which Origin group must be re-evaluated before a translate/rotate/scale.

import { ByteReader } from '../ByteReader'
import type { SeqBase } from './SeqBase'
import { SeqTransformType } from './SeqTransformType'

export class SeqFrame {
  readonly base: SeqBase
  readonly transformCount: number
  readonly transformGroups: Int32Array
  readonly transformX: Int32Array
  readonly transformY: Int32Array
  readonly transformZ: Int32Array
  readonly resetOriginGroups: Int32Array
  readonly hasAlphaTransform: boolean
  readonly hasColorTransform: boolean

  constructor(
    base: SeqBase,
    transformCount: number,
    transformGroups: Int32Array,
    transformX: Int32Array,
    transformY: Int32Array,
    transformZ: Int32Array,
    resetOriginGroups: Int32Array,
    hasAlphaTransform: boolean,
    hasColorTransform: boolean,
  ) {
    this.base = base
    this.transformCount = transformCount
    this.transformGroups = transformGroups
    this.transformX = transformX
    this.transformY = transformY
    this.transformZ = transformZ
    this.resetOriginGroups = resetOriginGroups
    this.hasAlphaTransform = hasAlphaTransform
    this.hasColorTransform = hasColorTransform
  }

  /** Decode one file of a frame archive; the base is looked up by the id in the header. */
  static decode(data: Uint8Array, loadBase: (baseId: number) => SeqBase | undefined): SeqFrame {
    const flags = new ByteReader(data)
    const baseId = flags.u16()
    const base = loadBase(baseId)
    if (!base) {
      throw new Error(`SeqFrame: missing base ${baseId}`)
    }
    const count = flags.u8()
    const values = new ByteReader(data, flags.offset + count)

    const groups = new Int32Array(count)
    const xs = new Int32Array(count)
    const ys = new Int32Array(count)
    const zs = new Int32Array(count)
    const origins = new Int32Array(count)

    let n = 0
    let resetOriginGroup = -1
    let lastResetOriginGroup = -1
    let hasAlpha = false
    let hasColor = false

    for (let i = 0; i < count; i++) {
      const type = base.types[i] ?? 0
      if (type === SeqTransformType.Origin) {
        resetOriginGroup = i
      }
      const flag = flags.u8()
      if (flag === 0) continue
      if (type === SeqTransformType.Origin) {
        lastResetOriginGroup = i
      }

      groups[n] = i
      const defaultValue = type === SeqTransformType.Scale ? 128 : 0
      xs[n] = (flag & 1) !== 0 ? values.iSmart() : defaultValue
      ys[n] = (flag & 2) !== 0 ? values.iSmart() : defaultValue
      zs[n] = (flag & 4) !== 0 ? values.iSmart() : defaultValue

      origins[n] = -1
      if (
        type === SeqTransformType.Translate ||
        type === SeqTransformType.Rotate ||
        type === SeqTransformType.Scale
      ) {
        if (resetOriginGroup > lastResetOriginGroup) {
          origins[n] = resetOriginGroup
          lastResetOriginGroup = resetOriginGroup
        }
      } else if (type === SeqTransformType.Alpha) {
        hasAlpha = true
      } else if (type === SeqTransformType.Light) {
        hasColor = true
      }
      n++
    }

    if (count !== 0 && values.offset !== data.length) {
      throw new Error(
        `SeqFrame: trailing bytes (read ${values.offset} of ${data.length}, ${count} groups, base ${baseId})`,
      )
    }

    return new SeqFrame(
      base,
      n,
      groups.subarray(0, n),
      xs.subarray(0, n),
      ys.subarray(0, n),
      zs.subarray(0, n),
      origins.subarray(0, n),
      hasAlpha,
      hasColor,
    )
  }
}
