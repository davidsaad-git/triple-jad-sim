/**
 * All MENUS-owned in-viewport plugin layers in one component: overhead
 * numbers / timer bars, floating widgets (Boss Health Bar, DPS Overlay,
 * Prayer Flick Helper, XP Drops) and the debug overlays. Mount it inside the
 * game viewport container (it fills it with `position: absolute; inset: 0`).
 * It also feeds the Prayer Flick Helper recorder from the runtime.
 */
import './widgets.css'
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { SimRuntime } from '../../app/runtime/types'
import type { OverlayProjection } from '../../render/api'
import { InputDisplay, SoundDebugOverlay, TickTimingOverlay, type SoundDebugSource } from './debugOverlays'
import { OverheadOverlays } from './OverheadOverlays'
import { prayerClickKind, prayerFlickRecorder } from './prayerFlick'
import { BossHealthBar, DpsOverlay, PrayerFlickHelper, XpDrops } from './widgets'

/** Feed tick windows and prayer clicks into the Prayer Flick Helper recorder. */
export function usePrayerFlickRecording(runtime: SimRuntime): void {
  useEffect(() => {
    const a = runtime.onTickWindow((w) => prayerFlickRecorder.recordTickWindow(w.tick, w.startTime, w.durationMs))
    const b = runtime.onDispatch((d) => {
      const kind = prayerClickKind(d.label)
      if (kind) prayerFlickRecorder.recordClick(kind, d.clickTime, d.arrivalTime)
    })
    const c = runtime.onRestart(() => prayerFlickRecorder.reset())
    return () => {
      a()
      b()
      c()
    }
  }, [runtime])
}

function useElementSize<T extends HTMLElement>(): [RefObject<T | null>, { width: number; height: number }] {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setSize((s) => (s.width === el.clientWidth && s.height === el.clientHeight ? s : { width: el.clientWidth, height: el.clientHeight }))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, size]
}

export interface PluginOverlaysProps {
  runtime: SimRuntime
  /** From GameViewport's onReady; null until the renderer is up. */
  overlay: OverlayProjection | null
  /** AUDIO's AudioSystem for the Sound Debug overlay. */
  audio?: SoundDebugSource | null
  soundName?: (id: number) => string | undefined
  /** Settings panel open (Sound Debug shifts right like scim). */
  controlsVisible?: boolean
}

export function PluginOverlays({ runtime, overlay, audio = null, soundName = () => undefined, controlsVisible = false }: PluginOverlaysProps) {
  usePrayerFlickRecording(runtime)
  const [ref, size] = useElementSize<HTMLDivElement>()
  return (
    <div ref={ref} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      <OverheadOverlays runtime={runtime} overlay={overlay} />
      {size.width > 0 && (
        <>
          <BossHealthBar viewportWidth={size.width} viewportHeight={size.height} />
          <DpsOverlay runtime={runtime} viewportWidth={size.width} viewportHeight={size.height} />
          <PrayerFlickHelper viewportWidth={size.width} viewportHeight={size.height} />
          <XpDrops runtime={runtime} viewportWidth={size.width} viewportHeight={size.height} />
        </>
      )}
      <TickTimingOverlay runtime={runtime} />
      <InputDisplay />
      <SoundDebugOverlay audio={audio} soundName={soundName} controlsVisible={controlsVisible} />
    </div>
  )
}
