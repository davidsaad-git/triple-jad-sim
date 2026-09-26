import { describe, expect, it } from 'vitest'
import { NpcAnimController, sampleFrameId, type AnimClip, type NpcAnimationSet, type PoseAdapter } from './actors/NpcAnimController'
import { PlayerMovement } from './actors/PlayerMovement'
import { FacingTracker, angleTo, direction8 } from './actors/facing'
import { Camera, NEAR, osrsDistance } from './camera/Camera'
import { createWheelNotcher, followStep } from './camera/CameraController'
import { CLEAR_COLOR, hexToPackedHsl, hslToRgb, packHsl8, postProcess, shadeHsl, shadeTexel } from './color/shading'
import { Flight, distanceToFootprint, initMotion, integrate, orientation, reaim } from './effects/projectile'
import { frameIndexAt } from './effects/SpotAnims'
import { multiply } from './gl/Renderer'
import { painterSort } from './model/painterSort'
import { RenderModel, adjustLightness } from './model/RenderModel'
import { assignSlot, type ActorOverlayState, prayerIconPath } from './overlays/UiOverlays'
import { cornerOutlineMesh, outlineMesh } from './overlays/worldOverlays'
import { hitTestBox, hitTestTriangles } from './picking'
import type { NpcHitTestData } from './actors/NpcManager'
import type { SeqType } from '../cache/config/SeqType'
import { mixHsl, overlayCorner, packHsl, underlayCorner, underlayHsl, HIDDEN_HSL } from '../scene/arena/floorColors'
import { shapeGeometry, shapeSurfaceHeight } from '../scene/arena/tileShapes'

const DISPLAY = { brightness: 0.6, contrast: 1, saturation: 1 }

describe('colour pipeline', () => {
  it('converts OSRS HSL like the shader (gamma 0.6)', () => {
    // black / white / mid grey
    expect(hslToRgb(0)).toEqual([0, 0, 0])
    const white = hslToRgb(127)
    expect(white[0]).toBeCloseTo(Math.pow((1 - 127 / 128) * (2 * 0.0625 * 1 + (1 - 0.0625)) + (2 * 127 / 128 - 1), 0.6), 6)
    // saturation bits 0 still mean 1/16 saturation: hue 0 is a faint red
    const grey = hslToRgb(64)
    expect(grey[0]).toBeGreaterThan(grey[1])
    expect(grey[1]).toBeGreaterThanOrEqual(grey[2])
    // pure-ish red hue 0, max saturation, lightness 64
    const red = hslToRgb((0 << 10) | (7 << 7) | 64)
    expect(red[0]).toBeGreaterThan(red[1])
    expect(red[0]).toBeGreaterThan(red[2])
  })

  it('applies gain, contrast, saturation and 8-bit rounding', () => {
    expect(postProcess([0.5, 0.5, 0.5], DISPLAY)).toEqual([128 / 255, 128 / 255, 128 / 255])
    const bright = postProcess([0.5, 0.5, 0.5], { ...DISPLAY, brightness: 1.2 })
    expect(bright[0]).toBe(1)
    const flat = postProcess([0.2, 0.8, 0.4], { ...DISPLAY, saturation: 0 })
    expect(flat[0]).toBeCloseTo(flat[1], 6)
    const lum = 0.2 * 0.299 + 0.8 * 0.587 + 0.4 * 0.114
    expect(flat[0]).toBeCloseTo(Math.round(lum * 255) / 255, 6)
    const contrast = postProcess([0.75, 0.25, 0.5], { ...DISPLAY, contrast: 2 })
    expect(contrast).toEqual([1, 0, 128 / 255])
  })

  it('shades textures as texel^0.6 * light/127', () => {
    const c = shadeTexel([255, 0, 128], 127, DISPLAY)
    expect(c[0]).toBe(255)
    expect(c[1]).toBe(0)
    expect(c[2]).toBe(Math.round(Math.pow(128 / 255, 0.6) * 255))
    const half = shadeTexel([255, 255, 255], 63, DISPLAY)
    expect(half[0]).toBe(Math.round((63 / 127) * 255))
  })

  it('keeps the clear colour at #0a0b10', () => {
    expect(CLEAR_COLOR.map((c) => Math.round(c * 255))).toEqual([10, 11, 16])
    expect(shadeHsl(0, DISPLAY)).toEqual([0, 0, 0])
  })

  it('packs hex colours like hexToPackedHsl', () => {
    expect(hexToPackedHsl('#000000')).toBe(0)
    expect(hexToPackedHsl('nonsense')).toBe(packHsl8(0, 0, 127))
    expect(packHsl8(0, 0, 60)).toBe(30)
    expect(packHsl8(0, 255, 100)).toBe(946)
    const teal = hexToPackedHsl('#6fb0ae')
    expect(teal >> 10).toBeGreaterThan(20)
    expect(hexToPackedHsl('#fff')).toBe(hexToPackedHsl('#ffffff'))
  })
})

