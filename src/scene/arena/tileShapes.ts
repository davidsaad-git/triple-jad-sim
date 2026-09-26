/**
 * OSRS tile shapes as scim tabulates them (:, `qb`;
 * rotation; point-in-shape height). Identical to the
 * client's TileModel tables.
 */

/** Per shape: canonical point ids (1-based). */
const SHAPE_POINTS: readonly (readonly number[])[] = [
  [1, 3, 5, 7],
  [1, 3, 5, 7],
  [1, 3, 5, 7],
  [1, 3, 5, 7, 6],
  [1, 3, 5, 7, 6],
  [1, 3, 5, 7, 6],
  [1, 3, 5, 7, 6],
  [1, 3, 5, 7, 2, 6],
  [1, 3, 5, 7, 2, 8],
  [1, 3, 5, 7, 2, 8],
  [1, 3, 5, 7, 11, 12],
  [1, 3, 5, 7, 11, 12],
  [1, 3, 5, 7, 13, 14],
]

/** Per shape: faces as (isOverlay, a, b, c) quadruples over the shape's point list. */
const SHAPE_FACES: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 0, 0, 1, 3],
  [1, 1, 2, 3, 1, 0, 1, 3],
  [0, 1, 2, 3, 1, 0, 1, 3],
  [0, 0, 1, 2, 0, 0, 2, 4, 1, 0, 4, 3],
  [0, 0, 1, 4, 0, 0, 4, 3, 1, 1, 2, 4],
  [0, 0, 4, 3, 1, 0, 1, 2, 1, 0, 2, 4],
  [0, 1, 2, 4, 1, 0, 1, 4, 1, 0, 4, 3],
  [0, 4, 1, 2, 0, 4, 2, 5, 1, 0, 4, 5, 1, 0, 5, 3],
  [0, 4, 1, 2, 0, 4, 2, 3, 0, 4, 3, 5, 1, 0, 4, 5],
  [0, 0, 4, 5, 1, 4, 1, 2, 1, 4, 2, 3, 1, 4, 3, 5],
  [0, 0, 1, 5, 0, 1, 4, 5, 0, 1, 2, 4, 1, 0, 5, 3, 1, 5, 4, 3, 1, 4, 2, 3],
  [1, 0, 1, 5, 1, 1, 4, 5, 1, 1, 2, 4, 0, 0, 5, 3, 0, 5, 4, 3, 0, 4, 2, 3],
  [1, 0, 5, 4, 1, 0, 1, 5, 0, 0, 4, 3, 0, 4, 5, 3, 0, 5, 2, 3, 0, 1, 2, 5],
]

/** Point id - 1 -> (x, z) in OSRS units within the tile and the two corners it averages (0 SW, 1 SE, 2 NE, 3 NW). */
const POINTS: readonly (readonly [number, number, number, number])[] = [
  [0, 0, 0, 0],
  [64, 0, 1, 0],
  [128, 0, 1, 1],
  [128, 64, 1, 2],
  [128, 128, 2, 2],
  [64, 128, 3, 2],
  [0, 128, 3, 3],
  [0, 64, 3, 0],
  [64, 32, 1, 0],
  [96, 64, 1, 2],
  [64, 96, 3, 2],
  [32, 64, 3, 0],
  [32, 32, 0, 0],
  [96, 32, 1, 1],
  [96, 96, 2, 2],
  [32, 96, 3, 3],
]

export interface ShapeVertex {
  x: number
  y: number
  height: number
  cornerA: number
  cornerB: number
}

export interface ShapeFace {
  isOverlay: boolean
  a: number
  b: number
  c: number
}

export interface ShapeGeometry {
  vertices: ShapeVertex[]
  faces: ShapeFace[]
}

/**
 * Vertices (with heights averaged from `cornerHeights` [SW, SE, NE, NW])
 * and faces of shape `shape` (0 = plain tile, 1..12 = overlay shape + 1)
 * rotated by `rotation` (0..3).
 */
export function shapeGeometry(shape: number, rotation: number, cornerHeights: readonly number[]): ShapeGeometry {
  const points = SHAPE_POINTS[shape] ?? SHAPE_POINTS[0]!
  const vertices = points.map((id) => {
    let p = id
    if ((id & 1) === 0 && id <= 8) p = ((id - rotation * 2 - 1) & 7) + 1
    if (id > 8 && id <= 12) p = ((id - 9 - rotation) & 3) + 9
    if (id > 12) p = ((id - 13 - rotation) & 3) + 13
    const [x, y, a, b] = POINTS[p - 1]!
    const height = a === b ? cornerHeights[a]! : (cornerHeights[a]! + cornerHeights[b]!) >> 1
    return { x, y, height, cornerA: a, cornerB: b }
  })
  const list = SHAPE_FACES[shape] ?? SHAPE_FACES[0]!
  const faces: ShapeFace[] = []
  for (let i = 0; i < list.length; i += 4) {
    const a = list[i + 1]!
    const b = list[i + 2]!
    const c = list[i + 3]!
    faces.push({
      isOverlay: list[i] === 1,
      a: a < 4 ? (a - rotation) & 3 : a,
      b: b < 4 ? (b - rotation) & 3 : b,
      c: c < 4 ? (c - rotation) & 3 : c,
    })
  }
  return { vertices, faces }
}

/**
 * Height of the shape surface at (px, pz) OSRS units within the tile, or
 * undefined when outside every face (float32 barycentrics).
 */
export function shapeSurfaceHeight(geom: ShapeGeometry, px: number, pz: number): number | undefined {
  for (const f of geom.faces) {
    const a = geom.vertices[f.a]!
    const b = geom.vertices[f.b]!
    const c = geom.vertices[f.c]!
    const det = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y)
    const w1 = (b.y - c.y) * (px - c.x) + (c.x - b.x) * (pz - c.y)
    const w2 = (c.y - a.y) * (px - c.x) + (a.x - c.x) * (pz - c.y)
    const w3 = det - w1 - w2
    if (det < 0 ? w1 > 0 || w2 > 0 || w3 > 0 : w1 < 0 || w2 < 0 || w3 < 0) continue
    const l1 = Math.fround(w1 / det)
    const l2 = Math.fround(w2 / det)
    const l3 = Math.fround(Math.fround(1 - l1) - l2)
    return Math.fround(Math.fround(Math.fround(l1 * a.height) + Math.fround(l2 * b.height)) + Math.fround(l3 * c.height)) | 0
  }
  return undefined
}
