/**
 * CPU-side triangle soup ready to upload: interleaved per-vertex position
 * (3 x f32), colour (4 x u8 normalised), priority (1 x f32) and optional
 * texcoord (3 x f32: u, v, layer).
 */
export interface MeshData {
  positions: Float32Array // 3 per vertex
  colors: Uint8Array // 4 per vertex
  priorities: Float32Array // 1 per vertex
  texcoords: Float32Array | null // 3 per vertex when textured
  vertexCount: number
}

export class MeshBuilder {
  private positions: number[] = []
  private colors: number[] = []
  private priorities: number[] = []
  private texcoords: number[] = []
  private textured = false

  triangle(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    rgbaA: number, rgbaB: number, rgbaC: number,
    priority = 0,
  ): void {
    this.positions.push(ax, ay, az, bx, by, bz, cx, cy, cz)
    pushRgba(this.colors, rgbaA)
    pushRgba(this.colors, rgbaB)
    pushRgba(this.colors, rgbaC)
    this.priorities.push(priority, priority, priority)
    if (this.textured) this.texcoords.push(0, 0, -1, 0, 0, -1, 0, 0, -1)
  }

  build(): MeshData {
    const vertexCount = this.positions.length / 3
    return {
      positions: Float32Array.from(this.positions),
      colors: Uint8Array.from(this.colors),
      priorities: Float32Array.from(this.priorities),
      texcoords: this.textured ? Float32Array.from(this.texcoords) : null,
      vertexCount,
    }
  }
}

function pushRgba(out: number[], rgba: number): void {
  out.push((rgba >>> 24) & 0xff, (rgba >>> 16) & 0xff, (rgba >>> 8) & 0xff, rgba & 0xff)
}

export function rgba(r: number, g: number, b: number, a = 255): number {
  return ((r << 24) | (g << 16) | (b << 8) | a) >>> 0
}

/** GPU buffers for one MeshData. */
export class GpuMesh {
  readonly vao: WebGLVertexArrayObject
  readonly vertexCount: number
  readonly textured: boolean
  private readonly buffers: WebGLBuffer[] = []

  constructor(gl: WebGL2RenderingContext, mesh: MeshData) {
    this.vertexCount = mesh.vertexCount
    this.textured = mesh.texcoords !== null
    const vao = gl.createVertexArray()
    if (!vao) throw new Error('createVertexArray failed')
    this.vao = vao
    gl.bindVertexArray(vao)

    this.attrib(gl, 0, mesh.positions, 3, gl.FLOAT, false, gl.STATIC_DRAW)
    this.attrib(gl, 1, mesh.colors, 4, gl.UNSIGNED_BYTE, true, gl.STATIC_DRAW)
    this.attrib(gl, 2, mesh.priorities, 1, gl.FLOAT, false, gl.STATIC_DRAW)
    if (mesh.texcoords) this.attrib(gl, 3, mesh.texcoords, 3, gl.FLOAT, false, gl.STATIC_DRAW)

    gl.bindVertexArray(null)
  }

  /** Re-upload positions only (animated models). */
  updatePositions(gl: WebGL2RenderingContext, positions: Float32Array): void {
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers[0]!)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions)
  }

  private attrib(
    gl: WebGL2RenderingContext,
    location: number,
    data: ArrayBufferView,
    size: number,
    type: number,
    normalized: boolean,
    usage: number,
  ): void {
    const buffer = gl.createBuffer()
    if (!buffer) throw new Error('createBuffer failed')
    this.buffers.push(buffer)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, data, usage)
    gl.enableVertexAttribArray(location)
    gl.vertexAttribPointer(location, size, type, normalized, 0, 0)
  }

  dispose(gl: WebGL2RenderingContext): void {
    for (const b of this.buffers) gl.deleteBuffer(b)
    gl.deleteVertexArray(this.vao)
  }
}