describe('terrain colours and shapes', () => {
  it('packs floor HSL with the lightness saturation halving', () => {
    expect(packHsl(0, 255, 100)).toBe(((255 / 32) << 7) + 50)
    expect(packHsl(128, 255, 200)).toBe((((255 >> 1) >> 1) / 32 << 7) + (32 << 10) + 100)
  })

  it('computes the underlay hue weighted by its multiplier', () => {
    const u = underlayHsl(0x808080)
    expect(u.hueMultiplier).toBe(1)
    expect(u.saturation).toBe(0)
    const r = underlayHsl(0xff0000)
    expect(r.hue).toBe(0)
    expect(r.hueMultiplier).toBeGreaterThan(1)
  })

  it('lights corners and handles hidden / textured sentinels', () => {
    expect(underlayCorner(-1, 96)).toBe(HIDDEN_HSL)
    expect(overlayCorner(-2, 96)).toBe(HIDDEN_HSL)
    expect(overlayCorner(-1, 200)).toBe(126)
    expect(overlayCorner(-1, 0)).toBe(2)
    expect(underlayCorner(100, 128)).toBe(100)
    expect(mixHsl(HIDDEN_HSL, 5)).toBe(HIDDEN_HSL)
    expect(mixHsl(-1, 77)).toBe(77)
    expect(mixHsl((10 << 10) | (4 << 7) | 100, (20 << 10) | (2 << 7) | 50)).toBe((15 << 10) | (3 << 7) | 75)
  })

  it('builds OSRS tile shapes with rotation and exact surface heights', () => {
    const plain = shapeGeometry(0, 0, [0, 0, 0, 0])
    expect(plain.vertices).toHaveLength(4)
    expect(plain.faces).toHaveLength(2)
    const shape = shapeGeometry(5, 1, [-100, -200, -300, -400])
    expect(shape.faces.length).toBe(3)
    const flat = shapeGeometry(0, 0, [-128, -128, -128, -128])
    expect(shapeSurfaceHeight(flat, 64, 64)).toBe(-128)
    const slope = shapeGeometry(0, 0, [0, -128, -128, 0])
    const h = shapeSurfaceHeight(slope, 64, 64)!
    expect(h).toBeGreaterThanOrEqual(-65)
    expect(h).toBeLessThanOrEqual(-63)
  })
})

function triModel(): RenderModel {
  const m = new RenderModel()
  m.verticesCount = 3
  m.usedVertexCount = 3
  m.verticesX = new Int32Array([0, 100, 0])
  m.verticesY = new Int32Array([0, 0, 0])
  m.verticesZ = new Int32Array([0, 0, 100])
  m.faceCount = 1
  m.indices1 = new Int32Array([0])
  m.indices2 = new Int32Array([1])
  m.indices3 = new Int32Array([2])
  m.faceColors = new Uint16Array([(10 << 10) | (3 << 7) | 80])
  return m
}

