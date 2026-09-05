// Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
//
// Applies animation frames to a model's vertices. Both pipelines write into a
// fresh (or caller-supplied) set of Int32 position arrays copied from the
// unanimated ModelData, so the lit Model stays untouched and the result can
// be re-uploaded per tick via ModelMesh.buildMeshPositions.
//
//  - legacy (indexes 0/1): per-label-group origin / translate / rotate /
//    scale / alpha / light transforms with the client's integer math;
//  - skeletal "animaya" (index 22): per-vertex weighted bone matrices.

import { Model } from '../model/Model'
import { ModelData } from '../model/ModelData'
import { COSINE, SINE } from '../model/MathTables'
import { type Mat4, mat4Add, mat4Create, mat4FromScaling, mat4Mul } from './Mat4'
import type { SeqFrame } from './SeqFrame'
import type { AnimLoaders } from './SeqLoaders'
import { SeqTransformType } from './SeqTransformType'
import type { SkeletalSeq } from './skeletal/SkeletalSeq'

/** The subset of SeqType the animator needs (structurally satisfied by config/SeqType). */
export interface SeqInfo {
  /** Legacy frame ids, (frame archive << 16) | file. */
  frameIds: readonly number[]
  /** Duration of each legacy frame in client ticks (20 ms). */
  frameLengths: readonly number[]
  /** Skeletal animation id in index 22, or -1. */
  skeletalId: number
  skeletalStart: number
  skeletalEnd: number
}

/** Result of animating one frame: positions (and alphas / colours when the frame changes them). */
export interface AnimatedFrame {
  verticesX: Int32Array
  verticesY: Int32Array
  verticesZ: Int32Array
  /** Copy of the face alphas after alpha transforms; undefined when the frame has none. */
  faceAlphas: Int8Array | undefined
  /** Copy of the packed face colours after light transforms; undefined when the frame has none. */
  faceColors: Uint16Array | undefined
}

export function isSkeletalSeq(seq: SeqInfo): boolean {
  return seq.skeletalId >= 0
}

/** Number of frames the sequence has (skeletal: ticks in its range). */
export function seqFrameCount(seq: SeqInfo): number {
  if (isSkeletalSeq(seq)) {
    return Math.max(0, seq.skeletalEnd - seq.skeletalStart)
  }
  return seq.frameIds.length
}

/** Client ticks (20 ms) per frame; skeletal frames are one tick each. */
export function seqFrameLengths(seq: SeqInfo): number[] {
  const count = seqFrameCount(seq)
  const out: number[] = new Array<number>(count)
  for (let i = 0; i < count; i++) {
    out[i] = isSkeletalSeq(seq) ? 1 : (seq.frameLengths[i] ?? 1)
  }
  return out
}

/** Total length of one pass in client ticks. */
export function seqTotalLength(seq: SeqInfo): number {
  let total = 0
  for (const n of seqFrameLengths(seq)) total += n
  return total
}

/** Frame index for a tick offset into the sequence (looping). */
export function seqFrameAtTick(seq: SeqInfo, tick: number): number {
  const lengths = seqFrameLengths(seq)
  const total = seqTotalLength(seq)
  if (lengths.length === 0 || total === 0) return 0
  let t = ((tick % total) + total) % total
  for (let i = 0; i < lengths.length; i++) {
    t -= lengths[i]!
    if (t < 0) return i
  }
  return lengths.length - 1
}

function sourceData(model: Model | ModelData): ModelData {
  if (model instanceof ModelData) return model
  if (!model.source) {
    throw new Error('Model has no source ModelData to animate')
  }
  return model.source
}

/** Allocate (or verify) an output frame for `data`. */
export function createAnimatedFrame(data: ModelData): AnimatedFrame {
  return {
    verticesX: new Int32Array(data.vertexCount),
    verticesY: new Int32Array(data.vertexCount),
    verticesZ: new Int32Array(data.vertexCount),
    faceAlphas: undefined,
    faceColors: undefined,
  }
}

/**
 * Pose `model` at `frameIndex` of `seq`. Returns fresh vertex positions
 * (client units, Y down, same vertex order as the model). Returns the
 * unanimated positions when the frame cannot be loaded.
 */
