/**
 * One draw command of the render queue.
 * Positions are in the units the model matrix expects (OSRS units for
 * terrain/locs/actors, world tiles for overlays).
 */
export type DepthMode = 'readwrite' | 'read' | 'sorted' | 'none'

export interface MeshCommand {
  /** VAO cache key: identical ids share GPU buffers (static meshes). */
  meshId: string
  /** Column-major 4x4 model -> world matrix. */
  modelMatrix: Float32Array
  positions: Float32Array
  hslColors: Float32Array
  alphas?: Float32Array | undefined
  faceBias?: Float32Array | undefined
  uvs?: Float32Array | undefined
  textureIds?: Float32Array | undefined
  /** Default 'readwrite'. */
  depth?: DepthMode
  /** 'normal' = alpha blending (transparent bucket). */
  blend?: 'normal'
  /** Default 'back'. */
  cullFace?: 'back' | 'front' | 'none'
  /** NDC depth bias added as clip.z += bias * clip.w. */
  depthBias?: number | undefined
  /** Re-upload attribute data every frame. */
  animated?: boolean
  /** Bumped by the owner whenever the arrays of an animated command change. */
  version?: number
}

export interface RenderQueue {
  commands: MeshCommand[]
  /** Interpolated tick (u_currentTick). */
  tick: number
  brightness: number
  contrast: number
  saturation: number
}

/** Column-major identity. */
export function identityMatrix(): Float32Array {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
}

/** The standard OSRS-units -> world matrix with yaw 0. */
export function osrsModelMatrix(tx: number, ty: number, tz: number): Float32Array {
  const s = 1 / 128
  return new Float32Array([s, 0, 0, 0, 0, 0, -s, 0, 0, s, 0, 0, tx, ty, tz, 1])
}
