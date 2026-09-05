import type { Actor } from '../engine/Actor'
import { Npc } from '../engine/Npc'
import { TILE_SIZE } from './Camera'
import type { HeightSampler, Ray } from './pick'

/** Nearest actor whose bounding box the ray hits, or null. */
export function pickActor(ray: Ray, actors: readonly Actor[], heights: HeightSampler, alpha: number): Actor | null {
  let best: Actor | null = null
  let bestT = Infinity
  for (const a of actors) {
    if (a.dead) continue
    const ix = a.prevX + (a.x - a.prevX) * alpha
    const iy = a.prevY + (a.y - a.prevY) * alpha
    const margin = TILE_SIZE * 0.3
    const x0 = ix * TILE_SIZE - margin
    const x1 = (ix + a.size) * TILE_SIZE + margin
    const z0 = iy * TILE_SIZE - margin
    const z1 = (iy + a.size) * TILE_SIZE + margin
    const ground = heights.heightAt((x0 + x1) / 2, (z0 + z1) / 2) ?? 0
    const height = a instanceof Npc ? 260 + a.size * 70 : 260
    const t = rayBox(ray, x0, ground, z0, x1, ground + height, z1)
    if (t !== null && t < bestT) {
      bestT = t
      best = a
    }
  }
  return best
}

function rayBox(ray: Ray, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): number | null {
  let tmin = -Infinity
  let tmax = Infinity
  const o = ray.origin
  const d = ray.direction
  const mins = [minX, minY, minZ]
  const maxs = [maxX, maxY, maxZ]
  for (let i = 0; i < 3; i++) {
    const di = d[i]!
    const oi = o[i]!
    if (Math.abs(di) < 1e-9) {
      if (oi < mins[i]! || oi > maxs[i]!) return null
      continue
    }
    let t1 = (mins[i]! - oi) / di
    let t2 = (maxs[i]! - oi) / di
    if (t1 > t2) [t1, t2] = [t2, t1]
    tmin = Math.max(tmin, t1)
    tmax = Math.min(tmax, t2)
    if (tmin > tmax) return null
  }
  return tmax < 0 ? null : Math.max(tmin, 0)
}
