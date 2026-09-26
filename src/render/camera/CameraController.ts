/**
 * Camera input and per-frame camera update:
 *
 * - keyboard (rebindable, ignored in text fields): rotate 120 deg/s, tilt
 *   60 deg/s times the Camera plugin keyboard speed;
 * - middle-drag (window capture) or right-drag (Camera plugin option, only
 *   when the input layer did not claim the right click): 324/2048 deg per
 *   pixel times the mouse speed, optional inversion;
 * - wheel: notches (detented or accumulated) times the zoom increment
 *   subtracted from the OSRS zoom;
 * - follow: 1/16 of the gap per 20 ms toward the visual player tile centre,
 *   snap beyond 500/128 tiles, height from the goal;
 * - freeform (toggle key, pointer lock): 15 tiles/s, 0.15 deg/px look.
 */
import { keybindStore } from '../../app/keybinds'
import { settingsStore } from '../../app/settings/settings'
import { Camera, innerZoomLimit } from './Camera'

const DRAG_DEG_PER_PX = 324 / 2048
const FOLLOW_KEEP = 15 / 16
const SNAP_DISTANCE = 500 / 128
const FREEFORM_SPEED = 15
const FREEFORM_LOOK = 0.15
const FREEFORM_MAX_STEP = 15

/** Wheel event -> whole notches (/`wfe`). */
export function createWheelNotcher(): (e: { deltaY: number; deltaMode: number; wheelDeltaY?: number }) => number {
  let acc = 0
  return (e) => {
    let notches: number
    let detented: boolean
    const wd = e.wheelDeltaY
    if (typeof wd === 'number' && wd !== 0) {
      notches = -wd / 120
      detented = Math.abs(wd) % 120 === 0
    } else {
      notches = e.deltaY / ([100, 3, 1][e.deltaMode] ?? 100)
      detented = e.deltaMode !== 0
    }
    if (notches === 0) return 0
    if (detented) {
      acc = 0
      return Math.round(notches) || Math.sign(notches)
    }
    if (acc !== 0 && Math.sign(notches) !== Math.sign(acc)) acc = 0
    acc += notches
    const whole = Math.trunc(acc)
    acc -= whole
    return whole
  }
}

/** `followHeight`-independent follow step (exported for tests). */
export function followStep(current: { x: number; y: number }, goalX: number, goalY: number, dtMs: number): { x: number; y: number } {
  const dx = goalX - current.x
  const dy = goalY - current.y
  if (Math.abs(dx) > SNAP_DISTANCE || Math.abs(dy) > SNAP_DISTANCE) return { x: goalX, y: goalY }
  const k = 1 - FOLLOW_KEEP ** (dtMs / 20)
  return { x: current.x + dx * k, y: current.y + dy * k }
}

function isTextField(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable
}

function keyMatches(pressed: Set<string>, bind: string | undefined): boolean {
  if (!bind) return false
  return pressed.has(bind.length === 1 ? bind.toLowerCase() : bind)
}

export interface CameraPluginState {
  enabled: boolean
  speed: number
  dragSpeed: number
  zoomIncrement: number
  invertYaw: boolean
  invertPitch: boolean
  rightClickMoves: boolean
}

export function cameraPluginState(): CameraPluginState {
  const s = settingsStore.get()
  const on = s.cameraPluginEnabled
  return {
    enabled: on,
    speed: on && Number.isFinite(s.cameraSpeed) && s.cameraSpeed > 0 ? s.cameraSpeed : 1,
    dragSpeed: on && Number.isFinite(s.cameraDragSpeed) && s.cameraDragSpeed > 0 ? s.cameraDragSpeed : 1,
    zoomIncrement: on && Number.isFinite(s.cameraZoomIncrement) && s.cameraZoomIncrement > 0 ? s.cameraZoomIncrement : 25,
    invertYaw: on && s.cameraInvertYaw,
    invertPitch: on && s.cameraInvertPitch,
    rightClickMoves: on && s.cameraRightClickMovesCamera,
  }
}

