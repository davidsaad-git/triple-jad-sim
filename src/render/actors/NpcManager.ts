/**
 * NPC presentation: model assembly, per-instance animation / facing /
 * placement, death presentations, transparent painter sort and hit-test
 * data. Re-implemented from scim's NpcModelLoader and NPC
 * instance manager.
 */
import type { SeqFrameLoader } from '../../cache/anim/SeqLoaders'
import type { NpcTypeLoader } from '../../cache/config/NpcType'
import type { SeqTypeLoader } from '../../cache/config/SeqType'
import type { MeshCommand } from '../gl/types'
import { faceTextureLayer, faceUvs, hasAnyTexture, type TextureLayerResolver, type UvGeometry } from '../model/meshBuild'
import type { ModelSource } from '../model/ModelSource'
import { painterSort, type SortProjection } from '../model/painterSort'
import { RenderModel, type LitColors } from '../model/RenderModel'
import { FacingTracker, angleTo } from './facing'
import { NpcAnimController, clipDuration, type AnimClip, type NpcAnimationSet } from './NpcAnimController'
import type { NpcRenderConfig } from './npcConfig'
import { footprintGroundZ } from '../../scene/arena/surfaceHeight'

export interface NpcSnapshot {
  id: string
  npcTypeId: number
  alive: boolean
  position: readonly [number, number]
  previousPosition: readonly [number, number]
  facingAngle: number
  lockedFacing?: number | undefined
  actionFacing?: number | undefined
  combatTargetId: string | null
  size: number
}

export interface NpcType {
  id: number
  config: NpcRenderConfig
  model: RenderModel
  restX: Int32Array
  restY: Int32Array
  restZ: Int32Array
  restAlphas: Int8Array | null
  lit: LitColors
  size: number
  widthScale: number
  heightScale: number
  rotationSpeed: number
  animations: NpcAnimationSet
  textured: boolean
  /** `computeModelBounds`: padded AABB of the unscaled model. */
  bounds: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }
  deathDurationMs: number
}

type Intent =
  | { kind: 'fixed'; angle: number }
  | { kind: 'turn'; angle: number }
  | { kind: 'track'; targetId: string }

export interface NpcInstance {
  actorId: string
  type: NpcType
  controller: NpcAnimController
  posedX: Int32Array
  posedY: Int32Array
  posedZ: Int32Array
  alphas: Int8Array | null
  posed: boolean
  matrix: Float32Array
  renderPos: [number, number]
  facingAngle: number
  intent: Intent
  facing: FacingTracker | null
  opaque: MeshCommand
  transparent: MeshCommand
  poseVersion: number
  sortDirty: boolean
  sortKey: string
  dying: boolean
  deathTimerMs: number
  moving: boolean
}

export interface NpcHitTestData {
  actorId: string
  verticesX: Int32Array
  verticesY: Int32Array
  verticesZ: Int32Array
  verticesCount: number
  indices1: Int32Array
  indices2: Int32Array
  indices3: Int32Array
  faceCount: number
  faceColors3: Int32Array
  modelMatrix: Float32Array
  useBoundingBox: boolean
}

export interface NpcOverlayHeights {
  hitsplatHeight: number
  healthBarHeight: number
  healthBarWidth: number
  baseHeight: number
}

const HEALTH_BAR_WIDTH: Record<number, number> = { 1: 40, 2: 60, 3: 80, 4: 100, 5: 120 }

export interface NpcManagerDeps {
  npcTypes: NpcTypeLoader
  seqTypes: SeqTypeLoader
  frames: SeqFrameLoader
  models: ModelSource
  resolveTextureLayer: TextureLayerResolver
}

export class NpcManager {
  private readonly deps: NpcManagerDeps
  private readonly types = new Map<number, NpcType>()
  private readonly failed = new Set<number>()
  readonly instances = new Map<string, NpcInstance>()
  readonly dying = new Map<string, NpcInstance>()
  terrainHeights: readonly ArrayLike<number>[] | null = null
  private snapPending = false
  private sortProjection: Omit<SortProjection, 'orientation' | 'modelX' | 'modelY' | 'modelZ'> | null = null
  private sortProjectionKey = ''