describe('model lighting', () => {
  it('lights smooth faces per vertex with the OSRS formula', () => {
    const m = triModel()
    const lit = m.computeLitColors(64, 850, -30, -50, -30)
    m.calculateVertexNormals()
    const n = m.normals![0]!
    expect(n.magnitude).toBe(1)
    const mag = ((Math.sqrt(30 * 30 + 50 * 50 + 30 * 30) | 0) * 850) >> 8
    const L = (64 + (-50 * n.y + -30 * n.z + -30 * n.x) / (mag * 1)) | 0
    expect(lit.faceColors1[0]).toBe(adjustLightness(m.faceColors[0]!, L))
    expect(lit.faceColors3[0]).toBe(lit.faceColors1[0])
  })

  it('hides alpha -1 faces and makes -2 faces unlit', () => {
    const m = triModel()
    m.faceAlphas = new Int8Array([-1])
    expect(m.computeLitColors(64, 850, -30, -50, -30).faceColors3[0]).toBe(-2)
    m.faceAlphas = new Int8Array([-2])
    const lit = m.computeLitColors(64, 850, -30, -50, -30)
    expect(lit.faceColors1[0]).toBe(128)
    expect(lit.faceColors3[0]).toBe(-1)
  })

  it('merges models de-duplicating vertices', () => {
    const a = triModel()
    const b = triModel()
    b.verticesX = new Int32Array([0, 100, 0])
    b.verticesZ = new Int32Array([0, 0, -100])
    const m = RenderModel.merge([a, b])
    expect(m.faceCount).toBe(2)
    expect(m.verticesCount).toBe(4)
  })
})

describe('painter sort', () => {
  it('keeps all faces in index order without a projection and splits transparent faces', () => {
    const m = RenderModel.merge([triModel(), triModel(), triModel()])
    m.faceAlphas = new Int8Array([0, 100, 0])
    const r = painterSort({ ...m, faceColors3: new Int32Array([0, 0, 0]), faceAlphas: m.faceAlphas }, null)
    expect(r.opaqueFaces).toEqual([0, 2])
    expect(r.transparentFaces).toEqual([1])
  })

  it('drops back faces and aborts when the camera is too close', () => {
    const m = triModel()
    const proj = { cameraX: 0, cameraY: -1000, cameraZ: -2000, yawSin: 0, yawCos: 1, pitchSin: Math.sin(0.4), pitchCos: Math.cos(0.4), orientation: 0, modelX: 0, modelY: 0, modelZ: 0 }
    const r = painterSort({ ...m, faceColors3: new Int32Array([0]), faceAlphas: null }, proj)
    expect(r.opaqueFaces.length + r.transparentFaces.length).toBeLessThanOrEqual(1)
    const close = painterSort({ ...m, faceColors3: new Int32Array([0]), faceAlphas: null }, { ...proj, cameraZ: 10, cameraY: 0, pitchSin: 0, pitchCos: 1 })
    expect(close.opaqueFaces).toEqual([])
  })
})

