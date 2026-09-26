import { type MouseEvent as ReactMouseEvent, useState } from 'react'
import type { EquipmentStats, EquipSlot } from '../../../sim/api'
import { bindContextMenu } from '../../../input/contextMenuStore'
import { equipmentItemTooltip, UI_TOOLTIPS, type TooltipContent } from '../../../input/menu'
import { bindTooltip } from '../../../input/tooltip'
import { itemIconUrl, packAsset, useActivePack } from '../../packs'
import { clientColors } from '../../theme/palettes'
import { unequipAmmo, unequipSlot } from '../actions'
import { useClient, useSimState } from '../context'
import { itemDisplayName, itemLookup } from '../items'
import { CONTENT_BOX } from '../layout'
import { ComposedSprite } from '../sprites/ComposedSprite'
import { tileImage } from '../sprites/imageStore'
import { type LayerSprite, SpriteLayer } from '../sprites/SpriteLayer'

/**
 * Worn Equipment tab:
 * slot tiles with item art or silhouettes, iron-rivet connectors, and four
 * framed buttons (only Equipment Stats is active). Left mouse down on a
 * filled slot unequips.
 */

const TILE = 36
const ICON = 32
/** Dizana's quiver variants. */
export const QUIVER_IDS: ReadonlySet<number> = new Set([28826, 28947, 28949, 28951, 28953, 28828, 28955, 28957, 28830, 28902, 28906])

type SlotName = EquipSlot | 'ammo' | 'quiver-ammo'

const POS: Readonly<Record<SlotName, { x: number; y: number }>> = {
  'quiver-ammo': { x: 136, y: 9 },
  head: { x: 84, y: 9 },
  cape: { x: 32, y: 50 },
  amulet: { x: 84, y: 50 },
  ammo: { x: 136, y: 50 },
  weapon: { x: 32, y: 91 },
  body: { x: 84, y: 91 },
  shield: { x: 136, y: 91 },
  legs: { x: 84, y: 132 },
  hands: { x: 32, y: 173 },
  boots: { x: 84, y: 173 },
  ring: { x: 136, y: 173 },
}

const SILHOUETTE: Readonly<Record<SlotName, string>> = {
  head: 'equipment-slots/slot_head.png',
  cape: 'equipment-slots/slot_cape.png',
  amulet: 'equipment-slots/slot_neck.png',
  ammo: 'equipment-slots/slot_ammunition.png',
  'quiver-ammo': 'equipment-slots/slot_ammunition.png',
  weapon: 'equipment-slots/slot_weapon.png',
  body: 'equipment-slots/slot_torso.png',
  shield: 'equipment-slots/slot_shield.png',
  legs: 'equipment-slots/slot_legs.png',
  hands: 'equipment-slots/slot_hands.png',
  boots: 'equipment-slots/slot_feet.png',
  ring: 'equipment-slots/slot_ring.png',
}

const BUTTONS = [
  { icon: 'buttons/equipment_stats_icon.png', label: 'Equipment Stats', disabled: false },
  { icon: 'buttons/equipment_guide_prices.png', label: 'Guide Prices', disabled: true },
  { icon: 'buttons/equipment_items_lost_on_death.png', label: 'Items Kept on Death', disabled: true },
  { icon: 'buttons/equipment_call_follower.png', label: 'Call Follower', disabled: true },
] as const
const buttonX = (i: number): number => 16 + i * 44

