/**
 * Orbit / freeform camera, re-implemented from scim's camera:
 *
 * - angles in degrees; pitch stored negative (-22.5 = OSRS 128), yaw 0 looks
 *   north from the south;
 * - eye = target + distance * (cos p sin y, -cos p cos y, sin p);
 * - projection with the OSRS focal length floor(H * zoom / 334) (device px),
 *   reversed depth, near 50/128, far 200 tiles;
 * - limits: pitch [-67.5, -22.5] (relaxed [-87.5, -5]), distance [2, 20]
 *   through updateCamera (the constructor keeps an unclamped distance),
 *   zoom [128 - outerAdjust, innerLimit];
 * - follow height (25 + trunc(25 * clamp(zoom, 128, 896) / 256)) / 128.
 * World units are tiles (x east, y north, z up).
 */

export const DEG = Math.PI / 180
export const NEAR = 50 / 128
export const DEFAULT_PITCH = -22.5
const OUTER_ADJUST_MIN = -400
const ZOOM_STEP = 448
const PITCH_MIN = -67.5
const PITCH_MAX = -22.5
const PITCH_MIN_RELAXED = -87.5
const PITCH_MAX_RELAXED = -5
const DISTANCE_MIN = 2
const DISTANCE_MAX = 20

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** `kf`: inner zoom limit for a Camera-plugin inner level 0..8. */
export function innerZoomLimit(level: number): number {
  return 896 + (Number.isFinite(level) ? clamp(Math.round(level), 0, 8) : 0) * ZOOM_STEP
}

const MAX_INNER = innerZoomLimit(8)

/**: OSRS camera distance for a pitch and a logical viewport height. */
export function osrsDistance(pitch: number, logicalHeight: number): number {
  const p2048 = Math.round((clamp(Math.abs(pitch), 0, 360) * 2048) / 360)
  return ((256 + (64 * clamp(Math.round(logicalHeight) - 334, 0, 100)) / 100) * (600 + 3 * clamp(p2048, 128, 383))) / 256 / 128
}

export interface CameraViewport {
  /** CSS px. */
  width: number
  height: number
  dpr: number
  logicalHeight?: number | undefined
}

export interface CameraState {
  pitch: number
  yaw: number
  yawTarget: number
  distance: number
  fovScale: number
  targetX: number
  targetY: number
  targetZ: number
}

export interface CameraInit {
  pitch?: number
  yaw?: number
  distance?: number
  targetX?: number
  targetY?: number
  targetZ?: number
}

export interface Ray {
  origin: { x: number; y: number; z: number }
  direction: { x: number; y: number; z: number }
}

export type TerrainHeights = readonly ArrayLike<number>[]

export class Camera {
  pitch: number
  yaw: number
  distance: number
  fovScale = 512
  targetX: number
  targetY: number
  targetZ: number
  viewport: CameraViewport
  mode: 'orbit' | 'freeform' = 'orbit'
  freeformX = 13
  freeformY = 10
  freeformZ = 15
  freeformPitch = -45
  freeformYaw = 0
  relaxPitchLimits = false
  innerZoomLimit = 896
  outerZoomAdjust = 0
  distanceOverride: boolean
  yawTarget: number
  terrainHeights: TerrainHeights | null = null
  private view: Float64Array | null = null
  private proj: Float64Array | null = null
  private invView: Float64Array | null = null
  private invProj: Float64Array | null = null

  constructor(viewport: CameraViewport, init: CameraInit = {}) {
    this.viewport = viewport
    this.pitch = init.pitch ?? DEFAULT_PITCH
    this.yaw = init.yaw ?? 0
    this.distanceOverride = init.distance !== undefined
    this.distance = init.distance ?? osrsDistance(this.pitch, viewport.logicalHeight ?? viewport.height)
    this.targetX = init.targetX ?? 13
    this.targetY = init.targetY ?? 10
    this.targetZ = init.targetZ ?? this.followHeight()
    this.yawTarget = this.yaw
  }

  // ---------------------------------------------------------------- terrain

  setTerrainHeights(h: TerrainHeights | null): void {
    this.terrainHeights = h
  }