describe('projectiles', () => {
  it('starts pushed forward, arrives at the target at the end cycle', () => {
    const src = { x: 0, y: 0, z: 4 }
    const tgt = { x: 10, y: 0, z: 1 }
    const f = new Flight(0, 41, 32, 16)
    let s = f.sample(0, src, tgt)
    expect(s.kind).toBe('active')
    if (s.kind === 'active') expect(s.motion.x).toBeCloseTo(0.25, 6)
    for (let c = 1; c <= 40; c++) s = f.sample(c, src, tgt)
    if (s.kind !== 'active') throw new Error('expected active')
    // one cycle before the exclusive end: 1/41 of the path left
    expect(s.motion.x).toBeGreaterThan(9.7)
    expect(f.sample(41, src, tgt).kind).toBe('expired')
    expect(new Flight(10, 20, 0, 0).sample(5, src, tgt).kind).toBe('pending')
  })

  it('reaches the target exactly after the full horizon and homes on a moving target', () => {
    let m = initMotion({ x: 0, y: 0, z: 5 }, { x: 8, y: 0, z: 1 }, 0, 16, 30)
    expect(m.vz).toBeGreaterThan(0)
    for (let i = 0; i < 30; i++) m = integrate(reaim(m, { x: 8, y: 0, z: 1 }, 30 - i), 1)
    expect(m.x).toBeCloseTo(8, 6)
    expect(m.z).toBeCloseTo(1, 6)
    let h = initMotion({ x: 0, y: 0, z: 1 }, { x: 5, y: 0, z: 1 }, 0, 0, 20)
    for (let i = 0; i < 20; i++) h = integrate(reaim(h, { x: 5, y: i * 0.1, z: 1 }, 20 - i), 1)
    expect(h.y).toBeGreaterThan(1)
  })

  it('orients the model along the velocity (0 = south, 1024 = north)', () => {
    // moving north -> the model faces north (1024); moving south -> 0
    expect(orientation({ x: 0, y: 0, z: 0, vx: 0, vy: 1, vz: 0, az: 0 }).yaw2048).toBeCloseTo(1024, 6)
    expect(orientation({ x: 0, y: 0, z: 0, vx: 0, vy: -1, vz: 0, az: 0 }).yaw2048 % 2048).toBeCloseTo(0, 6)
    expect(orientation({ x: 0, y: 0, z: 0, vx: 1, vy: 0, vz: 1, az: 0 }).pitchRad).toBeCloseTo(-Math.PI / 4, 6)
  })

  it('computes frame progress and footprint distance', () => {
    expect(Flight.frameProgress('full-sequence', 40, [10, 10, 10, 10], -1)).toBe(0)
    expect(Flight.frameProgress('frame-step', 20, [10, 10, 10, 10], 2)).toBe(0.5)
    expect(Flight.frameProgress('frame-step', 45, [10, 10, 10, 10], 2)).toBeCloseTo((20 + 5) / 40, 6)
    expect(distanceToFootprint(31, 33, 24, 36, 5)).toBe(3)
    expect(distanceToFootprint(26, 38, 24, 36, 5)).toBe(0)
    expect(frameIndexAt(0.5, [10, 10, 10, 10], 40)).toBe(2)
    expect(frameIndexAt(1, [10, 10], 20)).toBe(1)
  })
})

function seq(id: number, forcedPriority: number, frames: number[], masks: number[] | null = null, heightOffset = 0): SeqType {
  return {
    id,
    forcedPriority,
    frameIds: frames.map((_, i) => id * 100 + i),
    frameLengths: frames,
    masks,
    heightOffset,
    precedenceAnimating: -1,
    priority: -1,
    isSkeletalSeq: () => false,
  } as unknown as SeqType
}

function clip(name: string, s: SeqType): AnimClip {
  return { id: name, seqId: s.id, seq: s, frameIds: s.frameIds, frameLengths: s.frameLengths }
}

class RecordingAdapter implements PoseAdapter {
  poses: string[] = []
  resetPose(): void {}
  applyFrame(frameId: number): void {
    this.poses.push(`f${frameId}`)
  }
  applyFrameInterleaved(p: number, b: number): void {
    this.poses.push(`i${p}+${b}`)
  }
  commitPose(): void {}
}

