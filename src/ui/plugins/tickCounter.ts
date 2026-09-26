/**
 * Tick Counter plugin maths: value `((tick - 1) mod max) + 1`
 * and colour `ZC` = per-tick override, else the
 * gradient `$C` over four stops. Plus the colour-chip helpers
 * (`QC`).
 */

export type TickColorOverrides = Record<string, string>

/** Tick shown for `currentTick` in a `max`-tick cycle (1..max). */
export function tickCounterValue(currentTick: number, max: number): number {
  return ((((currentTick - 1) % max) + max) % max) + 1
}

interface Stop {
  pos: number
  r: number
  g: number
  b: number
}

const STOPS: readonly Stop[] = [
  { pos: 0, r: 210, g: 190, b: 160 },
  { pos: 0.33, r: 212, g: 168, b: 75 },
  { pos: 0.66, r: 220, g: 140, b: 50 },
  { pos: 1, r: 214, g: 124, b: 124 },
]

/** scim theme `textSecondary` for a 1-tick cycle. */
const SINGLE_TICK_COLOR = '#c8aa6e'

function hex2(v: number): string {
  return Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')
}

/** scim: default gradient colour for `tick` of `max`. */
export function defaultTickColor(tick: number, max: number): string {
  if (max <= 1) return SINGLE_TICK_COLOR
  const p = (tick - 1) / (max - 1)
  let a: Stop = STOPS[0]!
  let b: Stop = STOPS[STOPS.length - 1]!
  for (let i = 0; i < STOPS.length - 1; i++) {
    if (p >= STOPS[i]!.pos && p <= STOPS[i + 1]!.pos) {
      a = STOPS[i]!
      b = STOPS[i + 1]!
      break
    }
  }
  const span = b.pos - a.pos
  const t = span === 0 ? 0 : (p - a.pos) / span
  const r = Math.round(a.r + (b.r - a.r) * t)
  const g = Math.round(a.g + (b.g - a.g) * t)
  const bl = Math.round(a.b + (b.b - a.b) * t)
  return `#${hex2(r)}${hex2(g)}${hex2(bl)}`
}


export function tickColor(tick: number, max: number, overrides?: TickColorOverrides): string {
  return overrides?.[String(tick)] ?? defaultTickColor(tick, max)
}

/** scim: ticks 1..min(20, floor(max)). */
export function tickRange(max: number): number[] {
  const n = Number.isFinite(max) ? Math.min(20, Math.max(0, Math.floor(max))) : 0
  return Array.from({ length: n }, (_, i) => i + 1)
}

export function setTickColor(o: TickColorOverrides, tick: number, color: string): TickColorOverrides {
  return { ...o, [String(tick)]: color }
}

export function setAllTickColors(max: number, color: string): TickColorOverrides {
  return Object.fromEntries(tickRange(max).map((t) => [String(t), color]))
}

export function resetTickColor(o: TickColorOverrides, tick: number): TickColorOverrides {
  if (o[String(tick)] === undefined) return o
  const next = { ...o }
  delete next[String(tick)]
  return next
}

/** scim: the shared colour when every tick has the same override, else null. */
export function uniformTickColor(max: number, o: TickColorOverrides): string | null {
  const ticks = tickRange(max)
  const first = ticks.length > 0 ? o[String(ticks[0])] : undefined
  if (first === undefined) return null
  return ticks.every((t) => o[String(t)] === first) ? first : null
}

/** Infobox tile the CLIENT-UI strip renders. */
export interface TickCounterInfobox {
  id: 'tick-counter'
  text: string
  textColor: string
  tooltipTitle: 'Tick Counter'
  tooltipDetail: string
}

export function tickCounterInfobox(
  currentTick: number,
  settings: { showTickCounter: boolean; showTickCounterInfobox: boolean; tickCounterMax: number; tickCounterColors: TickColorOverrides },
): TickCounterInfobox | null {
  if (!settings.showTickCounter || !settings.showTickCounterInfobox || settings.tickCounterMax <= 0) return null
  const v = tickCounterValue(currentTick, settings.tickCounterMax)
  return {
    id: 'tick-counter',
    text: String(v),
    textColor: tickColor(v, settings.tickCounterMax, settings.tickCounterColors),
    tooltipTitle: 'Tick Counter',
    tooltipDetail: `Tick ${v} of ${settings.tickCounterMax}`,
  }
}
