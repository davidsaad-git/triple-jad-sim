/**
 * World-space plugin overlays as flat terrain-hugging meshes (scim
 *, `createCornerOutlineMesh3D`,
 *,
 *, debug grid
 *). Positions are world tiles, heights are
 * the tile-corner heights (no interpolation) lifted 0.01 tiles; drawn in
 * the no-depth pass (except clickboxes).
 */
import { hexToPackedHsl, packHsl8 } from '../color/shading'
import { identityMatrix, type MeshCommand } from '../gl/types'
import type { NpcHitTestData } from '../actors/NpcManager'

export type Heights = readonly ArrayLike<number>[] | null

export interface GridBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/** scim's terrain bounds for the 5-square arena: the offsets' full extent. */
export const ARENA_TERRAIN_BOUNDS: GridBounds = { minX: -64, maxX: 127, minY: -64, maxY: 127 }

const IDENTITY = identityMatrix()

class Builder {
  pos: number[] = []

  tri(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): void {
    this.pos.push(ax, ay, az, bx, by, bz, cx, cy, cz)
  }

  quad(p0: number[], p1: number[], p2: number[], p3: number[]): void {
    this.tri(p0[0]!, p0[1]!, p0[2]!, p1[0]!, p1[1]!, p1[2]!, p2[0]!, p2[1]!, p2[2]!)
    this.tri(p0[0]!, p0[1]!, p0[2]!, p2[0]!, p2[1]!, p2[2]!, p3[0]!, p3[1]!, p3[2]!)
  }

  /** `fillCornerGap`: flat square in the outward quadrant. */
  cornerGap(px: number, py: number, z: number, hw: number, sx: number, sy: number): void {
    const u = px + sx * hw
    const d = py + sy * hw
    this.tri(px, py, z, u, py, z, u, d, z)
    this.tri(px, py, z, u, d, z, px, d, z)
  }

  command(meshId: string, hsl: number, alpha: number, extra: Partial<MeshCommand> = {}, alwaysAlpha = false): MeshCommand {
    const positions = Float32Array.from(this.pos)
    const n = positions.length / 3
    const hslColors = new Float32Array(n).fill(hsl)
    return {
      meshId,
      modelMatrix: IDENTITY,
      positions,
      hslColors,
      ...(alpha < 1 || alwaysAlpha ? { alphas: new Float32Array(n).fill(alpha) } : {}),
      depth: 'none',
      cullFace: 'none',
      ...extra,
    }
  }
}

function corner(h: Heights, x: number, y: number): number {
  if (!h) return 0
  const col = h[Math.max(0, Math.min(h.length - 1, Math.floor(x)))]
  if (!col) return 0
  return col[Math.max(0, Math.min(col.length - 1, Math.floor(y)))] ?? 0
}

/** Terrain z of a tile corner + lift (`H(x,y)`). */
function hz(h: Heights, x: number, y: number, lift = 0.01): number {
  return -corner(h, x, y) / 128 + lift
}

/** Full outline around tiles x0..x1, y0..y1 (`createOutlineMesh3D`). */
export function outlineMesh(h: Heights, x0: number, y0: number, x1: number, y1: number, hsl: number, width: number, alpha = 1, bounds: GridBounds = ARENA_TERRAIN_BOUNDS): MeshCommand {
  const b = new Builder()
  const hw = width / 2
  const H = (x: number, y: number): number => hz(h, x, y)
  const xs = Math.max(x0, bounds.minX)
  const xe = Math.min(x1 + 1, bounds.maxX + 1)
  const ys = Math.max(y0, bounds.minY)
  const ye = Math.min(y1 + 1, bounds.maxY + 1)
  const inX = (v: number): boolean => bounds.minX <= v && v <= bounds.maxX + 1
  const inY = (v: number): boolean => bounds.minY <= v && v <= bounds.maxY + 1
  if (inY(y0)) {
    for (let x = xs; x < xe; x++) {
      const xn = Math.min(x + 1, xe)
      const y = y0
      b.quad([x, y - hw, H(x, y)], [xn, y - hw, H(xn, y)], [xn, y + hw, H(xn, y)], [x, y + hw, H(x, y)])
    }
  }
  if (inY(y1 + 1)) {
    for (let x = xs; x < xe; x++) {
      const xn = Math.min(x + 1, xe)
      const y = y1 + 1
      b.quad([xn, y + hw, H(xn, y)], [x, y + hw, H(x, y)], [x, y - hw, H(x, y)], [xn, y - hw, H(xn, y)])
    }
  }
  if (inX(x1 + 1)) {
    for (let y = ys; y < ye; y++) {
      const yn = Math.min(y + 1, ye)
      const x = x1 + 1
      b.quad([x + hw, y, H(x, y)], [x + hw, yn, H(x, yn)], [x - hw, yn, H(x, yn)], [x - hw, y, H(x, y)])
    }
  }
  if (inX(x0)) {
    for (let y = ys; y < ye; y++) {
      const yn = Math.min(y + 1, ye)
      const x = x0
      b.quad([x - hw, yn, H(x, yn)], [x - hw, y, H(x, y)], [x + hw, y, H(x, y)], [x + hw, yn, H(x, yn)])
    }
  }
  const corners: [number, number, number, number][] = [
    [x0, y0, -1, -1],
    [x1 + 1, y0, 1, -1],
    [x1 + 1, y1 + 1, 1, 1],
    [x0, y1 + 1, -1, 1],
  ]
  for (const [cx, cy, sx, sy] of corners) if (inX(cx) && inY(cy)) b.cornerGap(cx, cy, H(cx, cy), hw, sx, sy)
  return b.command(`outline-${x0}-${y0}-${x1}-${y1}-${hsl}-${alpha}-${width}`, hsl, alpha)
}