describe('NPC animation controller', () => {
  const idle = clip('idle', seq(1, 3, [5, 5]))
  const walk = clip('walk', seq(2, 4, [4, 4]))
  const magic = clip('magic', seq(3, 10, [10, 10]))
  const defend = clip('defend', seq(4, 4, [5, 5]))
  const death = clip('death', seq(5, 10, [3, 3]))
  const masked = clip('heal', seq(6, 6, [5], [1, 9999999]))
  const set: NpcAnimationSet = { idle, walk, death, attackClips: { magic, defend, heal: masked } }

  it('samples frames without tweening (loop and oneshot)', () => {
    expect(sampleFrameId(idle, 0, 'loop')).toBe(100)
    expect(sampleFrameId(idle, 5, 'loop')).toBe(101)
    expect(sampleFrameId(idle, 10, 'loop')).toBe(100)
    expect(sampleFrameId(magic, 99, 'oneshot')).toBe(301)
  })

  it('lets attacks replace defends but not the reverse; death is final', () => {
    const a = new RecordingAdapter()
    const c = new NpcAnimController(set, a)
    c.update(20, 1, false)
    c.triggerAttack(magic)
    c.update(20, 1, false)
    expect(c.describe().primary).toBe('magic')
    c.triggerAttack(defend)
    c.update(20, 1, false)
    expect(c.describe().primary).toBe('magic')
    c.update(20 * 20, 1, false)
    expect(c.describe().primary).toBe(null)
    c.triggerAttack(defend)
    c.update(20, 1, false)
    c.triggerAttack(magic)
    c.update(20, 1, false)
    expect(c.describe().primary).toBe('magic')
    c.triggerDeath()
    c.triggerAttack(magic)
    c.update(20 * 100, 1, false)
    expect(c.describe().primary).toBe('death')
    expect(a.poses[a.poses.length - 1]).toBe('f501')
  })

  it('walks while moving and keeps idle phase; interleaves masked primaries only over walk', () => {
    const a = new RecordingAdapter()
    const c = new NpcAnimController(set, a)
    c.update(60, 1, false)
    expect(c.describe().base).toBe('idle')
    c.update(20, 1, true)
    expect(c.describe().base).toBe('walk')
    c.triggerAttack(masked)
    c.update(20, 1, true)
    expect(a.poses[a.poses.length - 1]!.startsWith('i')).toBe(true)
    const b = new RecordingAdapter()
    const d = new NpcAnimController(set, b)
    d.triggerAttack(masked)
    d.update(20, 1, false)
    expect(b.poses[b.poses.length - 1]).toBe('f600')
  })

  it('honours start delays and caps catch-up at 50 cycles per update', () => {
    const a = new RecordingAdapter()
    const c = new NpcAnimController(set, a)
    c.triggerAttack(magic, { delayClientTicks: 3 })
    c.update(20, 1, false)
    expect(c.describe().primaryDelay).toBe(3)
    c.update(60, 1, false)
    expect(c.describe().primaryDelay).toBe(0)
    // one update never advances more than 50 cycles; the 20-cycle attack is over
    c.update(20 * 100, 1, false)
    expect(c.describe().primary).toBe(null)
  })

  it('uses the base height offset while an attack plays over walk', () => {
    const tall = clip('magic', seq(7, 10, [10], null, 12))
    const c = new NpcAnimController({ idle: clip('idle', seq(8, 3, [5], null, 4)), walk: clip('walk', seq(9, 4, [5], null, 4)), attackClips: { magic: tall } }, new RecordingAdapter())
    c.triggerAttack(tall)
    c.update(20, 1, false)
    expect(c.heightOffset()).toBe(12)
    c.update(20, 1, true)
    expect(c.heightOffset()).toBe(4)
  })
})

describe('hitsplats and overheads', () => {
  it('assigns slots round-robin and overwrites the earliest expiry when full', () => {
    const st: ActorOverlayState = { slots: [null, null, null, null], roundRobin: 0, healthBarVisibleUntilTick: -1 }
    expect(assignSlot(st, 1, 'damage', 10)).toBe(0)
    expect(assignSlot(st, 2, 'damage', 10)).toBe(1)
    expect(assignSlot(st, 3, 'block', 11)).toBe(2)
    expect(assignSlot(st, 4, 'heal', 11)).toBe(3)
    expect(assignSlot(st, 5, 'damage', 11)).toBe(0)
    // everything expired -> round robin resets to slot 0
    expect(assignSlot(st, 6, 'damage', 20)).toBe(0)
    expect(assignSlot(st, 7, 'damage', 20)).toBe(1)
  })

  it('maps protection prayers to scim icon paths', () => {
    expect(prayerIconPath('ProtectMagic')).toBe('/assets/ui/overhead_magic.png')
    expect(prayerIconPath('ProtectRange')).toBe('/assets/ui/overhead_missiles.png')
    expect(prayerIconPath('Piety')).toBe(null)
  })
})

