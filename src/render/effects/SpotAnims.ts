/**
 * Spot animations ("graphics"): model loading/posing (scim SpotAnimLoader
 *) and the instance renderer (`fd`).
 *
 * Per frame of the spot anim's sequence the model is copied, recoloured,
 * posed, resized (w, h, w), turned by its orientation, retextured and lit
 * with (-30, -50, -30), ambient + 64, contrast + 850; hidden faces are
 * drawn black (`renderTexturedAsBlack`). Opaque parts are drawn without
 * face culling, transparent parts with back-face culling (unsorted).
 */
import type { SeqFrameLoader } from '../../cache/anim/SeqLoaders'
import type { SeqType, SeqTypeLoader } from '../../cache/config/SeqType'
import type { SpotAnimTypeLoader } from '../../cache/config/SpotAnimType'
import type { MeshCommand } from '../gl/types'
import { buildModelMesh, splitOpaqueTransparent, type MeshArrays, type TextureLayerResolver } from '../model/meshBuild'
import type { ModelSource } from '../model/ModelSource'
import type { RenderModel } from '../model/RenderModel'

interface Part {
  meshId: string
  mesh: MeshArrays
  transparent: boolean
}

interface Entry {
  id: number
  staticParts: Part[]
  frames: Part[][]
  frameLengths: number[]
  frameStep: number
  heightOffset: number
  seq: SeqType | null
}

export interface SpotTransform {
  x: number
  y: number
  z: number
  yaw2048?: number
  pitchRad?: number
  scale?: number
}

export type SpotLifecycle =
  | { kind: 'oneShot'; startTick: number; durationTicks?: number }
  | { kind: 'duration'; startTick: number; endTick: number }
  | { kind: 'persistent'; startTick: number }
  | { kind: 'manual' }

export interface SpotStyle {
  depthBias?: number
  cullFace?: 'back' | 'front' | 'none'
}

export interface SpotInstance {
  instanceId: string
  spotAnimId: number
  transform: SpotTransform | ((currentTick: number, interpTick: number) => SpotTransform | null)
  lifecycle: SpotLifecycle
  style?: SpotStyle | undefined
  frameProgress?: number | undefined
  heightOffsetMode?: 'sequence' | 'actor'
  lastRenderCenter?: { x: number; y: number }
}

export interface SpotAnimDeps {
  spotTypes: SpotAnimTypeLoader
  seqTypes: SeqTypeLoader
  frames: SeqFrameLoader
  models: ModelSource
  resolveTextureLayer: TextureLayerResolver
}

/** First index whose cumulative length exceeds progress * total. */
export function frameIndexAt(progress: number, lengths: readonly number[], total: number): number {
  if (lengths.length === 0 || total === 0) return 0
  const r = progress * total
  let acc = 0
  for (let i = 0; i < lengths.length; i++) {
    acc += lengths[i]!
    if (r < acc) return i
  }
  return lengths.length - 1
}

/** `fillModelMatrix`. */
export function spotModelMatrix(out: Float32Array, t: SpotTransform): Float32Array {
  const s = (1 / 128) * (t.scale ?? 1)
  const a = ((t.yaw2048 ?? 0) / 2048) * 2 * Math.PI
  const p = t.pitchRad ?? 0
  const ca = Math.cos(a)
  const sa = Math.sin(a)
  const cp = Math.cos(p)
  const sp = Math.sin(p)
  out[0] = s * ca
  out[1] = -s * sa
  out[2] = 0
  out[3] = 0
  out[4] = s * sa * sp
  out[5] = s * ca * sp
  out[6] = -s * cp
  out[7] = 0
  out[8] = s * sa * cp
  out[9] = s * ca * cp
  out[10] = s * sp
  out[11] = 0
  out[12] = t.x
  out[13] = t.y
  out[14] = t.z
  out[15] = 1
  return out
}

export class SpotAnimSystem {
  private readonly deps: SpotAnimDeps
  private readonly entries = new Map<number, Entry | null>()
  readonly instances = new Map<string, SpotInstance>()
  private sortProjection: { cameraX: number; cameraY: number; cameraZ: number; yawSin: number; yawCos: number; pitchSin: number; pitchCos: number } | null = null

