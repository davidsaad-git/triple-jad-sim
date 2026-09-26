/**
 * Pure helpers behind Plugins panel widgets (scim
 *, NPC highlight grouping in `hye`).
 */
import type { NpcHighlight, NpcHighlightMode } from '../../app/plugins/stores'

export const ORB_LAYOUTS = ['vertical', 'horizontal', 'horizontal-wide'] as const
export type OrbLayout = (typeof ORB_LAYOUTS)[number]
export const ORB_LAYOUT_LABELS: Record<OrbLayout, string> = { vertical: 'Vertical', horizontal: 'Horizontal', 'horizontal-wide': 'Wide' }
export const DEFAULT_ORB_ORDER = ['hitpoints', 'prayer', 'run', 'special']
export const ORB_LABELS: Record<string, string> = { hitpoints: 'Hitpoints', prayer: 'Prayer', run: 'Run Energy', special: 'Special Attack' }

/** scim: swap two orb positions (out-of-range indices leave the order unchanged). */
export function swapOrbs(order: readonly string[], a: number, b: number): string[] {
  const next = [...order]
  if (a < 0 || b < 0 || a >= next.length || b >= next.length) return next
  const t = next[a]!
  next[a] = next[b]!
  next[b] = t
  return next
}


export function isDefaultOrbOrder(order: readonly string[]): boolean {
  return order.length === DEFAULT_ORB_ORDER.length && order.every((o, i) => o === DEFAULT_ORB_ORDER[i])
}

/** Click-two-orbs swap state machine: returns the new order and selection. */
export function orbSlotClick(order: readonly string[], selected: string | null, clicked: string): { order: string[]; selected: string | null } {
  if (selected === null || selected === clicked) return { order: [...order], selected: selected === clicked ? null : clicked }
  return { order: swapOrbs(order, order.indexOf(selected), order.indexOf(clicked)), selected: null }
}

/** scim: Stretched Mode UI scales. */
export const UI_SCALES = [1, 7 / 6, 4 / 3, 3 / 2, 5 / 3, 11 / 6, 2, 13 / 6, 7 / 3, 5 / 2, 8 / 3, 17 / 6, 3]

export const NPC_MODE_LABELS: Record<NpcHighlightMode, string> = { trueTile: 'True Tile', swTile: 'SW Tile', clickbox: 'Clickbox' }

/** Highlights grouped by NPC type in first-seen order. */
export function groupNpcHighlights(list: readonly NpcHighlight[]): { npcTypeId: number; npcName: string; entries: NpcHighlight[] }[] {
  const m = new Map<number, { npcName: string; entries: NpcHighlight[] }>()
  for (const h of list) {
    const g = m.get(h.npcTypeId)
    if (g) g.entries.push(h)
    else m.set(h.npcTypeId, { npcName: h.npcName, entries: [h] })
  }
  return [...m.entries()].map(([npcTypeId, g]) => ({ npcTypeId, ...g }))
}
