/**
 * Per-frame scene assembly: scim's scene compositor (`dw.buildScene`) with its Inferno subclass,
 * adapted to the triple-Jad encounter. Builds the render queue in scim's
 * command order and the data the DOM overlays, the picker and the frame
 * sound feed need.
 */
import type { CacheSystem } from '../cache/CacheSystem'
import { SeqFrameLoader } from '../cache/anim/SeqLoaders'
import { IdkTypeLoader } from '../cache/config/IdkType'
import { NpcTypeLoader } from '../cache/config/NpcType'
import { ObjTypeLoader } from '../cache/config/ObjType'
import { SeqTypeLoader } from '../cache/config/SeqType'
import { SpotAnimTypeLoader } from '../cache/config/SpotAnimType'
import type { SimEvent, SimState } from '../sim/api'
import type { SequenceFrameState } from './api'
import { NPC_RENDER_CONFIGS, PRELOAD_NPC_TYPES } from './actors/npcConfig'
import { NpcManager } from './actors/NpcManager'
import { PlayerPresenter } from './actors/Player'
import type { MovementState } from './actors/PlayerMovement'
import { attackSequenceCandidates, specialAttackVisuals, spellVisuals, type ItemFacts } from './actors/weaponData'
import { TRIPLE_JAD_ARENA } from './arenaConfig'
import type { Camera } from './camera/Camera'
import { InfernoVisuals } from './effects/InfernoVisuals'
import { LocAnimator } from './effects/LocAnimator'
import { PlayerEffects, playerEffectDescriptors } from './effects/PlayerEffects'
import { SpotAnimSystem } from './effects/SpotAnims'
import type { MeshCommand, RenderQueue } from './gl/types'
import { ModelSource } from './model/ModelSource'
import type { LabelDraw } from './overlays/DomOverlays'
import { UiOverlays, type HealthBarDraw, type HitsplatDraw, type IconDraw } from './overlays/UiOverlays'
import {
  debugGridMesh,
  lineMarkerMeshes,
  npcClickboxOverlay,
  npcHighlightMeshes,
  tileIndicators,
  tileMarkerMeshes,
  type LineMarkerInput,
  type NpcHighlightInput,
  type TileIndicatorInput,
  type TileMarkerInput,
} from './overlays/worldOverlays'
import { ArenaSceneBuilder, type ArenaScene } from '../scene/arena/ArenaScene'
import { bilinearHeight, footprintGroundZ } from '../scene/arena/surfaceHeight'

/** Spot anims scim preloads for the Inferno scene. */
export const PRELOAD_SPOT_ANIMS: readonly number[] = [1375, 1376, 1377, 131, 448, 449, 450, 660, 659, 444, 451, 85]

export interface CompositorSettings {
  brightness: number
  contrast: number
  saturation: number
  smoothTerrain: boolean
  showDebugGrid: boolean
  showNpcClickbox: boolean
}

export interface PluginOverlays {
  tileIndicators: TileIndicatorInput
  tileMarkers: readonly TileMarkerInput[]
  showTileMarkerLabels: boolean
  tileMarkerWidth: number
  lineMarkers: readonly LineMarkerInput[]
  showLineMarkerLabels: boolean
  lineMarkerWidth: number
  npcHighlights: readonly NpcHighlightInput[]
}

export interface FrameInput {
  state: SimState
  events: readonly SimEvent[]
  interpTick: number
  frameDeltaMs: number
  speed: number
  camera: Camera
  playerVisual: MovementState
  hoverTile: readonly [number, number] | null
  destinationTile: readonly [number, number] | null
  settings: CompositorSettings
  plugins: PluginOverlays
}

export interface FrameOutput {
  queue: RenderQueue
  hitsplats: HitsplatDraw[]
  healthBars: HealthBarDraw[]
  icons: IconDraw[]
  labels: LabelDraw[]
  frameStates: SequenceFrameState[]
  listener: { x: number; y: number } | null
  /** Discontinuity this frame (frame sounds sync silently). */
  discontinuity: boolean
}

export type TextureLayerOf = (textureId: number) => number

