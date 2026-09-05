// Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
//
// A skeletal ("animaya") animation from index 22: a set of curves keyed by
// bone (rotation / translation / scale xyz) or by legacy label group (alpha).

import { ByteReader } from '../../ByteReader'
import {
  type Mat4,
  mat4Create,
  mat4FromQuat,
  mat4FromScaling,
  mat4Identity,
  mat4Mul,
  quatCreate,
  quatMul,
  quatSetAxisAngle,
} from '../Mat4'
import type { SeqBase } from '../SeqBase'
import { Curve, floatView } from './Curve'
import type { SkeletalBase } from './SkeletalBase'
import type { SkeletalBone } from './SkeletalBone'
import {
  SkeletalTransformType,
  curveIndexForType,
  curveTypeForId,
  skeletalCurveCount,
  skeletalTransformTypeForId,
} from './SkeletalTypes'

const work = mat4Create()
const rotateMatrix = mat4Create()
const scaleMatrix = mat4Create()
const quatX = quatCreate()
const quatY = quatCreate()
const quatZ = quatCreate()
const quatAll = quatCreate()

export class SkeletalSeq {
  readonly id: number
  readonly version: number
  readonly base: SeqBase
  readonly skeletalBase: SkeletalBase

  poseId = 0
  curveCount = 0

  /** Per bone: up to 9 curves (rx ry rz tx ty tz sx sy sz). */
  readonly boneCurves: (Curve[] | undefined)[]
  /** Per legacy transform group of the base: curves for non-bone transform types (alpha in slot 0). */
  readonly curves: (Curve[] | undefined)[]

  hasAlphaTransform = false

  constructor(id: number, version: number, base: SeqBase, skeletalBase: SkeletalBase, r: ByteReader) {
    this.id = id
    this.version = version
    this.base = base
    this.skeletalBase = skeletalBase
    this.boneCurves = new Array<Curve[] | undefined>(skeletalBase.bones.length)
    this.curves = new Array<Curve[] | undefined>(base.count)

    const view = floatView(r)
    r.u16()
    r.u16()
    this.poseId = r.u8()
    this.curveCount = r.u16()

    for (let i = 0; i < this.curveCount; i++) {
      const transformType = skeletalTransformTypeForId(r.u8())
      const index = r.iSmart()
      const curveType = curveTypeForId(r.u8())

      const curve = new Curve(i)
      curve.decode(r, view)

      const target = transformType === SkeletalTransformType.Bone ? this.boneCurves : this.curves
      let slots = target[index]
      if (!slots) {
        slots = target[index] = new Array<Curve>(skeletalCurveCount(transformType))
      }
      curve.load()
      const slot = curveIndexForType(curveType)
      if (slot >= 0) slots[slot] = curve

      if (transformType === SkeletalTransformType.Alpha) {
        this.hasAlphaTransform = true
      }
    }
  }

  /** Decode a file of index 22; the base (frame map) id sits in the header. */
  static decode(id: number, data: Uint8Array, loadBase: (baseId: number) => SeqBase | undefined): SkeletalSeq {
    const r = new ByteReader(data)
    const version = r.u8()
    const baseId = r.u16()
    const base = loadBase(baseId)
    if (!base) {
      throw new Error(`SkeletalSeq ${id}: missing base ${baseId}`)
    }
    if (!base.skeletalBase) {
      throw new Error(`SkeletalSeq ${id}: base ${baseId} has no skeleton`)
    }
    return new SkeletalSeq(id, version, base, base.skeletalBase, r)
  }

  updateAnimMatrix(frame: number, bone: SkeletalBone, boneIndex: number, _poseId: number): void {
    mat4Identity(work)
    this.applyRotation(work, boneIndex, bone, frame)
    this.applyScaling(work, boneIndex, bone, frame)
    this.applyTranslation(work, boneIndex, bone, frame)
    bone.setAnimMatrix(work)
  }

  private applyRotation(matrix: Mat4, boneIndex: number, bone: SkeletalBone, frame: number): void {
    const rotation = bone.getRotation(this.poseId)
    let rx = rotation[0]!
    let ry = rotation[1]!
    let rz = rotation[2]!
    const curves = this.boneCurves[boneIndex]
    if (curves) {
      const cx = curves[0]
      const cy = curves[1]
      const cz = curves[2]
      if (cx) rx = cx.getValue(frame)
      if (cy) ry = cy.getValue(frame)
      if (cz) rz = cz.getValue(frame)
    }

    quatSetAxisAngle(quatX, 1, 0, 0, rx)
    quatSetAxisAngle(quatY, 0, 1, 0, ry)
    quatSetAxisAngle(quatZ, 0, 0, 1, rz)
    quatAll[0] = 0
    quatAll[1] = 0
    quatAll[2] = 0
    quatAll[3] = 1
    quatMul(quatAll, quatZ, quatAll)
    quatMul(quatAll, quatX, quatAll)
    quatMul(quatAll, quatY, quatAll)

    mat4FromQuat(rotateMatrix, quatAll)
    mat4Mul(matrix, rotateMatrix, matrix)
  }

  private applyScaling(matrix: Mat4, boneIndex: number, bone: SkeletalBone, frame: number): void {
    const scaling = bone.getScaling(this.poseId)
    let sx = scaling[0]!
    let sy = scaling[1]!
    let sz = scaling[2]!
    const curves = this.boneCurves[boneIndex]
    if (curves) {
      const cx = curves[6]
      const cy = curves[7]
      const cz = curves[8]
      if (cx) sx = cx.getValue(frame)
      if (cy) sy = cy.getValue(frame)
      if (cz) sz = cz.getValue(frame)
    }
    mat4FromScaling(scaleMatrix, sx, sy, sz)
    mat4Mul(matrix, scaleMatrix, matrix)
  }

  private applyTranslation(matrix: Mat4, boneIndex: number, bone: SkeletalBone, frame: number): void {
    const translation = bone.getTranslation(this.poseId)
    let tx = translation[0]!
    let ty = translation[1]!
    let tz = translation[2]!
    const curves = this.boneCurves[boneIndex]
    if (curves) {
      const cx = curves[3]
      const cy = curves[4]
      const cz = curves[5]
      if (cx) tx = cx.getValue(frame)
      if (cy) ty = cy.getValue(frame)
      if (cz) tz = cz.getValue(frame)
    }
    matrix[12] = tx
    matrix[13] = ty
    matrix[14] = tz
  }

  /** Lowest and highest key tick across all curves (to sanity-check a SeqType skeletal range). */
  tickRange(): [number, number] {
    let lo = Number.POSITIVE_INFINITY
    let hi = Number.NEGATIVE_INFINITY
    const visit = (slots: (Curve[] | undefined)[]): void => {
      for (const s of slots) {
        if (!s) continue
        for (const c of s) {
          if (!c) continue
          if (c.startTick < lo) lo = c.startTick
          if (c.endTick > hi) hi = c.endTick
        }
      }
    }
    visit(this.boneCurves)
    visit(this.curves)
    return [lo, hi]
  }
}
