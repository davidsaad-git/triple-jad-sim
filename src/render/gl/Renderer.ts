/**
 * WebGL2 renderer reproducing scim's PicoGLRenderer:
 *
 * - context: alpha false, MSAA on, no stencil, high-performance;
 * - reversed depth (clearDepth 0, GREATER), back-face culling, CCW fronts;
 * - clear colour #0a0b10 (never adjusted);
 * - passes in order: opaque (depth write) -> sorted (drawn without depth
 *   write, then re-drawn depth-only) -> transparent (alpha blending,
 *   separate alpha ONE/ONE, discard alpha < 0.01, depth write only for
 *   'readwrite') -> no-depth overlays (depth test off, blending still on);
 * - VAOs cached by meshId (static) or re-uploaded (animated), stale entries
 *   evicted every 60 frames after 120 unused frames;
 * - one 128x128 RGBA8 texture array, trilinear + anisotropy 16.
 */
import { CLEAR_COLOR } from '../color/shading'
import { SCENE_FRAGMENT_SHADER, SCENE_VERTEX_SHADER } from './shaders'
import type { TextureArrayData } from './textures'
import { TEXTURE_SIZE } from './textures'
import type { MeshCommand, RenderQueue } from './types'

interface VaoEntry {
  vao: WebGLVertexArrayObject
  buffers: WebGLBuffer[]
  pos: WebGLBuffer
  hsl: WebGLBuffer
  alpha: WebGLBuffer | null
  bias: WebGLBuffer | null
  uv: WebGLBuffer | null
  tex: WebGLBuffer | null
  vertexCount: number
  lastUsedFrame: number
  version: number | undefined
  source: Float32Array
}

export interface Viewport {
  /** CSS px. */
  width: number
  height: number
  /** Effective device pixel ratio (render scale * min(devicePixelRatio, 2)). */
  dpr: number
}

export function drawingBufferSize(v: Viewport): { width: number; height: number } {
  return { width: Math.max(1, Math.floor(v.width * v.dpr)), height: Math.max(1, Math.floor(v.height * v.dpr)) }
}

const EVICT_INTERVAL = 60
const MAX_STALE_FRAMES = 120