  constructor(deps: SpotAnimDeps) {
    this.deps = deps
  }

  // ---------------------------------------------------------------- loading

  load(id: number): boolean {
    if (id < 0) return false
    if (this.entries.has(id)) return this.entries.get(id) !== null
    try {
      this.entries.set(id, this.build(id))
    } catch (e) {
      console.warn(`spot anim ${id} failed: ${(e as Error).message}`)
      this.entries.set(id, { id, staticParts: [], frames: [], frameLengths: [], frameStep: -1, heightOffset: 0, seq: null })
    }
    return true
  }

  isLoaded(id: number): boolean {
    return this.entries.has(id) && this.entries.get(id) !== undefined
  }

  frameLengths(id: number): number[] | undefined {
    return this.entries.get(id)?.frameLengths
  }

  seqOf(id: number): SeqType | null {
    return this.entries.get(id)?.seq ?? null
  }

  private prepare(base: RenderModel, t: ReturnType<SpotAnimTypeLoader['load']>, frame: ReturnType<SeqFrameLoader['load']> | null): RenderModel {
    const m = base.copy()
    for (let i = 0; i < t.recolorFrom.length; i++) m.recolor(t.recolorFrom[i]!, t.recolorTo[i]!)
    if (frame) m.animate(frame)
    if (t.widthScale !== 128 || t.heightScale !== 128) m.resize(t.widthScale, t.heightScale, t.widthScale)
    if (t.orientation === 90) m.rotate90()
    else if (t.orientation === 180) m.rotate180()
    else if (t.orientation === 270) m.rotate270()
    for (let i = 0; i < t.retextureFrom.length; i++) m.retexture(t.retextureFrom[i]!, t.retextureTo[i]!)
    return m
  }

  private parts(prefix: string, m: RenderModel, t: ReturnType<SpotAnimTypeLoader['load']>): Part[] {
    const lit = m.computeLitColors(t.ambient + 64, t.contrast + 850, -30, -50, -30)
    const mesh = buildModelMesh(m, lit, { resolveTextureLayer: this.deps.resolveTextureLayer, renderTexturedAsBlack: true })
    const split = splitOpaqueTransparent(mesh)
    const out: Part[] = []
    if (split.opaque) out.push({ meshId: `${prefix}-opaque`, mesh: split.opaque, transparent: false })
    if (split.transparent) out.push({ meshId: `${prefix}-transparent`, mesh: split.transparent, transparent: true })
    return out
  }

  private build(id: number): Entry {
    const t = this.deps.spotTypes.load(id)
    const base = t.modelId >= 0 ? this.deps.models.get(t.modelId) : undefined
    if (!base) return { id, staticParts: [], frames: [], frameLengths: [], frameStep: -1, heightOffset: 0, seq: null }
    const seq = t.sequenceId >= 0 ? this.deps.seqTypes.load(t.sequenceId) : null
    if (seq && seq.frameIds && seq.frameIds.length > 0 && !seq.isSkeletalSeq()) {
      const animBase = base.copy()
      animBase.computeAnimationTables()
      const frames: Part[][] = []
      for (let i = 0; i < seq.frameIds.length; i++) {
        const frame = this.deps.frames.load(seq.frameIds[i]!) ?? null
        frames.push(this.parts(`spotanim-${id}-frame-${i}`, this.prepare(animBase, t, frame), t))
      }
      return {
        id,
        staticParts: [],
        frames,
        frameLengths: seq.frameIds.map((_, i) => seq.frameLengths[i] || 1),
        frameStep: seq.frameStep,
        heightOffset: seq.heightOffset,
        seq,
      }
    }
    const staticParts = this.parts(`spotanim-${id}`, this.prepare(base, t, null), t)
    if (seq) {
      return { id, staticParts, frames: [staticParts], frameLengths: seq.frameLengths.length > 0 ? [...seq.frameLengths] : [1], frameStep: seq.frameStep, heightOffset: seq.heightOffset, seq }
    }
    return { id, staticParts, frames: [], frameLengths: [], frameStep: -1, heightOffset: 0, seq: null }
  }