/** Corner-only outline of one tile (`createCornerOutlineMesh3D`), arms `f` of an edge. */
export function cornerOutlineMesh(h: Heights, x: number, y: number, hsl: number, width: number, f = 0.25, alpha = 1): MeshCommand {
  const b = new Builder()
  const a = hz(h, x, y)
  const bb = hz(h, x + 1, y)
  const c = hz(h, x + 1, y + 1)
  const d = hz(h, x, y + 1)
  const X0 = x
  const X1 = x + 1
  const Y0 = y
  const Y1 = y + 1
  const hw = width / 2
  const L = (p: number, q: number, t: number): number => p + (q - p) * t
  let xe = L(X0, X1, f)
  let ze = L(a, bb, f)
  b.quad([X0, Y0 - hw, a], [xe, Y0 - hw, ze], [xe, Y0 + hw, ze], [X0, Y0 + hw, a])
  let ye = L(Y0, Y1, f)
  ze = L(a, d, f)
  b.quad([X0 - hw, Y0, a], [X0 - hw, ye, ze], [X0 + hw, ye, ze], [X0 + hw, Y0, a])
  xe = L(X1, X0, f)
  ze = L(bb, a, f)
  b.quad([xe, Y0 - hw, ze], [X1, Y0 - hw, bb], [X1, Y0 + hw, bb], [xe, Y0 + hw, ze])
  ye = L(Y0, Y1, f)
  ze = L(bb, c, f)
  b.quad([X1 + hw, Y0, bb], [X1 + hw, ye, ze], [X1 - hw, ye, ze], [X1 - hw, Y0, bb])
  xe = L(X1, X0, f)
  ze = L(c, d, f)
  b.quad([X1, Y1 + hw, c], [xe, Y1 + hw, ze], [xe, Y1 - hw, ze], [X1, Y1 - hw, c])
  ye = L(Y1, Y0, f)
  ze = L(c, bb, f)
  b.quad([X1 + hw, ye, ze], [X1 + hw, Y1, c], [X1 - hw, Y1, c], [X1 - hw, ye, ze])
  xe = L(X0, X1, f)
  ze = L(d, c, f)
  b.quad([xe, Y1 + hw, ze], [X0, Y1 + hw, d], [X0, Y1 - hw, d], [xe, Y1 - hw, ze])
  ye = L(Y1, Y0, f)
  ze = L(d, a, f)
  b.quad([X0 - hw, ye, ze], [X0 - hw, Y1, d], [X0 + hw, Y1, d], [X0 + hw, ye, ze])
  b.cornerGap(X0, Y0, a, hw, -1, -1)
  b.cornerGap(X1, Y0, bb, hw, 1, -1)
  b.cornerGap(X1, Y1, c, hw, 1, 1)
  b.cornerGap(X0, Y1, d, hw, -1, 1)
  return b.command(`corner-outline-${x}-${y}-${hsl}-${alpha}-${width}`, hsl, alpha)
}

export interface IndicatorStyle {
  enabled: boolean
  color: string
  opacity: number
  width: number
  cornerOnly: boolean
}

export interface TileIndicatorInput {
  enabled: boolean
  trueTile: IndicatorStyle
  hoverTile: IndicatorStyle
  destinationTile: IndicatorStyle
}

function indicator(h: Heights, t: readonly [number, number], s: IndicatorStyle): MeshCommand {
  const hsl = hexToPackedHsl(s.color)
  const w = s.width * 0.02
  return s.cornerOnly ? cornerOutlineMesh(h, t[0], t[1], hsl, w, 0.25, s.opacity) : outlineMesh(h, t[0], t[1], t[0], t[1], hsl, w, s.opacity)
}

const inRange = (t: readonly [number, number]): boolean => t[0] >= 0 && t[0] < 64 && t[1] >= 0 && t[1] < 64
const same = (a: readonly [number, number] | null, b: readonly [number, number] | null): boolean => !!a && !!b && a[0] === b[0] && a[1] === b[1]