export function animateModel(
  model: Model | ModelData,
  seq: SeqInfo,
  frameIndex: number,
  loaders: AnimLoaders,
  out?: AnimatedFrame,
): AnimatedFrame {
  const data = sourceData(model)
  const frame = out && out.verticesX.length === data.vertexCount ? out : createAnimatedFrame(data)
  frame.verticesX.set(data.verticesX)
  frame.verticesY.set(data.verticesY)
  frame.verticesZ.set(data.verticesZ)
  frame.faceAlphas = undefined
  frame.faceColors = undefined

  if (isSkeletalSeq(seq)) {
    const skeletal = loaders.skeletal.load(seq.skeletalId)
    if (skeletal) {
      applySkeletalSeq(frame, data, skeletal, seq.skeletalStart + frameIndex)
    }
  } else {
    const id = seq.frameIds[frameIndex]
    if (id !== undefined) {
      const seqFrame = loaders.frames.load(id)
      if (seqFrame) {
        applySeqFrame(frame, data, seqFrame)
      }
    }
  }
  return frame
}

// ---------------------------------------------------------------- legacy

let originX = 0
let originY = 0
let originZ = 0

/** Apply one legacy frame to `frame` (positions already holding the base pose). */
export function applySeqFrame(frame: AnimatedFrame, data: ModelData, seqFrame: SeqFrame): void {
  const base = seqFrame.base
  const vertexLabels = data.vertexLabels
  if (vertexLabels.length === 0 && !seqFrame.hasAlphaTransform && !seqFrame.hasColorTransform) {
    return
  }
  if (seqFrame.hasAlphaTransform && data.faceAlphas) {
    frame.faceAlphas = data.faceAlphas.slice()
  }
  if (seqFrame.hasColorTransform) {
    frame.faceColors = data.faceColors.slice()
  }

  originX = 0
  originY = 0
  originZ = 0
  for (let i = 0; i < seqFrame.transformCount; i++) {
    const group = seqFrame.transformGroups[i]!
    const resetOriginGroup = seqFrame.resetOriginGroups[i]!
    if (resetOriginGroup !== -1) {
      transform(frame, data, SeqTransformType.Origin, base.labels[resetOriginGroup] ?? [], 0, 0, 0)
    }
    transform(
      frame,
      data,
      base.types[group] ?? 0,
      base.labels[group] ?? [],
      seqFrame.transformX[i]!,
      seqFrame.transformY[i]!,
      seqFrame.transformZ[i]!,
    )
  }
}

function transform(
  frame: AnimatedFrame,
  data: ModelData,
  type: number,
  labels: readonly number[],
  tx: number,
  ty: number,
  tz: number,
): void {
  const vx = frame.verticesX
  const vy = frame.verticesY
  const vz = frame.verticesZ
  const vertexLabels = data.vertexLabels

  switch (type) {
    case SeqTransformType.Origin: {
      originX = 0
      originY = 0
      originZ = 0
      let count = 0
      for (const label of labels) {
        const vertices = vertexLabels[label]
        if (!vertices) continue
        for (let k = 0; k < vertices.length; k++) {
          const v = vertices[k]!
          originX += vx[v]!
          originY += vy[v]!
          originZ += vz[v]!
          count++
        }
      }
      if (count > 0) {
        originX = tx + ((originX / count) | 0)
        originY = ty + ((originY / count) | 0)
        originZ = tz + ((originZ / count) | 0)
      } else {
        originX = tx
        originY = ty
        originZ = tz
      }
      break
    }
    case SeqTransformType.Translate: {
      for (const label of labels) {
        const vertices = vertexLabels[label]
        if (!vertices) continue
        for (let k = 0; k < vertices.length; k++) {
          const v = vertices[k]!
          vx[v] = vx[v]! + tx
          vy[v] = vy[v]! + ty
          vz[v] = vz[v]! + tz
        }
      }
      break
    }
    case SeqTransformType.Rotate: {
      const angleX = (tx & 0xff) * 8
      const angleY = (ty & 0xff) * 8
      const angleZ = (tz & 0xff) * 8
      for (const label of labels) {
        const vertices = vertexLabels[label]
        if (!vertices) continue
        for (let k = 0; k < vertices.length; k++) {
          const v = vertices[k]!
          let x = vx[v]! - originX
          let y = vy[v]! - originY
          let z = vz[v]! - originZ

          // roll
          if (angleZ !== 0) {
            const sin = SINE[angleZ]!
            const cos = COSINE[angleZ]!
            const t = (sin * y + cos * x) >> 16
            y = (cos * y - sin * x) >> 16
            x = t
          }
          // pitch
          if (angleX !== 0) {
            const sin = SINE[angleX]!
            const cos = COSINE[angleX]!
            const t = (cos * y - sin * z) >> 16
            z = (sin * y + cos * z) >> 16
            y = t
          }
          // yaw
          if (angleY !== 0) {
            const sin = SINE[angleY]!
            const cos = COSINE[angleY]!
            const t = (sin * z + cos * x) >> 16
            z = (cos * z - sin * x) >> 16
            x = t
          }

          vx[v] = x + originX
          vy[v] = y + originY
          vz[v] = z + originZ
        }
      }
      break
    }
    case SeqTransformType.Scale: {
      for (const label of labels) {
        const vertices = vertexLabels[label]
        if (!vertices) continue
        for (let k = 0; k < vertices.length; k++) {
          const v = vertices[k]!
          vx[v] = (((vx[v]! - originX) * tx) / 128 | 0) + originX
          vy[v] = (((vy[v]! - originY) * ty) / 128 | 0) + originY
          vz[v] = (((vz[v]! - originZ) * tz) / 128 | 0) + originZ
        }
      }
      break
    }
    case SeqTransformType.Alpha: {
      const alphas = frame.faceAlphas
      if (!alphas) break
      const faceLabels = data.faceLabels
      for (const label of labels) {
        const faces = faceLabels[label]
        if (!faces) continue
        for (let k = 0; k < faces.length; k++) {
          const f = faces[k]!
          let alpha = (alphas[f]! & 0xff) + tx * 8
          if (alpha < 0) alpha = 0
          else if (alpha > 255) alpha = 255
          alphas[f] = alpha
        }
      }
      break
    }
    case SeqTransformType.Light: {
      const colors = frame.faceColors
      if (!colors) break
      const faceLabels = data.faceLabels
      for (const label of labels) {
        const faces = faceLabels[label]
        if (!faces) continue
        for (let k = 0; k < faces.length; k++) {
          const f = faces[k]!
          const color = colors[f]!
          const hue = ((color >> 10) & 0x3f) + tx
          let saturation = ((color >> 7) & 0x7) + ty
          let lightness = (color & 0x7f) + tz
          if (saturation < 0) saturation = 0
          else if (saturation > 7) saturation = 7
          if (lightness < 0) lightness = 0
          else if (lightness > 127) lightness = 127
          colors[f] = ((hue & 0x3f) << 10) + (saturation << 7) + lightness
        }
      }
      break
    }
    default:
      break
  }
}