describe('camera', () => {
  const viewport = { width: 800, height: 600, dpr: 1 }

  it('orbits south of the target at yaw 0 with the OSRS focal length', () => {
    const cam = new Camera(viewport, { pitch: -22.5, yaw: 0, distance: 24, targetX: 30, targetY: 30, targetZ: 0 })
    const eye = cam.orbitEye()
    expect(eye.y).toBeCloseTo(30 - 24 * Math.cos((22.5 * Math.PI) / 180), 6)
    expect(eye.z).toBeCloseTo(24 * Math.sin((22.5 * Math.PI) / 180), 6)
    const p = cam.projectionMatrix()
    expect(p[0]).toBeCloseTo((2 * Math.floor((600 * 512) / 334)) / 800, 9)
    const s = cam.project(30, 30, 0)!
    expect(s.x).toBeCloseTo(400, 3)
    expect(s.y).toBeCloseTo(300, 3)
    expect(cam.distance).toBe(24)
    cam.update({ distance: 24 })
    expect(cam.distance).toBe(20)
  })

  it('maps near/far to reversed NDC depth', () => {
    const cam = new Camera(viewport, { distance: 10 })
    const p = cam.projectionMatrix()
    const ndc = (z: number): number => (p[10]! * z + p[14]!) / (p[11]! * z)
    expect(ndc(-NEAR)).toBeCloseTo(1, 9)
    expect(ndc(-200)).toBeCloseTo(-1, 9)
  })

  it('clamps pitch and zoom and ray-marches tiles', () => {
    const cam = new Camera(viewport, { pitch: -22.5, yaw: 0, distance: 10, targetX: 20.5, targetY: 20.5, targetZ: 0 })
    cam.update({ pitch: -90 })
    expect(cam.pitch).toBe(-67.5)
    cam.update({ fovScale: 10000 })
    expect(cam.fovScale).toBe(896)
    cam.setLimits({ relaxPitch: true, innerZoomLimit: 896 + 448 * 8, outerZoomAdjust: 0 })
    cam.update({ pitch: -90, fovScale: 10000 })
    expect(cam.pitch).toBe(-87.5)
    expect(cam.fovScale).toBe(896 + 448 * 8)
    const flat = Array.from({ length: 65 }, () => new Int32Array(65))
    cam.setTerrainHeights(flat)
    cam.update({ pitch: -45, fovScale: 512 })
    const centre = cam.project(20.5, 20.5, 0)!
    expect(cam.screenToTile(centre.x, centre.y)).toEqual({ x: 20, y: 20 })
    const edge = cam.screenToTileEdge(centre.x, centre.y + 40)
    expect(edge?.edge).toBe('south')
  })

  it('follows 1/16 per 20 ms and snaps beyond 3.9 tiles; wheel notches', () => {
    const p = followStep({ x: 0, y: 0 }, 1, 0, 20)
    expect(p.x).toBeCloseTo(1 / 16, 9)
    expect(followStep({ x: 0, y: 0 }, 4, 0, 20)).toEqual({ x: 4, y: 0 })
    const n = createWheelNotcher()
    expect(n({ deltaY: 100, deltaMode: 0 })).toBe(1)
    expect(n({ deltaY: 50, deltaMode: 0 })).toBe(0)
    expect(n({ deltaY: 50, deltaMode: 0 })).toBe(1)
    expect(n({ deltaY: -3, deltaMode: 1 })).toBe(-1)
    expect(osrsDistance(-22.5, 334)).toBeCloseTo((256 * (600 + 3 * 128)) / 256 / 128, 9)
  })
})

