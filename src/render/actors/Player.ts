/**
 * The local player's presentation: model from equipment, animation set
 * from the weapon, client movement interpolation, per-frame OSRS painter
 * sort of all faces (the opaque part is drawn in the depth-write-off
 * "sorted" pass), placement on the terrain.
 */
import type { SeqTypeLoader, SeqType } from '../../cache/config/SeqType'
import type { SeqFrameLoader } from '../../cache/anim/SeqLoaders'
import type { Equipment } from '../../sim/api'
import type { MeshCommand } from '../gl/types'
import { faceTextureLayer, faceUvs, hasAnyTexture, type TextureLayerResolver, type UvGeometry } from '../model/meshBuild'
import { painterSort, type SortProjection } from '../model/painterSort'
import { bilinearHeight } from '../../scene/arena/surfaceHeight'
import { PlayerAnimController, type PlayerAnimationSet, type PoseSet } from './PlayerAnimController'
import { buildPlayerModel, equipmentKey, type PlayerModelData, type PlayerModelDeps } from './PlayerModel'
import { PlayerMovement, type MovementState } from './PlayerMovement'
import { DEFAULT_ANIM_SET, EAT_SEQ, animSetsFor, blockSeqsFor, type AnimSet } from './weaponData'

export interface PlayerDeps extends PlayerModelDeps {
  seqTypes: SeqTypeLoader
  frames: SeqFrameLoader
  resolveTextureLayer: TextureLayerResolver
}

const POSE_KEYS: readonly [keyof PoseSet, keyof AnimSet][] = [
  ['idle', 'idle'],
  ['walk', 'walk'],
  ['run', 'run'],
  ['turnLeft', 'turnLeft'],
  ['turnRight', 'turnRight'],
  ['walkBack', 'turn180'],
  ['idleTurnLeft', 'standTurn'],
  ['idleTurnRight', 'standTurn'],
]

export class PlayerPresenter {
  private readonly deps: PlayerDeps
  readonly movement: PlayerMovement
  private data: PlayerModelData | null = null
  private key = ''
  controller: PlayerAnimController | null = null
  private meshVersion = 0
  readonly opaque: MeshCommand
  readonly transparent: MeshCommand
  private readonly matrix = new Float32Array(16)
  private poseDirty = true
  private lastSortKey = ''
  private textured = false
  /** Visual state of the last update. */
  visual: MovementState

  constructor(deps: PlayerDeps, x: number, y: number, facing: number) {
    this.deps = deps
    this.movement = new PlayerMovement(x, y)
    this.movement.facingAngle = facing
    this.visual = this.movement.state()
    this.opaque = { meshId: 'player-model-opaque', modelMatrix: this.matrix, positions: new Float32Array(0), hslColors: new Float32Array(0), depth: 'sorted', cullFace: 'back', animated: true, version: 0 }
    this.transparent = {
      meshId: 'player-model-transparent',
      modelMatrix: this.matrix,
      positions: new Float32Array(0),
      hslColors: new Float32Array(0),
      depth: 'read',
      blend: 'normal',
      cullFace: 'back',
      animated: true,
      version: 0,
    }
  }

  get loaded(): boolean {
    return this.data !== null
  }

  seq(id: number): SeqType | null {
    if (id < 0) return null
    const s = this.deps.seqTypes.load(id)
    if (s.isSkeletalSeq() || !s.frameIds || s.frameIds.length === 0) return null
    return s
  }

  private fromSets(sets: AnimSet[], key: keyof AnimSet): SeqType | null {
    for (const set of sets) {
      const id = set[key]
      if (id === undefined) continue
      const s = this.seq(id)
      if (s) return s
    }
    return null
  }

  /** First loadable, frame-based sequence of a list (`loadFrameBasedSeqFromIds`). */
  firstSeq(ids: readonly number[]): SeqType | null {
    for (const id of ids) {
      const s = this.seq(id)
      if (s) return s
    }
    return null
  }

