import { vec4, type mat4 } from 'gl-matrix'
import type { Actor } from '../engine/Actor'
import { Npc } from '../engine/Npc'
import { Player } from '../engine/Player'
import { TILE_SIZE } from '../render/Camera'
import type { HeightSampler } from '../render/pick'
import type { Renderer } from '../render/Renderer'
import { overlayStore, type OverlayActor } from './OverlayState'

/** Projects actors into viewport pixel space for the DOM overlay, once per frame. */
export function projectActors(renderer: Renderer, heights: HeightSampler, actors: readonly Actor[], alpha: number, tick: number): OverlayActor[] {
  const rect = renderer.canvas.getBoundingClientRect()
  const w = rect.width
  const h = rect.height
  const out: OverlayActor[] = []
  const vp = renderer.camera.viewProjection
  const tmp = vec4.create()
  for (const a of actors) {
    if (a.dead && a.hitsplats.length === 0) continue
    const ix = a.prevX + (a.x - a.prevX) * alpha
    const iy = a.prevY + (a.y - a.prevY) * alpha
    const wx = (ix + a.size / 2) * TILE_SIZE
    const wz = (iy + a.size / 2) * TILE_SIZE
    const wy = heights.heightAt(wx, wz) ?? 0
    const height = a instanceof Npc ? 120 + a.size * 60 : 230
    const head = project(vp, wx, wy + height, wz, w, h, tmp)
    const feet = project(vp, wx, wy, wz, w, h, tmp)
    if (!head || !feet) continue
    const inCombat = a instanceof Npc ? a.hitpoints < a.maxHitpoints || a.hitsplats.length > 0 : a.hitsplats.length > 0
    out.push({
      id: a.id,
      name: a.name,
      x: head.x,
      headY: head.y,
      feetY: feet.y,
      hitpoints: a.hitpoints,
      maxHitpoints: a.maxHitpoints,
      isPlayer: a instanceof Player,
      inCombat,
      hitsplats: a.hitsplats.map((s) => ({ kind: s.kind, amount: s.amount, age: tick - s.tick })),
      overhead: a instanceof Player ? a.prayers.overhead : null,
    })
  }
  return out
}

function project(vp: mat4, x: number, y: number, z: number, w: number, h: number, tmp: vec4): { x: number; y: number } | null {
  vec4.set(tmp, x, y, z, 1)
  vec4.transformMat4(tmp, tmp, vp)
  if (tmp[3] <= 0) return null
  const nx = tmp[0] / tmp[3]
  const ny = tmp[1] / tmp[3]
  return { x: ((nx + 1) / 2) * w, y: ((1 - ny) / 2) * h }
}

export function publishOverlay(
  actors: OverlayActor[],
  wave: number,
  phase: string,
  tick: number,
  spawnCountdown: number,
  width: number,
  height: number,
  boss: { name: string; hitpoints: number; maxHitpoints: number } | null = null,
  setTimerTicks = -1,
): void {
  overlayStore.set({ actors, wave, phase, tick, spawnCountdown, width, height, boss, setTimerTicks })
}