  // ---------------------------------------------------------------- instances

  upsert(inst: SpotInstance): void {
    const prev = this.instances.get(inst.instanceId)
    if (prev?.lastRenderCenter) inst.lastRenderCenter = prev.lastRenderCenter
    this.instances.set(inst.instanceId, inst)
  }

  despawn(id: string): void {
    this.instances.delete(id)
  }

  despawnPrefix(prefix: string): void {
    for (const k of [...this.instances.keys()]) if (k.startsWith(prefix)) this.instances.delete(k)
  }

  clear(): void {
    this.instances.clear()
  }

  private totalTicks(e: Entry | null | undefined): number {
    const sum = e ? e.frameLengths.reduce((a, b) => a + b, 0) : 0
    return sum > 0 ? sum / 30 : 3
  }

  /** Remove expired instances. */
  tick(interpTick: number): void {
    for (const [k, i] of this.instances) {
      const l = i.lifecycle
      if (l.kind === 'duration' && interpTick >= l.endTick) this.instances.delete(k)
      else if (l.kind === 'oneShot' && interpTick >= l.startTick + (l.durationTicks ?? this.totalTicks(this.entries.get(i.spotAnimId)))) {
        this.instances.delete(k)
      }
    }
  }

  setSortProjection(p: SpotAnimSystem['sortProjection']): void {
    this.sortProjection = p
  }

  /** Emit the current frame of every live instance. */
  render(out: MeshCommand[], currentTick: number, interpTick: number): void {
    for (const inst of this.instances.values()) {
      const l = inst.lifecycle
      if (l.kind !== 'manual' && interpTick < l.startTick) continue
      const e = this.entries.get(inst.spotAnimId)
      if (!e) continue
      const tr = typeof inst.transform === 'function' ? inst.transform(currentTick, interpTick) : inst.transform
      if (!tr) continue
      inst.lastRenderCenter = { x: tr.x, y: tr.y }
      const pos = { ...tr }
      if ((inst.heightOffsetMode ?? 'sequence') === 'sequence') pos.z += e.heightOffset / 128
      const progress = this.progressOf(inst, e, interpTick)
      const total = e.frameLengths.reduce((a, b) => a + b, 0)
      const parts = e.frames.length === 0 ? e.staticParts : e.frames.length <= 1 ? e.frames[0]! : e.frames[frameIndexAt(progress, e.frameLengths, total)]!
      if (!parts || parts.length === 0) continue
      const matrix = spotModelMatrix(new Float32Array(16), pos)
      for (const part of parts) {
        if (part.transparent && !this.partVisible(part, matrix)) continue
        out.push({
          meshId: part.meshId,
          modelMatrix: matrix,
          positions: part.mesh.positions,
          hslColors: part.mesh.hslColors,
          alphas: part.mesh.alphas,
          faceBias: part.mesh.faceBias,
          uvs: part.mesh.uvs,
          textureIds: part.mesh.textureIds,
          depthBias: inst.style?.depthBias,
          cullFace: part.transparent ? 'back' : inst.style?.cullFace ?? 'none',
          ...(part.transparent ? { depth: 'read' as const, blend: 'normal' as const } : { depth: 'readwrite' as const }),
        })
      }
    }
  }

  private progressOf(inst: SpotInstance, e: Entry, interpTick: number): number {
    if (inst.frameProgress !== undefined) return Math.max(0, Math.min(1, inst.frameProgress))
    const l = inst.lifecycle
    const T = this.totalTicks(e)
    if (l.kind === 'manual') return 0
    if (l.kind === 'persistent') {
      const el = interpTick - l.startTick
      return e.frameStep >= 0 ? (((el % T) + T) % T) / T : Math.max(0, Math.min(1, el / T))
    }
    const dur = l.kind === 'duration' ? l.endTick - l.startTick : l.durationTicks ?? T
    return Math.max(0, Math.min(1, (interpTick - l.startTick) / Math.max(dur, 1e-3)))
  }