function Unlimited() {
  return (
    <svg role="img" aria-label="Unlimited" width={12} height={8} viewBox="0 0 12 8" fill="none" style={{ position: 'absolute', top: 2, left: 2, zIndex: 2, color: 'var(--color-text-body)', filter: 'drop-shadow(1px 1px 0 rgba(0, 0, 0, 0.85))', pointerEvents: 'none' }}>
      <path d="M3.5 2C1.8 2 1.8 6 3.5 6C5.2 6 6.8 2 8.5 2C10.2 2 10.2 6 8.5 6C6.8 6 5.2 2 3.5 2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}

function Connectors({ showQuiver }: { showQuiver: boolean }) {
  const pack = useActivePack()
  const v = packAsset('dialog/iron_rivets_vertical.png', pack)
  const h = packAsset('dialog/iron_rivets_horizontal.png', pack)
  const verticals = [...(showQuiver ? [{ x: 154, y1: 27, y2: 68 }] : []), { x: 102, y1: 27, y2: 68 }, { x: 102, y1: 68, y2: 109 }, { x: 102, y1: 109, y2: 150 }, { x: 102, y1: 150, y2: 191 }]
  const horizontals = [
    { y: 68, x1: 50, x2: 102 },
    { y: 68, x1: 102, x2: 154 },
    { y: 109, x1: 50, x2: 102 },
    { y: 109, x1: 102, x2: 154 },
    { y: 191, x1: 50, x2: 102 },
    { y: 191, x1: 102, x2: 154 },
  ]
  return (
    <ComposedSprite
      cacheKey={`equipment-connectors|${v}|${h}|${showQuiver}`}
      width={CONTENT_BOX.width}
      height={CONTENT_BOX.height}
      sources={[v, h]}
      style={{ zIndex: 0 }}
      draw={(ctx, images) => {
        const vi = images.get(v)
        const hi = images.get(h)
        if (vi) for (const s of verticals) tileImage(ctx, vi, s.x - 18, s.y1, 36, s.y2 - s.y1)
        if (hi) for (const s of horizontals) tileImage(ctx, hi, s.x1, s.y - 18, s.x2 - s.x1, 36)
      }}
    />
  )
}

function FramedButton({ label, disabled, left, onMouseDown, tooltip }: { label: string; disabled: boolean; left: number; onMouseDown?: (e: ReactMouseEvent) => void; tooltip?: TooltipContent }) {
  const pack = useActivePack()
  const p = (k: string): string => packAsset(`buttons/equipment_${k}.png`, pack)
  const [et, eb, el, er, ctl, ctr, cbl, cbr] = [p('edge_top'), p('edge_bottom'), p('edge_left'), p('edge_right'), p('metal_corner_top_left'), p('metal_corner_top_right'), p('metal_corner_bottom_left'), p('metal_corner_bottom_right')]
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onMouseDown={onMouseDown}
      {...(tooltip ? bindTooltip(() => tooltip) : {})}
      style={{ position: 'absolute', left, top: 218, width: 40, height: 40, padding: 0, border: 'none', background: 'transparent', cursor: 'default', zIndex: 2, ...(disabled ? { opacity: 0.5 } : null) }}
    >
      <ComposedSprite
        cacheKey={`equipment-action-frame|${[et, eb, el, er, ctl, ctr, cbl, cbr].join(',')}`}
        width={40}
        height={40}
        sources={[et, eb, el, er, ctl, ctr, cbl, cbr]}
        draw={(ctx, images) => {
          const g = (u: string) => images.get(u)
          const t = g(et)
          const b = g(eb)
          const l = g(el)
          const r = g(er)
          if (t) tileImage(ctx, t, 9, 0, 22, 9)
          if (b) tileImage(ctx, b, 9, 31, 22, 9)
          if (l) tileImage(ctx, l, 0, 9, 9, 22)
          if (r) tileImage(ctx, r, 31, 9, 9, 22)
          const c1 = g(ctl)
          const c2 = g(ctr)
          const c3 = g(cbl)
          const c4 = g(cbr)
          if (c1) ctx.drawImage(c1, 0, 0, 9, 9)
          if (c2) ctx.drawImage(c2, 31, 0, 9, 9)
          if (c3) ctx.drawImage(c3, 0, 31, 9, 9)
          if (c4) ctx.drawImage(c4, 31, 31, 9, 9)
        }}
      />
    </button>
  )
}

const signed = (v: number | undefined): string => {
  const n = v || 0
  return n >= 0 ? `+${n}` : `${n}`
}

function StatRow({ label, value, suffix = '' }: { label: string; value: number | undefined; suffix?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: '"RuneScape Bold 12", sans-serif', fontSize: '13px', lineHeight: 1.15, padding: '1px 2px' }}>
      <span style={{ color: 'var(--color-secondary)' }}>{label}</span>
      <span style={{ color: 'var(--color-text-body)' }}>
        {signed(value)}
        {suffix}
      </span>
    </div>
  )
}