  private animationSet(equipment: Equipment): PlayerAnimationSet {
    const sets = animSetsFor(equipment.weapon)
    const set: PlayerAnimationSet = {}
    for (const [pose, key] of POSE_KEYS) set[pose] = this.fromSets(sets, key)
    set.eat = this.seq(EAT_SEQ)
    set.attack = this.fromSets(sets, 'attack')
    set.block = this.firstSeq(blockSeqsFor(equipment.weapon, equipment.shield))
    const unarmed: PoseSet = {}
    for (const [pose, key] of POSE_KEYS) unarmed[pose] = this.fromSets([DEFAULT_ANIM_SET], key)
    set.unarmed = unarmed
    return set
  }

  /** (Re)build the model when the worn equipment changed. */
  setEquipment(equipment: Equipment): void {
    const key = equipmentKey(equipment)
    if (key === this.key && this.data) return
    this.key = key
    const data = buildPlayerModel(equipment, this.deps)
    if (!data) return
    this.data = data
    this.textured = hasAnyTexture(data.model)
    const set = this.animationSet(equipment)
    // The pose adapter always works on the current model (scim updateModel keeps the controller's phases).
    const adapter = {
      resetPose: () => {
        const d = this.data
        if (!d) return
        const m = d.model
        m.verticesX.set(d.restX)
        m.verticesY.set(d.restY)
        m.verticesZ.set(d.restZ)
        if (d.restAlphas && m.faceAlphas) m.faceAlphas.set(d.restAlphas)
      },
      applyFrame: (frameId: number) => {
        const f = this.deps.frames.load(frameId)
        if (f) this.data?.model.animate(f)
      },
      applyFrameInterleaved: (p: number, b: number, masks: readonly number[]) => {
        const m = this.data?.model
        if (!m) return
        const fp = this.deps.frames.load(p)
        const fb = this.deps.frames.load(b)
        if (fp && fb) m.animateInterleaved(fp, fb, masks)
        else if (fp) m.animate(fp)
        else if (fb) m.animate(fb)
      },
      commitPose: () => {
        this.poseDirty = true
      },
    }
    if (this.controller) this.controller.setAnimationSet(set)
    else this.controller = new PlayerAnimController(set, adapter)
    this.controller.applyInitialFrame()
    this.meshVersion++
    this.opaque.meshId = `player-model-v${this.meshVersion}-opaque`
    this.transparent.meshId = `player-model-v${this.meshVersion}-transparent`
    this.poseDirty = true
  }

  /** `lift` = (lowest point + animation height offset) / 128. */
  modelLift(): number {
    if (!this.data || !this.controller) return 0
    return (this.data.bottomY + this.controller.heightOffset()) / 128
  }

  /** Place the model and rebuild the sorted meshes when needed. */
  build(
    terrain: readonly ArrayLike<number>[] | null,
    projection: Omit<SortProjection, 'orientation' | 'modelX' | 'modelY' | 'modelZ'> | null,
  ): void {
    const data = this.data
    if (!data) return
    const [px, py] = this.visual.position
    const cx = px + 0.5
    const cy = py + 0.5
    const z = -bilinearHeight(terrain, cx, cy) / 128 + this.modelLift()
    const facing = this.visual.facingAngle
    const s = 1 / 128
    const a = (facing / 2048) * 2 * Math.PI
    const m = this.matrix
    m[0] = s * Math.cos(a)
    m[1] = -s * Math.sin(a)
    m[2] = 0
    m[3] = 0
    m[4] = 0
    m[5] = 0
    m[6] = -s
    m[7] = 0
    m[8] = s * Math.sin(a)
    m[9] = s * Math.cos(a)
    m[10] = 0
    m[11] = 0
    m[12] = cx
    m[13] = cy
    m[14] = z
    m[15] = 1
    const proj = projection ? { ...projection, orientation: facing, modelX: cx * 128, modelY: -z * 128, modelZ: cy * 128 } : null
    const key = proj
      ? `${proj.cameraX},${proj.cameraY},${proj.cameraZ},${proj.yawSin},${proj.yawCos},${proj.pitchSin},${proj.pitchCos},${facing},${proj.modelX},${proj.modelY},${proj.modelZ}`
      : 'none'
    if (!this.poseDirty && key === this.lastSortKey) return
    this.poseDirty = false
    this.lastSortKey = key
    const model = data.model
    const sorted = painterSort(
      {
        verticesX: model.verticesX,
        verticesY: model.verticesY,
        verticesZ: model.verticesZ,
        verticesCount: model.verticesCount,
        indices1: model.indices1,
        indices2: model.indices2,
        indices3: model.indices3,
        faceCount: model.faceCount,
        faceRenderPriorities: model.faceRenderPriorities,
        priority: model.priority,
        faceAlphas: model.faceAlphas,
        faceColors3: data.lit.faceColors3,
      },
      proj,
    )
    const consume = this.controller?.isConsuming ?? false
    this.fill(this.opaque, sorted.opaqueFaces, consume)
    this.fill(this.transparent, sorted.transparentFaces, consume)
  }

