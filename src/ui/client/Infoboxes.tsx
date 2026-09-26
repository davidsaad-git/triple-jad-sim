import { type CSSProperties, type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Store, useStore } from '../../app/GameStore'
import type { ClientLayoutMode, InfoboxPinTarget, PanelPosition, Settings } from '../../app/settings/settings'
import { settingsStore, useSetting, useSettings } from '../../app/settings/settings'
import { TOOLTIP_COLORS } from '../../input/menu'
import { hideTooltip, showTooltip } from '../../input/tooltip'
import type { SimState, SkillName } from '../../sim/api'
import { tickCounterInfobox } from '../plugins/tickCounter'
import { itemIconUrl } from '../packs'
import { useClient, useSimState } from './context'
import { DraggablePanel, PANEL_MOVED_EVENT } from './DraggablePanel'
import {
  type Box,
  clampModernPanelPosition,
  defaultInfoboxPosition,
  infoboxAbovePanel,
  infoboxContentScale,
  infoboxDockSize,
  infoboxStripSize,
  panelMetrics,
} from './layout'
import { PixelSprite } from './sprites/PixelSprite'
import { publicUrl } from '../../app/publicUrl'

/**
 * Infoboxes: a strip of 32x32 boxes pinned above the inventory, the
 * HUD, or free (Alt-drag). Content comes from a provider registry so other
 * modules can add boxes; the built-ins are scim's list in scim's order.
 */

export interface Infobox {
  id: string
  /** Sprite URL; `itemId` is used when absent. */
  spriteUrl?: string
  itemId?: number
  text: string
  textColor?: string
  tone?: 'boost' | 'drain'
  /** When set with `sampledAtTick`, the text is a m:ss timer interpolated between ticks. */
  ticksRemaining?: number
  sampledAtTick?: number
  tooltipTitle: string
  tooltipDetail: string
}

export type InfoboxProvider = (state: SimState, settings: Settings) => Infobox | readonly Infobox[] | null | undefined

interface ProviderEntry {
  id: string
  order: number
  provide: InfoboxProvider
}

// ---------------------------------------------------------------------------
// Timers
// ---------------------------------------------------------------------------

/** Seconds shown for a tick count (one tick = 0.6 s, rounded up). */
export function ticksToSeconds(ticks: number): number {
  return Math.max(0, Math.ceil(ticks * 0.6))
}

/** `m:ss`. */
export function formatTimer(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}

export function formatTicks(ticks: number): string {
  return formatTimer(ticksToSeconds(ticks))
}

/** Seconds left at interpolated tick `now` for a timer sampled at `sampledAt`. */
export function interpolatedSeconds(ticksRemaining: number, sampledAt: number, now: number): number {
  return ticksToSeconds(ticksRemaining - Math.min(1, Math.max(0, now - sampledAt)))
}

// ---------------------------------------------------------------------------
// Built-in providers
// ---------------------------------------------------------------------------

/** Item ids of item-sprite infoboxes. */
export const INFOBOX_ITEMS = { saturatedHeart: 27641, antipoison: 2446, surgePotion: 30875 } as const

const ARCEUUS_SPRITES = publicUrl('assets/ui/packs/pack-vanilla/spells/arceuus_spell')

const STAT_INFOBOXES: readonly { stat: SkillName; id: string; name: string }[] = [
  { stat: 'attack', id: 'stat-attack', name: 'Attack' },
  { stat: 'strength', id: 'stat-strength', name: 'Strength' },
  { stat: 'defence', id: 'stat-defence', name: 'Defence' },
  { stat: 'ranged', id: 'stat-ranged', name: 'Ranged' },
  { stat: 'magic', id: 'stat-magic', name: 'Magic' },
]

function timer(state: SimState, key: string): number {
  const v = state.combatTimers[key]
  return typeof v === 'number' ? v : 0
}

