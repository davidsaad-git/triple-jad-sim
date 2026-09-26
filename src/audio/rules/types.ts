/**
 * Event -> sound rule model, mirroring scim.gg's EventAudioPlayer rule tables
 * ( result constructors entry normaliser).
 *
 * A layer maps an event type to one rule. A rule either names its sound(s)
 * statically or resolves them from the event, returning:
 *  - `play`: one or more entries (id + optional per-entry delay/position/range/channel),
 *  - `silent`: stop the chain for this event (nothing plays),
 *  - `pass`: try the next layer (scim defines it; the shipped tables never use it).
 */
import type { SimEvent, Tile } from '../../sim/api'

export type SoundChannel = 'sfx' | 'area'

export interface SoundEntry {
  id: number
  /** Client cycles (20 ms) after the frame the event is played on. */
  delayCycles?: number
  /** Source tile for area attenuation (map-square-local). */
  position?: Tile
  /** Attenuation range in tiles (default 15). */
  range?: number
  channel?: SoundChannel
}

export type SoundSpec = number | SoundEntry | readonly (number | SoundEntry)[]

export interface PlayOptionsFromRule {
  position?: Tile
  range?: number
  channel?: SoundChannel
  volume?: number
}

export type RuleResult =
  | ({ kind: 'play'; sound: SoundSpec } & PlayOptionsFromRule)
  | { readonly kind: 'silent' }
  | { readonly kind: 'pass' }

export interface SoundRule {
  resolve: SoundSpec | ((event: SimEvent) => RuleResult)
  /** Extra ids to preload (sounds only reachable through `resolve` functions). */
  preloadIds?: readonly number[]
}

export type RuleTable = Partial<Record<SimEvent['type'], SoundRule>>

export interface RuleLayer {
  name: string
  rules: RuleTable
}


export function play(sound: SoundSpec, opts: PlayOptionsFromRule = {}): RuleResult {
  return { kind: 'play', sound, ...opts }
}


export const SILENT: RuleResult = Object.freeze({ kind: 'silent' as const })
export const PASS: RuleResult = Object.freeze({ kind: 'pass' as const })

/** Normalised entry. */
export interface NormalisedEntry {
  id: number
  delayCycles: number
  position?: Tile
  range?: number
  channel?: SoundChannel
}

function isEntry(v: unknown): v is SoundEntry {
  return typeof v === 'object' && v !== null && 'id' in v
}

/** A tile if the value is a 2-number array, else undefined. */
export function asTile(v: unknown): Tile | undefined {
  return Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number' && typeof v[1] === 'number' ? [v[0], v[1]] : undefined
}

/** Number / entry / list -> list of entries; invalid items are skipped. */
export function normaliseSound(spec: SoundSpec): NormalisedEntry[] {
  const list: readonly unknown[] = Array.isArray(spec) ? spec : [spec]
  const out: NormalisedEntry[] = []
  for (const item of list) {
    if (typeof item === 'number') {
      out.push({ id: item, delayCycles: 0 })
      continue
    }
    if (!isEntry(item) || typeof item.id !== 'number') continue
    const e: NormalisedEntry = { id: item.id, delayCycles: item.delayCycles ?? 0 }
    if (item.position !== undefined) e.position = item.position
    if (item.range !== undefined) e.range = item.range
    if (item.channel !== undefined) e.channel = item.channel
    out.push(e)
  }
  return out
}

/** Every id a layer can play. */
export function collectLayerSoundIds(layers: readonly RuleLayer[]): number[] {
  const ids = new Set<number>()
  for (const layer of layers) {
    for (const rule of Object.values(layer.rules)) {
      if (!rule) continue
      if (typeof rule.resolve !== 'function') for (const e of normaliseSound(rule.resolve)) ids.add(e.id)
      if (rule.preloadIds) for (const id of rule.preloadIds) ids.add(id)
    }
  }
  return [...ids]
}