/** `buildTileOutlines3D`: true tile, destination, hover (+ debug grid after). */
export function tileIndicators(
  h: Heights,
  cfg: TileIndicatorInput,
  trueTile: readonly [number, number],
  destination: readonly [number, number] | null,
  hover: readonly [number, number] | null,
): MeshCommand[] {
  const out: MeshCommand[] = []
  if (!cfg.enabled) return out
  if (inRange(trueTile) && cfg.trueTile.enabled) out.push(indicator(h, trueTile, cfg.trueTile))
  if (destination && !same(destination, trueTile) && inRange(destination) && cfg.destinationTile.enabled) {
    out.push(indicator(h, destination, cfg.destinationTile))
  }
  if (hover && !same(hover, trueTile) && !same(hover, destination) && inRange(hover) && cfg.hoverTile.enabled) {
    out.push(indicator(h, hover, cfg.hoverTile))
  }
  return out
}

/** Debug grid: 0..64 lines 0.02 tiles wide, colour Dl(0,0,60). */
export function debugGridMesh(h: Heights): MeshCommand {
  const b = new Builder()
  const H = (x: number, y: number): number => hz(h, x, y)
  for (let y = 0; y <= 64; y++) {
    for (let x = 0; x < 64; x++) {
      b.tri(x, y - 0.01, H(x, y), x + 1, y - 0.01, H(x + 1, y), x + 1, y + 0.01, H(x + 1, y))
      b.tri(x, y - 0.01, H(x, y), x + 1, y + 0.01, H(x + 1, y), x, y + 0.01, H(x, y))
    }
  }
  for (let x = 0; x <= 64; x++) {
    for (let y = 0; y < 64; y++) {
      b.tri(x - 0.01, y, H(x, y), x + 0.01, y, H(x, y), x + 0.01, y + 1, H(x, y + 1))
      b.tri(x - 0.01, y, H(x, y), x + 0.01, y + 1, H(x, y + 1), x - 0.01, y + 1, H(x, y + 1))
    }
  }
  return b.command('debug-grid-3d', packHsl8(0, 0, 60), 1)
}

export interface TileMarkerInput {
  x: number
  y: number
  color: string
  opacity: number
  fillOpacity?: number | undefined
  label?: string | undefined
}

/** `buildTileMarkers`: black fill (lift 0.008) then outline, per marker. */
export function tileMarkerMeshes(h: Heights, markers: readonly TileMarkerInput[], widthSetting: number): MeshCommand[] {
  const out: MeshCommand[] = []
  const wpx = Number.isFinite(widthSetting) ? Math.max(0.5, Math.min(10, widthSetting)) : 2
  for (const m of markers) {
    const fill = m.fillOpacity ?? 0
    const hsl = hexToPackedHsl(m.color)
    if (fill > 0) {
      const b = new Builder()
      const H = (x: number, y: number): number => hz(h, x, y, 0.008)
      const { x, y } = m
      b.tri(x, y, H(x, y), x + 1, y, H(x + 1, y), x + 1, y + 1, H(x + 1, y + 1))
      b.tri(x, y, H(x, y), x + 1, y + 1, H(x + 1, y + 1), x, y + 1, H(x, y + 1))
      out.push(b.command(`tile-marker-fill-${fill}-${x}-${y}`, 0, fill, { blend: 'normal' }, true))
    }
    if (m.opacity > 0) out.push(outlineMesh(h, m.x, m.y, m.x, m.y, hsl, wpx * 0.02, m.opacity))
  }
  return out
}

export interface LineMarkerInput {
  x: number
  y: number
  orientation: 'horizontal' | 'vertical'
  color: string
  opacity: number
  label?: string | undefined
}