function SectionTitle({ title }: { title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0 2px' }}>
      <span style={{ fontFamily: '"RuneScape Bold 12", sans-serif', fontSize: '12px', letterSpacing: '1px', textTransform: 'uppercase', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>{title}</span>
      <div style={{ flex: 1, height: 1, background: 'var(--color-border)' }} />
    </div>
  )
}

function BackButton({ onClick }: { onClick: () => void }) {
  const [hover, setHover] = useState(false)
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      title="Back to equipment"
      aria-label="Back to equipment"
      style={{ display: 'inline-grid', placeItems: 'center', width: 24, height: 24, marginLeft: -3, flex: '0 0 auto', border: 'none', background: 'none', padding: 0, cursor: 'default', color: hover ? 'var(--color-text-body)' : 'var(--color-secondary)', transition: 'color 0.15s ease', outline: 'none' }}
    >
      <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false">
        <path d="M7.5 2 L3.5 6 L7.5 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="square" strokeLinejoin="miter" />
      </svg>
    </button>
  )
}

export function EquipmentStatsView({ stats, onBack }: { stats: EquipmentStats | undefined; onBack: () => void }) {
  return (
    <div style={{ width: CONTENT_BOX.width, height: CONTENT_BOX.height, position: 'relative' }}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', padding: '8px 10px', boxSizing: 'border-box', gap: 6, textRendering: 'optimizeSpeed', WebkitFontSmoothing: 'none' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingBottom: 2 }}>
          <BackButton onClick={onBack} />
          <div style={{ flex: 1, fontFamily: '"RuneScape Bold 12", sans-serif', fontSize: '16px', color: 'var(--color-secondary)', textShadow: '1px 1px 0 #000', textAlign: 'center', marginRight: 25 }}>Equipment Stats</div>
        </div>
        <div className="game-panel-scroll" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1, overflowY: 'auto', overflowX: 'hidden', marginRight: -4, paddingRight: 4, borderTop: '1px solid var(--color-border)', paddingTop: 2, paddingBottom: 4 }}>
          <SectionTitle title="Attack" />
          <StatRow label="Stab" value={stats?.attackStab} />
          <StatRow label="Slash" value={stats?.attackSlash} />
          <StatRow label="Crush" value={stats?.attackCrush} />
          <StatRow label="Magic" value={stats?.attackMagic} />
          <StatRow label="Ranged" value={stats?.attackRanged} />
          <SectionTitle title="Defence" />
          <StatRow label="Stab" value={stats?.defenceStab} />
          <StatRow label="Slash" value={stats?.defenceSlash} />
          <StatRow label="Crush" value={stats?.defenceCrush} />
          <StatRow label="Magic" value={stats?.defenceMagic} />
          <StatRow label="Ranged" value={stats?.defenceRanged} />
          <SectionTitle title="Other" />
          <StatRow label="Melee strength" value={stats?.meleeStrength} />
          <StatRow label="Ranged strength" value={stats?.rangedStrength} />
          <StatRow label="Magic damage" value={stats?.magicDamage} suffix="%" />
          <StatRow label="Prayer" value={stats?.prayer} />
        </div>
      </div>
    </div>
  )
}