const BUILTIN_PROVIDERS: readonly ProviderEntry[] = [
  {
    id: 'tick-counter',
    order: 0,
    provide: (s, settings) => tickCounterInfobox(s.currentTick, settings),
  },
  {
    id: 'saturated-heart',
    order: 10,
    provide: (s) => {
      const ticks = timer(s, 'saturatedHeartActiveTicks')
      if (ticks <= 0) return null
      const t = formatTicks(ticks)
      return { id: 'saturated-heart', itemId: INFOBOX_ITEMS.saturatedHeart, text: t, ticksRemaining: ticks, sampledAtTick: s.currentTick, tooltipTitle: 'Saturated heart', tooltipDetail: `Magic +${4 + Math.floor(s.stats.magic.max * 0.1)} (${t} remaining)` }
    },
  },
  {
    id: 'mark-of-darkness',
    order: 20,
    provide: (s) => {
      const ticks = timer(s, 'markOfDarknessActiveTicks')
      if (ticks <= 0) return null
      const t = formatTicks(ticks)
      return { id: 'mark-of-darkness', spriteUrl: `${ARCEUUS_SPRITES}/mark_of_darkness.png`, text: t, ticksRemaining: ticks, sampledAtTick: s.currentTick, tooltipTitle: 'Mark of Darkness', tooltipDetail: `Demonbane bonus active (${t} remaining)` }
    },
  },
  {
    id: 'death-charge',
    order: 30,
    provide: (s) => {
      const active = timer(s, 'deathChargeActiveTicks')
      const cooldown = timer(s, 'deathChargeCooldownTicks')
      const out: Infobox[] = []
      if (active > 0) {
        const procs = timer(s, 'deathChargeProcsRemaining')
        out.push({
          id: 'death-charge',
          spriteUrl: `${ARCEUUS_SPRITES}/death_charge.png`,
          text: String(procs),
          ...(procs > 1 ? { tone: 'boost' as const } : {}),
          tooltipTitle: 'Death Charge',
          tooltipDetail: `${procs} ${procs === 1 ? 'kill' : 'kills'} left to restore 15% special attack (${formatTicks(active)} remaining)`,
        })
      }
      if (cooldown > 0 && active === 0) {
        const t = formatTicks(cooldown)
        out.push({ id: 'death-charge-cooldown', spriteUrl: `${ARCEUUS_SPRITES}/death_charge_disabled.png`, text: t, ticksRemaining: cooldown, sampledAtTick: s.currentTick, tooltipTitle: 'Death Charge', tooltipDetail: `Can be recast in ${t}` })
      }
      return out
    },
  },
  {
    id: 'antipoison',
    order: 40,
    provide: (s) => {
      if (s.poisonVarp >= 0) return null
      const ticks = (Math.abs(s.poisonVarp) - 1) * 30 + s.poisonTickCounter
      const t = formatTicks(ticks)
      return { id: 'antipoison', itemId: INFOBOX_ITEMS.antipoison, text: t, ticksRemaining: ticks, sampledAtTick: s.currentTick, tooltipTitle: 'Antipoison', tooltipDetail: `Poison immunity (${t} remaining)` }
    },
  },
  {
    id: 'surge-potion-cooldown',
    order: 50,
    provide: (s) => {
      const ticks = timer(s, 'surgePotionCooldownTicks')
      if (ticks <= 0) return null
      const t = formatTicks(ticks)
      return { id: 'surge-potion-cooldown', itemId: INFOBOX_ITEMS.surgePotion, text: t, ticksRemaining: ticks, sampledAtTick: s.currentTick, tooltipTitle: 'Surge potion', tooltipDetail: `Cooldown (${t} remaining)` }
    },
  },
  {
    id: 'stats',
    order: 60,
    provide: (s) => {
      const out: Infobox[] = []
      for (const { stat, id, name } of STAT_INFOBOXES) {
        const lv = s.stats[stat]
        if (lv.current === lv.max) continue
        const diff = lv.current - lv.max
        out.push({ id, spriteUrl: publicUrl(`assets/ui/skill-${stat}.png`), text: String(lv.current), tone: diff > 0 ? 'boost' : 'drain', tooltipTitle: name, tooltipDetail: `${name}: ${lv.current}/${lv.max} (${diff > 0 ? '+' : ''}${diff})` })
      }
      return out
    },
  },
]

