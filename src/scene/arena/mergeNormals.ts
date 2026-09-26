/**
 * The OSRS scene "merge normals of adjacent objects" pass as scim ports it
 *. Applied to locs
 * with the mergeNormals flag that are not animated and whose placement
 * type is boundary (0-3), large (9-21) or floor (22).
 */
import type { RenderModel, VertexNormal } from '../../render/model/RenderModel'
import type { HeightPlane } from './locPlacement'
import { planeHeight } from './locPlacement'

export interface MergeablePart {
  model: RenderModel
  /** Index of the source loc (parts of the same loc share it). */
  objectIndex: number
  category: 'boundary' | 'large' | 'floor'
  level: number
  tileX: number
  tileY: number
  sizeX: number
  sizeY: number
  /** Decoration offset in OSRS units. */
  sceneOffsetX: number
  sceneOffsetY: number
  /** Context height plane and the mapping from centre-square tiles to it. */
  plane: HeightPlane | null
  planeOffsetX: number
  planeOffsetY: number
}

function centreX(p: MergeablePart): number {
  return p.tileX * 128 + p.sizeX * 64 + p.sceneOffsetX
}

function centreY(p: MergeablePart): number {
  return p.tileY * 128 + p.sizeY * 64 + p.sceneOffsetY
}

/** `EC`: average height of the 4 corners of tile (x, y) in the part's context plane. */
function tileGroundHeight(p: MergeablePart, x: number, y: number): number {
  if (!p.plane) return 0
  const cx = x + p.planeOffsetX
  const cy = y + p.planeOffsetY
  return (
    (planeHeight(p.plane, cx, cy) +
      planeHeight(p.plane, cx, cy + 1) +
      planeHeight(p.plane, cx + 1, cy) +
      planeHeight(p.plane, cx + 1, cy + 1)) >>
    2
  )
}

function copyNormal(n: VertexNormal): VertexNormal {
  return { x: n.x, y: n.y, z: n.z, magnitude: n.magnitude }
}

let mergeCounter = 0
let stamp0 = new Int32Array(4096)
let stamp1 = new Int32Array(4096)

/** `Zs.mergeNormals(a, b, dx, dy, dz, hideFaces)`. */
export function mergeModelNormals(a: RenderModel, b: RenderModel, dx: number, dy: number, dz: number, hideFaces: boolean): void {
  a.calculateBounds()
  a.calculateVertexNormals()
  b.calculateBounds()
  b.calculateVertexNormals()
  const na = a.normals
  const nb = b.normals
  if (!na || !nb) return
  mergeCounter++
  if (stamp0.length < a.usedVertexCount) stamp0 = new Int32Array(a.usedVertexCount * 2)
  if (stamp1.length < b.usedVertexCount) stamp1 = new Int32Array(b.usedVertexCount * 2)
  const ay = a.contourVerticesY ?? a.verticesY
  const by = b.contourVerticesY ?? b.verticesY
  let merged = 0
  for (let i = 0; i < a.usedVertexCount; i++) {
    const n0 = na[i]!
    if (n0.magnitude === 0) continue
    const y = ay[i]! - dy
    if (y > b.minHeight) continue
    const x = a.verticesX[i]! - dx
    if (x < b.minX || x > b.maxX) continue
    const z = a.verticesZ[i]! - dz
    if (z < b.minZ || z > b.maxZ) continue
    for (let j = 0; j < b.usedVertexCount; j++) {
      const n1 = nb[j]!
      if (x !== b.verticesX[j] || z !== b.verticesZ[j] || y !== by[j] || n1.magnitude === 0) continue
      a.mergedNormals ||= new Array(a.usedVertexCount)
      b.mergedNormals ||= new Array(b.usedVertexCount)
      let m0 = a.mergedNormals[i]
      if (!m0) m0 = a.mergedNormals[i] = copyNormal(n0)
      let m1 = b.mergedNormals[j]
      if (!m1) m1 = b.mergedNormals[j] = copyNormal(n1)
      m0.x += n1.x
      m0.y += n1.y
      m0.z += n1.z
      m0.magnitude += n1.magnitude
      m1.x += n0.x
      m1.y += n0.y
      m1.z += n0.z
      m1.magnitude += n0.magnitude
      merged++
      stamp0[i] = mergeCounter
      stamp1[j] = mergeCounter
    }
  }
  if (merged >= 3 && hideFaces) {
    for (let f = 0; f < a.faceCount; f++) {
      if (stamp0[a.indices1[f]!] === mergeCounter && stamp0[a.indices2[f]!] === mergeCounter && stamp0[a.indices3[f]!] === mergeCounter) {
        a.faceRenderTypes ||= new Int8Array(a.faceCount)
        a.faceRenderTypes[f] = 2
      }
    }
    for (let f = 0; f < b.faceCount; f++) {
      if (stamp1[b.indices1[f]!] === mergeCounter && stamp1[b.indices2[f]!] === mergeCounter && stamp1[b.indices3[f]!] === mergeCounter) {
        b.faceRenderTypes ||= new Int8Array(b.faceCount)
        b.faceRenderTypes[f] = 2
      }
    }
  }
}

