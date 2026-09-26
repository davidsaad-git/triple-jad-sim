/**
 * Viewport hit testing (bundle/`jfe`
 *): tiles by ray-marching the terrain, NPCs by their animated
 * model: size-1 NPCs against a padded world box, larger NPCs against each
 * projected face's screen rectangle grown by 5 px; nearest first, one hit
 * per actor, actors behind the ray origin dropped. The player is never
 * pickable.
 */
import type { NpcHitTestData } from './actors/NpcManager'
import type { Camera } from './camera/Camera'

function mul4(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const o = new Float64Array(16)
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r]! * b[c * 4]! + a[4 + r]! * b[c * 4 + 1]! + a[8 + r]! * b[c * 4 + 2]! + a[12 + r]! * b[c * 4 + 3]!
    }
  }
  return o
}

/** Triangle-rect path: returns trunc(meanSquaredEyeDistance * 128^2) or null. */
export function hitTestTriangles(
  px: number,
  py: number,
  hit: NpcHitTestData,
  view: ArrayLike<number>,
  proj: ArrayLike<number>,
  width: number,
  height: number,
): number | null {
  const mv = mul4(view, hit.modelMatrix)
  const mvp = mul4(proj, mv)
  const n = hit.verticesCount
  const sx = new Float64Array(n)
  const sy = new Float64Array(n)
  const d2 = new Float64Array(n)
  for (let v = 0; v < n; v++) {
    const x = hit.verticesX[v]!
    const y = hit.verticesY[v]!
    const z = hit.verticesZ[v]!
    const w = mvp[3]! * x + mvp[7]! * y + mvp[11]! * z + mvp[15]!
    if (w <= 0) {
      sx[v] = NaN
      sy[v] = NaN
    } else {
      const cx = mvp[0]! * x + mvp[4]! * y + mvp[8]! * z + mvp[12]!
      const cy = mvp[1]! * x + mvp[5]! * y + mvp[9]! * z + mvp[13]!
      sx[v] = ((cx / w + 1) * width) / 2
      sy[v] = ((1 - cy / w) * height) / 2
    }
    const ex = mv[0]! * x + mv[4]! * y + mv[8]! * z + mv[12]!
    const ey = mv[1]! * x + mv[5]! * y + mv[9]! * z + mv[13]!
    const ez = mv[2]! * x + mv[6]! * y + mv[10]! * z + mv[14]!
    d2[v] = ex * ex + ey * ey + ez * ez
  }
  let best = Infinity
  for (let f = 0; f < hit.faceCount; f++) {
    if (hit.faceColors3[f] === -2) continue
    const a = hit.indices1[f]!
    const b = hit.indices2[f]!
    const c = hit.indices3[f]!
    const ax = sx[a]!
    const bx = sx[b]!
    const cx = sx[c]!
    if (Number.isNaN(ax) || Number.isNaN(bx) || Number.isNaN(cx)) continue
    const ay = sy[a]!
    const by = sy[b]!
    const cy = sy[c]!
    const minX = Math.min(ax, bx, cx) - 5
    const maxX = Math.max(ax, bx, cx) + 5
    const minY = Math.min(ay, by, cy) - 5
    const maxY = Math.max(ay, by, cy) + 5
    if (px >= minX && px <= maxX && py >= minY && py <= maxY) {
      const d = (d2[a]! + d2[b]! + d2[c]!) / 3
      if (d < best) best = d
    }
  }
  return best === Infinity ? null : Math.trunc(best * 128 * 128)
}

const BOX_FACES: readonly (readonly number[])[] = [
  [0, 2, 6, 4],
  [1, 3, 7, 5],
  [0, 1, 5, 4],
  [2, 3, 7, 6],
  [0, 1, 3, 2],
  [4, 5, 7, 6],
]

function inTriangle(px: number, py: number, a: [number, number], b: [number, number], c: [number, number]): boolean {
  const e = (p: [number, number], q: [number, number]): number => (q[0] - p[0]) * (py - p[1]) - (q[1] - p[1]) * (px - p[0])
  const d1 = e(a, b)
  const d2 = e(b, c)
  const d3 = e(c, a)
  if (Number.isNaN(d1) || Number.isNaN(d2) || Number.isNaN(d3)) return false
  const neg = d1 < 0 || d2 < 0 || d3 < 0
  const pos = d1 > 0 || d2 > 0 || d3 > 0
  return !(neg && pos)
}