  constructor(deps: NpcManagerDeps) {
    this.deps = deps
  }

  // ---------------------------------------------------------------- types

  loadType(id: number, config: NpcRenderConfig): NpcType | null {
    const cached = this.types.get(id)
    if (cached) return cached
    if (this.failed.has(id)) return null
    try {
      const t = this.buildType(id, config)
      this.types.set(id, t)
      return t
    } catch (e) {
      console.warn(`NpcManager: failed to load npc ${id}: ${(e as Error).message}`)
      this.failed.add(id)
      return null
    }
  }

  isTypeLoaded(id: number): boolean {
    return this.types.has(id)
  }

  typeOf(id: number): NpcType | undefined {
    return this.types.get(id)
  }

  private clip(seqId: number, name: string): AnimClip | undefined {
    if (seqId < 0) return undefined
    const seq = this.deps.seqTypes.load(seqId)
    if (seq.isSkeletalSeq() || !seq.frameIds || seq.frameIds.length === 0) return undefined
    return { id: name, seqId, seq, frameIds: seq.frameIds, frameLengths: seq.frameLengths }
  }

  private buildType(id: number, config: NpcRenderConfig): NpcType {
    const npc = this.deps.npcTypes.load(id)
    if (npc.modelIds.length === 0) throw new Error('no models')
    const parts: RenderModel[] = []
    for (const modelId of npc.modelIds) {
      const base = this.deps.models.get(modelId)
      if (!base) continue
      const m = base.copy()
      // First-match recolour per face.
      if (npc.recolorFrom.length > 0) {
        for (let f = 0; f < m.faceCount; f++) {
          const i = npc.recolorFrom.indexOf(m.faceColors[f]!)
          if (i !== -1) m.faceColors[f] = npc.recolorTo[i]!
        }
      }
      for (let i = 0; i < npc.retextureFrom.length; i++) m.retexture(npc.retextureFrom[i]!, npc.retextureTo[i]!)
      parts.push(m)
    }
    if (parts.length === 0) throw new Error('no models loaded')
    const model = parts.length === 1 ? parts[0]! : RenderModel.merge(parts)
    const lit = model.computeLitColors(npc.ambient + 64, npc.contrast + 850, -30, -50, -30)
    model.computeAnimationTables()
    const idle = this.clip(config.idleSeqId >= 0 ? config.idleSeqId : npc.idleSeqId, 'idle')
    if (!idle) throw new Error(`idle sequence ${config.idleSeqId} missing`)
    const attackClips: Record<string, AnimClip> = {}
    for (const [name, seqId] of Object.entries(config.attackClips)) {
      const c = this.clip(seqId, name)
      if (c) attackClips[name] = c
    }
    const walk = this.clip(config.walkSeqId ?? npc.walkSeqId, 'walk')
    const death = this.clip(config.deathSeqId, 'death')
    const animations: NpcAnimationSet = { idle, walk, death, attackClips }
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    let minZ = Infinity
    let maxZ = -Infinity
    for (let v = 0; v < model.verticesCount; v++) {
      const x = model.verticesX[v]!
      const y = model.verticesY[v]!
      const z = model.verticesZ[v]!
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }
    const cx = (maxX + minX) / 2
    const cy = (maxY + minY) / 2
    const cz = (maxZ + minZ) / 2
    let hx = (maxX - minX + 1) / 2
    const hy = (maxY - minY + 1) / 2
    let hz = (maxZ - minZ + 1) / 2
    if (hx < 32) hx = 32
    if (hz < 32) hz = 32
    hx += 8
    hz += 8
    const deathDurationMs =
      config.deathDurationMs ?? (death ? death.frameLengths.reduce((a, b) => a + b, 0) * 20 : 600)
    return {
      id,
      config,
      model,
      restX: model.verticesX.slice(),
      restY: model.verticesY.slice(),
      restZ: model.verticesZ.slice(),
      restAlphas: model.faceAlphas ? model.faceAlphas.slice() : null,
      lit,
      size: npc.size,
      widthScale: npc.widthScale,
      heightScale: npc.heightScale,
      rotationSpeed: npc.rotationSpeed,
      animations,
      textured: hasAnyTexture(model),
      bounds: { minX: cx - hx, minY: cy - hy, minZ: cz - hz, maxX: cx + hx, maxY: cy + hy, maxZ: cz + hz },
      deathDurationMs,
    }
  }

