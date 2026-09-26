/**
 * OSRS model painter sort, as ported by scim (helpers
 *, bucket limit `wu` = 6000, sentinel =
 * -1000). Vertices are projected with the OSRS camera; if any vertex is
 * closer than 50 units the sort aborts (returns empty lists, i.e. the
 * model is not drawn that frame). Back faces (non-positive screen signed
 * area) are dropped. Faces are bucketed by average depth and, when face
 * priorities exist, merged through the 12 OSRS priority lists with the
 * 10/11 interleave rules. Faces with alpha != 0 go to the transparent list.
 */
import { COS_F, SIN_F } from './tables'

export interface SortProjection {
  cameraX: number
  cameraY: number
  cameraZ: number
  yawSin: number
  yawCos: number
  pitchSin: number
  pitchCos: number
  /** Model yaw 0..2047. */
  orientation: number
  modelX: number
  modelY: number
  modelZ: number
}

export interface SortableModel {
  verticesX: ArrayLike<number>
  verticesY: ArrayLike<number>
  verticesZ: ArrayLike<number>
  verticesCount: number
  indices1: ArrayLike<number>
  indices2: ArrayLike<number>
  indices3: ArrayLike<number>
  faceCount: number
  faceRenderPriorities: ArrayLike<number> | null | undefined
  priority: number
  faceAlphas: ArrayLike<number> | null | undefined
  faceColors3: ArrayLike<number>
}

export interface SortResult {
  opaqueFaces: number[]
  transparentFaces: number[]
}

const MAX_BUCKETS = 6000
const SENTINEL = -1000

let screenX = new Float64Array(256)
let screenY = new Float64Array(256)
let depth = new Float64Array(256)
const bucketHead = new Int32Array(MAX_BUCKETS)
const bucketTail = new Int32Array(MAX_BUCKETS)
let nextFace = new Int32Array(256)
const prioCount = new Int32Array(12)
const prioDepthSum = new Int32Array(12)
const prioFaces: number[][] = Array.from({ length: 12 }, () => [])
const prio10Depth: number[] = []
const prio11Depth: number[] = []

function ensure(vertices: number, faces: number): void {
  if (vertices > screenX.length) {
    screenX = new Float64Array(vertices)
    screenY = new Float64Array(vertices)
    depth = new Float64Array(vertices)
  }
  if (faces > nextFace.length) nextFace = new Int32Array(faces)
}

function clampPriority(p: number): number {
  return p < 0 ? 0 : p > 11 ? 11 : p
}

function facePriority(m: SortableModel, f: number): number {
  return m.faceRenderPriorities == null ? clampPriority(m.priority) : clampPriority(m.faceRenderPriorities[f]!)
}

function emit(out: SortResult, face: number, alphas: ArrayLike<number> | null | undefined): void {
  if (alphas && alphas[face] !== 0) out.transparentFaces.push(face)
  else out.opaqueFaces.push(face)
}

/**
 * Sort all faces of `m`. With `proj === null` no projection happens: faces
 * keep index order (bucketed by reverse index) and priorities still apply.
 */