export class SceneCompositor {
  readonly cache: CacheSystem
  private readonly models: ModelSource
  private readonly seqTypes: SeqTypeLoader
  private readonly frames: SeqFrameLoader
  private readonly npcTypes: NpcTypeLoader
  private readonly objs: ObjTypeLoader
  readonly npcs: NpcManager
  readonly spots: SpotAnimSystem
  readonly player: PlayerPresenter
  private readonly visuals = new InfernoVisuals()
  private readonly playerFx = new PlayerEffects()
  private readonly ui = new UiOverlays()
  private readonly arenaBuilder: ArenaSceneBuilder
  private arena: ArenaScene | null = null
  private arenaSmooth: boolean | null = null
  private readonly layerOf: TextureLayerOf
  private lastProcessedEventId = -1
  private lastDisplayedTick: number | undefined
  private animationCycle: number | null = null
  private indicatorCache = new Map<string, MeshCommand[]>()
  private readonly locAnimators = new Map<string, LocAnimator>()
  private gridCache: MeshCommand | null = null

  constructor(cache: CacheSystem, layerOf: TextureLayerOf, initialState: SimState) {
    this.cache = cache
    this.layerOf = layerOf
    this.models = new ModelSource(cache)
    this.seqTypes = new SeqTypeLoader(cache)
    this.frames = new SeqFrameLoader(cache)
    this.npcTypes = new NpcTypeLoader(cache)
    this.objs = new ObjTypeLoader(cache)
    const resolveTextureLayer = (id: number): number => layerOf(id)
    this.npcs = new NpcManager({ npcTypes: this.npcTypes, seqTypes: this.seqTypes, frames: this.frames, models: this.models, resolveTextureLayer })
    this.spots = new SpotAnimSystem({ spotTypes: new SpotAnimTypeLoader(cache), seqTypes: this.seqTypes, frames: this.frames, models: this.models, resolveTextureLayer })
    this.player = new PlayerPresenter(
      { objs: this.objs, kits: new IdkTypeLoader(cache), models: this.models, seqTypes: this.seqTypes, frames: this.frames, resolveTextureLayer },
      initialState.playerPosition[0],
      initialState.playerPosition[1],
      initialState.playerFacingAngle,
    )
    this.arenaBuilder = new ArenaSceneBuilder(cache, TRIPLE_JAD_ARENA, this.models)
  }

  /** Build the static world and preload actors (synchronous, ~0.5 s). */
  load(smoothTerrain: boolean, state: SimState): void {
    this.buildArena(smoothTerrain)
    for (const id of PRELOAD_NPC_TYPES) {
      const cfg = NPC_RENDER_CONFIGS[id]
      if (cfg) this.npcs.loadType(id, cfg)
    }
    for (const id of PRELOAD_SPOT_ANIMS) this.spots.load(id)
    this.player.setEquipment(state.playerEquipment)
  }

  private buildArena(smooth: boolean): void {
    if (this.arena && this.arenaSmooth === smooth) return
    const scene = this.arenaBuilder.build({ smoothTerrain: smooth, textureLayer: this.layerOf })
    this.arena = scene
    this.arenaSmooth = smooth
    this.npcs.terrainHeights = scene.terrainHeights
    this.indicatorCache.clear()
    this.gridCache = null
  }

  get terrainHeights(): Int32Array[] | null {
    return this.arena?.terrainHeights ?? null
  }

  get arenaStats(): ArenaScene['stats'] | null {
    return this.arena?.stats ?? null
  }

  private itemFacts = (id: number): ItemFacts | undefined => {
    const o = this.objs.load(id)
    return { name: o.name, wearPos: o.wearPos1 }
  }

  /** Transient reset on rewind / forward jump / restart. */
  private resetTransient(): void {
    this.visuals.clear(this.spots)
    this.animationCycle = null
    this.playerFx.clear(this.spots)
    this.spots.clear()
    this.ui.reset()
    this.npcs.resetTransient()
    this.player.controller?.reset()
    this.lastProcessedEventId = -1
  }