  /**
   * `isTransparentPartVisible`: a transparent part is culled when any vertex
   * is closer than 50 OSRS units to the camera plane or no triangle faces
   * the camera (the OSRS face sorter would return nothing).
   */
  private partVisible(part: Part, matrix: Float32Array): boolean {
    const p = this.sortProjection
    if (!p) return true
    const pos = part.mesh.positions
    const n = pos.length / 3
    let front = false
    const sx = new Float64Array(3)
    const sy = new Float64Array(3)
    for (let v = 0; v < n; v++) {
      const x = pos[v * 3]!
      const y = pos[v * 3 + 1]!
      const z = pos[v * 3 + 2]!
      const wx = (matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!) * 128
      const wy = (matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!) * 128
      const wz = (matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!) * 128
      const rx = wx - p.cameraX
      const ry = -wz - p.cameraY
      const rz = wy - p.cameraZ
      const ex = rx * p.yawCos + rz * p.yawSin
      const ez0 = rz * p.yawCos - rx * p.yawSin
      const ey = ry * p.pitchCos - ez0 * p.pitchSin
      const ez = ez0 * p.pitchCos + ry * p.pitchSin
      if (ez < 50) return false
      sx[v % 3] = ex / ez
      sy[v % 3] = ey / ez
      if (v % 3 === 2 && !front) {
        if ((sx[0]! - sx[1]!) * (sy[2]! - sy[1]!) - (sx[2]! - sx[1]!) * (sy[0]! - sy[1]!) > 0) front = true
      }
    }
    return front
  }

  /** Instances whose sequence has frame sounds. */
  frameStates(currentTick: number, interpTick: number): { key: string; seqId: number; frame: number; position: { x: number; y: number } | null }[] {
    const out: { key: string; seqId: number; frame: number; position: { x: number; y: number } | null }[] = []
    void currentTick
    for (const inst of this.instances.values()) {
      const e = this.entries.get(inst.spotAnimId)
      if (!e || !e.seq || e.seq.frameSounds.size === 0) continue
      const l = inst.lifecycle
      if (l.kind !== 'manual' && interpTick < l.startTick) continue
      const total = e.frameLengths.reduce((a, b) => a + b, 0)
      const frame = frameIndexAt(this.progressOf(inst, e, interpTick), e.frameLengths, total)
      out.push({ key: `spotanim:${inst.instanceId}`, seqId: e.seq.id, frame, position: inst.lastRenderCenter ?? null })
    }
    return out
  }
}

/**
 *: keep a one-shot instance alive between `startCycle` and
 * its end. Returns the lifecycle state.
 */
export function oneShot(
  sys: SpotAnimSystem,
  opts: {
    instanceId: string
    spotAnimId: number
    startCycle: number
    transform: SpotInstance['transform']
    style?: SpotStyle | undefined
    heightOffsetMode: 'sequence' | 'actor'
    fallbackDurationCycles: number
  },
  nowCycle: number,
): 'unloaded' | 'expired' | 'pending' | 'active' {
  if (!sys.isLoaded(opts.spotAnimId)) {
    sys.despawn(opts.instanceId)
    return 'unloaded'
  }
  const lengths = sys.frameLengths(opts.spotAnimId)
  const sum = lengths ? lengths.reduce((a, b) => a + b, 0) : 0
  const dur = sum > 0 ? sum : opts.fallbackDurationCycles
  if (dur <= 0 || nowCycle >= opts.startCycle + dur) {
    sys.despawn(opts.instanceId)
    return 'expired'
  }
  if (nowCycle < opts.startCycle) {
    sys.despawn(opts.instanceId)
    return 'pending'
  }
  sys.upsert({
    instanceId: opts.instanceId,
    spotAnimId: opts.spotAnimId,
    transform: opts.transform,
    lifecycle: { kind: 'oneShot', startTick: opts.startCycle / 30, durationTicks: dur / 30 },
    style: opts.style,
    heightOffsetMode: opts.heightOffsetMode,
  })
  return 'active'
}
