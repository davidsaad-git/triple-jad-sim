import { mat4 } from 'gl-matrix'
import type { Actor } from '../engine/Actor'
import { TILE_SIZE } from './Camera'
import { GpuMesh, MeshBuilder, rgba } from './Mesh'
import type { Drawable, Renderer } from './Renderer'
import type { HeightSampler } from './pick'

/**
 * Placeholder actor visuals: a box per actor sized to its footprint, moved
 * each frame to the tick-interpolated position. Replaced by real models once
 * the model pipeline is in.
 */
export class ActorMarkers {
  private readonly renderer: Renderer
  private readonly entries = new Map<number, { drawable: Drawable; size: number }>()
  private readonly heights: HeightSampler

  constructor(renderer: Renderer, heights: HeightSampler) {
    this.renderer = renderer
    this.heights = heights
  }

  sync(actors: readonly Actor[], alpha: number, colorFor: (a: Actor) => number): void {
    const seen = new Set<number>()
    for (const a of actors) {
      seen.add(a.id)
      let entry = this.entries.get(a.id)
      if (!entry || entry.size !== a.size) {
        if (entry) this.renderer.remove(entry.drawable)
        const mesh = new GpuMesh(this.renderer.gl, buildBox(a.size, colorFor(a)))
        entry = { drawable: this.renderer.add(mesh), size: a.size }
        this.entries.set(a.id, entry)
      }
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
    for (const [id, entry] of this.entries) {
      if (!seen.has(id)) {
        this.renderer.remove(entry.drawable)
        entry.drawable.mesh.dispose(this.renderer.gl)
        this.entries.delete(id)
      }
    }
  }
}

function buildBox(size: number, color: number): ReturnType<MeshBuilder['build']> {
  const b = new MeshBuilder()
  const half = (size * TILE_SIZE) / 2 - 8
  const h = 150 + size * 30
  const dark = shade(color, 0.6)
  const mid = shade(color, 0.8)
  const x0 = -half, x1 = half, z0 = -half, z1 = half
  // Top (CCW from above).
  b.triangle(x0, h, z0, x0, h, z1, x1, h, z1, color, color, color)
  b.triangle(x0, h, z0, x1, h, z1, x1, h, z0, color, color, color)
  // Sides.
  quad(b, x0, 0, z0, x1, 0, z0, x1, h, z0, x0, h, z0, dark) // south (z0) facing -z
  quad(b, x1, 0, z1, x0, 0, z1, x0, h, z1, x1, h, z1, mid) // north
  quad(b, x0, 0, z1, x0, 0, z0, x0, h, z0, x0, h, z1, mid) // west
  quad(b, x1, 0, z0, x1, 0, z1, x1, h, z1, x1, h, z0, dark) // east
  // A nose marker on the front (south side) so facing is visible.
  const nose = rgba(255, 255, 255)
  b.triangle(-12, h, z0 - 1, 12, h, z0 - 1, 0, h + 30, z0 - 1, nose, nose, nose)
  return b.build()
}

function quad(
  b: MeshBuilder,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
  dx: number, dy: number, dz: number,
  color: number,
): void {
  b.triangle(ax, ay, az, cx, cy, cz, bx, by, bz, color, color, color)
  b.triangle(ax, ay, az, dx, dy, dz, cx, cy, cz, color, color, color)
}

function shade(color: number, f: number): number {
  const r = Math.round(((color >>> 24) & 0xff) * f)
  const g = Math.round(((color >>> 16) & 0xff) * f)
  const bl = Math.round(((color >>> 8) & 0xff) * f)
  return rgba(r, g, bl, color & 0xff)
}