  /** Corner height, indices clamped to 0..64 (`getTerrainHeightAt`). */
  terrainHeightAt(x: number, y: number): number {
    const h = this.terrainHeights
    if (!h) return 0
    const ix = clamp(Math.floor(x), 0, 64)
    const iy = clamp(Math.floor(y), 0, 64)
    return h[ix]?.[iy] ?? 0
  }

  /** Bilinear height (`getTerrainHeightInterpolated`). */
  terrainHeightInterpolated(x: number, y: number): number {
    const h = this.terrainHeights
    if (!h) return 0
    const ix = clamp(Math.floor(x), 0, 63)
    const iy = clamp(Math.floor(y), 0, 63)
    const fx = clamp(x - ix, 0, 1)
    const fy = clamp(y - iy, 0, 1)
    const a = h[ix]?.[iy] ?? 0
    const b = h[ix + 1]?.[iy] ?? 0
    const c = h[ix]?.[iy + 1] ?? 0
    const d = h[ix + 1]?.[iy + 1] ?? 0
    const s = a + (b - a) * fx
    return s + (c + (d - c) * fx - s) * fy
  }

  followHeight(): number {
    const z = clamp(this.fovScale, 128, 896)
    return (25 + Math.trunc((25 * z) / 256)) / 128
  }

  playerCenterZ(x: number, y: number): number {
    return -this.terrainHeightInterpolated(x, y) / 128 + this.followHeight()
  }

  // ---------------------------------------------------------------- state

  update(p: Partial<Pick<CameraState, 'pitch' | 'yaw' | 'distance' | 'fovScale' | 'targetX' | 'targetY' | 'targetZ'>>): void {
    if (p.pitch !== undefined) {
      const lo = this.relaxPitchLimits ? PITCH_MIN_RELAXED : PITCH_MIN
      const hi = this.relaxPitchLimits ? PITCH_MAX_RELAXED : PITCH_MAX
      this.pitch = Math.max(lo, Math.min(hi, p.pitch))
      if (!this.distanceOverride) this.distance = osrsDistance(this.pitch, this.viewport.logicalHeight ?? this.viewport.height)
    }
    if (p.yaw !== undefined) {
      this.yaw = p.yaw % 360
      this.yawTarget = this.yaw
    }
    if (p.distance !== undefined) {
      this.distanceOverride = true
      this.distance = Math.max(DISTANCE_MIN, Math.min(DISTANCE_MAX, p.distance))
    }
    if (p.fovScale !== undefined) this.fovScale = clamp(Math.round(p.fovScale), this.minFovScale(), this.maxFovScale())
    if (p.targetX !== undefined) this.targetX = p.targetX
    if (p.targetY !== undefined) this.targetY = p.targetY
    if (p.targetZ !== undefined) this.targetZ = p.targetZ
    this.invalidate()
  }

  setLimits(opts: { relaxPitch: boolean; innerZoomLimit: number; outerZoomAdjust: number }): void {
    this.relaxPitchLimits = opts.relaxPitch
    this.innerZoomLimit = clamp(Math.round(opts.innerZoomLimit), 896, MAX_INNER)
    this.outerZoomAdjust = clamp(opts.outerZoomAdjust, OUTER_ADJUST_MIN, 400)
    this.update({ pitch: this.pitch, fovScale: this.fovScale })
  }

  minFovScale(): number {
    return 128 - this.outerZoomAdjust
  }

  maxFovScale(): number {
    return this.innerZoomLimit
  }

  setViewport(v: CameraViewport): void {
    this.viewport = v
    if (!this.distanceOverride) this.distance = osrsDistance(this.pitch, v.logicalHeight ?? v.height)
    this.proj = null
    this.invProj = null
  }

  state(): CameraState {
    return {
      pitch: this.pitch,
      yaw: this.yaw,
      yawTarget: this.yawTarget,
      distance: this.distance,
      fovScale: this.fovScale,
      targetX: this.targetX,
      targetY: this.targetY,
      targetZ: this.targetZ,
    }
  }