export class Renderer {
  readonly canvas: HTMLCanvasElement
  private gl: WebGL2RenderingContext
  private program!: WebGLProgram
  private uniforms!: Record<string, WebGLUniformLocation | null>
  private readonly vaos = new Map<string, VaoEntry>()
  private frame = 0
  private textureArray: WebGLTexture | null = null
  private textureAnimations: Float32Array = new Float32Array(512)
  private contextLost = false
  private readonly mvp = new Float32Array(16)
  private viewport: Viewport = { width: 1, height: 1, dpr: 1 }
  private readonly onLost: (e: Event) => void
  private readonly onRestored: () => void
  private textureData: TextureArrayData | null = null
  /** Draw statistics of the last frame. */
  stats = { drawCalls: 0, triangles: 0 }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: true,
      depth: true,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: false,
    })
    if (!gl) throw new Error('WebGL2 is not supported')
    this.gl = gl
    this.onLost = (e: Event) => {
      e.preventDefault()
      this.contextLost = true
    }
    this.onRestored = () => {
      this.contextLost = false
      this.vaos.clear()
      this.textureArray = null
      this.setup()
      if (this.textureData) this.uploadTextures(this.textureData)
      this.resize(this.viewport)
    }
    canvas.addEventListener('webglcontextlost', this.onLost)
    canvas.addEventListener('webglcontextrestored', this.onRestored)
    this.setup()
  }

  private setup(): void {
    const gl = this.gl
    gl.clearDepth(0)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.GREATER)
    gl.enable(gl.CULL_FACE)
    gl.cullFace(gl.BACK)
    gl.frontFace(gl.CCW)
    gl.disable(gl.BLEND)
    gl.clearColor(CLEAR_COLOR[0], CLEAR_COLOR[1], CLEAR_COLOR[2], 1)
    this.program = this.compile(SCENE_VERTEX_SHADER, SCENE_FRAGMENT_SHADER)
    const names = [
      'u_mvp',
      'u_zBias',
      'u_textureAnimations[0]',
      'u_textureAnimTime',
      'u_textures',
      'u_hasTextures',
      'u_brightness',
      'u_contrast',
      'u_saturation',
      'u_discardAlpha',
    ]
    this.uniforms = {}
    for (const n of names) this.uniforms[n] = gl.getUniformLocation(this.program, n)
    gl.useProgram(this.program)
    gl.uniform4fv(this.uniforms['u_textureAnimations[0]']!, this.textureAnimations)
  }

  private compile(vs: string, fs: string): WebGLProgram {
    const gl = this.gl
    const shader = (type: number, src: string): WebGLShader => {
      const s = gl.createShader(type)
      if (!s) throw new Error('createShader failed')
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        throw new Error(`shader compile failed: ${gl.getShaderInfoLog(s) ?? ''}`)
      }
      return s
    }
    const p = gl.createProgram()
    if (!p) throw new Error('createProgram failed')
    gl.attachShader(p, shader(gl.VERTEX_SHADER, vs))
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs))
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error(`program link failed: ${gl.getProgramInfoLog(p) ?? ''}`)
    }
    return p
  }

  /** True for software rasterisers (scim then uses the software render scale, default 0.5). */
  isSoftwareRenderer(): boolean {
    try {
      const ext = this.gl.getExtension('WEBGL_debug_renderer_info')
      const name = ext ? String(this.gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : ''
      return /swiftshader|llvmpipe|software|microsoft basic render/i.test(name)
    } catch {
      return false
    }
  }

  get isContextLost(): boolean {
    return this.contextLost
  }

  /** Resize the drawing buffer: floor(css * dpr), CSS size unchanged, full viewport. */
  resize(v: Viewport): void {
    this.viewport = v
    const { width, height } = drawingBufferSize(v)
    if (this.canvas.width !== width) this.canvas.width = width
    if (this.canvas.height !== height) this.canvas.height = height
    this.canvas.style.width = `${v.width}px`
    this.canvas.style.height = `${v.height}px`
    this.gl.viewport(0, 0, width, height)
  }

  uploadTextures(data: TextureArrayData): void {
    this.textureData = data
    const gl = this.gl
    if (this.textureArray) gl.deleteTexture(this.textureArray)
    const tex = gl.createTexture()
    if (!tex) return
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex)
    const levels = Math.floor(Math.log2(TEXTURE_SIZE)) + 1
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, gl.RGBA8, TEXTURE_SIZE, TEXTURE_SIZE, data.layers)
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY,
      0,
      0,
      0,
      0,
      TEXTURE_SIZE,
      TEXTURE_SIZE,
      data.layers,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array(data.argb.buffer, data.argb.byteOffset, data.argb.byteLength),
    )
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT)
    const aniso =
      gl.getExtension('EXT_texture_filter_anisotropic') ??
      gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic') ??
      gl.getExtension('MOZ_EXT_texture_filter_anisotropic')
    if (aniso) {
      const max = gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number
      gl.texParameterf(gl.TEXTURE_2D_ARRAY, aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(16, max || 1))
    }
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null)
    this.textureArray = tex
    this.textureAnimations = data.animations
    gl.useProgram(this.program)
    gl.uniform4fv(this.uniforms['u_textureAnimations[0]']!, this.textureAnimations)
  }

  /** Draw one frame. `viewProj` = projection * view (column-major). */
  render(queue: RenderQueue, viewProj: Float32Array, textureAnimTime: number): void {
    const gl = this.gl
    if (this.contextLost || gl.isContextLost()) return
    this.frame++
    if (this.frame % EVICT_INTERVAL === 0) this.evict()
    this.stats.drawCalls = 0
    this.stats.triangles = 0
    gl.clearColor(CLEAR_COLOR[0], CLEAR_COLOR[1], CLEAR_COLOR[2], 1)
    gl.depthMask(true)
    gl.colorMask(true, true, true, true)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    if (queue.commands.length === 0) return

    const opaque: MeshCommand[] = []
    const sorted: MeshCommand[] = []
    const transparent: MeshCommand[] = []
    const noDepth: MeshCommand[] = []
    for (const c of queue.commands) {
      if (c.depth === 'none') noDepth.push(c)
      else if (c.depth === 'sorted') sorted.push(c)
      else if (c.depth === 'read' || c.blend === 'normal') transparent.push(c)
      else opaque.push(c)
    }

    gl.useProgram(this.program)
    const u = this.uniforms
    gl.uniform1f(u['u_brightness']!, queue.brightness)
    gl.uniform1f(u['u_contrast']!, queue.contrast)
    gl.uniform1f(u['u_saturation']!, queue.saturation)
    gl.uniform1f(u['u_textureAnimTime']!, textureAnimTime)
    if (this.textureArray) {
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.textureArray)
      gl.uniform1i(u['u_textures']!, 0)
      gl.uniform1f(u['u_hasTextures']!, 1)
    } else {
      gl.uniform1f(u['u_hasTextures']!, 0)
    }
    let zBias = 0
    gl.uniform1f(u['u_zBias']!, 0)
    const draw = (c: MeshCommand): VaoEntry | null => {
      const count = c.positions.length / 3
      if (count === 0) return null
      const bias = c.depthBias ?? 0
      if (bias !== zBias) {
        zBias = bias
        gl.uniform1f(u['u_zBias']!, zBias)
      }
      multiply(this.mvp, viewProj, c.modelMatrix)
      gl.uniformMatrix4fv(u['u_mvp']!, false, this.mvp)
      if (c.cullFace === 'none') gl.disable(gl.CULL_FACE)
      else if (c.cullFace === 'front') gl.cullFace(gl.FRONT)
      const entry = this.vaoFor(c)
      if (entry) {
        gl.bindVertexArray(entry.vao)
        gl.drawArrays(gl.TRIANGLES, 0, entry.vertexCount)
        gl.bindVertexArray(null)
        this.stats.drawCalls++
        this.stats.triangles += entry.vertexCount / 3
      }
      if (c.cullFace === 'none') gl.enable(gl.CULL_FACE)
      else if (c.cullFace === 'front') gl.cullFace(gl.BACK)
      return entry
    }

    // 1. opaque
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.GREATER)
    gl.depthMask(true)
    gl.disable(gl.BLEND)
    gl.uniform1f(u['u_discardAlpha']!, 0)
    for (const c of opaque) draw(c)

    // 2. sorted: draw without depth writes, then lay down depth only
    if (sorted.length > 0) {
      gl.depthMask(false)
      const drawn: { entry: VaoEntry; mvp: Float32Array; bias: number }[] = []
      for (const c of sorted) {
        const e = draw(c)
        if (e) drawn.push({ entry: e, mvp: this.mvp.slice(), bias: c.depthBias ?? 0 })
      }
      gl.depthMask(true)
      gl.colorMask(false, false, false, false)
      for (const d of drawn) {
        if (d.bias !== zBias) {
          zBias = d.bias
          gl.uniform1f(u['u_zBias']!, zBias)
        }
        gl.uniformMatrix4fv(u['u_mvp']!, false, d.mvp)
        gl.bindVertexArray(d.entry.vao)
        gl.drawArrays(gl.TRIANGLES, 0, d.entry.vertexCount)
        gl.bindVertexArray(null)
      }
      gl.colorMask(true, true, true, true)
    }

    // 3. transparent
    gl.enable(gl.BLEND)
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE)
    gl.uniform1f(u['u_discardAlpha']!, 1)
    for (const c of transparent) {
      gl.depthMask(c.depth === 'readwrite')
      draw(c)
    }
    gl.depthMask(true)

    // 4. no-depth overlays (blending stays enabled, like scim)
    if (noDepth.length > 0) {
      gl.disable(gl.DEPTH_TEST)
      gl.depthMask(false)
      gl.uniform1f(u['u_discardAlpha']!, 0)
      for (const c of noDepth) draw(c)
      gl.enable(gl.DEPTH_TEST)
      gl.depthMask(true)
    }
    gl.disable(gl.BLEND)
  }

  private vaoFor(c: MeshCommand): VaoEntry | null {
    const cached = this.vaos.get(c.meshId)
    const count = c.positions.length / 3
    if (cached) {
      cached.lastUsedFrame = this.frame
      if (c.animated) {
        if (cached.vertexCount !== count) {
          this.deleteEntry(cached)
          const fresh = this.createVao(c)
          this.vaos.set(c.meshId, fresh)
          return fresh
        }
        if (c.version === undefined || cached.version !== c.version || cached.source !== c.positions) {
          this.upload(cached, c)
          cached.version = c.version
          cached.source = c.positions
        }
      }
      return cached
    }
    const entry = this.createVao(c)
    this.vaos.set(c.meshId, entry)
    return entry
  }

  private upload(e: VaoEntry, c: MeshCommand): void {
    const gl = this.gl
    const sub = (buf: WebGLBuffer | null, data: Float32Array | undefined): void => {
      if (!buf || !data) return
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data)
    }
    sub(e.pos, c.positions)
    sub(e.hsl, c.hslColors)
    sub(e.alpha, c.alphas)
    sub(e.bias, c.faceBias)
    sub(e.uv, c.uvs)
    sub(e.tex, c.textureIds)
  }

  private createVao(c: MeshCommand): VaoEntry {
    const gl = this.gl
    const vao = gl.createVertexArray()!
    gl.bindVertexArray(vao)
    const usage = c.animated ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW
    const buffers: WebGLBuffer[] = []
    const attr = (loc: number, data: Float32Array, size: number): WebGLBuffer => {
      const b = gl.createBuffer()!
      buffers.push(b)
      gl.bindBuffer(gl.ARRAY_BUFFER, b)
      gl.bufferData(gl.ARRAY_BUFFER, data, usage)
      gl.enableVertexAttribArray(loc)
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0)
      return b
    }
    const pos = attr(0, c.positions, 3)
    let uv: WebGLBuffer | null = null
    if (c.uvs) uv = attr(2, c.uvs, 2)
    else {
      gl.disableVertexAttribArray(2)
      gl.vertexAttrib2f(2, 0, 0)
    }
    let tex: WebGLBuffer | null = null
    if (c.textureIds) tex = attr(3, c.textureIds, 1)
    else {
      gl.disableVertexAttribArray(3)
      gl.vertexAttrib1f(3, 0)
    }
    const hsl = attr(4, c.hslColors, 1)
    let alpha: WebGLBuffer | null = null
    if (c.alphas) alpha = attr(6, c.alphas, 1)
    else {
      gl.disableVertexAttribArray(6)
      gl.vertexAttrib1f(6, 1)
    }
    let bias: WebGLBuffer | null = null
    if (c.faceBias) bias = attr(7, c.faceBias, 1)
    else {
      gl.disableVertexAttribArray(7)
      gl.vertexAttrib1f(7, 0)
    }
    gl.bindVertexArray(null)
    return {
      vao,
      buffers,
      pos,
      hsl,
      alpha,
      bias,
      uv,
      tex,
      vertexCount: c.positions.length / 3,
      lastUsedFrame: this.frame,
      version: c.version,
      source: c.positions,
    }
  }

  private deleteEntry(e: VaoEntry): void {
    for (const b of e.buffers) this.gl.deleteBuffer(b)
    this.gl.deleteVertexArray(e.vao)
  }

  private evict(): void {
    const limit = this.frame - MAX_STALE_FRAMES
    for (const [k, e] of this.vaos) {
      if (e.lastUsedFrame < limit) {
        this.deleteEntry(e)
        this.vaos.delete(k)
      }
    }
  }

  /** Drop a cached VAO (e.g. when a static mesh id is rebuilt with new data). */
  invalidate(meshIdPrefix: string): void {
    for (const [k, e] of this.vaos) {
      if (k.startsWith(meshIdPrefix)) {
        this.deleteEntry(e)
        this.vaos.delete(k)
      }
    }
  }

  dispose(): void {
    for (const e of this.vaos.values()) this.deleteEntry(e)
    this.vaos.clear()
    if (this.textureArray) this.gl.deleteTexture(this.textureArray)
    this.textureArray = null
    this.gl.deleteProgram(this.program)
    this.canvas.removeEventListener('webglcontextlost', this.onLost)
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored)
  }
}

/** out = a * b (column-major 4x4). */
export function multiply(out: Float32Array, a: ArrayLike<number>, b: ArrayLike<number>): Float32Array {
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[row]! * b[col * 4]! + a[4 + row]! * b[col * 4 + 1]! + a[8 + row]! * b[col * 4 + 2]! + a[12 + row]! * b[col * 4 + 3]!
    }
  }
  return out
}