  // ---------------------------------------------------------------- instances

  private createInstance(npc: NpcSnapshot, type: NpcType): NpcInstance {
    const matrix = new Float32Array(16)
    const inst: NpcInstance = {
      actorId: npc.id,
      type,
      controller: null as unknown as NpcAnimController,
      posedX: type.restX.slice(),
      posedY: type.restY.slice(),
      posedZ: type.restZ.slice(),
      alphas: type.restAlphas ? type.restAlphas.slice() : null,
      posed: false,
      matrix,
      renderPos: [npc.position[0], npc.position[1]],
      facingAngle: npc.facingAngle,
      intent: intentOf(npc),
      facing: null,
      opaque: emptyCommand(`npc-${type.id}-opaque-${npc.id}`, matrix, type.config.depthBias, false),
      transparent: emptyCommand(`npc-${type.id}-transparent-${npc.id}`, matrix, type.config.depthBias, true),
      poseVersion: 0,
      sortDirty: true,
      sortKey: '',
      dying: false,
      deathTimerMs: 0,
      moving: false,
    }
    inst.controller = new NpcAnimController(type.animations, this.poseAdapter(inst))
    this.placeInstance(inst)
    return inst
  }

  private poseAdapter(inst: NpcInstance): import('./NpcAnimController').PoseAdapter {
    const type = inst.type
    const m = type.model
    return {
      resetPose: () => {
        m.verticesX.set(type.restX)
        m.verticesY.set(type.restY)
        m.verticesZ.set(type.restZ)
        if (type.restAlphas && m.faceAlphas) m.faceAlphas.set(type.restAlphas)
      },
      applyFrame: (frameId) => {
        const f = this.deps.frames.load(frameId)
        if (f) m.animate(f)
      },
      applyFrameInterleaved: (p, b, masks) => {
        const fp = this.deps.frames.load(p)
        const fb = this.deps.frames.load(b)
        if (fp && fb) m.animateInterleaved(fp, fb, masks)
        else if (fp) m.animate(fp)
        else if (fb) m.animate(fb)
      },
      commitPose: () => {
        if (type.widthScale !== 128 || type.heightScale !== 128) m.resize(type.widthScale, type.heightScale, type.widthScale)
        inst.posedX.set(m.verticesX.subarray(0, inst.posedX.length))
        inst.posedY.set(m.verticesY.subarray(0, inst.posedY.length))
        inst.posedZ.set(m.verticesZ.subarray(0, inst.posedZ.length))
        if (inst.alphas && m.faceAlphas) inst.alphas.set(m.faceAlphas)
        inst.posed = true
        inst.poseVersion++
        inst.sortDirty = true
        this.buildOpaque(inst)
      },
    }
  }

  /** Model matrix. */
  private placeInstance(inst: NpcInstance): void {
    const size = inst.type.size
    const [x, y] = inst.renderPos
    const s = 1 / 128
    const a = (inst.facingAngle / 2048) * 2 * Math.PI
    const c = Math.cos(a)
    const sn = Math.sin(a)
    const z = footprintGroundZ(this.terrainHeights, x, y, size, size) + inst.controller.heightOffset() * s
    const m = inst.matrix
    const before = m[0]! + m[1]! * 3 + m[8]! * 5 + m[12]! * 7 + m[13]! * 11 + m[14]! * 13
    m[0] = s * c
    m[1] = -s * sn
    m[2] = 0
    m[3] = 0
    m[4] = 0
    m[5] = 0
    m[6] = -s
    m[7] = 0
    m[8] = s * sn
    m[9] = s * c
    m[10] = 0
    m[11] = 0
    m[12] = x + size / 2
    m[13] = y + size / 2
    m[14] = z
    m[15] = 1
    const after = m[0]! + m[1]! * 3 + m[8]! * 5 + m[12]! * 7 + m[13]! * 11 + m[14]! * 13
    if (after !== before) inst.sortDirty = true
  }

