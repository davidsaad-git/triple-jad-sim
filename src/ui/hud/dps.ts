/**
 * HUD DPS readout (scim, 09):
 * actual = player damage on the current target / seconds since the first
 * hit on it; expected = sum of per-attack expected damage over the same
 * window; lucky >= 1.05x expected, unlucky < 0.9x expected.
 */
import type { DamageHistoryEntry, NpcState, SimState } from '../../sim/api'

export const SECONDS_PER_TICK = 0.6

export interface HudDps {
  actual: number
  expected: number
}

export function hudDps(history: readonly DamageHistoryEntry[], targetId: string | undefined, currentTick: number): HudDps | null {
  if (!targetId) return null
  const hits = history.filter((e) => e.source === 'PlayerAttack' && e.targetId === targetId)
  const first = hits[0]
  if (!first) return null
  const damage = hits.reduce((a, e) => a + e.effectiveDamage, 0)
  const expected = hits.reduce((a, e) => a + (e.expectedHit ?? 0), 0)
  const secs = (currentTick - first.tick) * SECONDS_PER_TICK
  return { actual: secs > 0 ? damage / secs : 0, expected: secs > 0 ? expected / secs : 0 }
}

export function dpsLuckClass(d: HudDps | null): '' | 'hud-dps-lucky' | 'hud-dps-unlucky' {
  if (!d || !(d.expected > 0)) return ''
  if (d.actual >= d.expected * 1.05) return 'hud-dps-lucky'
  if (d.actual < d.expected * 0.9) return 'hud-dps-unlucky'
  return ''
}

/** HUD target: the attack target NPC (falling back to the boss), else the boss. */
export function hudTarget(state: SimState): NpcState | undefined {
  const boss = state.npcs.find((n) => n.role === 'boss')
  if (state.attackTarget) return state.npcs.find((n) => n.id === state.attackTarget) ?? boss
  return boss
}

/** HP bar colour thresholds (< 33% danger, < 66% warning, else success). */
export function hpBarColor(pct: number): string {
  return pct < 33 ? '#d46a60' : pct < 66 ? '#d4a848' : '#6dba6d'
}

/** scim's target label: camelCase split, first letter capitalised, underscores kept. */
export function targetLabel(npc: NpcState | undefined): string {
  return npc ? npc.archetypeId.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()) : 'Target'
}

/** scim: HUD tool stack layout. */
export function hudToolsLayout(input: { width: number; height: number; horizontal: boolean }): {
  horizontal: boolean
  hudWidth: number
  practiceWidth: number
  width: number
  height: number
} {
  const side = input.horizontal && input.width >= 416 && input.height >= 96
  const hudWidth = side ? Math.min(332, Math.max(224, Math.floor(input.width / 3))) : Math.min(216, input.width)
  const practiceWidth = side ? Math.min(800, input.width - hudWidth - 4) : hudWidth
  return { horizontal: side, hudWidth, practiceWidth, width: side ? hudWidth + 4 + practiceWidth : hudWidth, height: side ? Math.min(176, input.height) : input.height }
}

/** scim: HUD compact mode by width. */
export function hudCompactMode(compact: boolean, width: number | undefined): 'column' | 'row' | 'row-tight' | 'narrow' {
  if (!compact) return 'column'
  return width === undefined || width >= 332 ? 'row' : width >= 288 ? 'row-tight' : 'narrow'
}