export function EquipmentTab({ view, onViewChange }: { view: 'equipment' | 'stats'; onViewChange: (v: 'equipment' | 'stats') => void }) {
  const { runtime } = useClient()
  const state = useSimState()
  const pack = useActivePack()
  const lookup = itemLookup(runtime.cache)
  if (view === 'stats') return <EquipmentStatsView stats={state.equipmentStats} onBack={() => onViewChange('equipment')} />

  const eq = state.playerEquipment
  const supplies = state.playerCombatSupplies
  const quiverWorn = eq.cape !== undefined && QUIVER_IDS.has(eq.cape)
  const quiverCarried = state.inventory.some((i) => i !== null && QUIVER_IDS.has(i.id))
  const showQuiver = quiverWorn || quiverCarried
  const name = (id: number): string => itemDisplayName(lookup.item(id))

  const slots: { slot: SlotName; item: number | undefined; opacity?: number; unlimited?: boolean }[] = [
    { slot: 'head', item: eq.head },
    { slot: 'cape', item: eq.cape },
    { slot: 'amulet', item: eq.amulet },
    ...(showQuiver ? [{ slot: 'quiver-ammo' as const, item: supplies.quiverAmmo?.id, opacity: quiverWorn ? 1 : 0.5, unlimited: true }] : []),
    { slot: 'ammo', item: supplies.equippedAmmo?.id, unlimited: true },
    { slot: 'weapon', item: eq.weapon },
    { slot: 'body', item: eq.body },
    { slot: 'shield', item: eq.shield },
    { slot: 'legs', item: eq.legs },
    { slot: 'hands', item: eq.hands },
    { slot: 'boots', item: eq.boots },
    { slot: 'ring', item: eq.ring },
  ]

  const sprites: LayerSprite[] = []
  for (const s of slots) {
    const o = s.opacity ?? 1
    const p = POS[s.slot]
    sprites.push({ src: packAsset('equipment-slots/slot_tile.png', pack), x: p.x, y: p.y, w: TILE, h: TILE, width: TILE, height: TILE, opacity: o })
    if (s.item !== undefined && s.item >= 0) sprites.push({ src: itemIconUrl(s.item), x: p.x + 2, y: p.y + 2, w: ICON, h: ICON, offsetX: 2, opacity: o })
    else sprites.push({ src: packAsset(SILHOUETTE[s.slot], pack), x: p.x, y: p.y, w: TILE, h: TILE, width: ICON, height: ICON, opacity: o * 0.8 })
  }
  BUTTONS.forEach((b, i) => sprites.push({ src: packAsset(b.icon, pack), x: buttonX(i) + 4, y: 222, w: 32, h: 32, width: 32, height: 32, opacity: b.disabled ? 0.5 : 1 }))

  const slotLabel = (s: SlotName): string => (s === 'quiver-ammo' || s === 'ammo' ? 'Ammunition' : s.charAt(0).toUpperCase() + s.slice(1))

  return (
    <div style={{ width: CONTENT_BOX.width, height: CONTENT_BOX.height, position: 'relative' }} data-testid="equipment-panel">
      <Connectors showQuiver={showQuiver} />
      <SpriteLayer width={CONTENT_BOX.width} height={CONTENT_BOX.height} sprites={sprites} style={{ zIndex: 1 }} />
      {slots.map((s) => {
        const p = POS[s.slot]
        const item = s.item !== undefined && s.item >= 0 ? s.item : undefined
        let tooltip: () => TooltipContent
        let menu: ReturnType<typeof bindContextMenu> | null = null
        let onDown: ((e: ReactMouseEvent) => void) | undefined
        if (s.slot === 'quiver-ammo' || s.slot === 'ammo') {
          const withRemove = s.slot === 'ammo'
          tooltip = () =>
            item !== undefined
              ? { lines: [...equipmentItemTooltip(item, name(item), withRemove).lines, { spans: [{ text: 'Unlimited', color: clientColors.textSecondary }] }] }
              : { lines: [{ spans: [{ text: 'Ammunition', color: clientColors.primaryHover }] }] }
          if (s.slot === 'ammo' && item !== undefined) {
            menu = bindContextMenu(() => ({ entries: [{ action: 'Remove', target: name(item), onClick: () => unequipAmmo(runtime), clickType: 'yellow' }, { action: 'Examine', target: name(item) }, { action: 'Cancel' }] }))
            onDown = (e) => {
              if (e.button === 0) unequipAmmo(runtime)
              menu?.onMouseDown(e)
            }
          }
        } else {
          const slot = s.slot
          tooltip = () => (item === undefined ? { lines: [{ spans: [{ text: slotLabel(slot), color: clientColors.primaryHover }] }] } : equipmentItemTooltip(item, name(item), true))
          if (item !== undefined) {
            menu = bindContextMenu(() => ({ entries: [{ action: 'Remove', target: name(item), onClick: () => unequipSlot(runtime, slot), clickType: 'yellow' }, { action: 'Examine', target: name(item) }, { action: 'Cancel' }] }))
          }
          onDown = (e) => {
            if (e.button === 0 && item !== undefined) unequipSlot(runtime, slot)
            menu?.onMouseDown(e)
          }
        }
        return (
          <div
            key={s.slot}
            data-testid={`equipment-slot-${s.slot}`}
            {...bindTooltip(tooltip)}
            onMouseDown={onDown}
            onContextMenu={menu?.onContextMenu ?? ((e) => e.preventDefault())}
            style={{ position: 'absolute', left: p.x, top: p.y, width: TILE, height: TILE, boxSizing: 'border-box', zIndex: 2, cursor: 'default', ...(s.opacity === undefined ? {} : { opacity: s.opacity }) }}
          >
            {s.unlimited && item !== undefined && <Unlimited />}
          </div>
        )
      })}
      {BUTTONS.map((b, i) => (
        <FramedButton
          key={b.label}
          label={b.label}
          disabled={b.disabled}
          left={buttonX(i)}
          {...(b.disabled
            ? {}
            : {
                onMouseDown: (e: ReactMouseEvent) => {
                  if (e.button === 0) onViewChange('stats')
                },
                tooltip: UI_TOOLTIPS.equipmentStats,
              })}
        />
      ))}
    </div>
  )
}