  setMode(mode: 'orbit' | 'freeform'): void {
    if (this.mode === mode) return
    if (mode === 'freeform') {
      const e = this.orbitEye()
      this.freeformX = e.x
      this.freeformY = e.y
      this.freeformZ = e.z
      this.freeformPitch = this.pitch
      this.freeformYaw = this.yaw
    }
    this.mode = mode
    this.view = null
    this.invView = null
  }

  updateFreeform(p: { x?: number; y?: number; z?: number; pitch?: number; yaw?: number }): void {
    if (p.x !== undefined) this.freeformX = p.x
    if (p.y !== undefined) this.freeformY = p.y
    if (p.z !== undefined) this.freeformZ = Math.max(0.5, p.z)
    if (p.pitch !== undefined) this.freeformPitch = Math.max(-89, Math.min(89, p.pitch))
    if (p.yaw !== undefined) this.freeformYaw = p.yaw
    this.view = null
    this.invView = null
  }

  moveFreeform(forward: number, right: number, up: number): void {
    const y = this.freeformYaw * DEG
    this.freeformX += -Math.sin(y) * forward + Math.cos(y) * right
    this.freeformY += Math.cos(y) * forward + Math.sin(y) * right
    this.freeformZ = Math.max(0.5, this.freeformZ + up)
    this.view = null
    this.invView = null
  }

  invalidate(): void {
    this.view = null
    this.proj = null
    this.invView = null
    this.invProj = null
  }

  // ---------------------------------------------------------------- matrices

  orbitEye(): { x: number; y: number; z: number } {
    const p = Math.abs(this.pitch) * DEG
    const y = this.yaw * DEG
    return {
      x: this.targetX + this.distance * Math.cos(p) * Math.sin(y),
      y: this.targetY - this.distance * Math.cos(p) * Math.cos(y),
      z: this.targetZ + this.distance * Math.sin(p),
    }
  }

  eye(): { x: number; y: number; z: number } {
    return this.mode === 'freeform' ? { x: this.freeformX, y: this.freeformY, z: this.freeformZ } : this.orbitEye()
  }

  /** OSRS-space camera for the painter sort. */
  osrsProjection(): { cameraX: number; cameraY: number; cameraZ: number; yawSin: number; yawCos: number; pitchSin: number; pitchCos: number } {
    const e = this.eye()
    const pitch = this.mode === 'freeform' ? -this.freeformPitch : Math.abs(this.pitch)
    const yaw = this.mode === 'freeform' ? this.freeformYaw : this.yaw
    const p = pitch * DEG
    const y = yaw * DEG
    return {
      cameraX: e.x * 128,
      cameraY: -e.z * 128,
      cameraZ: e.y * 128,
      yawSin: Math.sin(y),
      yawCos: Math.cos(y),
      pitchSin: Math.sin(p),
      pitchCos: Math.cos(p),
    }
  }

  viewMatrix(): Float64Array {
    if (this.view) return this.view
    let ex: number
    let ey: number
    let ez: number
    let cp: number
    let sp: number
    let cy: number
    let sy: number
    if (this.mode === 'freeform') {
      ex = this.freeformX
      ey = this.freeformY
      ez = this.freeformZ
      const p = -this.freeformPitch * DEG
      const y = this.freeformYaw * DEG
      cp = Math.cos(p)
      sp = Math.sin(p)
      cy = Math.cos(y)
      sy = Math.sin(y)
    } else {
      const p = Math.abs(this.pitch) * DEG
      const y = this.yaw * DEG
      cp = Math.cos(p)
      sp = Math.sin(p)
      cy = Math.cos(y)
      sy = Math.sin(y)
      const e = this.orbitEye()
      ex = e.x
      ey = e.y
      ez = e.z
    }
    const rx = cy
    const ry = sy
    const ux = -sp * sy
    const uy = sp * cy
    const uz = cp
    const bx = cp * sy
    const by = -cp * cy
    const bz = sp
    this.view = new Float64Array([
      rx,
      ux,
      bx,
      0,
      ry,
      uy,
      by,
      0,
      0,
      uz,
      bz,
      0,
      -(rx * ex + ry * ey),
      -(ux * ex + uy * ey + uz * ez),
      -(bx * ex + by * ey + bz * ez),
      1,
    ])
    return this.view
  }