  frame(input: FrameInput): FrameOutput {
    const { state, interpTick, camera } = input
    const currentTick = state.currentTick
    if (this.arenaSmooth !== input.settings.smoothTerrain) this.buildArena(input.settings.smoothTerrain)
    const heights = this.terrainHeights
    // 1. discontinuities
    let discontinuity = false
    if (this.lastDisplayedTick !== undefined && (currentTick < this.lastDisplayedTick || currentTick > this.lastDisplayedTick + 1)) {
      discontinuity = true
      this.resetTransient()
    }
    this.lastDisplayedTick = currentTick
    // 2. new events
    const fresh: SimEvent[] = []
    for (const ev of input.events) {
      if (ev.eventId <= this.lastProcessedEventId) continue
      fresh.push(ev)
      this.lastProcessedEventId = ev.eventId
    }
    this.player.setEquipment(state.playerEquipment)
    const pc = this.player.controller
    let pendingAttack: Parameters<typeof attackSequenceCandidates>[0] | null = null
    for (const ev of fresh) {
      if (ev.type === 'item_consumed') pc?.triggerConsume()
      else if (ev.type === 'hit_applied' && ev.targetId === 'player') pc?.triggerBlock()
      else if (ev.type === 'spell_self_cast') {
        const anim = (ev as { animationId?: unknown }).animationId
        const spot = (ev as { spotAnimId?: unknown }).spotAnimId
        if (typeof anim === 'number' && typeof spot === 'number') {
          const s = this.player.seq(anim)
          if (s) pc?.triggerAttack(s)
        }
      } else if (ev.type === 'attack_started' && ev.sourceId === 'player') {
        const spellId = ev.spellId ?? undefined
        const spell = spellId === undefined || spellId === null ? undefined : spellVisuals(spellId)
        if (spellId !== undefined && spellId !== null && !spell) pendingAttack = { kind: 'spell', castAnimationId: 1162 }
        else if (spell) pendingAttack = { kind: 'spell', castAnimationId: spell.castAnimationId, fallbackAnimationId: spell.fallbackAnimationId }
        else {
          const spec = ev.usingSpecialAttack === true && ev.weaponId !== undefined ? specialAttackVisuals(ev.weaponId)?.animationId : undefined
          pendingAttack = { kind: 'weapon', weaponId: ev.weaponId, attackKind: ev.attackKind, specAnimationId: spec }
        }
      }
    }
    if (pendingAttack && pc) {
      const seq = this.player.firstSeq(attackSequenceCandidates(pendingAttack))
      if (seq) pc.triggerAttack(seq)
      else if (pendingAttack.kind === 'weapon') pc.triggerAttack()
    }
    // 3. encounter events
    for (const ev of fresh) if (ev.type === 'actor_despawned') this.npcs.remove(ev.actorId)
    this.visuals.consumeEvents(fresh)
    // 4. player effects
    const descriptors = playerEffectDescriptors(state, fresh, this.itemFacts)
    this.playerFx.consume(descriptors, this.spots, (t) => this.npcs.typeHitsplatHeight(t))

    const queue: RenderQueue = {
      commands: [],
      tick: interpTick,
      brightness: input.settings.brightness,
      contrast: input.settings.contrast,
      saturation: input.settings.saturation,
    }
    const cmds = queue.commands
    const frac = Math.max(0, Math.min(1, interpTick - currentTick))
    // 5. NPC sync
    for (const npc of state.npcs) {
      if (!this.npcs.isTypeLoaded(npc.npcTypeId)) {
        const cfg = NPC_RENDER_CONFIGS[npc.npcTypeId]
        if (cfg) this.npcs.loadType(npc.npcTypeId, cfg)
      }
    }
    this.npcs.sync(state.npcs, frac)
    // 6. static world
    if (this.arena) {
      cmds.push(...this.arena.terrainCommands)
      cmds.push(...this.arena.staticLocCommands)
      const locClock = performance.now() / (20 / input.speed)
      for (const a of this.arena.animatedLocs) {
        let anim = this.locAnimators.get(a.key)
        if (!anim) {
          anim = new LocAnimator(a.seq, performance.now() / 20)
          this.locAnimators.set(a.key, anim)
        }
        const frame = a.frames[Math.floor(anim.update(locClock)) % a.frames.length]
        if (frame) cmds.push(...frame)
      }
    }
    // 7. NPC facing (Zuk-mode sim clock) and animations
    const pv = input.playerVisual.position
    const facingDt = this.animationCycle === null ? 0 : Math.max(0, interpTick * 30 - this.animationCycle)
    this.npcs.updateFacing(pv, facingDt * 20)
    this.advanceNpcAnimations(state, interpTick)
    // NPC meshes are emitted after the transparent sort projection is set
    const projection = camera.osrsProjection()
    this.npcs.setSortProjection(projection)
    this.spots.setSortProjection(projection)
    this.npcs.render(cmds)
    // 8. markers and highlights
    if (input.plugins.tileMarkers.length > 0) cmds.push(...tileMarkerMeshes(heights, input.plugins.tileMarkers, input.plugins.tileMarkerWidth))
    if (input.plugins.lineMarkers.length > 0) cmds.push(...lineMarkerMeshes(heights, input.plugins.lineMarkers, input.plugins.lineMarkerWidth))
    if (input.plugins.npcHighlights.length > 0) {
      const hits = new Map(this.npcs.hitTestData().map((h) => [h.actorId, h]))
      cmds.push(
        ...npcHighlightMeshes(heights, input.plugins.npcHighlights, state.npcs, (id) => hits.get(id), (t) => NPC_RENDER_CONFIGS[t]?.depthBias ?? 0),
      )
    }
    // 9. inferno visuals
    const surface = (x: number, y: number): number => this.arena?.surface.resolve(x, y) ?? bilinearHeight(heights, x, y)
    const resolveActor = (id: string): readonly [number, number] | null => (id === 'player' ? pv : this.npcs.visualPosition(id))
    this.visuals.update(this.spots, {
      cycle: interpTick * 30,
      resolveActor,
      surfaceHeight: surface,
      bilinearHeight: (x, y) => bilinearHeight(heights, x, y),
    })
    // 10. player
    if (pc) {
      pc.update({
        deltaMs: input.frameDeltaMs,
        speed: input.speed,
        isMoving: input.playerVisual.isVisuallyMoving,
        simIsMoving: input.playerVisual.simIsMoving,
        isRunning: input.playerVisual.isRunning,
        locomotion: input.playerVisual.locomotion,
        visualAngle: input.playerVisual.facingAngle,
        targetAngle: input.playerVisual.targetAngle,
        isTurning: input.playerVisual.isTurning,
      })
    }
    this.player.visual = input.playerVisual
    this.player.build(heights, projection)
    this.player.render(cmds)
    // 11. player graphic and projectiles
    const targetId = state.attackTarget ?? state.lastAttackTarget
    const targetFacing = state.npcs.find((n) => n.id === targetId)?.facingAngle ?? 0
    this.playerFx.update(this.spots, {
      currentTick,
      interpTick,
      playerVisual: pv,
      facingAngle: input.playerVisual.facingAngle,
      playerModelLift: this.player.modelLift(),
      resolveActor,
      surfaceHeight: surface,
      bilinearHeight: (x, y) => bilinearHeight(heights, x, y),
      footprintZ: (x, y, size) => footprintGroundZ(heights, x, y, size, size),
      targetFacing,
      typeHitsplatHeight: (t) => this.npcs.typeHitsplatHeight(t),
    })
    // 12. spot anims
    this.spots.tick(interpTick)
    this.spots.render(cmds, currentTick, interpTick)
    // 13. UI overlays
    this.ui.update(currentTick, fresh)
    const proj = {
      project: (x: number, y: number, z: number) => camera.project(x, y, z),
      height: (x: number, y: number) => bilinearHeight(heights, x, y),
    }
    const overlayNpcs = state.npcs.filter((n) => n.alive || this.npcs.instanceOrDying(n.id))
    const ui = this.ui.build(proj, state, pv, overlayNpcs, (id) => this.npcs.overlayHeights(id), interpTick, frac)
    // 14. tile indicators, debug grid, clickbox overlay
    cmds.push(...this.indicators(heights, input))
    if (input.settings.showDebugGrid) {
      this.gridCache ??= debugGridMesh(heights)
      cmds.push(this.gridCache)
    }
    if (input.settings.showNpcClickbox) {
      const typeOf = new Map(state.npcs.map((n) => [n.id, n.npcTypeId]))
      cmds.push(...npcClickboxOverlay(this.npcs.hitTestData(), (id) => NPC_RENDER_CONFIGS[typeOf.get(id) ?? -1]?.depthBias ?? 0))
    }
    // labels
    const labels: LabelDraw[] = []
    if (input.plugins.showTileMarkerLabels) {
      for (const m of input.plugins.tileMarkers) {
        const t = m.label?.trim()
        if (!t) continue
        const cx = m.x + 0.5
        const cy = m.y + 0.5
        const s = camera.project(cx, cy, -bilinearHeight(heights, cx, cy) / 128)
        if (s) labels.push({ key: `${m.x},${m.y}`, screenX: s.x, screenY: s.y, text: t, color: m.color })
      }
    }
    if (input.plugins.showLineMarkerLabels) {
      for (const l of input.plugins.lineMarkers) {
        const t = l.label?.trim()
        if (!t) continue
        const bx = l.orientation === 'horizontal' ? l.x + 1 : l.x
        const by = l.orientation === 'horizontal' ? l.y : l.y + 1
        const mx = (l.x + bx) / 2
        const my = (l.y + by) / 2
        const s = camera.project(mx, my, -bilinearHeight(heights, mx, my) / 128)
        if (s) labels.push({ key: `line:${l.orientation}:${l.x},${l.y}`, screenX: s.x, screenY: s.y, text: t, color: l.color })
      }
    }
    // frame sound states
    const frameStates: SequenceFrameState[] = []
    for (const s of this.npcs.frameStates()) frameStates.push({ key: s.key, seqId: s.seqId, frame: s.frame, position: s.position })
    const listener = { x: pv[0] + 0.5, y: pv[1] + 0.5 }
    const ps = pc?.frameState()
    if (ps) frameStates.push({ key: 'player', seqId: ps.seqId, frame: ps.frame, position: listener })
    for (const s of this.spots.frameStates(currentTick, interpTick)) frameStates.push(s)
    return { queue, hitsplats: ui.hitsplats, healthBars: ui.healthBars, icons: ui.icons, labels, frameStates, listener, discontinuity }
  }