  /** `syncInstances` with the interpolation fraction of the tick. */
  sync(npcs: readonly NpcSnapshot[], frac: number): void {
    const seen = new Set<string>()
    for (const npc of npcs) {
      seen.add(npc.id)
      const type = this.types.get(npc.npcTypeId)
      if (!npc.alive) {
        const inst = this.instances.get(npc.id)
        if (inst && !this.dying.has(npc.id)) this.enterDying(inst)
        continue
      }
      if (!type) continue
      let inst = this.instances.get(npc.id)
      if (!inst) {
        inst = this.createInstance(npc, type)
        this.instances.set(npc.id, inst)
      }
      const moved = npc.previousPosition[0] !== npc.position[0] || npc.previousPosition[1] !== npc.position[1]
      inst.moving = moved
      inst.renderPos =
        frac > 0 && moved
          ? [
              npc.previousPosition[0] + (npc.position[0] - npc.previousPosition[0]) * frac,
              npc.previousPosition[1] + (npc.position[1] - npc.previousPosition[1]) * frac,
            ]
          : [npc.position[0], npc.position[1]]
      inst.facingAngle = npc.facingAngle
      inst.intent = intentOf(npc)
      this.placeInstance(inst)
    }
    for (const id of [...this.instances.keys()]) if (!seen.has(id)) this.instances.delete(id)
  }

  private enterDying(inst: NpcInstance): void {
    this.instances.delete(inst.actorId)
    inst.dying = true
    inst.deathTimerMs = 0
    inst.facing = null
    inst.controller.triggerDeath()
    this.dying.set(inst.actorId, inst)
  }

  /** `actor_despawned`: drop the presentation immediately (also mid-death). */
  remove(actorId: string): void {
    this.instances.delete(actorId)
    this.dying.delete(actorId)
  }

  /** After a discontinuity. */
  resetTransient(): void {
    this.dying.clear()
    for (const inst of this.instances.values()) {
      inst.controller.reset()
      inst.facing = null
    }
    this.snapPending = true
  }

  clear(): void {
    this.instances.clear()
    this.dying.clear()
  }

  // ---------------------------------------------------------------- facing

  /** `updateNpcVisualFacing`: `deltaMs` in simulation time. */
  updateFacing(playerVisual: readonly [number, number], deltaMs: number): void {
    const snap = this.snapPending
    for (const inst of this.instances.values()) {
      const size = inst.type.size
      const cx = inst.renderPos[0] + size / 2
      const cy = inst.renderPos[1] + size / 2
      let mode: 'fixed' | 'smooth' = 'smooth'
      let target = inst.facing?.angle ?? inst.facingAngle
      const intent = inst.intent
      if (intent.kind === 'fixed') {
        mode = 'fixed'
        target = intent.angle
      } else if (intent.kind === 'turn') target = intent.angle
      else {
        const c = this.actorCenter(intent.targetId, playerVisual)
        target = c ? angleTo(cx, cy, c[0], c[1]) : inst.facing?.angle ?? inst.facingAngle
      }
      if (!inst.facing) inst.facing = new FacingTracker(inst.facingAngle, inst.type.rotationSpeed)
      inst.facing.turnSpeed = inst.type.rotationSpeed
      let angle: number
      if (mode === 'fixed' || snap) angle = inst.facing.snap(target)
      else {
        inst.facing.setTarget(target)
        angle = inst.facing.advance(deltaMs)
      }
      inst.facingAngle = angle
      this.placeInstance(inst)
    }
    this.snapPending = false
  }