  projectionMatrix(): Float64Array {
    if (this.proj) return this.proj
    const w = Math.max(1, Math.floor(this.viewport.width * this.viewport.dpr))
    const h = Math.max(1, Math.floor(this.viewport.height * this.viewport.dpr))
    const f = Math.floor((h * this.fovScale) / 334)
    const inv = 1 / 199.609375
    this.proj = new Float64Array([(2 * f) / w, 0, 0, 0, 0, (2 * f) / h, 0, 0, 0, 0, 200.390625 * inv, -1, 0, 0, 400 * NEAR * inv, 0])
    return this.proj
  }

  /** projection * view as float32 (for the renderer). */
  viewProjection(out = new Float32Array(16)): Float32Array {
    const p = this.projectionMatrix()
    const v = this.viewMatrix()
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        out[col * 4 + row] = p[row]! * v[col * 4]! + p[4 + row]! * v[col * 4 + 1]! + p[8 + row]! * v[col * 4 + 2]! + p[12 + row]! * v[col * 4 + 3]!
      }
    }
    return out
  }

  // ---------------------------------------------------------------- projection helpers

  /** World (tiles, z up) -> CSS px, or null when behind the near plane (`projectScreenFromWorld`). */
  project(x: number, y: number, z: number): { x: number; y: number } | null {
    const v = this.viewMatrix()
    const p = this.projectionMatrix()
    const vx = v[0]! * x + v[4]! * y + v[8]! * z + v[12]!
    const vy = v[1]! * x + v[5]! * y + v[9]! * z + v[13]!
    const vz = v[2]! * x + v[6]! * y + v[10]! * z + v[14]!
    const vw = v[3]! * x + v[7]! * y + v[11]! * z + v[15]!
    if (-vz < NEAR) return null
    const cx = p[0]! * vx + p[4]! * vy + p[8]! * vz + p[12]! * vw
    const cy = p[1]! * vx + p[5]! * vy + p[9]! * vz + p[13]! * vw
    const cw = p[3]! * vx + p[7]! * vy + p[11]! * vz + p[15]! * vw
    if (cw <= 0) return null
    return { x: (cx / cw + 1) * 0.5 * this.viewport.width, y: (1 - cy / cw) * 0.5 * this.viewport.height }
  }

  /** `tileToScreen`: level = world z, defaults to the interpolated terrain surface. */
  tileToScreen(x: number, y: number, level?: number): { x: number; y: number } | null {
    return this.project(x, y, level ?? -this.terrainHeightInterpolated(x, y) / 128)
  }

  /** CSS px -> world ray. */
  screenToRay(px: number, py: number): Ray | null {
    const nx = (px / this.viewport.width) * 2 - 1
    const ny = 1 - (py / this.viewport.height) * 2
    const ip = this.invProj ?? (this.invProj = invert(this.projectionMatrix()))
    const iv = this.invView ?? (this.invView = invert(this.viewMatrix()))
    if (!ip || !iv) return null
    const unproject = (z: number): [number, number, number] => {
      let x = ip[0]! * nx + ip[4]! * ny + ip[8]! * z + ip[12]!
      let y = ip[1]! * nx + ip[5]! * ny + ip[9]! * z + ip[13]!
      let zz = ip[2]! * nx + ip[6]! * ny + ip[10]! * z + ip[14]!
      const w = ip[3]! * nx + ip[7]! * ny + ip[11]! * z + ip[15]!
      if (w !== 0) {
        x /= w
        y /= w
        zz /= w
      }
      return [iv[0]! * x + iv[4]! * y + iv[8]! * zz + iv[12]!, iv[1]! * x + iv[5]! * y + iv[9]! * zz + iv[13]!, iv[2]! * x + iv[6]! * y + iv[10]! * zz + iv[14]!]
    }
    const near = unproject(1)
    const far = unproject(-1)
    let dx = far[0] - near[0]
    let dy = far[1] - near[1]
    let dz = far[2] - near[2]
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (len > 0) {
      dx /= len
      dy /= len
      dz /= len
    }
    return { origin: { x: near[0], y: near[1], z: near[2] }, direction: { x: dx, y: dy, z: dz } }
  }

  /** `screenToTile`: 300 steps of 0.2 tiles against corner heights. */
  screenToTile(px: number, py: number): { x: number; y: number } | null {
    const ray = this.screenToRay(px, py)
    if (!ray) return null
    const { origin: o, direction: d } = ray
    if (!this.terrainHeights) {
      if (d.z >= 0) return null
      const t = -o.z / d.z
      if (t < 0) return null
      const tx = Math.floor(o.x + d.x * t)
      const ty = Math.floor(o.y + d.y * t)
      return tx < 0 || tx > 63 || ty < 0 || ty > 63 ? null : { x: tx, y: ty }
    }
    for (let i = 0; i < 300; i++) {
      const t = i * 0.2
      const x = o.x + d.x * t
      const y = o.y + d.y * t
      const z = o.z + d.z * t
      const tx = Math.floor(x)
      const ty = Math.floor(y)
      if (tx < 0 || tx > 63 || ty < 0 || ty > 63) continue
      if (z <= -this.terrainHeightAt(tx, ty) / 128) return { x: tx, y: ty }
    }
    return null
  }

  /** `screenToTileEdge`: the edge of the hovered tile nearest the cursor. */
  screenToTileEdge(px: number, py: number): { x: number; y: number; edge: 'north' | 'east' | 'south' | 'west' } | null {
    const tile = this.screenToTile(px, py)
    if (!tile) return null
    const { x, y } = tile
    const corner = (cx: number, cy: number) => this.project(cx, cy, -this.terrainHeightInterpolated(cx, cy) / 128)
    const sw = corner(x, y)
    const se = corner(x + 1, y)
    const ne = corner(x + 1, y + 1)
    const nw = corner(x, y + 1)
    if (!sw || !se || !ne || !nw) return null
    const edges: { edge: 'north' | 'east' | 'south' | 'west'; a: { x: number; y: number }; b: { x: number; y: number } }[] = [
      { edge: 'south', a: sw, b: se },
      { edge: 'east', a: se, b: ne },
      { edge: 'north', a: nw, b: ne },
      { edge: 'west', a: sw, b: nw },
    ]
    let best: { edge: 'north' | 'east' | 'south' | 'west'; dist: number } | null = null
    for (const e of edges) {
      const dist = pointSegmentDistanceSq(px, py, e.a, e.b)
      if (!best || dist < best.dist) best = { edge: e.edge, dist }
    }
    return best ? { x, y, edge: best.edge } : null
  }
}

