/**
 * XP Drops motion model (scim sampler `ave` + opacity). Drops are born at `tick * 600` ms (+400 ms per extra
 * skill when ungrouped), rise at `speed` px/s for 2000 ms, fade after 80% of
 * their life, and a drop born within 2 s of the previous one starts 26 px
 * below where the previous one is at that moment.
 */
import type { SimEvent, SkillName } from '../../sim/api'
import { uiAsset } from '../packs'

export const XP_DROP_LIFE_MS = 2000
export const XP_DROP_FADE_START = 0.8
export const XP_DROP_STACK_PX = 26
export const XP_DROP_STAGGER_MS = 400

export interface XpDropEntry {
  key: string
  skills: { skill: SkillName; amount: number }[]
  predictedHit: number
  bornAtMs: number
  startOffsetPx: number
}


export function xpDropOpacity(ageMs: number): number {
  const t = ageMs / XP_DROP_LIFE_MS
  return t <= XP_DROP_FADE_START ? 1 : Math.max(0, 1 - (t - XP_DROP_FADE_START) / (1 - XP_DROP_FADE_START))
}

/** Vertical offset (px, negative = up) of a drop `ageMs` after birth. */
export function xpDropY(entry: XpDropEntry, ageMs: number, speed: number): number {
  return entry.startOffsetPx - (ageMs / 1000) * speed
}

interface Spawn {
  order: number
  entry: XpDropEntry
}

export class XpDropSampler {
  private spawns: Spawn[] = []
  private seen = new Set<number>()
  private nextOrder = 0
  private grouped: boolean
  private speed: number

  constructor(opts: { grouped: boolean; speed: number }) {
    this.grouped = opts.grouped
    this.speed = opts.speed
  }

  setOptions(opts: { grouped: boolean; speed: number }): void {
    if (opts.grouped !== this.grouped || opts.speed !== this.speed) {
      this.grouped = opts.grouped
      this.speed = opts.speed
      this.reset()
    }
  }

  reset(): void {
    this.spawns = []
    this.seen.clear()
    this.nextOrder = 0
  }

  /** Feed a tick's events (duplicates by eventId are ignored). */
  ingest(events: readonly SimEvent[]): void {
    const fresh: Spawn[] = []
    for (const e of events) {
      if (e.type !== 'xp_drop' || this.seen.has(e.eventId)) continue
      this.seen.add(e.eventId)
      const groups = this.grouped ? [e.skills] : e.skills.map((s) => [s])
      groups.forEach((skills, i) => {
        if (skills.reduce((a, s) => a + s.amount, 0) <= 0) return
        fresh.push({
          order: this.nextOrder++,
          entry: { key: `${e.eventId}:${i}`, skills, predictedHit: i === 0 ? e.predictedHit : 0, bornAtMs: e.tick * 600 + i * XP_DROP_STAGGER_MS, startOffsetPx: 0 },
        })
      })
    }
    if (fresh.length === 0) return
    const minBorn = Math.min(...fresh.map((s) => s.entry.bornAtMs))
    const cut = this.firstAfter(minBorn)
    const tail = this.spawns.slice(cut).concat(fresh)
    tail.sort((a, b) => a.entry.bornAtMs - b.entry.bornAtMs || a.order - b.order)
    this.spawns.length = cut
    for (const s of tail) {
      const prev = this.spawns.at(-1)?.entry
      const dt = prev ? s.entry.bornAtMs - prev.bornAtMs : XP_DROP_LIFE_MS
      const offset = prev && dt < XP_DROP_LIFE_MS ? Math.max(0, prev.startOffsetPx - (dt / 1000) * this.speed + XP_DROP_STACK_PX) : 0
      this.spawns.push({ ...s, entry: { ...s.entry, startOffsetPx: offset } })
    }
    // Forget drops long gone.
    while (this.spawns.length > 0 && this.spawns.length > 64 && this.spawns[0]!.entry.bornAtMs < minBorn - XP_DROP_LIFE_MS) this.spawns.shift()
  }

  /** Drops alive at `nowMs` (born in (now - 2000, now]). */
  sample(nowMs: number): XpDropEntry[] {
    const lo = this.firstAfter(nowMs - XP_DROP_LIFE_MS)
    const hi = this.firstAfter(nowMs)
    return this.spawns.slice(lo, hi).map((s) => s.entry)
  }

  /** Index of the first spawn born strictly after `t`. */
  private firstAfter(t: number): number {
    let lo = 0
    let hi = this.spawns.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.spawns[mid]!.entry.bornAtMs <= t) lo = mid + 1
      else hi = mid
    }
    return lo
  }
}

/** Drop text: total XP (en-US grouping) plus " (N)" predicted hit. */
export function xpDropText(entry: XpDropEntry, showPredictedHit: boolean): string {
  const total = entry.skills.reduce((a, s) => a + s.amount, 0)
  const f = new Intl.NumberFormat('en-US').format(total)
  return showPredictedHit && entry.predictedHit > 0 ? `${f} (${entry.predictedHit})` : f
}

export const SKILL_ICON: Record<SkillName, string> = {
  attack: uiAsset('skill-attack.png'),
  strength: uiAsset('skill-strength.png'),
  defence: uiAsset('skill-defence.png'),
  ranged: uiAsset('skill-ranged.png'),
  magic: uiAsset('skill-magic.png'),
  prayer: uiAsset('skill-prayer.png'),
  hitpoints: uiAsset('skill-hitpoints.png'),
}