  actorCenter(actorId: string, playerVisual: readonly [number, number]): [number, number] | null {
    if (actorId === 'player') return [playerVisual[0] + 0.5, playerVisual[1] + 0.5]
    const inst = this.instances.get(actorId)
    if (!inst) return null
    const s = inst.type.size
    return [inst.renderPos[0] + s / 2, inst.renderPos[1] + s / 2]
  }

  /** Interpolated SW corner of a live NPC (`getVisualPosition`). */
  visualPosition(actorId: string): [number, number] | null {
    const inst = this.instances.get(actorId)
    return inst ? [inst.renderPos[0], inst.renderPos[1]] : null
  }

  // ---------------------------------------------------------------- animation

  triggerClip(actorId: string, clipId: string): boolean {
    const inst = this.instances.get(actorId)
    if (!inst) return false
    const clip = inst.type.animations.attackClips[clipId]
    if (!clip) return false
    inst.controller.triggerAttack(clip)
    return true
  }

  hasClip(npcTypeId: number, clipId: string): boolean {
    const t = this.types.get(npcTypeId)
    return !!t && t.animations.attackClips[clipId] !== undefined
  }

  /** `updateAnimations`: advance every controller by `deltaMs`. */
  updateAnimations(deltaMs: number): void {
    for (const inst of this.instances.values()) {
      inst.controller.update(deltaMs, 1, inst.moving)
      this.placeInstance(inst)
    }
    for (const [id, inst] of this.dying) {
      inst.deathTimerMs += Math.max(0, deltaMs)
      inst.controller.update(deltaMs, 1, false)
      this.placeInstance(inst)
      if (inst.deathTimerMs >= inst.type.deathDurationMs) this.dying.delete(id)
    }
  }

  // ---------------------------------------------------------------- meshes

  setSortProjection(p: Omit<SortProjection, 'orientation' | 'modelX' | 'modelY' | 'modelZ'> | null): void {
    const key = p ? `${p.cameraX},${p.cameraY},${p.cameraZ},${p.yawSin.toFixed(6)},${p.yawCos.toFixed(6)},${p.pitchSin.toFixed(6)},${p.pitchCos.toFixed(6)}` : ''
    if (key !== this.sortProjectionKey) {
      this.sortProjectionKey = key
      for (const i of this.instances.values()) i.sortDirty = true
      for (const i of this.dying.values()) i.sortDirty = true
    }
    this.sortProjection = p
  }

  private geometry(inst: NpcInstance): UvGeometry {
    const m = inst.type.model
    return {
      verticesX: inst.posedX,
      verticesY: inst.posedY,
      verticesZ: inst.posedZ,
      indices1: m.indices1,
      indices2: m.indices2,
      indices3: m.indices3,
      textureCoords: m.textureCoords,
      textureMappingP: m.textureMappingP,
      textureMappingM: m.textureMappingM,
      textureMappingN: m.textureMappingN,
    }
  }