/** `DC`: bounding-box overlap test, then merge. */
function mergeIfOverlapping(a: MergeablePart, b: MergeablePart, dh: number, hide: boolean): void {
  a.model.calculateBounds()
  b.model.calculateBounds()
  const dx = centreX(b) - centreX(a)
  const dz = centreY(b) - centreY(a)
  const ma = a.model
  const mb = b.model
  if (
    ma.maxX - dx < mb.minX ||
    ma.minX - dx > mb.maxX ||
    ma.maxY - dh < mb.minY ||
    ma.minY - dh > mb.maxY ||
    ma.maxZ - dz < mb.minZ ||
    ma.minZ - dz > mb.maxZ
  ) {
    return
  }
  mergeModelNormals(ma, mb, dx, dh, dz, hide)
}

/**: run the neighbour scan over all mergeable parts. */
export function mergeLocNormals(parts: MergeablePart[]): void {
  for (const p of parts) {
    if (p.model.faceRenderTypes) p.model.faceRenderTypes = new Int8Array(p.model.faceRenderTypes)
    p.model.mergedNormals = undefined
  }
  const byCell = new Map<string, number[]>()
  const key = (level: number, x: number, y: number): string => `${level}:${x}:${y}`
  parts.forEach((p, i) => {
    for (let x = p.tileX; x < p.tileX + p.sizeX; x++) {
      for (let y = p.tileY; y < p.tileY + p.sizeY; y++) {
        const k = key(p.level, x, y)
        const list = byCell.get(k)
        if (list) list.push(i)
        else byCell.set(k, [i])
      }
    }
  })
  const done = new Set<string>()
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!
    const ground = tileGroundHeight(p, p.tileX, p.tileY)
    const floor = p.category === 'floor'
    let xStart = p.tileX
    const xEnd = p.tileX + (floor ? 1 : p.sizeX)
    const yStart = p.tileY - 1
    const yEnd = p.tileY + (floor ? 1 : p.sizeY)
    const levelEnd = floor ? p.level : p.level + 1
    for (let level = p.level; level <= levelEnd; level++) {
      const sameLevel = level === p.level
      for (let x = xStart; x <= xEnd; x++) {
        for (let y = yStart; y <= yEnd; y++) {
          const process = floor
            ? x >= xEnd || y >= yEnd
            : !sameLevel || x >= xEnd || y >= yEnd || (y < p.tileY && p.tileX !== x)
          if (!process) continue
          const list = byCell.get(key(level, x, y))
          if (!list) continue
          const dh = tileGroundHeight(p, x, y) - ground
          for (const j of list) {
            const q = parts[j]!
            if (j === i || q.objectIndex === p.objectIndex) continue
            if (floor ? q.category !== 'floor' : q.category === 'floor') continue
            const a = Math.min(i, j)
            const b = Math.max(i, j)
            const k = `${a}:${b}:${level}:${x}:${y}`
            if (done.has(k)) continue
            done.add(k)
            mergeIfOverlapping(p, q, dh, sameLevel)
          }
        }
      }
      xStart--
    }
  }
  const byObject = new Map<number, number[]>()
  parts.forEach((p, i) => {
    const list = byObject.get(p.objectIndex)
    if (list) list.push(i)
    else byObject.set(p.objectIndex, [i])
  })
  for (const list of byObject.values()) {
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const pa = parts[list[a]!]!
        const pb = parts[list[b]!]!
        if (pa.category === 'boundary' && pb.category === 'boundary') mergeIfOverlapping(pa, pb, 0, false)
      }
    }
  }
}