/** Padded bounding-box path for size-1 NPCs (`jfe`). */
export function hitTestBox(
  px: number,
  py: number,
  hit: NpcHitTestData,
  view: ArrayLike<number>,
  proj: ArrayLike<number>,
  width: number,
  height: number,
): number | null {
  if (hit.verticesCount === 0) return null
  const m = hit.modelMatrix
  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity
  for (let v = 0; v < hit.verticesCount; v++) {
    const x = hit.verticesX[v]!
    const y = hit.verticesY[v]!
    const z = hit.verticesZ[v]!
    const wx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!
    const wy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!
    const wz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!
    if (wx < minX) minX = wx
    if (wx > maxX) maxX = wx
    if (wy < minY) minY = wy
    if (wy > maxY) maxY = wy
    if (wz < minZ) minZ = wz
    if (wz > maxZ) maxZ = wz
  }
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const cz = (minZ + maxZ) / 2
  const hx = Math.max((maxX - minX) / 2, 32 / 128) + 8 / 128
  const hy = Math.max((maxY - minY) / 2, 32 / 128) + 8 / 128
  const hzv = (maxZ - minZ) / 2
  const pv = mul4(proj, view)
  const screen: [number, number][] = []
  let minD2 = Infinity
  for (let i = 0; i < 8; i++) {
    const x = cx + (i & 1 ? hx : -hx)
    const y = cy + (i & 2 ? hy : -hy)
    const z = cz + (i & 4 ? hzv : -hzv)
    const w = pv[3]! * x + pv[7]! * y + pv[11]! * z + pv[15]!
    if (w <= 0) {
      screen.push([NaN, NaN])
      continue
    }
    const nx = (pv[0]! * x + pv[4]! * y + pv[8]! * z + pv[12]!) / w
    const ny = (pv[1]! * x + pv[5]! * y + pv[9]! * z + pv[13]!) / w
    screen.push([((nx + 1) * width) / 2, ((1 - ny) * height) / 2])
    const ex = view[0]! * x + view[4]! * y + view[8]! * z + view[12]!
    const ey = view[1]! * x + view[5]! * y + view[9]! * z + view[13]!
    const ez = view[2]! * x + view[6]! * y + view[10]! * z + view[14]!
    minD2 = Math.min(minD2, ex * ex + ey * ey + ez * ez)
  }
  let hitAny = false
  for (const [a, b, c, d] of BOX_FACES) {
    if (inTriangle(px, py, screen[a!]!, screen[b!]!, screen[c!]!) || inTriangle(px, py, screen[a!]!, screen[c!]!, screen[d!]!)) {
      hitAny = true
      break
    }
  }
  return !hitAny || minD2 === Infinity ? null : Math.trunc(minD2 * 16384)
}

/** All NPCs under a CSS point, nearest first. */
export function pickNpcs(camera: Camera, px: number, py: number, hits: readonly NpcHitTestData[]): string[] {
  const ray = camera.screenToRay(px, py)
  if (!ray) return []
  const view = camera.viewMatrix()
  const proj = camera.projectionMatrix()
  const w = camera.viewport.width
  const h = camera.viewport.height
  const found: { id: string; d: number }[] = []
  for (const hit of hits) {
    const d = hit.useBoundingBox ? hitTestBox(px, py, hit, view, proj, w, h) : hitTestTriangles(px, py, hit, view, proj, w, h)
    if (d === null) continue
    const m = hit.modelMatrix
    const ox = m[12]! - ray.origin.x
    const oy = m[13]! - ray.origin.y
    const oz = m[14]! - ray.origin.z
    if (ox * ray.direction.x + oy * ray.direction.y + oz * ray.direction.z < 0) continue
    found.push({ id: hit.actorId, d })
  }
  found.sort((a, b) => a.d - b.d)
  const seen = new Set<string>()
  const out: string[] = []
  for (const f of found) {
    if (seen.has(f.id)) continue
    seen.add(f.id)
    out.push(f.id)
  }
  return out
}
