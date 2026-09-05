import { mat4 } from 'gl-matrix'
import { animateModel, seqFrameAtTick, seqTotalLength, type AnimatedFrame } from '../../cache/anim'
import { buildMeshPositions } from '../../cache/model/ModelMesh'
import type { Actor } from '../../engine/Actor'
import { TILE_SIZE } from '../Camera'
import { GpuMesh } from '../Mesh'
import type { HeightSampler } from '../pick'
import type { Drawable, Renderer } from '../Renderer'
import type { ActorModelResolver, ResolvedModel } from './ActorModelResolver'
import { convertPositions, modelMeshToMeshData } from './meshConvert'

/** Client animation cycles per game tick (600 ms / 20 ms). */
export const CYCLES_PER_TICK = 30

interface Entry {
  drawable: Drawable
  model: ResolvedModel
  frame: AnimatedFrame | undefined
  clientPositions: Float32Array
  lastSeq: number
  lastFrame: number
}

/**
 * Draws actors with their real cache models, posed by the actor's current
 * animation. Frames are re-skinned on the CPU when the frame index changes
 * and re-uploaded as positions only, like the client.
 */
export class ActorRenderer {
  private readonly renderer: Renderer
  private readonly resolver: ActorModelResolver
  private readonly heights: HeightSampler
  private readonly entries = new Map<number, Entry>()
  /** Per (model key, seqId, frame) cache of posed render positions. */
  private readonly poseCache = new Map<string, Float32Array>()

  constructor(renderer: Renderer, resolver: ActorModelResolver, heights: HeightSampler) {
    this.renderer = renderer
    this.resolver = resolver
    this.heights = heights
  }

  /** Returns actors that have no model (so a fallback marker can be used). */
  sync(actors: readonly Actor[], worldTick: number, alpha: number): Actor[] {
    const fallback: Actor[] = []
    const seen = new Set<number>()
    for (const a of actors) {
      const entry = this.entryFor(a)
      if (!entry) {
        fallback.push(a)
        continue
      }
      seen.add(a.id)
      if (entry.model.animated) this.pose(a, entry, worldTick, alpha)
      this.place(a, entry, alpha)
    }
    for (const [id, entry] of this.entries) {
      if (!seen.has(id)) {
        this.renderer.remove(entry.drawable)
        entry.drawable.mesh.dispose(this.renderer.gl)
        this.entries.delete(id)
      }
    }
    return fallback
  }

  private entryFor(actor: Actor): Entry | null {
    const model = this.resolver.resolve(actor)
    if (!model) return null
    const existing = this.entries.get(actor.id)
    if (existing && existing.model.key === model.key) return existing
    if (existing) {
      this.renderer.remove(existing.drawable)
      existing.drawable.mesh.dispose(this.renderer.gl)
      this.entries.delete(actor.id)
    }
    const gpu = new GpuMesh(this.renderer.gl, modelMeshToMeshData(model.mesh))
    const entry: Entry = {
      drawable: this.renderer.add(gpu),
      model,
      frame: undefined,
      clientPositions: new Float32Array(model.mesh.vertexCount * 3),
      lastSeq: -2,
      lastFrame: -1,
    }
    this.entries.set(actor.id, entry)
    return entry
  }

  private pose(actor: Actor, entry: Entry, worldTick: number, alpha: number): void {
    let seqId = actor.animation.seqId
    let cycles = Math.floor((worldTick - actor.animation.startTick + alpha) * CYCLES_PER_TICK)
    if (seqId >= 0 && !actor.animation.loop) {
      const seq = this.resolver.npcs.seq(seqId)
      if (!seq || cycles >= seqTotalLength(seq)) seqId = -1
    }
    if (seqId < 0) {
      seqId = this.resolver.defaultSequence(actor)
      cycles = Math.floor((worldTick + alpha) * CYCLES_PER_TICK)
    }
    if (seqId < 0) return
    const seq = this.resolver.npcs.seq(seqId)
    if (!seq) return
    const frame = seqFrameAtTick(seq, cycles)
    if (entry.lastSeq === seqId && entry.lastFrame === frame) return
    entry.lastSeq = seqId
    entry.lastFrame = frame
    const key = `${entry.model.key}:${seqId}:${frame}`
    let positions = this.poseCache.get(key)
    if (!positions) {
      entry.frame = animateModel(entry.model.lit, seq, frame, this.resolver.npcs.anim, entry.frame)
      buildMeshPositions(entry.model.lit, entry.frame, entry.clientPositions)
      positions = convertPositions(entry.clientPositions, new Float32Array(entry.clientPositions.length))
      this.poseCache.set(key, positions)
    }
    entry.drawable.mesh.updatePositions(this.renderer.gl, positions)
  }

  private place(a: Actor, entry: Entry, alpha: number): void {
    const ix = a.prevX + (a.x - a.prevX) * alpha
    const iy = a.prevY + (a.y - a.prevY) * alpha
    const wx = (ix + a.size / 2) * TILE_SIZE
    const wz = (iy + a.size / 2) * TILE_SIZE
    const wy = this.heights.heightAt(wx, wz) ?? 0
    const m = entry.drawable.model
    mat4.fromTranslation(m, [wx, wy, wz])
    mat4.rotateY(m, m, (a.facing / 2048) * Math.PI * 2)
    entry.drawable.visible = !a.dead
  }
}