  private writeFaces(inst: NpcInstance, faces: ArrayLike<number>, cmd: MeshCommand): void {
    const t = inst.type
    const m = t.model
    const n = faces.length
    const positions = new Float32Array(n * 9)
    const hsl = new Float32Array(n * 3)
    const alphas = new Float32Array(n * 3)
    const bias = new Float32Array(n * 3)
    const uvs = t.textured ? new Float32Array(n * 6) : undefined
    const tex = t.textured ? new Float32Array(n * 3) : undefined
    const geom = t.textured ? this.geometry(inst) : null
    const tmp = new Float32Array(6)
    for (let i = 0; i < n; i++) {
      const f = faces[i]!
      let c1 = t.lit.faceColors1[f]!
      let c2 = t.lit.faceColors2[f]!
      let c3 = t.lit.faceColors3[f]!
      if (c3 === -1) c3 = c2 = c1
      const a = inst.alphas ? (255 - (inst.alphas[f]! & 255)) / 255 : 1
      const b = m.faceBias ? (m.faceBias[f] === -1 ? 0 : m.faceBias[f]! & 255) : 0
      const idx = [m.indices1[f]!, m.indices2[f]!, m.indices3[f]!]
      const cols = [c1, c2, c3]
      for (let k = 0; k < 3; k++) {
        const v = idx[k]!
        const o = (i * 3 + k) * 3
        positions[o] = inst.posedX[v]!
        positions[o + 1] = inst.posedY[v]!
        positions[o + 2] = inst.posedZ[v]!
        hsl[i * 3 + k] = cols[k]! & 0xffff
        alphas[i * 3 + k] = a
        bias[i * 3 + k] = b
      }
      if (uvs && tex && geom) {
        const layer = faceTextureLayer(m, f, this.deps.resolveTextureLayer)
        if (layer > 0) faceUvs(geom, f, tmp, 0)
        else tmp.fill(0)
        uvs.set(tmp, i * 6)
        tex[i * 3] = layer
        tex[i * 3 + 1] = layer
        tex[i * 3 + 2] = layer
      }
    }
    cmd.positions = positions
    cmd.hslColors = hsl
    cmd.alphas = alphas
    cmd.faceBias = bias
    cmd.uvs = uvs
    cmd.textureIds = tex
    cmd.version = (cmd.version ?? 0) + 1
  }

  /** Opaque faces in model order (depth-tested, no sort). */
  private buildOpaque(inst: NpcInstance): void {
    const t = inst.type
    const faces: number[] = []
    for (let f = 0; f < t.model.faceCount; f++) {
      if (t.lit.faceColors3[f] === -2) continue
      const a = inst.alphas ? (255 - (inst.alphas[f]! & 255)) / 255 : 1
      if (a >= 0.999) faces.push(f)
    }
    this.writeFaces(inst, faces, inst.opaque)
  }

  /** Painter-sort the transparent faces when the pose, matrix or camera changed. */
  private sortTransparent(inst: NpcInstance): void {
    if (!inst.sortDirty) return
    inst.sortDirty = false
    const t = inst.type
    if (!inst.alphas) {
      if (inst.transparent.positions.length > 0) this.writeFaces(inst, [], inst.transparent)
      return
    }
    const p = this.sortProjection
    let faces: number[]
    if (p) {
      const m = inst.matrix
      const orientation = ((Math.round(Math.atan2(m[8]! * 128, m[0]! * 128) * (2048 / (2 * Math.PI))) % 2048) + 2048) % 2048
      const res = painterSort(
        {
          verticesX: inst.posedX,
          verticesY: inst.posedY,
          verticesZ: inst.posedZ,
          verticesCount: t.model.verticesCount,
          indices1: t.model.indices1,
          indices2: t.model.indices2,
          indices3: t.model.indices3,
          faceCount: t.model.faceCount,
          faceRenderPriorities: t.model.faceRenderPriorities,
          priority: t.model.priority,
          faceAlphas: inst.alphas,
          faceColors3: t.lit.faceColors3,
        },
        { ...p, orientation, modelX: m[12]! * 128, modelY: -m[14]! * 128, modelZ: m[13]! * 128 },
      )
      faces = res.transparentFaces
    } else {
      faces = []
      for (let f = 0; f < t.model.faceCount; f++) {
        if (t.lit.faceColors3[f] === -2) continue
        if ((255 - (inst.alphas[f]! & 255)) / 255 < 0.999) faces.push(f)
      }
    }
    this.writeFaces(inst, faces, inst.transparent)
  }

  /** Commands in scim order: live instances then dying ones (opaque, transparent each). */
  render(out: MeshCommand[]): void {
    for (const inst of this.instances.values()) this.emit(inst, out)
    for (const inst of this.dying.values()) this.emit(inst, out)
  }

  private emit(inst: NpcInstance, out: MeshCommand[]): void {
    if (!inst.posed) inst.controller.update(0, 1, false)
    this.sortTransparent(inst)
    if (inst.opaque.positions.length > 0) out.push(inst.opaque)
    if (inst.transparent.positions.length > 0) out.push(inst.transparent)
  }

