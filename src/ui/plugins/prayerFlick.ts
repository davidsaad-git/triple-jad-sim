/**
 * Prayer Flick Helper data and geometry (scim recorder, bars `WH`
 *, fraction `HH`; orb sweep).
 *
 * The recorder keeps the last tick window and up to 64 prayer clicks
 * (`{kind, clickTime, arrivalTime}` on the pausable clock). Wiring:
 * - tick windows come from `runtime.onTickWindow`;
 * - clicks come from `runtime.onDispatch` for dispatches labelled
 *   `prayer:on|off` / `quick-prayer:on|off` (see `prayerClickKind`), or a direct
 *   `prayerFlickRecorder.recordClick(kind, clickTime, arrivalTime)` call.
 */
import { Store } from '../../app/GameStore'

export type FlickKind = 'on' | 'off'

export interface FlickClick {
  id: number
  kind: FlickKind
  clickTime: number
  arrivalTime: number
}

export interface FlickWindow {
  tick: number
  startTime: number
  durationMs: number
}

export interface FlickSnapshot {
  window: FlickWindow | null
  clicks: readonly FlickClick[]
}

export interface FlickMark {
  id: number
  kind: FlickKind
  /** 0..1 position of the click in its bar, null for the inbound half of a slipped click. */
  clickFraction: number | null
  /** 0..1 position of the arrival, null for the outbound half of a slipped click. */
  arrivalFraction: number | null
  slipped: boolean
}

export interface FlickBar {
  tick: number
  current: boolean
  marks: FlickMark[]
}

export interface FlickBars {
  bars: FlickBar[]
  durationMs: number
  clickCount: number
  slippedCount: number
}

export const MAX_CLICKS = 64
export const BAR_COUNT = 3

/** scim: tick index and fraction of a time relative to the window. */
export function tickFraction(time: number, w: FlickWindow): { tick: number; fraction: number } {
  if (!(w.durationMs > 0)) return { tick: w.tick, fraction: 0 }
  const t = (time - w.startTime) / w.durationMs
  const whole = Math.floor(t)
  return { tick: w.tick + whole, fraction: t - whole }
}

/** scim: newest tick first. */
export function buildFlickBars(clicks: readonly FlickClick[], w: FlickWindow | null, count = BAR_COUNT): FlickBars {
  const n = Math.max(1, Math.floor(count))
  if (!w) return { bars: Array.from({ length: n }, (_, i) => ({ tick: -i, current: false, marks: [] })), durationMs: 0, clickCount: 0, slippedCount: 0 }
  const oldest = w.tick - (n - 1)
  const byTick = new Map<number, FlickMark[]>()
  const put = (tick: number, m: FlickMark) => {
    if (tick < oldest || tick > w.tick) return false
    const list = byTick.get(tick)
    if (list) list.push(m)
    else byTick.set(tick, [m])
    return true
  }
  let clickCount = 0
  let slippedCount = 0
  for (const c of clicks) {
    const a = tickFraction(c.clickTime, w)
    const b = tickFraction(c.arrivalTime, w)
    if (a.tick === b.tick) {
      if (put(a.tick, { id: c.id, kind: c.kind, clickFraction: a.fraction, arrivalFraction: b.fraction, slipped: false })) clickCount++
      continue
    }
    const out = put(a.tick, { id: c.id, kind: c.kind, clickFraction: a.fraction, arrivalFraction: null, slipped: true })
    const inb = put(b.tick, { id: c.id, kind: c.kind, clickFraction: null, arrivalFraction: b.fraction, slipped: true })
    if (out || inb) {
      clickCount++
      slippedCount++
    }
  }
  return {
    bars: Array.from({ length: n }, (_, i) => {
      const tick = w.tick - i
      return { tick, current: i === 0, marks: byTick.get(tick) ?? [] }
    }),
    durationMs: w.durationMs,
    clickCount,
    slippedCount,
  }
}

/** scim: keep at most 64 clicks and drop those that arrived before the oldest bar. */
export function pruneClicks(clicks: readonly FlickClick[], w: FlickWindow | null, count = BAR_COUNT): readonly FlickClick[] {
  const recent = clicks.length > MAX_CLICKS ? clicks.slice(clicks.length - MAX_CLICKS) : clicks
  if (!w || recent.length === 0) return recent
  const oldest = w.tick - (Math.max(1, Math.floor(count)) - 1)
  const i = recent.findIndex((c) => tickFraction(c.arrivalTime, w).tick >= oldest)
  return i === -1 ? [] : i === 0 ? recent : recent.slice(i)
}

const EMPTY: FlickSnapshot = { window: null, clicks: [] }

class PrayerFlickRecorder extends Store<FlickSnapshot> {
  private nextId = 1
  recordTickWindow(tick: number, startTime: number, durationMs: number): void {
    const window = { tick, startTime, durationMs }
    this.set({ window, clicks: pruneClicks(this.get().clicks, window) })
  }
  recordClick(kind: FlickKind, clickTime: number, arrivalTime: number): void {
    const c: FlickClick = { id: this.nextId++, kind, clickTime, arrivalTime: Math.max(clickTime, arrivalTime) }
    const s = this.get()
    this.set({ window: s.window, clicks: pruneClicks([...s.clicks, c], s.window) })
  }
  reset(): void {
    const s = this.get()
    if (s.window !== null || s.clicks.length !== 0) this.set(EMPTY)
  }
}

export const prayerFlickRecorder = new PrayerFlickRecorder(EMPTY)

/**
 * Dispatch labels that count as prayer clicks for the helper (CLIENT-UI's
 * prayer tab `prayer:on` / `prayer:off`, quick-prayer orb `quick-prayer:on` /
 * `quick-prayer:off`, optionally with a `:<PrayerId>` suffix). Viewport inputs
 * (walk / attack / manual-cast / take) are ignored.
 */
export function prayerClickKind(label: string | undefined): FlickKind | null {
  if (!label) return null
  const m = /^(?:quick-)?prayer:(on|off)(?::|$)/.exec(label)
  return m ? (m[1] as FlickKind) : null
}

/** Mark CSS geometry: left = click, width = arrival - click, with the instant threshold 0.03. */
export function markGeometry(m: FlickMark): { left: number; width: number; instant: boolean } {
  const left = m.clickFraction ?? 0
  const width = (m.arrivalFraction ?? 1) - left
  return { left, width, instant: !m.slipped && width < 0.03 }
}

// ---------------------------------------------------------------------------
// Prayer orb flick sweep
// ---------------------------------------------------------------------------

/** Orb fill disc size (26x26 at 27,4 inside the 57x34 orb). */
export const ORB_DISC = 26

/**
 * The vertical 1 px line sweeping the prayer orb once per tick, tracing the
 * circle: `f` = fractional progress through the current tick.
 */
export function orbSweepGeometry(f: number, size = ORB_DISC): { x: number; y: number; height: number } {
  const a = f * Math.PI
  const height = Math.trunc(Math.sin(a) * size)
  return { x: Math.trunc((-Math.cos(a) * size) / 2) + Math.trunc(size / 2), y: Math.trunc(size / 2) - Math.trunc(height / 2), height }
}

/** scim: sweep visibility (committed or client-predicted prayers, or "Never hide"). */
export function orbSweepVisible(opts: { prayerEnabled: boolean; flickOrbEnabled: boolean; alwaysOn: boolean; prayersCommitted: boolean; prayersPredicted: boolean }): boolean {
  if (!opts.prayerEnabled || !opts.flickOrbEnabled) return false
  return opts.prayersCommitted || opts.prayersPredicted || opts.alwaysOn
}