const registry = new Store<{ entries: readonly ProviderEntry[] }>({ entries: BUILTIN_PROVIDERS })

/**
 * Add (or replace, by id) an infobox provider. Built-in ids and orders:
 * tick-counter 0, saturated-heart 10, mark-of-darkness 20, death-charge 30,
 * antipoison 40, surge-potion-cooldown 50, stats 60. Returns an unregister
 * function that restores the built-in of the same id, if any.
 */
export function registerInfoboxProvider(id: string, provide: InfoboxProvider, order = 100): () => void {
  const entry: ProviderEntry = { id, order, provide }
  const sorted = (list: readonly ProviderEntry[]): ProviderEntry[] => [...list].sort((a, b) => a.order - b.order)
  registry.set({ entries: sorted([...registry.get().entries.filter((e) => e.id !== id), entry]) })
  return () => {
    const current = registry.get().entries
    if (!current.includes(entry)) return
    const builtin = BUILTIN_PROVIDERS.find((e) => e.id === id)
    registry.set({ entries: sorted([...current.filter((e) => e !== entry), ...(builtin ? [builtin] : [])]) })
  }
}

/** All infoboxes for a state, in provider order. */
export function collectInfoboxes(state: SimState, settings: Settings, entries: readonly ProviderEntry[] = registry.get().entries): Infobox[] {
  const out: Infobox[] = []
  for (const e of entries) {
    let r: ReturnType<InfoboxProvider>
    try {
      r = e.provide(state, settings)
    } catch {
      r = null
    }
    if (!r) continue
    if (Array.isArray(r)) out.push(...(r as readonly Infobox[]))
    else out.push(r as Infobox)
  }
  return out
}

export function useInfoboxes(): Infobox[] {
  const state = useSimState()
  const settings = useSettings((s) => s)
  const entries = useStore(registry, (s) => s.entries)
  return useMemo(() => collectInfoboxes(state, settings, entries), [state, settings, entries])
}

// ---------------------------------------------------------------------------
// Strip view (scim, `hge`)
// ---------------------------------------------------------------------------

function textClass(hasSprite: boolean, tone: Infobox['tone']): string {
  return `infobox-text${hasSprite ? '' : ' infobox-text--solo'}${tone ? ` infobox-text--${tone}` : ''}`
}

function TimerText({ ticksRemaining, sampledAtTick, hasSprite }: { ticksRemaining: number; sampledAtTick: number; hasSprite: boolean }) {
  const { runtime } = useClient()
  const [text, setText] = useState(() => formatTimer(ticksToSeconds(ticksRemaining)))
  useLayoutEffect(() => {
    let handle = 0
    let last = ''
    const frame = (): void => {
      const next = formatTimer(interpolatedSeconds(ticksRemaining, sampledAtTick, runtime.clock.interpolatedTick()))
      if (next !== last) {
        last = next
        setText(next)
      }
      handle = runtime.scheduler.request(frame)
    }
    frame()
    return () => runtime.scheduler.cancel(handle)
  }, [runtime, ticksRemaining, sampledAtTick])
  return <span className={textClass(hasSprite, undefined)}>{text}</span>
}