  // ---------------------------------------------------------------- queries

  hitTestData(): NpcHitTestData[] {
    const out: NpcHitTestData[] = []
    for (const inst of this.instances.values()) {
      const m = inst.type.model
      out.push({
        actorId: inst.actorId,
        verticesX: inst.posedX,
        verticesY: inst.posedY,
        verticesZ: inst.posedZ,
        verticesCount: m.verticesCount,
        indices1: m.indices1,
        indices2: m.indices2,
        indices3: m.indices3,
        faceCount: m.faceCount,
        faceColors3: inst.type.lit.faceColors3,
        modelMatrix: inst.matrix,
        useBoundingBox: inst.type.size === 1,
      })
    }
    return out
  }

  /** Clickbox meshes use the same data for dying instances too. */
  instanceOrDying(actorId: string): NpcInstance | undefined {
    return this.instances.get(actorId) ?? this.dying.get(actorId)
  }

  /** `getNpcOverlayHeights`. */
  overlayHeights(actorId: string): NpcOverlayHeights | null {
    const inst = this.instanceOrDying(actorId)
    if (!inst) return null
    const t = inst.type
    const width = HEALTH_BAR_WIDTH[Math.min(t.size, 5)] ?? 40
    let up: number
    if (inst.posed) {
      up = 0
      for (let v = 0; v < t.model.verticesCount; v++) up = Math.max(up, -inst.posedY[v]!)
    } else {
      up = (-t.bounds.minY * t.heightScale) / 128
    }
    return { hitsplatHeight: up / 2 / 128, healthBarHeight: (up + 15) / 128, healthBarWidth: width, baseHeight: inst.matrix[14]! }
  }

  /** Type-level hitsplat height (player projectile impacts, `getNpcTypeOverlayHeights`). */
  typeHitsplatHeight(npcTypeId: number): number {
    const t = this.types.get(npcTypeId)
    if (!t) return 0
    return (-t.bounds.minY * t.heightScale) / 128 / 2 / 128
  }

  /** Frame states for the frame sound tracker (live and dying). */
  frameStates(): { key: string; seqId: number; frame: number; position: { x: number; y: number } | null }[] {
    const out: { key: string; seqId: number; frame: number; position: { x: number; y: number } | null }[] = []
    const add = (inst: NpcInstance): void => {
      const s = inst.controller.frameState()
      if (!s) return
      const size = inst.type.size
      out.push({ key: inst.actorId, seqId: s.seqId, frame: s.frame, position: { x: inst.renderPos[0] + size / 2, y: inst.renderPos[1] + size / 2 } })
    }
    for (const i of this.instances.values()) add(i)
    for (const i of this.dying.values()) add(i)
    return out
  }

  deathDurationOf(npcTypeId: number): number {
    const t = this.types.get(npcTypeId)
    return t ? t.deathDurationMs : 600
  }

  clipDurationOf(npcTypeId: number, clipId: string): number {
    const c = this.types.get(npcTypeId)?.animations.attackClips[clipId]
    return c ? clipDuration(c) : 0
  }
}

function intentOf(npc: NpcSnapshot): Intent {
  if (npc.lockedFacing !== undefined) return { kind: 'fixed', angle: npc.lockedFacing }
  if (npc.actionFacing !== undefined) return { kind: 'turn', angle: npc.actionFacing }
  if (npc.combatTargetId != null) return { kind: 'track', targetId: npc.combatTargetId }
  return { kind: 'turn', angle: npc.facingAngle }
}

function emptyCommand(meshId: string, matrix: Float32Array, depthBias: number, transparent: boolean): MeshCommand {
  return {
    meshId,
    modelMatrix: matrix,
    positions: new Float32Array(0),
    hslColors: new Float32Array(0),
    alphas: new Float32Array(0),
    depthBias,
    animated: true,
    version: 0,
    cullFace: 'back',
    ...(transparent ? { depth: 'read' as const, blend: 'normal' as const } : { depth: 'readwrite' as const }),
  }
}
