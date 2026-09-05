import { mat4, vec3, vec4 } from 'gl-matrix'
import { TILE_SIZE, type Camera } from './Camera'

export interface Ray {
  origin: vec3
  direction: vec3
}

/** Build a world-space ray from a canvas pixel (CSS pixels relative to the canvas). */
export function rayFromScreen(camera: Camera, px: number, py: number, width: number, height: number): Ray {
  const ndcX = (px / width) * 2 - 1
  const ndcY = 1 - (py / height) * 2
  const inv = mat4.invert(mat4.create(), camera.viewProjection)
  if (!inv) throw new Error('viewProjection not invertible')
  const near = vec4.transformMat4(vec4.create(), [ndcX, ndcY, -1, 1], inv)
  const far = vec4.transformMat4(vec4.create(), [ndcX, ndcY, 1, 1], inv)
  const o = vec3.fromValues(near[0] / near[3], near[1] / near[3], near[2] / near[3])
  const f = vec3.fromValues(far[0] / far[3], far[1] / far[3], far[2] / far[3])
  const d = vec3.normalize(vec3.create(), vec3.subtract(vec3.create(), f, o))
  return { origin: o, direction: d }
}

export interface HeightSampler {
  /** World-space height (y up) at world x/z, or null outside the map. */
  heightAt(x: number, z: number): number | null
}

/** Flat ground at y = 0, used until the real terrain is loaded. */
export const flatGround: HeightSampler = { heightAt: () => 0 }

/**
 * March along the ray until it crosses the terrain surface; returns the tile
 * hit (SW corner tile coords) or null.
 */
export function pickTile(ray: Ray, sampler: HeightSampler, maxDistance = 20000): { x: number; y: number; worldX: number; worldZ: number } | null {
  const step = TILE_SIZE / 4
  let prevAbove: boolean | null = null
  for (let t = 0; t < maxDistance; t += step) {
    const x = ray.origin[0] + ray.direction[0] * t
    const y = ray.origin[1] + ray.direction[1] * t
    const z = ray.origin[2] + ray.direction[2] * t
    const h = sampler.heightAt(x, z)
    if (h === null) {
      prevAbove = null
      continue
    }
    const above = y > h
    if (prevAbove === true && !above) {
      return { x: Math.floor(x / TILE_SIZE), y: Math.floor(z / TILE_SIZE), worldX: x, worldZ: z }
    }
    prevAbove = above
  }
  return null
}