export function painterSort(m: SortableModel, proj: SortProjection | null): SortResult {
  const out: SortResult = { opaqueFaces: [], transparentFaces: [] }
  if (m.faceCount <= 0 || m.verticesCount <= 0) return out
  ensure(m.verticesCount, m.faceCount)
  let minDepth = 0
  let buckets: number
  if (proj !== null) {
    const { cameraX, cameraY, cameraZ, yawSin, yawCos, pitchSin, pitchCos, orientation, modelX, modelY, modelZ } = proj
    let os = 0
    let oc = 1
    if (orientation !== 0) {
      const a = orientation & 2047
      os = SIN_F[a]!
      oc = COS_F[a]!
    }
    const dx0 = modelX - cameraX
    const dy0 = modelY - cameraY
    const centreDepth = ((modelZ - cameraZ) * yawCos - dx0 * yawSin) * pitchCos + dy0 * pitchSin
    const centre = Math.trunc(centreDepth)
    minDepth = Infinity
    let maxDepth = -Infinity
    for (let v = 0; v < m.verticesCount; v++) {
      let x = m.verticesX[v]!
      const y = m.verticesY[v]!
      let z = m.verticesZ[v]!
      if (orientation !== 0) {
        const t = x
        x = z * os + t * oc
        z = z * oc - t * os
      }
      const rx = x + modelX - cameraX
      const ry = y + modelY - cameraY
      const rz = z + modelZ - cameraZ
      const sx = rx * yawCos + rz * yawSin
      const sz0 = rz * yawCos - rx * yawSin
      const sy = ry * pitchCos - sz0 * pitchSin
      const sz = sz0 * pitchCos + ry * pitchSin
      if (sz < 50) return out
      screenX[v] = sx / sz
      screenY[v] = sy / sz
      const d = Math.trunc(sz) - centre
      depth[v] = d
      if (d < minDepth) minDepth = d
      if (d > maxDepth) maxDepth = d
    }
    buckets = maxDepth - minDepth + 1
    if (buckets >= MAX_BUCKETS) return out
  } else {
    buckets = Math.max(m.faceCount, 1)
  }
  bucketHead.fill(-1, 0, buckets)
  bucketTail.fill(-1, 0, buckets)
  let lo = buckets
  let hi = 0
  for (let f = 0; f < m.faceCount; f++) {
    if (m.faceColors3[f] === -2) continue
    const a = m.indices1[f]!
    const b = m.indices2[f]!
    const c = m.indices3[f]!
    if (proj !== null) {
      const ax = screenX[a]!
      const ay = screenY[a]!
      const bx = screenX[b]!
      const by = screenY[b]!
      const cx = screenX[c]!
      const cy = screenY[c]!
      if ((ax - bx) * (cy - by) - (cx - bx) * (ay - by) <= 0) continue
    }
    let bucket: number
    if (proj === null) bucket = m.faceCount - 1 - f
    else {
      bucket = Math.trunc((depth[a]! + depth[b]! + depth[c]!) / 3) - minDepth
      if (bucket < 0) bucket = 0
      if (bucket >= buckets) bucket = buckets - 1
    }
    if (bucketTail[bucket] === -1) {
      bucketHead[bucket] = f
      bucketTail[bucket] = f
      nextFace[f] = -1
    } else {
      const tail = bucketTail[bucket]!
      nextFace[tail] = f
      nextFace[f] = -1
      bucketTail[bucket] = f
    }
    if (bucket < lo) lo = bucket
    if (bucket > hi) hi = bucket
  }
  if (lo > hi) return out

  if (m.faceRenderPriorities == null && proj !== null) {
    for (let b = hi; b >= lo; b--) {
      for (let f = bucketHead[b]!; f !== -1; f = nextFace[f]!) emit(out, f, m.faceAlphas)
    }
    return out
  }

  prioCount.fill(0)
  prioDepthSum.fill(0)
  for (let i = 0; i < 12; i++) prioFaces[i]!.length = 0
  prio10Depth.length = 0
  prio11Depth.length = 0
  for (let b = hi; b >= lo; b--) {
    for (let f = bucketHead[b]!; f !== -1; f = nextFace[f]!) {
      const p = facePriority(m, f)
      const i = prioCount[p]!
      prioCount[p] = i + 1
      prioFaces[p]![i] = f
      if (p < 10) prioDepthSum[p] = prioDepthSum[p]! + b
      else if (p === 10) prio10Depth[i] = b
      else prio11Depth[i] = b
    }
  }
  let avg12 = 0
  if (prioCount[1]! > 0 || prioCount[2]! > 0) {
    avg12 = Math.trunc((prioDepthSum[1]! + prioDepthSum[2]!) / (prioCount[1]! + prioCount[2]!))
  }
  let avg34 = 0
  if (prioCount[3]! > 0 || prioCount[4]! > 0) {
    avg34 = Math.trunc((prioDepthSum[3]! + prioDepthSum[4]!) / (prioCount[3]! + prioCount[4]!))
  }
  let avg68 = 0
  if (prioCount[6]! > 0 || prioCount[8]! > 0) {
    avg68 = Math.trunc((prioDepthSum[6]! + prioDepthSum[8]!) / (prioCount[6]! + prioCount[8]!))
  }
  let idx = 0
  let len = prioCount[10]!
  let list = prioFaces[10]!
  let depths = prio10Depth
  if (idx === len) {
    idx = 0
    len = prioCount[11]!
    list = prioFaces[11]!
    depths = prio11Depth
  }
  let current = idx < len ? depths[idx]! : SENTINEL
  const advance = (): void => {
    emit(out, list[idx++]!, m.faceAlphas)
    if (idx === len && list !== prioFaces[11]) {
      idx = 0
      len = prioCount[11]!
      list = prioFaces[11]!
      depths = prio11Depth
    }
    current = idx < len ? depths[idx]! : SENTINEL
  }
  for (let p = 0; p < 10; p++) {
    while (p === 0 && current > avg12) advance()
    while (p === 3 && current > avg34) advance()
    while (p === 5 && current > avg68) advance()
    const faces = prioFaces[p]!
    for (let i = 0; i < prioCount[p]!; i++) emit(out, faces[i]!, m.faceAlphas)
  }
  while (current !== SENTINEL) advance()
  return out
}