  /** `getEncounterAttackTriggers` + `advanceAnimations`: NPC animation on the sim clock. */
  private advanceNpcAnimations(state: SimState, interpTick: number): void {
    const now = interpTick * 30
    this.animationCycle ??= state.currentTick * 30
    for (const cue of this.visuals.takeAnimations(now)) {
      this.advanceTo(Math.max(this.animationCycle, cue.cycle))
      const npc = state.npcs.find((n) => n.id === cue.cue.actorId)
      if (!npc) continue
      if (this.npcs.hasClip(npc.npcTypeId, cue.cue.clipId)) {
        this.npcs.triggerClip(npc.id, cue.cue.clipId)
        this.npcs.updateAnimations(0)
      }
    }
    this.advanceTo(now)
  }

  private advanceTo(target: number): void {
    let d = target - (this.animationCycle ?? target)
    while (d > 0) {
      const step = Math.min(d, 50)
      this.npcs.updateAnimations(step * 20)
      d -= step
    }
    this.animationCycle = target
  }

  private indicators(heights: Int32Array[] | null, input: FrameInput): MeshCommand[] {
    const c = input.plugins.tileIndicators
    const t = input.state.playerPosition
    const key = JSON.stringify([c, t, input.destinationTile, input.hoverTile])
    let cmds = this.indicatorCache.get(key)
    if (!cmds) {
      if (this.indicatorCache.size > 64) this.indicatorCache.clear()
      cmds = tileIndicators(heights, c, t, input.destinationTile, input.hoverTile)
      this.indicatorCache.set(key, cmds)
    }
    return cmds
  }
}