/** Squared distance from a point to a segment. */
export function pointSegmentDistanceSq(px: number, py: number, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = dx * dx + dy * dy
  if (len === 0) return (px - a.x) ** 2 + (py - a.y) ** 2
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / len))
  const x = a.x + t * dx
  const y = a.y + t * dy
  return (px - x) ** 2 + (py - y) ** 2
}

/** General 4x4 inverse (column-major), null when singular. */
export function invert(m: ArrayLike<number>): Float64Array | null {
  const inv = new Float64Array(16)
  inv[0] = m[5]! * m[10]! * m[15]! - m[5]! * m[11]! * m[14]! - m[9]! * m[6]! * m[15]! + m[9]! * m[7]! * m[14]! + m[13]! * m[6]! * m[11]! - m[13]! * m[7]! * m[10]!
  inv[4] = -m[4]! * m[10]! * m[15]! + m[4]! * m[11]! * m[14]! + m[8]! * m[6]! * m[15]! - m[8]! * m[7]! * m[14]! - m[12]! * m[6]! * m[11]! + m[12]! * m[7]! * m[10]!
  inv[8] = m[4]! * m[9]! * m[15]! - m[4]! * m[11]! * m[13]! - m[8]! * m[5]! * m[15]! + m[8]! * m[7]! * m[13]! + m[12]! * m[5]! * m[11]! - m[12]! * m[7]! * m[9]!
  inv[12] = -m[4]! * m[9]! * m[14]! + m[4]! * m[10]! * m[13]! + m[8]! * m[5]! * m[14]! - m[8]! * m[6]! * m[13]! - m[12]! * m[5]! * m[10]! + m[12]! * m[6]! * m[9]!
  inv[1] = -m[1]! * m[10]! * m[15]! + m[1]! * m[11]! * m[14]! + m[9]! * m[2]! * m[15]! - m[9]! * m[3]! * m[14]! - m[13]! * m[2]! * m[11]! + m[13]! * m[3]! * m[10]!
  inv[5] = m[0]! * m[10]! * m[15]! - m[0]! * m[11]! * m[14]! - m[8]! * m[2]! * m[15]! + m[8]! * m[3]! * m[14]! + m[12]! * m[2]! * m[11]! - m[12]! * m[3]! * m[10]!
  inv[9] = -m[0]! * m[9]! * m[15]! + m[0]! * m[11]! * m[13]! + m[8]! * m[1]! * m[15]! - m[8]! * m[3]! * m[13]! - m[12]! * m[1]! * m[11]! + m[12]! * m[3]! * m[9]!
  inv[13] = m[0]! * m[9]! * m[14]! - m[0]! * m[10]! * m[13]! - m[8]! * m[1]! * m[14]! + m[8]! * m[2]! * m[13]! + m[12]! * m[1]! * m[10]! - m[12]! * m[2]! * m[9]!
  inv[2] = m[1]! * m[6]! * m[15]! - m[1]! * m[7]! * m[14]! - m[5]! * m[2]! * m[15]! + m[5]! * m[3]! * m[14]! + m[13]! * m[2]! * m[7]! - m[13]! * m[3]! * m[6]!
  inv[6] = -m[0]! * m[6]! * m[15]! + m[0]! * m[7]! * m[14]! + m[4]! * m[2]! * m[15]! - m[4]! * m[3]! * m[14]! - m[12]! * m[2]! * m[7]! + m[12]! * m[3]! * m[6]!
  inv[10] = m[0]! * m[5]! * m[15]! - m[0]! * m[7]! * m[13]! - m[4]! * m[1]! * m[15]! + m[4]! * m[3]! * m[13]! + m[12]! * m[1]! * m[7]! - m[12]! * m[3]! * m[5]!
  inv[14] = -m[0]! * m[5]! * m[14]! + m[0]! * m[6]! * m[13]! + m[4]! * m[1]! * m[14]! - m[4]! * m[2]! * m[13]! - m[12]! * m[1]! * m[6]! + m[12]! * m[2]! * m[5]!
  inv[3] = -m[1]! * m[6]! * m[11]! + m[1]! * m[7]! * m[10]! + m[5]! * m[2]! * m[11]! - m[5]! * m[3]! * m[10]! - m[9]! * m[2]! * m[7]! + m[9]! * m[3]! * m[6]!
  inv[7] = m[0]! * m[6]! * m[11]! - m[0]! * m[7]! * m[10]! - m[4]! * m[2]! * m[11]! + m[4]! * m[3]! * m[10]! + m[8]! * m[2]! * m[7]! - m[8]! * m[3]! * m[6]!
  inv[11] = -m[0]! * m[5]! * m[11]! + m[0]! * m[7]! * m[9]! + m[4]! * m[1]! * m[11]! - m[4]! * m[3]! * m[9]! - m[8]! * m[1]! * m[7]! + m[8]! * m[3]! * m[5]!
  inv[15] = m[0]! * m[5]! * m[10]! - m[0]! * m[6]! * m[9]! - m[4]! * m[1]! * m[10]! + m[4]! * m[2]! * m[9]! + m[8]! * m[1]! * m[6]! - m[8]! * m[2]! * m[5]!
  let det = m[0]! * inv[0]! + m[1]! * inv[4]! + m[2]! * inv[8]! + m[3]! * inv[12]!
  if (det === 0) return null
  det = 1 / det
  for (let i = 0; i < 16; i++) inv[i] = inv[i]! * det
  return inv
}
