/**
 * Hitsplats, health bars and the overhead prayer icon: state driven by
 * `hitsplat_spawned` events, 4 slots per actor, 2-tick hitsplats, 8-tick
 * health bars, screen positions from projected world anchors.
 */
import type { PrayerId, SimEvent, SimState } from '../../sim/api'

export const HITSPLAT_DURATION_TICKS = 2
export const HEALTHBAR_DURATION_TICKS = 8
export const HITSPLAT_SIZE = 24
export const HITSPLAT_FONT_SIZE = 16
export const HEALTHBAR_HEIGHT = 7
export const OVERHEAD_ICON_SIZE = 25
export const PLAYER_HEAD_HEIGHT = 2.2
export const PLAYER_CENTER_HEIGHT = (2.2 * 100) / 215
export const HITSPLAT_OFFSETS: readonly { x: number; y: number }[] = [
  { x: 0, y: 0 },
  { x: 0, y: -20 },
  { x: -15, y: -10 },
  { x: 15, y: -10 },
]

export type HitsplatKind = 'damage' | 'block' | 'poison' | 'venom' | 'doom' | 'heal' | 'burn'

export interface HitsplatSlot {
  amount: number
  type: HitsplatKind
  spawnTick: number
  expiryTick: number
}

export interface ActorOverlayState {
  slots: (HitsplatSlot | null)[]
  roundRobin: number
  healthBarVisibleUntilTick: number
}

export interface HitsplatDraw {
  key: string
  screenX: number
  screenY: number
  amount: number
  type: HitsplatKind
  width: number
  height: number
  fontSize: number
}

export interface HealthBarDraw {
  key: string
  screenX: number
  screenY: number
  ratio: number
  width: number
  height: number
}

export interface IconDraw {
  key: string
  screenX: number
  screenY: number
  iconPath: string
  width: number
  height: number
}

const KINDS = new Set<HitsplatKind>(['damage', 'block', 'poison', 'venom', 'doom', 'heal', 'burn'])

/** `assignHitsplatSlot`. Returns the slot index used. */
export function assignSlot(st: ActorOverlayState, amount: number, type: HitsplatKind, tick: number): number {
  const slot: HitsplatSlot = { amount, type, spawnTick: tick, expiryTick: tick + HITSPLAT_DURATION_TICKS }
  const live = (s: HitsplatSlot | null): s is HitsplatSlot => s !== null && s.expiryTick > tick
  if (st.slots.every(live)) {
    let best = 0
    for (let i = 1; i < 4; i++) if (st.slots[i]!.expiryTick < st.slots[best]!.expiryTick) best = i
    st.slots[best] = slot
    return best
  }
  if (st.slots.every((s) => !live(s))) st.roundRobin = 0
  for (let n = 0; n < 4; n++) {
    const i = st.roundRobin
    st.roundRobin = (st.roundRobin + 1) % 4
    if (!live(st.slots[i] ?? null)) {
      st.slots[i] = slot
      return i
    }
  }
  return -1
}

/** Overhead icon path per protection prayer. */
export function prayerIconPath(prayer: PrayerId | null): string | null {
  switch (prayer) {
    case 'ProtectMagic':
      return '/assets/ui/overhead_magic.png'
    case 'ProtectRange':
      return '/assets/ui/overhead_missiles.png'
    case 'ProtectMelee':
      return '/assets/ui/overhead_melee.png'
    case 'Redemption':
      return '/assets/ui/overhead_redemption.png'
    default:
      return null
  }
}

export interface NpcAnchorSource {
  id: string
  alive: boolean
  hp: number
  maxHp: number
  size: number
  position: readonly [number, number]
  previousPosition: readonly [number, number]
}

export interface OverlayHeights {
  hitsplatHeight: number
  healthBarHeight: number
  healthBarWidth: number
  baseHeight: number
}

export interface OverlayProjector {
  project(x: number, y: number, z: number): { x: number; y: number } | null
  /** Bilinear OSRS height (negative up). */
  height(x: number, y: number): number
}

export class UiOverlays {
  readonly actors = new Map<string, ActorOverlayState>()
  private lastObservedTick = -Infinity

  reset(): void {
    this.actors.clear()
    this.lastObservedTick = -Infinity
  }

  /** `update(tick, events)` with the not-yet-processed events. */
  update(tick: number, events: readonly SimEvent[]): void {
    if (tick < this.lastObservedTick) this.actors.clear()
    this.lastObservedTick = tick
    for (const ev of events) {
      if (ev.type !== 'hitsplat_spawned') continue
      let st = this.actors.get(ev.targetId)
      if (!st) {
        st = { slots: [null, null, null, null], roundRobin: 0, healthBarVisibleUntilTick: -1 }
        this.actors.set(ev.targetId, st)
      }
      assignSlot(st, ev.amount, KINDS.has(ev.hitsplatType as HitsplatKind) ? (ev.hitsplatType as HitsplatKind) : 'damage', ev.tick)
      st.healthBarVisibleUntilTick = ev.tick + HEALTHBAR_DURATION_TICKS
    }
    for (const [id, st] of this.actors) {
      for (let i = 0; i < 4; i++) {
        const s = st.slots[i]
        if (s && tick >= s.expiryTick) st.slots[i] = null
      }
      if (!st.slots.some((s) => s !== null) && !(tick < st.healthBarVisibleUntilTick)) this.actors.delete(id)
    }
  }

