import type { Camera } from './Camera'

/**
 * Client-like camera input: arrow keys rotate/pitch, middle-mouse (or
 * right-mouse when enabled) drag rotates, wheel zooms.
 */
export class CameraControls {
  private readonly keys = new Set<string>()
  private dragging = false
  private lastX = 0
  private lastY = 0
  rotateSpeed = 2.2 // radians per second from keys
  pitchSpeed = 1.6
  dragSensitivity = 0.006
  zoomStep = 90
  rightClickRotates = false

  private readonly camera: Camera
  private readonly element: HTMLElement

  constructor(camera: Camera, element: HTMLElement) {
    this.camera = camera
    this.element = element
    element.addEventListener('mousedown', this.onMouseDown)
    window.addEventListener('mousemove', this.onMouseMove)
    window.addEventListener('mouseup', this.onMouseUp)
    element.addEventListener('wheel', this.onWheel, { passive: false })
    element.addEventListener('contextmenu', this.onContextMenu)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
  }

  update(dt: number): void {
    const c = this.camera
    if (this.keys.has('ArrowLeft')) c.yaw -= this.rotateSpeed * dt
    if (this.keys.has('ArrowRight')) c.yaw += this.rotateSpeed * dt
    if (this.keys.has('ArrowUp')) c.pitch += this.pitchSpeed * dt
    if (this.keys.has('ArrowDown')) c.pitch -= this.pitchSpeed * dt
  }

  dispose(): void {
    this.element.removeEventListener('mousedown', this.onMouseDown)
    window.removeEventListener('mousemove', this.onMouseMove)
    window.removeEventListener('mouseup', this.onMouseUp)
    this.element.removeEventListener('wheel', this.onWheel)
    this.element.removeEventListener('contextmenu', this.onContextMenu)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
  }

  private onMouseDown = (e: MouseEvent) => {
    if (e.button === 1 || (this.rightClickRotates && e.button === 2)) {
      this.dragging = true
      this.lastX = e.clientX
      this.lastY = e.clientY
      e.preventDefault()
    }
  }

  private onMouseMove = (e: MouseEvent) => {
    if (!this.dragging) return
    const dx = e.clientX - this.lastX
    const dy = e.clientY - this.lastY
    this.lastX = e.clientX
    this.lastY = e.clientY
    this.camera.yaw += dx * this.dragSensitivity
    this.camera.pitch += dy * this.dragSensitivity
  }

  private onMouseUp = () => {
    this.dragging = false
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault()
    this.camera.distance += Math.sign(e.deltaY) * this.zoomStep
  }

  private onContextMenu = (e: MouseEvent) => {
    e.preventDefault()
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.key.startsWith('Arrow')) {
      this.keys.add(e.key)
      e.preventDefault()
    }
  }

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.key)
  }

  private onBlur = () => {
    this.keys.clear()
    this.dragging = false
  }
}
