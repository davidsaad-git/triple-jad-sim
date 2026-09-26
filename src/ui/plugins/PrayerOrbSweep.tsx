/**
 * Prayer plugin "Pray flick on prayer orb" sweep for CLIENT-UI's prayer orb
 * (scim, visibility): a 1x26
 * #69c7d3 line clipped to the orb's 26x26 fill disc (at 27,4 in the 57x34
 * orb) sweeping left to right once per tick along the circle.
 *
 * Usage (inside the orb's positioned container):
 *   <PrayerOrbSweep runtime={runtime} prayersPredicted={clientSideActive} />
 */
import { useLayoutEffect, useRef, type CSSProperties } from 'react'
import type { SimRuntime } from '../../app/runtime/types'
import { useTickSnapshot } from '../../app/runtime/RuntimeContext'
import { useSetting } from '../../app/settings/settings'
import { ORB_DISC, orbSweepGeometry, orbSweepVisible } from './prayerFlick'

const SWEEP_COLOR = '#69c7d3'
const SWEEP_SHADOW = '1px 0 0 rgba(0, 0, 0, 0.75), -1px 0 0 rgba(0, 0, 0, 0.75)'
const CLIP: CSSProperties = { position: 'absolute', left: 27, top: 4, width: ORB_DISC, height: ORB_DISC, overflow: 'hidden', pointerEvents: 'none' }
const LINE: CSSProperties = {
  position: 'absolute',
  left: 0,
  top: 0,
  width: 1,
  height: ORB_DISC,
  transform: 'scaleY(0)',
  transformOrigin: '0 0',
  background: SWEEP_COLOR,
  boxShadow: SWEEP_SHADOW,
}

/**
 * Drives `el` every frame from the runtime's interpolated tick. Returns the
 * cleanup; exported for canvas/DOM orbs that position their own element.
 */
export function attachOrbSweep(runtime: SimRuntime, el: HTMLElement, size = ORB_DISC): () => void {
  let lx = -1
  let ly = -1
  let lh = -1
  let handle = 0
  const frame = () => {
    const t = runtime.clock.interpolatedTick()
    const g = orbSweepGeometry(t - Math.floor(t), size)
    if (g.x !== lx || g.y !== ly || g.height !== lh) {
      lx = g.x
      ly = g.y
      lh = g.height
      el.style.transform = `translate(${g.x}px, ${g.y}px) scaleY(${g.height / size})`
    }
    handle = runtime.scheduler.request(frame)
  }
  handle = runtime.scheduler.request(frame)
  return () => runtime.scheduler.cancel(handle)
}

/** True when the sweep should show (plugin settings + committed/predicted prayers). */
export function usePrayerOrbSweepVisible(prayersPredicted = false): boolean {
  const snap = useTickSnapshot()
  const prayerEnabled = useSetting('prayerEnabled')
  const flickOrbEnabled = useSetting('prayerFlickOrbEnabled')
  const alwaysOn = useSetting('prayerFlickAlwaysOn')
  const s = snap.state
  const committed = s.activePrayer !== null || s.offensivePrayer !== null || s.independentPrayers.length > 0 || s.prayerState.activePrayers.length > 0
  return orbSweepVisible({ prayerEnabled, flickOrbEnabled, alwaysOn, prayersCommitted: committed, prayersPredicted })
}

export function PrayerOrbSweep({ runtime, prayersPredicted = false }: { runtime: SimRuntime; prayersPredicted?: boolean }) {
  const visible = usePrayerOrbSweepVisible(prayersPredicted)
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!visible || !el) return
    return attachOrbSweep(runtime, el)
  }, [runtime, visible])
  if (!visible) return null
  return (
    <div className="prayer-orb-flick-sweep" aria-hidden style={CLIP}>
      <span ref={ref} style={LINE} />
    </div>
  )
}
