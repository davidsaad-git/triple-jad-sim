/**
 * Small bridge between the 3D viewport and the client UI (minimap compass,
 * FPS readout): the camera yaw the minimap rotates to (`onCameraChange` ->
 *), the compass click (: yaw := 0
 * instantly) and the measured frame rate.
 */
import { Store, useStore } from '../app/GameStore'

export interface ViewportInfo {
  /** Camera yaw in degrees (0 = looking north; 90 = camera east looking west). */
  yaw: number
  /** Rendered frames per second over the last >= 1000 ms window. */
  fps: number
}

export const viewportStore = new Store<ViewportInfo>({ yaw: 0, fps: 0 })

let resetHandler: (() => void) | null = null

/** Called by the viewport to register the compass action. */
export function registerCompassReset(handler: (() => void) | null): void {
  resetHandler = handler
}

/** Compass click: face north (yaw 0) instantly. */
export function resetCameraYaw(): void {
  resetHandler?.()
}

export function useCameraYaw(): number {
  return useStore(viewportStore, (s) => s.yaw)
}

export function useRenderFps(): number {
  return useStore(viewportStore, (s) => s.fps)
}
