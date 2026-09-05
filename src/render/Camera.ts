import { mat4, vec3 } from 'gl-matrix'

/** One tile is 128 client units. */
export const TILE_SIZE = 128

/**
 * OSRS-style orbit camera. World space follows the client: x east, z north,
 * y up (we negate the client's downward heights when building geometry).
 * Yaw and pitch are in radians; yaw 0 looks north (towards +z), increasing
 * yaw turns clockwise when viewed from above, matching the client's 2048-unit
 * compass where the minimap arrow points along the view direction.
 */
export class Camera {
  target = vec3.fromValues(32 * TILE_SIZE, 0, 32 * TILE_SIZE)
  yaw = 0
  pitch = 0.45
  distance = 1400
  fovY = (60 * Math.PI) / 180
  near = 50
  far = 20000

  readonly view = mat4.create()
  readonly projection = mat4.create()
  readonly viewProjection = mat4.create()
  readonly position = vec3.create()

  static readonly MIN_PITCH = 0.12
  static readonly MAX_PITCH = 1.45
  static readonly MIN_DISTANCE = 250
  static readonly MAX_DISTANCE = 4000

  update(aspect: number): void {
    this.pitch = clamp(this.pitch, Camera.MIN_PITCH, Camera.MAX_PITCH)
    this.distance = clamp(this.distance, Camera.MIN_DISTANCE, Camera.MAX_DISTANCE)

    const horizontal = Math.cos(this.pitch) * this.distance
    const px = this.target[0] - Math.sin(this.yaw) * horizontal
    const pz = this.target[2] - Math.cos(this.yaw) * horizontal
    const py = this.target[1] + Math.sin(this.pitch) * this.distance
    vec3.set(this.position, px, py, pz)

    mat4.lookAt(this.view, this.position, this.target, [0, 1, 0])
    mat4.perspective(this.projection, this.fovY, aspect, this.near, this.far)
    mat4.multiply(this.viewProjection, this.projection, this.view)
  }

  /** Client compass angle 0..2047 for the minimap. */
  get compass(): number {
    const units = Math.round((this.yaw / (Math.PI * 2)) * 2048)
    return ((units % 2048) + 2048) % 2048
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