// ---------------------------------------------------------------- skeletal

const skinMatrix = mat4Create()
const scaledBone = mat4Create()
const boneScale = mat4Create()

/** Pose `frame` at skeletal tick `tick` using the model's bone weights. */
export function applySkeletalSeq(frame: AnimatedFrame, data: ModelData, seq: SkeletalSeq, tick: number): void {
  const groups = data.animMayaGroups
  const scales = data.animMayaScales
  if (groups && scales) {
    const skeletalBase = seq.skeletalBase
    skeletalBase.updateAnimMatrices(seq, tick)
    const poseId = seq.poseId
    for (let v = 0; v < data.vertexCount; v++) {
      const group = groups[v]
      if (!group || group.length === 0) continue
      const weights = scales[v]!
      skinMatrix.fill(0)
      for (let i = 0; i < group.length; i++) {
        const bone = skeletalBase.getBone(group[i]!)
        if (!bone) continue
        const w = weights[i]! / 255
        mat4FromScaling(boneScale, w, w, w)
        mat4Mul(scaledBone, boneScale, bone.getFinalMatrix(poseId))
        mat4Add(skinMatrix, skinMatrix, scaledBone)
      }
      transformVertex(frame, v, skinMatrix)
    }
  }

  if (seq.hasAlphaTransform && data.faceAlphas) {
    const alphas = (frame.faceAlphas = data.faceAlphas.slice())
    const base = seq.base
    const faceLabels = data.faceLabels
    for (let i = 0; i < base.count; i++) {
      if (base.types[i] !== SeqTransformType.Alpha) continue
      const curve = seq.curves[i]?.[0]
      if (!curve) continue
      const delta = curve.getValue(tick) * 255
      for (const label of base.labels[i] ?? []) {
        const faces = faceLabels[label]
        if (!faces) continue
        for (let k = 0; k < faces.length; k++) {
          const f = faces[k]!
          let alpha = (alphas[f]! & 0xff) + delta
          if (alpha < 0) alpha = 0
          else if (alpha > 255) alpha = 255
          alphas[f] = alpha
        }
      }
    }
  }
}

/** Skeletal matrices are in a Y-up / Z-forward space; the model is Y-down / Z-back. */
function transformVertex(frame: AnimatedFrame, v: number, m: Mat4): void {
  const x = frame.verticesX[v]!
  const y = -frame.verticesY[v]!
  const z = -frame.verticesZ[v]!
  frame.verticesX[v] = Math.round(m[0]! * x + m[4]! * y + m[8]! * z + m[12]!)
  frame.verticesY[v] = -Math.round(m[1]! * x + m[5]! * y + m[9]! * z + m[13]!)
  frame.verticesZ[v] = -Math.round(m[2]! * x + m[6]! * y + m[10]! * z + m[14]!)
}