describe('movement and facing', () => {
  it('walks a tile in 32 cycles (4 units / cycle), runs in 16', () => {
    const m = new PlayerMovement(10, 10)
    m.facingAngle = 1024
    m.enqueueTickMovement(1, [[10, 11]], false)
    m.advance(20 * 16, 1)
    expect(m.state().position[1]).toBeCloseTo(10.5, 6)
    m.advance(20 * 16, 1)
    expect(m.state().position[1]).toBe(11)
    const r = new PlayerMovement(10, 10)
    r.facingAngle = 1024
    r.enqueueTickMovement(1, [[10, 11], [10, 12]], true)
    r.advance(20 * 16, 1)
    expect(r.state().position[1]).toBe(11)
  })

  it('teleports beyond 288 units and turns 32 units per cycle', () => {
    const m = new PlayerMovement(0, 0)
    m.enqueueTickMovement(1, [[10, 10]], false)
    expect(m.state().position).toEqual([10, 10])
    const f = new FacingTracker(0, 32)
    f.setTarget(1024)
    f.advance(20 * 10)
    expect(f.angle).toBe(320)
    f.advance(20 * 50)
    expect(f.angle).toBe(1024)
  })

  it('computes angles like scim (0 south, 1024 north)', () => {
    expect(angleTo(0, 0, 0, 1)).toBe(1024)
    expect(angleTo(0, 0, 1, 0)).toBe(1536)
    expect(angleTo(0, 0, -1, 0)).toBe(512)
    expect(direction8(1, 1, 0)).toBe(1280)
    expect(direction8(0, 0, 77)).toBe(77)
  })
})

describe('world overlays', () => {
  it('builds outline strips 1 per tile edge plus 4 corner squares', () => {
    const m = outlineMesh(null, 5, 5, 5, 5, 100, 0.03)
    // 4 edges x 2 tris + 4 corner squares x 2 tris
    expect(m.positions.length / 9).toBe(16)
    expect(m.depth).toBe('none')
    expect(m.alphas).toBeUndefined()
    const big = outlineMesh(null, 0, 0, 4, 4, 100, 0.04, 0.5)
    expect(big.positions.length / 9).toBe(4 * 5 * 2 + 8)
    expect(big.alphas?.[0]).toBe(0.5)
    const corners = cornerOutlineMesh(null, 1, 1, 100, 0.03)
    expect(corners.positions.length / 9).toBe(8 * 2 + 4 * 2)
    // lifted 0.01 above the terrain
    expect(corners.positions[2]).toBeCloseTo(0.01, 6)
  })
})

describe('picking', () => {
  it('hits large NPC triangles via 5 px grown rectangles and size-1 NPCs via a padded box', () => {
    const cam = new Camera({ width: 800, height: 600, dpr: 1 }, { pitch: -45, yaw: 0, distance: 10, targetX: 10, targetY: 10, targetZ: 0 })
    const s = 1 / 128
    const matrix = new Float32Array([s, 0, 0, 0, 0, 0, -s, 0, 0, s, 0, 0, 10, 10, 0, 1])
    const hit: NpcHitTestData = {
      actorId: 'npc',
      verticesX: new Int32Array([-64, 64, 0]),
      verticesY: new Int32Array([0, 0, -128]),
      verticesZ: new Int32Array([0, 0, 0]),
      verticesCount: 3,
      indices1: new Int32Array([0]),
      indices2: new Int32Array([1]),
      indices3: new Int32Array([2]),
      faceCount: 1,
      faceColors3: new Int32Array([0]),
      modelMatrix: matrix,
      useBoundingBox: false,
    }
    const centre = cam.project(10, 10, 0.5)!
    const view = cam.viewMatrix()
    const proj = cam.projectionMatrix()
    expect(hitTestTriangles(centre.x, centre.y, hit, view, proj, 800, 600)).not.toBeNull()
    expect(hitTestTriangles(centre.x + 300, centre.y, hit, view, proj, 800, 600)).toBeNull()
    expect(hitTestBox(centre.x, centre.y, { ...hit, useBoundingBox: true }, view, proj, 800, 600)).not.toBeNull()
    const tri = hitTestTriangles(centre.x, centre.y, hit, view, proj, 800, 600)!
    expect(Number.isInteger(tri)).toBe(true)
  })

  it('multiplies column-major matrices', () => {
    const out = multiply(new Float32Array(16), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 3, 4, 1], [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1])
    expect([out[12], out[13], out[14]]).toEqual([3, 4, 5])
  })
})