/** `buildLineMarkers`: one quad per edge, squares on the outside of L-joins. */
export function lineMarkerMeshes(h: Heights, lines: readonly LineMarkerInput[], widthSetting: number): MeshCommand[] {
  const out: MeshCommand[] = []
  const wpx = Number.isFinite(widthSetting) ? Math.max(0.5, Math.min(10, widthSetting)) : 1
  const w = wpx * 0.02
  const groups = new Map<string, LineMarkerInput[]>()
  for (const l of lines) {
    const k = `${l.color}-${l.opacity}`
    const g = groups.get(k)
    if (g) g.push(l)
    else groups.set(k, [l])
  }
  for (const group of groups.values()) {
    const first = group[0]!
    const hsl = hexToPackedHsl(first.color)
    const alpha = first.opacity
    const adj = new Map<string, { x: number; y: number; n: [number, number][] }>()
    const touch = (x: number, y: number, ox: number, oy: number): void => {
      const k = `${x},${y}`
      let v = adj.get(k)
      if (!v) {
        v = { x, y, n: [] }
        adj.set(k, v)
      }
      v.n.push([ox, oy])
    }
    for (const l of group) {
      const ax = l.x
      const ay = l.y
      const bx = l.orientation === 'horizontal' ? l.x + 1 : l.x
      const by = l.orientation === 'horizontal' ? l.y : l.y + 1
      touch(ax, ay, bx, by)
      touch(bx, by, ax, ay)
      const b = new Builder()
      const hw = w / 2
      const hA = hz(h, ax, ay)
      const hB = hz(h, bx, by)
      const [ox, oy] = ay === by ? [0, hw] : [hw, 0]
      b.tri(ax - ox, ay - oy, hA, bx - ox, by - oy, hB, bx + ox, by + oy, hB)
      b.tri(ax - ox, ay - oy, hA, bx + ox, by + oy, hB, ax + ox, ay + oy, hA)
      out.push(b.command(`edge-${ax}-${ay}-${bx}-${by}-${hsl}-${alpha}-${w}`, hsl, alpha))
    }
    for (const v of adj.values()) {
      if (v.n.length !== 2) continue
      let sx = 0
      let sy = 0
      for (const [nx, ny] of v.n) {
        sx += v.x - nx
        sy += v.y - ny
      }
      if (sx === 0 || sy === 0) continue
      const b = new Builder()
      b.cornerGap(v.x, v.y, hz(h, v.x, v.y), w / 2, sx, sy)
      out.push(b.command(`edge-join-${v.x}-${v.y}-${sx}-${sy}-${hsl}-${alpha}-${w}`, hsl, alpha, {}, true))
    }
  }
  return out
}

export interface NpcHighlightInput {
  npcTypeId: number
  mode: 'trueTile' | 'swTile' | 'clickbox'
  color: string
}

export interface HighlightNpc {
  id: string
  npcTypeId: number
  alive: boolean
  size: number
  position: readonly [number, number]
}

/** Clickbox triangles of an NPC's posed model (alpha, colour), transparent pass with depth writes. */
export function clickboxMesh(meshId: string, hit: NpcHitTestData, hsl: number, alpha: number, depthBias: number): MeshCommand {
  const pos: number[] = []
  for (let f = 0; f < hit.faceCount; f++) {
    if (hit.faceColors3[f] === -2) continue
    for (const v of [hit.indices1[f]!, hit.indices2[f]!, hit.indices3[f]!]) pos.push(hit.verticesX[v]!, hit.verticesY[v]!, hit.verticesZ[v]!)
  }
  const positions = Float32Array.from(pos)
  const n = positions.length / 3
  return {
    meshId,
    modelMatrix: hit.modelMatrix,
    positions,
    hslColors: new Float32Array(n).fill(hsl),
    alphas: new Float32Array(n).fill(alpha),
    blend: 'normal',
    depth: 'readwrite',
    cullFace: 'back',
    animated: true,
    depthBias: depthBias + 5e-4,
  }
}

/** `buildNpcHighlights`: per alive NPC, every highlight of its type. */
export function npcHighlightMeshes(
  h: Heights,
  highlights: readonly NpcHighlightInput[],
  npcs: readonly HighlightNpc[],
  hitData: (actorId: string) => NpcHitTestData | undefined,
  depthBias: (npcTypeId: number) => number,
): MeshCommand[] {
  const byType = new Map<number, NpcHighlightInput[]>()
  for (const hl of highlights) {
    const g = byType.get(hl.npcTypeId)
    if (g) g.push(hl)
    else byType.set(hl.npcTypeId, [hl])
  }
  const out: MeshCommand[] = []
  for (const npc of npcs) {
    if (!npc.alive) continue
    for (const hl of byType.get(npc.npcTypeId) ?? []) {
      const hsl = hexToPackedHsl(hl.color)
      const [x, y] = npc.position
      if (hl.mode === 'trueTile') out.push(outlineMesh(h, x, y, x + npc.size - 1, y + npc.size - 1, hsl, 0.04))
      else if (hl.mode === 'swTile') out.push(outlineMesh(h, x, y, x, y, hsl, 0.04))
      else {
        const hit = hitData(npc.id)
        if (hit) out.push(clickboxMesh(`npc-highlight-clickbox-${npc.id}-${hl.color}`, hit, hsl, 0.3, depthBias(npc.npcTypeId)))
      }
    }
  }
  return out
}

/** Debug "NPC Clickbox" overlay: every NPC's hit mesh in red at alpha 0.3. */
export function npcClickboxOverlay(hits: readonly NpcHitTestData[], depthBias: (actorId: string) => number): MeshCommand[] {
  return hits.map((hit) => clickboxMesh(`npc-clickbox-overlay-${hit.actorId}`, hit, packHsl8(0, 255, 100), 0.3, depthBias(hit.actorId)))
}
