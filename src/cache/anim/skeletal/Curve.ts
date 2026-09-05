// Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
//
// A keyframed animation curve (Maya-style, with per-key bezier tangents).
// After `load()` the curve is baked into one value per tick between its
// first and last key; the keys are then dropped.

import type { ByteReader } from '../../ByteReader'
import { interpolateCurve } from './CurveInterp'
import { CurveInterpType, curveInterpTypeForId } from './SkeletalTypes'

export class CurvePoint {
  /** Tick. */
  x = 0
  /** Value. */
  y = 0
  /** In-tangent (dx, dy). */
  field2 = 0
  field3 = 0
  /** Out-tangent (dx, dy). */
  field4 = 0
  field5 = 0

  next: CurvePoint | undefined

  decode(r: ByteReader, view: DataView): void {
    this.x = r.i16()
    this.y = readF32(r, view)
    this.field2 = readF32(r, view)
    this.field3 = readF32(r, view)
    this.field4 = readF32(r, view)
    this.field5 = readF32(r, view)
  }
}

/** DataView over the reader's bytes, so `getFloat32(r.offset)` addresses the same data. */
export function floatView(r: ByteReader): DataView {
  return new DataView(r.data.buffer, r.data.byteOffset, r.data.byteLength)
}

/** Big-endian IEEE float at the reader's cursor (ByteReader has no float primitive). */
export function readF32(r: ByteReader, view: DataView): number {
  const v = view.getFloat32(r.offset)
  r.offset += 4
  return v
}

export class Curve {
  readonly id: number

  type = 0
  startInterpType: CurveInterpType = CurveInterpType.Constant
  endInterpType: CurveInterpType = CurveInterpType.Constant
  /** Selects the "weighted tangents" evaluator. */
  bool = false

  points: CurvePoint[] | undefined

  startTick = 0
  endTick = 0

  values: Float32Array = new Float32Array(0)
  minValue = 0
  maxValue = 0

  noInterp = false

  pointIndex = 0
  pointIndexUpdated = true

  interpBool = false
  interpV0 = 0
  interpV1 = 0
  interpV2 = 0
  interpV3 = 0
  interpV4 = 0
  interpV5 = 0
  interpV6 = 0
  interpV7 = 0
  interpV8 = 0
  interpV9 = 0

  constructor(id: number) {
    this.id = id
  }

  decode(r: ByteReader, view: DataView): void {
    const count = r.u16()
    this.type = r.u8()
    this.startInterpType = curveInterpTypeForId(r.u8())
    this.endInterpType = curveInterpTypeForId(r.u8())
    this.bool = r.u8() !== 0

    const points: CurvePoint[] = new Array<CurvePoint>(count)
    let last: CurvePoint | undefined
    for (let i = 0; i < count; i++) {
      const point = new CurvePoint()
      point.decode(r, view)
      points[i] = point
      if (last) last.next = point
      last = point
    }
    this.points = points
  }

  /** Bake per-tick values and drop the keys. */
  load(): void {
    const points = this.points
    if (!points || points.length === 0) {
      return
    }
    this.startTick = points[0]!.x
    this.endTick = points[points.length - 1]!.x
    this.values = new Float32Array(this.getTickDuration() + 1)
    for (let t = this.startTick; t <= this.endTick; t++) {
      this.values[t - this.startTick] = interpolateCurve(this, t)
    }
    // The client computes these after clearing the points (yielding 0); we
    // evaluate them first so out-of-range ticks extrapolate sensibly instead.
    this.minValue = interpolateCurve(this, this.startTick - 1)
    this.maxValue = interpolateCurve(this, this.endTick + 1)
    this.points = undefined
  }

  getValue(t: number): number {
    if (t < this.startTick) {
      return this.minValue
    } else if (t > this.endTick) {
      return this.maxValue
    }
    return this.values[t - this.startTick] ?? 0
  }

  getPointIndex(t: number): number {
    const points = this.points
    if (!points) {
      return this.pointIndex
    }
    const current = points[this.pointIndex]
    if (
      this.pointIndex < 0 ||
      current === undefined ||
      current.x > t ||
      (current.next !== undefined && current.next.x <= t)
    ) {
      if (t >= this.startTick && t <= this.endTick) {
        const pointCount = points.length
        let newPointIndex = this.pointIndex
        if (pointCount > 0) {
          let start = 0
          let end = pointCount - 1
          do {
            const mid = (start + end) >> 1
            const midPoint = points[mid]!
            if (t < midPoint.x) {
              if (t > points[mid - 1]!.x) {
                newPointIndex = mid - 1
                break
              }
              end = mid - 1
            } else {
              if (t <= midPoint.x) {
                newPointIndex = mid
                break
              }
              if (t < points[mid + 1]!.x) {
                newPointIndex = mid
                break
              }
              start = mid + 1
            }
          } while (start <= end)
        }
        if (this.pointIndex !== newPointIndex) {
          this.pointIndex = newPointIndex
          this.pointIndexUpdated = true
        }
        return this.pointIndex
      }
      return -1
    }
    return this.pointIndex
  }

  getCurvePoint(t: number): CurvePoint | undefined {
    if (!this.points) {
      return undefined
    }
    const index = this.getPointIndex(t)
    if (index < 0 || index >= this.points.length) {
      return undefined
    }
    return this.points[index]
  }

  getPointCount(): number {
    return this.points ? this.points.length : 0
  }

  getTickDuration(): number {
    return this.endTick - this.startTick
  }
}