function InfoboxItem({ box, contentScale, hovered }: { box: Infobox; contentScale: number; hovered: boolean }) {
  const sprite = box.spriteUrl ?? (box.itemId !== undefined && box.itemId > 0 ? itemIconUrl(box.itemId) : '')
  const hasSprite = sprite !== ''
  const timed = box.ticksRemaining !== undefined && box.sampledAtTick !== undefined
  return (
    <div
      className={`infobox-item${hovered ? ' is-hovered' : ''}`}
      role="img"
      aria-label={`${box.tooltipTitle}. ${box.tooltipDetail}`}
      data-infobox-id={box.id}
      data-infobox-title={box.tooltipTitle}
      data-infobox-detail={box.tooltipDetail}
    >
      {hasSprite && <PixelSprite src={sprite} alt={box.tooltipTitle} className="infobox-sprite" width={24 * contentScale} height={24 * contentScale} />}
      {timed ? (
        <TimerText ticksRemaining={box.ticksRemaining!} sampledAtTick={box.sampledAtTick!} hasSprite={hasSprite} />
      ) : (
        <span className={textClass(hasSprite, box.tone)} style={box.textColor ? { color: box.textColor } : undefined}>
          {box.text}
        </span>
      )}
    </div>
  )
}

/** Hover tooltip by hit-testing on window mousemove (the strip is pointer-transparent; scim). */
function useInfoboxHover(stripRef: RefObject<HTMLDivElement | null>): string | null {
  const [hovered, setHovered] = useState<string | null>(null)
  useEffect(() => {
    let current: HTMLElement | null = null
    let raf = 0
    let cx = 0
    let cy = 0
    const clear = (): void => {
      if (!current) return
      current = null
      setHovered(null)
      hideTooltip()
    }
    const hit = (): HTMLElement | null => {
      const strip = stripRef.current
      if (!strip) return null
      for (const el of strip.querySelectorAll<HTMLElement>('[data-infobox-id]')) {
        const r = el.getBoundingClientRect()
        if (cx >= r.left && cx < r.right && cy >= r.top && cy < r.bottom) return el
      }
      return null
    }
    const uncovered = (el: HTMLElement): boolean => {
      if (typeof document.elementFromPoint !== 'function') return true
      const strip = stripRef.current
      if (!strip) return false
      const prev = strip.style.pointerEvents
      strip.style.pointerEvents = 'auto'
      const top = document.elementFromPoint(cx, cy)
      strip.style.pointerEvents = prev
      return !!top && el.contains(top)
    }
    const run = (): void => {
      raf = 0
      const el = hit()
      if (!el || (el !== current && !uncovered(el))) {
        clear()
        return
      }
      current = el
      setHovered(el.dataset.infoboxId ?? null)
      showTooltip({ lines: [{ spans: [{ text: el.dataset.infoboxTitle ?? '', color: TOOLTIP_COLORS.item }] }, { spans: [{ text: el.dataset.infoboxDetail ?? '', color: TOOLTIP_COLORS.action }] }] })
    }
    const onMove = (e: MouseEvent): void => {
      cx = e.clientX
      cy = e.clientY
      if (raf === 0) raf = requestAnimationFrame(run)
    }
    window.addEventListener('mousemove', onMove)
    document.addEventListener('mouseleave', clear)
    return () => {
      window.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseleave', clear)
      if (raf !== 0) cancelAnimationFrame(raf)
      clear()
    }
  }, [stripRef])
  return hovered
}

export interface InfoboxStripViewProps {
  infoboxes: readonly Infobox[]
  contentScale: number
  /** Right-align the rows (HUD pin with a right-aligned HUD). */
  alignEnd?: boolean
  /** Panel zoom, for the 1 px borders (`--infobox-zoom`). */
  zoom?: number
}

export function InfoboxStripView({ infoboxes, contentScale, alignEnd = false, zoom = 1 }: InfoboxStripViewProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const hovered = useInfoboxHover(ref)
  const outlined = useSetting('infoboxTextOutlineEnabled')
  const outlineColor = useSetting('infoboxTextOutlineColor')
  if (infoboxes.length === 0) return null
  const style = { '--infobox-scale': contentScale, '--infobox-zoom': zoom, ...(outlined ? { '--infobox-outline-color': outlineColor } : {}) } as CSSProperties
  return (
    <div ref={ref} className={`infobox-strip${outlined ? ' infobox-strip--outlined' : ''}${alignEnd ? ' infobox-strip--align-end' : ''}`} style={style}>
      {infoboxes.map((b) => (
        <InfoboxItem key={b.id} box={b} contentScale={contentScale} hovered={b.id === hovered} />
      ))}
    </div>
  )
}

