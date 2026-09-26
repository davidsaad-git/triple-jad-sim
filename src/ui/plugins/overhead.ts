/**
 * Overhead number / timer-bar placement (scim overlay projector `nae`). Pure maths over screen anchors.
 */
import { tickColor, tickCounterValue, type TickColorOverrides } from './tickCounter'

export const HEALTHBAR_WIDTH = 40
export const HEALTHBAR_HEIGHT = 7
export const OVERHEAD_ICON_SIZE = 25
export const OVERHEAD_NUMBER_GAP = 2
export const ATTACK_COOLDOWN_TICKS_COLOR = '#00ffff'

/** scim: null when the timer is done (r <= 0). */
export function attackCooldownRatio(nextAttackTick: number | undefined, attackSpeed: number | undefined, currentTick: number): number | null {
  if (nextAttackTick === undefined || attackSpeed === undefined) return null
  const r = nextAttackTick - currentTick
  if (r <= 0) return null
  return Math.max(0, Math.min(1, (r - 1) / Math.max(1, attackSpeed - 1)))
}

/** scim: centre Y of the n-th bar stacked under the health bar anchored at `y`. */
export function stackedBarY(y: number, n: number): number {
  return y + HEALTHBAR_HEIGHT + (HEALTHBAR_HEIGHT + 2) * n
}

export interface OverheadPlacement {
  fontSize: number
  abovePrayerIcon: boolean
  offsetX: number
  offsetY: number
}

export interface OverheadNumber {
  key: string
  text: string
  color: string
  x: number
  y: number
  fontSize: number
}

/**
 * scim: tick counter and attack cooldown number above
 * the head anchor. Numbers not "above prayer icon" fill the icon slot; the
 * ones with the flag sit above the icon; two numbers stack with a 2 px gap.
 */
export function overheadNumbers(
  head: { x: number; y: number },
  hasPrayerIcon: boolean,
  currentTick: number,
  opts: {
    tickCounter?: (OverheadPlacement & { max: number; colors: TickColorOverrides }) | undefined
    attackCooldown?: (OverheadPlacement & { nextAttackTick: number | undefined }) | undefined
  },
): OverheadNumber[] {
  const items: { placement: OverheadPlacement; text: string; color: string; key: string }[] = []
  const tc = opts.tickCounter
  if (tc && tc.max > 0) {
    const v = tickCounterValue(currentTick, tc.max)
    items.push({ placement: tc, text: String(v), color: tickColor(v, tc.max, tc.colors), key: 'player-tick-counter' })
  }
  const ac = opts.attackCooldown
  if (ac && ac.nextAttackTick !== undefined) {
    const r = ac.nextAttackTick - currentTick
    if (r > 0) items.push({ placement: ac, text: String(r), color: ATTACK_COOLDOWN_TICKS_COLOR, key: 'player-attack-cooldown-ticks' })
  }
  if (items.length === 0) return []
  const slotY = head.y - OVERHEAD_ICON_SIZE / 2
  const icon = hasPrayerIcon ? OVERHEAD_ICON_SIZE : 0
  items.sort((a, b) => Number(a.placement.abovePrayerIcon) - Number(b.placement.abovePrayerIcon))
  const out: OverheadNumber[] = []
  let ceiling = Infinity
  for (const it of items) {
    const { fontSize, abovePrayerIcon, offsetX, offsetY } = it.placement
    const wanted = abovePrayerIcon ? head.y - icon - fontSize / 2 - OVERHEAD_NUMBER_GAP : slotY
    const y = Math.min(wanted, ceiling - OVERHEAD_NUMBER_GAP - fontSize / 2)
    ceiling = y - fontSize / 2
    out.push({ key: it.key, text: it.text, color: it.color, x: head.x + offsetX, y: y - offsetY, fontSize })
  }
  return out
}