  private fill(cmd: MeshCommand, faces: readonly number[], consume: boolean): void {
    const data = this.data!
    const model = data.model
    const lit = data.lit
    const n = faces.length
    const pos = new Float32Array(n * 9)
    const hsl = new Float32Array(n * 3)
    const alpha = new Float32Array(n * 3)
    const bias = new Float32Array(n * 3)
    const uvs = this.textured ? new Float32Array(n * 6) : undefined
    const tex = this.textured ? new Float32Array(n * 3) : undefined
    const geom: UvGeometry | null = this.textured
      ? {
          verticesX: model.verticesX,
          verticesY: model.verticesY,
          verticesZ: model.verticesZ,
          indices1: model.indices1,
          indices2: model.indices2,
          indices3: model.indices3,
          textureCoords: model.textureCoords,
          textureMappingP: model.textureMappingP,
          textureMappingM: model.textureMappingM,
          textureMappingN: model.textureMappingN,
        }
      : null
    const tmp = new Float32Array(6)
    for (let i = 0; i < n; i++) {
      const f = faces[i]!
      let c1 = lit.faceColors1[f]!
      let c2 = lit.faceColors2[f]!
      let c3 = lit.faceColors3[f]!
      if (c3 === -1) c3 = c2 = c1
      const a = model.faceAlphas ? (255 - (model.faceAlphas[f]! & 255)) / 255 : 1
      const b = model.faceBias ? (model.faceBias[f] === -1 ? 0 : model.faceBias[f]! & 255) : 0
      const collapsed = consume && data.weaponShieldMask[f] === 1
      const idx = collapsed ? [model.indices1[f]!, model.indices1[f]!, model.indices1[f]!] : [model.indices1[f]!, model.indices2[f]!, model.indices3[f]!]
      const cols = collapsed ? [c1, c1, c1] : [c1, c2, c3]
      for (let k = 0; k < 3; k++) {
        const v = idx[k]!
        const o = (i * 3 + k) * 3
        pos[o] = model.verticesX[v]!
        pos[o + 1] = model.verticesY[v]!
        pos[o + 2] = model.verticesZ[v]!
        hsl[i * 3 + k] = cols[k]! & 0xffff
        alpha[i * 3 + k] = a
        bias[i * 3 + k] = b
      }
      if (uvs && tex && geom) {
        const layer = collapsed ? 0 : faceTextureLayer(model, f, this.deps.resolveTextureLayer)
        if (layer > 0) faceUvs(geom, f, tmp, 0)
        else tmp.fill(0)
        uvs.set(tmp, i * 6)
        tex[i * 3] = layer
        tex[i * 3 + 1] = layer
        tex[i * 3 + 2] = layer
      }
    }
    cmd.positions = pos
    cmd.hslColors = hsl
    cmd.alphas = alpha
    cmd.faceBias = bias
    cmd.uvs = uvs
    cmd.textureIds = tex
    cmd.version = (cmd.version ?? 0) + 1
  }

  render(out: MeshCommand[]): void {
    if (!this.data) return
    if (this.opaque.positions.length > 0) out.push(this.opaque)
    if (this.transparent.positions.length > 0) out.push(this.transparent)
  }
}