  private pushSplats(out: HitsplatDraw[], keyPrefix: string, st: ActorOverlayState | undefined, anchor: { x: number; y: number } | null): void {
    if (!st || !anchor) return
    for (let i = 0; i < 4; i++) {
      const s = st.slots[i]
      if (!s) continue
      out.push({
        key: `${keyPrefix}-slot-${i}`,
        screenX: anchor.x + HITSPLAT_OFFSETS[i]!.x,
        screenY: anchor.y + HITSPLAT_OFFSETS[i]!.y,
        amount: s.amount,
        type: s.type,
        width: HITSPLAT_SIZE,
        height: HITSPLAT_SIZE,
        fontSize: HITSPLAT_FONT_SIZE,
      })
    }
  }

  /**
   * Build this frame's draw lists. `playerVisual` = interpolated SW tile of
   * the player; NPC anchors use the interpolated footprint centre.
   */
  build(
    proj: OverlayProjector,
    state: SimState,
    playerVisual: readonly [number, number],
    npcs: readonly NpcAnchorSource[],
    heights: (id: string) => OverlayHeights | null,
    interpTick: number,
    frac: number,
  ): { hitsplats: HitsplatDraw[]; healthBars: HealthBarDraw[]; icons: IconDraw[] } {
    const hitsplats: HitsplatDraw[] = []
    const healthBars: HealthBarDraw[] = []
    const icons: IconDraw[] = []
    const [px, py] = playerVisual
    const ground = -proj.height(px, py) / 128
    // prayer overhead
    const icon = prayerIconPath(state.activePrayer)
    if (icon) {
      const a = proj.project(px + 0.5, py + 0.5, ground + PLAYER_HEAD_HEIGHT)
      if (a) icons.push({ key: 'prayer-overhead-player', screenX: a.x, screenY: a.y - OVERHEAD_ICON_SIZE / 2, iconPath: icon, width: OVERHEAD_ICON_SIZE, height: OVERHEAD_ICON_SIZE })
    }
    // player hitsplats and health bar
    const pst = this.actors.get('player')
    if (pst) {
      this.pushSplats(hitsplats, 'hitsplat', pst, proj.project(px + 0.5, py + 0.5, ground + PLAYER_CENTER_HEIGHT))
      if (interpTick <= pst.healthBarVisibleUntilTick) {
        const a = proj.project(px + 0.5, py + 0.5, ground + PLAYER_HEAD_HEIGHT)
        if (a) {
          healthBars.push({
            key: 'player-healthbar',
            screenX: a.x,
            screenY: a.y + HEALTHBAR_HEIGHT,
            ratio: state.maxHP > 0 ? Math.max(0, state.playerHP / state.maxHP) : 1,
            width: 40,
            height: HEALTHBAR_HEIGHT,
          })
        }
      }
    }
    // NPCs
    for (const npc of npcs) {
      const st = this.actors.get(npc.id)
      if (!st) continue
      const moved = npc.previousPosition[0] !== npc.position[0] || npc.previousPosition[1] !== npc.position[1]
      const cx = (frac > 0 && moved ? npc.previousPosition[0] + (npc.position[0] - npc.previousPosition[0]) * frac : npc.position[0]) + npc.size / 2
      const cy = (frac > 0 && moved ? npc.previousPosition[1] + (npc.position[1] - npc.previousPosition[1]) * frac : npc.position[1]) + npc.size / 2
      const h = heights(npc.id)
      const base = h?.baseHeight ?? -proj.height(cx, cy) / 128
      this.pushSplats(hitsplats, `hitsplat-${npc.id}`, st, proj.project(cx, cy, base + (h?.hitsplatHeight ?? 1)))
      if (interpTick > st.healthBarVisibleUntilTick) continue
      const a = proj.project(cx, cy, base + (h?.healthBarHeight ?? 1.5))
      if (!a) continue
      healthBars.push({
        key: `npc-healthbar-${npc.id}`,
        screenX: a.x,
        screenY: a.y + HEALTHBAR_HEIGHT,
        ratio: npc.maxHp > 0 ? Math.max(0, npc.hp / npc.maxHp) : 1,
        width: h?.healthBarWidth ?? 40,
        height: HEALTHBAR_HEIGHT,
      })
    }
    return { hitsplats, healthBars, icons }
  }
}
