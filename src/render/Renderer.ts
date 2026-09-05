import { mat4 } from 'gl-matrix'
import { Camera } from './Camera'
import { createGl, createProgram } from './gl'
import { GpuMesh } from './Mesh'
import { COLOR_FRAG, COLOR_VERT, TEXTURE_FRAG, TEXTURE_VERT } from './shaders'

export interface Drawable {
  mesh: GpuMesh
  model: mat4
  /** Hidden drawables are skipped without being removed. */
  visible: boolean
}

interface ProgramInfo {
  program: WebGLProgram
  uViewProjection: WebGLUniformLocation | null
  uModel: WebGLUniformLocation | null
  uBrightness: WebGLUniformLocation | null
  uTextures: WebGLUniformLocation | null
}

/**
 * Thin WebGL2 renderer: owns the context, camera, programs and a list of
 * drawables. Scene content is built elsewhere and handed over as GpuMesh.
 */
export class Renderer {
  readonly gl: WebGL2RenderingContext
  readonly canvas: HTMLCanvasElement
  readonly camera = new Camera()
  readonly drawables: Drawable[] = []
  brightness = 1
  clearColor: [number, number, number] = [0.06, 0.05, 0.05]
  textureArray: WebGLTexture | null = null

  private readonly colorProgram: ProgramInfo
  private readonly textureProgram: ProgramInfo
  private frameHandle = 0
  private lastWidth = 0
  private lastHeight = 0
  private readonly onFrame: ((dt: number, now: number) => void)[] = []
  private lastTime = 0

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.gl = createGl(canvas)
    this.colorProgram = this.makeProgram(COLOR_VERT, COLOR_FRAG)
    this.textureProgram = this.makeProgram(TEXTURE_VERT, TEXTURE_FRAG)
    const gl = this.gl
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
    gl.enable(gl.CULL_FACE)
    gl.cullFace(gl.BACK)
    gl.frontFace(gl.CCW)
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
  }

  private makeProgram(vs: string, fs: string): ProgramInfo {
    const gl = this.gl
    const program = createProgram(gl, vs, fs)
    return {
      program,
      uViewProjection: gl.getUniformLocation(program, 'u_viewProjection'),
      uModel: gl.getUniformLocation(program, 'u_model'),
      uBrightness: gl.getUniformLocation(program, 'u_brightness'),
      uTextures: gl.getUniformLocation(program, 'u_textures'),
    }
  }

  addFrameListener(fn: (dt: number, now: number) => void): () => void {
    this.onFrame.push(fn)
    return () => {
      const i = this.onFrame.indexOf(fn)
      if (i >= 0) this.onFrame.splice(i, 1)
    }
  }

  add(mesh: GpuMesh, model: mat4 = mat4.create()): Drawable {
    const d: Drawable = { mesh, model, visible: true }
    this.drawables.push(d)
    return d
  }

  remove(d: Drawable): void {
    const i = this.drawables.indexOf(d)
    if (i >= 0) this.drawables.splice(i, 1)
  }

  private running = false
  private generation = 0

  start(): void {
    if (this.running) return
    this.running = true
    const gen = ++this.generation
    this.lastTime = performance.now()
    const loop = (now: number) => {
      if (!this.running || gen !== this.generation) return
      this.frameHandle = requestAnimationFrame(loop)
      const dt = Math.min(0.1, (now - this.lastTime) / 1000)
      this.lastTime = now
      for (const fn of this.onFrame) fn(dt, now)
      this.render()
    }
    this.frameHandle = requestAnimationFrame(loop)
  }

  stop(): void {
    this.running = false
    this.generation++
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle)
    this.frameHandle = 0
  }

  private resizeToDisplay(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr))
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr))
    if (w !== this.lastWidth || h !== this.lastHeight) {
      this.canvas.width = w
      this.canvas.height = h
      this.lastWidth = w
      this.lastHeight = h
    }
  }

  render(): void {
    const gl = this.gl
    this.resizeToDisplay()
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.clearColor(this.clearColor[0], this.clearColor[1], this.clearColor[2], 1)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

    this.camera.update(this.canvas.width / this.canvas.height)

    let current: ProgramInfo | null = null
    for (const d of this.drawables) {
      if (!d.visible) continue
      const info = d.mesh.textured ? this.textureProgram : this.colorProgram
      if (info !== current) {
        current = info
        gl.useProgram(info.program)
        gl.uniformMatrix4fv(info.uViewProjection, false, this.camera.viewProjection)
        gl.uniform1f(info.uBrightness, this.brightness)
        if (info === this.textureProgram && this.textureArray) {
          gl.activeTexture(gl.TEXTURE0)
          gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.textureArray)
          gl.uniform1i(info.uTextures, 0)
        }
      }
      gl.uniformMatrix4fv(info.uModel, false, d.model)
      gl.bindVertexArray(d.mesh.vao)
      gl.drawArrays(gl.TRIANGLES, 0, d.mesh.vertexCount)
    }
    gl.bindVertexArray(null)
  }

  dispose(): void {
    this.stop()
    for (const d of this.drawables) d.mesh.dispose(this.gl)
    this.drawables.length = 0
  }
}
