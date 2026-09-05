// Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
//
// One bone of a skeletal base: a parent link and, per pose, a bind-pose local
// matrix (16 floats, column-major, translation in 12..14) plus an unused
// 3-float vector. The bind matrices are decomposed into Euler rotation,
// translation and scale so curves can override individual channels.

import type { ByteReader } from '../../ByteReader'
import {
  type Mat4,
  type Vec3,
  mat4Copy,
  mat4Create,
  mat4GetScaling,
  mat4GetTranslation,
  mat4Invert,
  mat4Mul,
} from '../Mat4'
import { readF32 } from './Curve'

const scratch = mat4Create()

export class SkeletalBone {
  readonly parentId: number
  parent: SkeletalBone | undefined

  readonly localMatrices: Mat4[]
  private readonly modelMatrices: (Mat4 | undefined)[]
  private readonly invertedModelMatrices: (Mat4 | undefined)[]

  readonly rotations: Vec3[]
  readonly translations: Vec3[]
  readonly scalings: Vec3[]

  private readonly animMatrix: Mat4 = mat4Create()
  private readonly animModelMatrix: Mat4 = mat4Create()
  private readonly finalMatrix: Mat4 = mat4Create()
  private updateAnimModelMatrix = false
  private updateFinalMatrix = false

  constructor(poseCount: number, r: ByteReader, view: DataView) {
    this.parentId = r.i16()
    this.localMatrices = new Array<Mat4>(poseCount)
    this.modelMatrices = new Array<Mat4 | undefined>(poseCount)
    this.invertedModelMatrices = new Array<Mat4 | undefined>(poseCount)
    this.rotations = new Array<Vec3>(poseCount)
    this.translations = new Array<Vec3>(poseCount)
    this.scalings = new Array<Vec3>(poseCount)

    for (let i = 0; i < poseCount; i++) {
      const m = new Float32Array(16)
      for (let j = 0; j < 16; j++) {
        m[j] = readF32(r, view)
      }
      this.localMatrices[i] = m
      // Unused direction vector.
      readF32(r, view)
      readF32(r, view)
      readF32(r, view)
    }

    for (let i = 0; i < poseCount; i++) {
      const local = this.localMatrices[i]!
      mat4Invert(scratch, local)
      const rotation = new Float32Array(3)
      SkeletalBone.getRotation(rotation, scratch)
      this.rotations[i] = rotation
      this.translations[i] = mat4GetTranslation(new Float32Array(3), local)
      this.scalings[i] = mat4GetScaling(new Float32Array(3), local)
    }
  }

  /** Euler angles (x, y, z) of a rotation matrix, the client's Matrix.getRotation. */
  static getRotation(out: Vec3, m: Mat4): Vec3 {
    out[0] = -Math.asin(m[6]!)
    out[1] = 0
    out[2] = 0
    const cosX = Math.cos(out[0]!)
    if (Math.abs(cosX) > 0.005) {
      out[1] = Math.atan2(m[2]!, m[10]!)
      out[2] = Math.atan2(m[4]!, m[5]!)
    } else {
      const sinY = m[1]!
      const cosY = m[0]!
      if (m[6]! < 0) {
        out[1] = Math.atan2(sinY, cosY)
      } else {
        out[1] = -Math.atan2(sinY, cosY)
      }
      out[2] = 0
    }
    return out
  }

  getLocalMatrix(poseId: number): Mat4 {
    return this.localMatrices[poseId] ?? this.localMatrices[0]!
  }

  /** Bind pose in model space (parent chain applied), cached. */
  getModelMatrix(poseId: number): Mat4 {
    let m = this.modelMatrices[poseId]
    if (!m) {
      m = mat4Create()
      if (this.parent) {
        mat4Mul(m, this.parent.getModelMatrix(poseId), this.getLocalMatrix(poseId))
      } else {
        mat4Copy(m, this.getLocalMatrix(poseId))
      }
      this.modelMatrices[poseId] = m
    }
    return m
  }

  getInvertedModelMatrix(poseId: number): Mat4 {
    let m = this.invertedModelMatrices[poseId]
    if (!m) {
      m = mat4Invert(mat4Create(), this.getModelMatrix(poseId))
      this.invertedModelMatrices[poseId] = m
    }
    return m
  }

  setAnimMatrix(m: Mat4): void {
    mat4Copy(this.animMatrix, m)
    this.updateAnimModelMatrix = true
    this.updateFinalMatrix = true
  }

  getAnimMatrix(): Mat4 {
    return this.animMatrix
  }

  /** Animated pose in model space. */
  getAnimModelMatrix(): Mat4 {
    if (this.updateAnimModelMatrix) {
      this.updateAnimModelMatrix = false
      if (this.parent) {
        mat4Mul(this.animModelMatrix, this.parent.getAnimModelMatrix(), this.animMatrix)
      } else {
        mat4Copy(this.animModelMatrix, this.animMatrix)
      }
    }
    return this.animModelMatrix
  }

  /** animModel * inverse(bindModel): maps bind-pose vertices to the animated pose. */
  getFinalMatrix(poseId: number): Mat4 {
    if (this.updateFinalMatrix) {
      this.updateFinalMatrix = false
      mat4Mul(this.finalMatrix, this.getAnimModelMatrix(), this.getInvertedModelMatrix(poseId))
    }
    return this.finalMatrix
  }

  getRotation(poseId: number): Vec3 {
    return this.rotations[poseId] ?? this.rotations[0]!
  }

  getTranslation(poseId: number): Vec3 {
    return this.translations[poseId] ?? this.translations[0]!
  }

  getScaling(poseId: number): Vec3 {
    return this.scalings[poseId] ?? this.scalings[0]!
  }
}