/**
 * The strip docked inside the HUD stack (`dockWidth` path of scim):
 * pass it as HudTools' `status` when the pin target is HUD.
 */
export function InfoboxDock({ width, alignEnd = false }: { width: number; alignEnd?: boolean }) {
  const boxes = useInfoboxes()
  const uiScale = useSetting('uiScale')
  const contentScale = infoboxContentScale(uiScale)
  if (boxes.length === 0) return null
  const size = infoboxDockSize(width, uiScale, contentScale, boxes.length)
  return (
    <div data-tutorial="infobox-panel" style={{ width, height: size.height * uiScale, position: 'relative' }}>
      <div style={{ width: size.width, transform: `scale(${uiScale})`, transformOrigin: '0 0' }}>
        <InfoboxStripView infoboxes={boxes} contentScale={contentScale} alignEnd={alignEnd} zoom={uiScale} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Positioned strip
// ---------------------------------------------------------------------------

const TRANSLATE_RE = /translate3d\(\s*(-?\d+(?:\.\d+)?)px\s*,\s*(-?\d+(?:\.\d+)?)px/

/** Left/top of a panel from its `translate3d` transform. */
export function readTranslate(transform: string): { left: number; top: number } | null {
  const m = TRANSLATE_RE.exec(transform)
  return m ? { left: Number.parseFloat(m[1]!), top: Number.parseFloat(m[2]!) } : null
}

/** Effective pin target: Inventory does not work in Fixed mode (falls back to HUD). */
export function effectivePinTarget(pin: InfoboxPinTarget, layout: ClientLayoutMode): InfoboxPinTarget {
  return layout === 'fixed' && pin === 'inventory' ? 'hud' : pin
}

export interface InfoboxPanelProps {
  layout: ClientLayoutMode
  uiScale: number
  frameWidth: number
  frameHeight: number
  exclusionRects?: readonly Box[]
  /** The HUD renders an `InfoboxDock` itself, so skip the floating HUD strip. */
  hudDocked?: boolean
}

export function InfoboxPanel({ layout, uiScale, frameWidth, frameHeight, exclusionRects, hudDocked = false }: InfoboxPanelProps) {
  const boxes = useInfoboxes()
  const pin = effectivePinTarget(useSetting('infoboxPinTarget'), layout)
  const storedPos = useSetting('infoboxPosition')
  const gamePanelSetting = useSetting('gamePanelPosition')
  const contentScale = infoboxContentScale(uiScale)
  const count = Math.max(1, boxes.length)
  const [hudRect, setHudRect] = useState<{ left: number; top: number; width: number } | null>(null)
  const [panelAt, setPanelAt] = useState<{ left: number; top: number } | null>(null)
  const stripRef = useRef<HTMLElement | null>(null)

  const size = pin === 'hud' && hudRect ? infoboxDockSize(hudRect.width, uiScale, contentScale, count) : infoboxStripSize(count, contentScale)
  const metrics = panelMetrics(layout)
  const gamePanel = layout === 'modern' ? clampModernPanelPosition(gamePanelSetting, uiScale) : gamePanelSetting
  const fallback = defaultInfoboxPosition(size.width, size.height, uiScale, gamePanel, metrics)
  const sizeRef = useRef(size)
  sizeRef.current = size
  const scaleRef = useRef(uiScale)
  scaleRef.current = uiScale

  const findStrip = useCallback((): HTMLElement | null => {
    if (!stripRef.current || !stripRef.current.isConnected) stripRef.current = document.querySelector<HTMLElement>('[data-tutorial="infobox-panel"]')
    return stripRef.current
  }, [])

  // Inventory pin: follow the game panel's live transform (also during drags).
  useEffect(() => {
    if (pin !== 'inventory') {
      setPanelAt(null)
      return
    }
    const sync = (): void => {
      const panel = document.querySelector<HTMLElement>('[data-tutorial="game-panel"]')
      const at = panel ? readTranslate(panel.style.transform) : null
      if (!at) return
      const strip = findStrip()
      if (strip) {
        const p = infoboxAbovePanel(at.left, at.top, sizeRef.current.height * scaleRef.current)
        strip.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`
      }
      setPanelAt((prev) => (prev && prev.left === at.left && prev.top === at.top ? prev : at))
    }
    sync()
    window.addEventListener(PANEL_MOVED_EVENT, sync)
    return () => window.removeEventListener(PANEL_MOVED_EVENT, sync)
  }, [pin, findStrip])
  useLayoutEffect(() => {
    if (pin !== 'inventory') return
    const panel = document.querySelector<HTMLElement>('[data-tutorial="game-panel"]')
    const at = panel ? readTranslate(panel.style.transform) : null
    setPanelAt((prev) => (at === null ? prev : prev && prev.left === at.left && prev.top === at.top ? prev : at))
  })

  // HUD pin: track the HUD element every frame (scim rAF loop).
  const hasBoxes = boxes.length > 0
  useLayoutEffect(() => {
    if (pin !== 'hud' || !hasBoxes || hudDocked) {
      setHudRect(null)
      return
    }
    let raf = 0
    const measure = (): void => {
      const strip = findStrip()
      const hud = document.querySelector<HTMLElement>('[data-tutorial="hud"]')
      const origin = strip?.offsetParent
      if (!strip || !hud || !origin) {
        setHudRect((prev) => (prev === null ? prev : null))
      } else {
        const h = hud.getBoundingClientRect()
        const o = origin.getBoundingClientRect()
        const next = { left: h.left - o.left, top: h.top - o.top, width: h.width }
        const p = infoboxAbovePanel(next.left, next.top, sizeRef.current.height * scaleRef.current)
        const t = `translate3d(${p.x}px, ${p.y}px, 0px)`
        if (strip.style.transform !== t) strip.style.transform = t
        setHudRect((prev) => (prev && prev.left === next.left && prev.top === next.top && prev.width === next.width ? prev : next))
      }
      raf = requestAnimationFrame(measure)
    }
    measure()
    return () => cancelAnimationFrame(raf)
  }, [pin, hasBoxes, hudDocked, findStrip])

  if (boxes.length === 0) return null
  if (pin === 'hud' && hudDocked) return null

  const pinned = pin === 'hud' || pin === 'inventory'
  let position: PanelPosition
  if (pin === 'hud' && hudRect) {
    const p = infoboxAbovePanel(hudRect.left, hudRect.top, size.height * uiScale)
    position = { x: p.x, y: p.y, anchorX: 'left', anchorY: 'top' }
  } else if (pin === 'inventory' && panelAt) {
    const p = infoboxAbovePanel(panelAt.left, panelAt.top, size.height * uiScale)
    position = { x: p.x, y: p.y, anchorX: 'left', anchorY: 'top' }
  } else if (pin === 'free') position = storedPos ?? fallback
  else position = fallback

  return (
    <DraggablePanel
      defaultPosition={fallback}
      position={position}
      width={size.width}
      height={size.height}
      scale={uiScale}
      contentScale={contentScale}
      {...(pin === 'free' ? { onPositionChange: (p: PanelPosition) => settingsStore.patch({ infoboxPosition: p }) } : {})}
      onScaleChange={(s) => settingsStore.patch({ uiScale: Math.max(1, Math.min(3, s)) })}
      frameWidth={frameWidth}
      frameHeight={frameHeight}
      {...(exclusionRects ? { exclusionRects } : {})}
      locked={pinned}
      externallyPositioned={pinned}
      scaleEnabled={layout !== 'fixed'}
      pointerPassthrough
      dataTutorial="infobox-panel"
    >
      <InfoboxStripView infoboxes={boxes} contentScale={contentScale} zoom={uiScale} />
    </DraggablePanel>
  )
}