export class CameraController {
  readonly camera: Camera
  private readonly pressed = new Set<string>()
  private drag: 'middle' | 'right' | null = null
  private lastX = 0
  private lastY = 0
  private readonly notcher = createWheelNotcher()
  private follow: { x: number; y: number; z: number }
  private pointerLocked = false
  private detach: (() => void) | null = null
  private limitsKey = ''
  onChange: (() => void) | null = null

  constructor(camera: Camera, startX: number, startY: number) {
    this.camera = camera
    this.follow = { x: startX + 0.5, y: startY + 0.5, z: camera.targetZ }
  }

  /** Snap the follow target to a tile (restart, teleports). */
  snapTo(x: number, y: number): void {
    this.follow = { x: x + 0.5, y: y + 0.5, z: this.camera.playerCenterZ(x + 0.5, y + 0.5) }
    this.camera.update({ targetX: this.follow.x, targetY: this.follow.y, targetZ: this.follow.z })
  }

  attach(container: HTMLElement, canvas: HTMLCanvasElement): void {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (isTextField(document.activeElement)) return
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
      this.pressed.add(k)
      const toggle = keybindStore.get().camera.toggleFreeform
      if (toggle && e.key === toggle) {
        e.preventDefault()
        const mode = this.camera.mode === 'orbit' ? 'freeform' : 'orbit'
        this.camera.setMode(mode)
        if (mode === 'freeform') {
          const r = canvas.requestPointerLock?.() as unknown
          if (r instanceof Promise) r.catch(() => this.camera.setMode('orbit'))
        } else if (document.pointerLockElement) document.exitPointerLock()
      }
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
      this.pressed.delete(k)
      if (e.key === 'Shift') this.pressed.delete('Shift')
    }
    const onBlur = (): void => {
      this.pressed.clear()
      this.drag = null
    }
    const onVisibility = (): void => {
      if (document.hidden) {
        this.drag = null
        this.pressed.clear()
      }
    }
    const onWindowDown = (e: MouseEvent): void => {
      if (e.button !== 1) return
      e.preventDefault()
      this.drag = 'middle'
      this.lastX = e.clientX
      this.lastY = e.clientY
    }
    const onContainerDown = (e: MouseEvent): void => {
      if (e.button !== 2 || e.defaultPrevented || e.altKey) return
      if (!cameraPluginState().rightClickMoves || this.drag === 'middle') return
      this.drag = 'right'
      this.lastX = e.clientX
      this.lastY = e.clientY
    }
    const onMove = (e: MouseEvent): void => {
      if (this.pointerLocked && this.camera.mode === 'freeform') {
        const p = cameraPluginState()
        const dx = Math.max(-FREEFORM_MAX_STEP, Math.min(FREEFORM_MAX_STEP, e.movementX * FREEFORM_LOOK * (p.invertYaw ? -1 : 1)))
        const dy = Math.max(-FREEFORM_MAX_STEP, Math.min(FREEFORM_MAX_STEP, e.movementY * FREEFORM_LOOK * (p.invertPitch ? -1 : 1)))
        this.camera.updateFreeform({ yaw: this.camera.freeformYaw - dx, pitch: this.camera.freeformPitch - dy })
        this.onChange?.()
        return
      }
      if (!this.drag) return
      const mask = this.drag === 'middle' ? 4 : 2
      if ((e.buttons & mask) === 0) {
        this.drag = null
        return
      }
      const p = cameraPluginState()
      const dx = e.clientX - this.lastX
      const dy = e.clientY - this.lastY
      this.lastX = e.clientX
      this.lastY = e.clientY
      const k = DRAG_DEG_PER_PX * p.dragSpeed
      this.camera.update({ yaw: this.camera.yaw - dx * k * (p.invertYaw ? -1 : 1), pitch: this.camera.pitch - dy * k * (p.invertPitch ? -1 : 1) })
      this.onChange?.()
    }
    const onUp = (e: MouseEvent): void => {
      if ((e.button === 1 && this.drag === 'middle') || (e.button === 2 && this.drag === 'right')) this.drag = null
    }
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.deltaY === 0) return
      const n = this.notcher(e as WheelEvent & { wheelDeltaY?: number })
      if (n === 0) return
      this.camera.update({ fovScale: this.camera.fovScale - n * cameraPluginState().zoomIncrement })
      this.onChange?.()
    }
    const onAux = (e: MouseEvent): void => {
      if (e.button === 1) e.preventDefault()
    }
    const onLockChange = (): void => {
      this.pointerLocked = document.pointerLockElement === canvas
      if (!this.pointerLocked && this.camera.mode === 'freeform') this.camera.setMode('orbit')
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('mousedown', onWindowDown, true)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    container.addEventListener('mousedown', onContainerDown)
    container.addEventListener('wheel', onWheel, { passive: false })
    container.addEventListener('auxclick', onAux)
    document.addEventListener('pointerlockchange', onLockChange)
    this.detach = () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('mousedown', onWindowDown, true)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      container.removeEventListener('mousedown', onContainerDown)
      container.removeEventListener('wheel', onWheel)
      container.removeEventListener('auxclick', onAux)
      document.removeEventListener('pointerlockchange', onLockChange)
    }
  }

  dispose(): void {
    this.detach?.()
    this.detach = null
  }

  /** Apply the Camera plugin limits when they change. */
  syncLimits(): void {
    const s = settingsStore.get()
    const on = s.cameraPluginEnabled
    const relax = on && s.cameraVerticalCamera
    const inner = innerZoomLimit(on ? s.cameraInnerZoomLevel : 0)
    const outer = on ? s.cameraOuterZoomLimit : 0
    const key = `${relax}|${inner}|${outer}`
    if (key === this.limitsKey) return
    this.limitsKey = key
    this.camera.setLimits({ relaxPitch: relax, innerZoomLimit: inner, outerZoomAdjust: outer })
  }

  private held(action: string): boolean {
    if (isTextField(document.activeElement)) return false
    const binds = keybindStore.get().camera as Record<string, string>
    return keyMatches(this.pressed, binds[action])
  }

  /** Per-frame camera update; `visual` = interpolated player SW tile. */
  update(dtMs: number, visual: readonly [number, number]): void {
    this.syncLimits()
    const cam = this.camera
    if (cam.mode === 'freeform') {
      const step = (dtMs / 1000) * FREEFORM_SPEED
      let f = 0
      let r = 0
      let u = 0
      if (this.held('freeformForward')) f += step
      if (this.held('freeformBackward')) f -= step
      if (this.held('freeformLeft')) r -= step
      if (this.held('freeformRight')) r += step
      if (this.held('freeformUp')) u += step
      if (this.held('freeformDown')) u -= step
      if (f !== 0 || r !== 0 || u !== 0) cam.moveFreeform(f, r, u)
      return
    }
    const gx = visual[0] + 0.5
    const gy = visual[1] + 0.5
    const next = followStep(this.follow, gx, gy, dtMs)
    this.follow.x = next.x
    this.follow.y = next.y
    this.follow.z = cam.playerCenterZ(gx, gy)
    const p = cameraPluginState()
    const rot = 120 * p.speed * (dtMs / 1000)
    const tilt = 60 * p.speed * (dtMs / 1000)
    const before = `${cam.yaw}|${cam.pitch}`
    const upd: { targetX: number; targetY: number; targetZ: number; yaw?: number; pitch?: number } = {
      targetX: this.follow.x,
      targetY: this.follow.y,
      targetZ: this.follow.z,
    }
    if (this.held('orbitRotateLeft')) upd.yaw = cam.yaw - rot
    if (this.held('orbitRotateRight')) upd.yaw = (upd.yaw ?? cam.yaw) + rot
    if (this.held('orbitTiltUp')) upd.pitch = cam.pitch - tilt
    if (this.held('orbitTiltDown')) upd.pitch = (upd.pitch ?? cam.pitch) + tilt
    cam.update(upd)
    if (`${cam.yaw}|${cam.pitch}` !== before) this.onChange?.()
  }
}
