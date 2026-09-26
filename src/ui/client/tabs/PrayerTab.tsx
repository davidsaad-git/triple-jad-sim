import { type MouseEvent as ReactMouseEvent, type ReactNode, useMemo, useRef, useState } from 'react'
import { antiDragStore, usePluginStore } from '../../../app/plugins/stores'
import { useStore } from '../../../app/GameStore'
import { useSettings } from '../../../app/settings/settings'
import { bindContextMenu } from '../../../input/contextMenuStore'
import { prayerTooltip } from '../../../input/menu'
import { bindTooltip } from '../../../input/tooltip'
import type { PrayerId } from '../../../sim/api'
import { packAsset, useActivePack } from '../../packs'
import { clientColors } from '../../theme/palettes'
import { togglePrayer } from '../actions'
import {
  closeQuickPrayerSetup,
  panelModesStore,
  quickPrayerSetupStore,
  setPrayerOrder,
  toggleQuickPrayerSelection,
  togglePrayerFilterOption,
  togglePrayerHidden,
  usePanelFilters,
  usePanelModes,
} from '../clientState'
import { useClient, usePresentation, useSimState } from '../context'
import { dragStarted, reorderPressRules, useWindowDrag } from '../drag'
import { CONTENT_BOX, prayerCellOrigin } from '../layout'
import { isPrayerLit, PRAYER_GROUPS } from '../presentation'
import { NineSlice } from '../sprites/NineSlice'
import { PixelSprite } from '../sprites/PixelSprite'
import { usePanelScale } from '../sprites/scale'
import { type LayerSprite, SpriteLayer } from '../sprites/SpriteLayer'
import { FilterMenu, type FilterRow } from './FilterMenu'
import { type Availability, displayedPrayers, type DisplayedPrayer, orderedBook, PRAYER_BOOK, visiblePrayers } from './prayerBook'

/**
 * Prayer tab (scim, 03):
 * 29 icons in a 5-column grid; the ten simulated prayers toggle on mouse
 * down, the rest are drawn disabled at 40%. Right-click the tab for reorder /
 * filter modes. The quick-prayer setup view replaces the grid while open.
 */

const CELL = 34
const PITCH = 37
const SHADOW = '1px 1px 0 #000'

export function useAvailability(): Availability {
  const state = useSimState()
  return { basePrayerLevel: state.stats.prayer.max, baseDefenceLevel: state.stats.defence.max }
}

export function useUpgradedPrayers(): boolean {
  const state = useSimState()
  const v = state.mechanicsConfig.deadeyeMysticVigour
  return v === undefined ? true : v !== false
}

interface Press {
  index: number
  startX: number
  startY: number
  startTime: number
  curX: number
  curY: number
  dragging: boolean
  canDrag: boolean
  thresholdMs: number
}

export function PrayerTab() {
  const { runtime } = useClient()
  const presentation = usePresentation()
  const state = useSimState()
  const pack = useActivePack()
  const filters = usePanelFilters()
  const modes = usePanelModes()
  const anti = usePluginStore(antiDragStore, (s) => s)
  const instantPrayer = useSettings((s) => s.instantInventoryEnabled && s.instantPrayerEnabled)
  const availability = useAvailability()
  const upgraded = useUpgradedPrayers()
  const scale = usePanelScale()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const ghostRef = useRef<HTMLDivElement | null>(null)
  const targetRef = useRef<HTMLDivElement | null>(null)
  const pressRef = useRef<Press | null>(null)
  const [press, setPress] = useState<Press | null>(null)
  const quickSetupOpen = useStore(quickPrayerSetupStore, (s) => s.open)

  const reordering = modes.prayerReordering
  const filtering = modes.prayerFiltering
  const filterView = modes.prayerFilterViewOpen && filtering
  const hidden = useMemo(() => new Set(filters.prayer.hidden), [filters.prayer.hidden])
  const ordered = useMemo(() => orderedBook(filters.prayer.order), [filters.prayer.order])
  const visible = useMemo(() => visiblePrayers(ordered, hidden, filters.prayer.filterOptions, filtering, reordering, availability), [ordered, hidden, filters.prayer.filterOptions, filtering, reordering, availability.basePrayerLevel, availability.baseDefenceLevel]) // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => displayedPrayers(visible, availability, upgraded), [visible, availability.basePrayerLevel, availability.baseDefenceLevel, upgraded]) // eslint-disable-line react-hooks/exhaustive-deps
  const shownRef = useRef(shown)
  shownRef.current = shown
  const display = presentation.prayerDisplay(state, instantPrayer)
  const lit = (p: PrayerId): boolean => isPrayerLit(p, display, display.overrides)

  const activate = (e: DisplayedPrayer): void => {
    if (!e.prayer || !e.available) return
    togglePrayer(runtime, presentation, e.prayer, instantPrayer)
  }

  const { startDrag } = useWindowDrag({
    onMove: (x, y, t) => {
      const p = pressRef.current
      const root = rootRef.current
      if (!p || !root) return
      p.curX = x
      p.curY = y
      if (!p.dragging && dragStarted({ startX: p.startX, startY: p.startY, startTime: p.startTime, thresholdMs: p.thresholdMs, canDrag: p.canDrag }, x, y, t)) {
        p.dragging = true
        setPress({ ...p })
      }
      if (!p.dragging) return
      const rect = root.getBoundingClientRect()
      const lx = (x - rect.left) / scale
      const ly = (y - rect.top) / scale
      if (ghostRef.current) ghostRef.current.style.transform = `translate3d(${lx - CELL / 2}px, ${ly - CELL / 2}px, 0)`
      if (targetRef.current) {
        const hit = cellAt(lx, ly, shownRef.current.length)
        const target = hit === p.index ? null : hit
        if (target === null) targetRef.current.style.display = 'none'
        else {
          targetRef.current.style.display = ''
          targetRef.current.style.transform = `translate3d(${10 + (target % 5) * PITCH}px, ${15 + Math.floor(target / 5) * PITCH}px, 0)`
        }
      }
    },
    onEnd: (x, y) => {
      const p = pressRef.current
      pressRef.current = null
      setPress(null)
      if (!p) return
      if (p.dragging && rootRef.current) {
        const rect = rootRef.current.getBoundingClientRect()
        const target = cellAt((x - rect.left) / scale, (y - rect.top) / scale, shownRef.current.length)
        if (target !== null && target !== p.index) {
          const icons = shownRef.current.map((e) => e.icon)
          const a = icons[p.index]!
          icons[p.index] = icons[target]!
          icons[target] = a
          setPrayerOrder(icons)
        }
      } else {
        const e = shownRef.current[p.index]
        if (e) activate(e)
      }
    },
  })

  if (quickSetupOpen) return <QuickPrayerSetup availability={availability} upgraded={upgraded} />

  const sprites: LayerSprite[] = []
  if (!filterView) {
    shown.forEach((e, i) => {
      const o = prayerCellOrigin(i)
      const usable = e.prayer !== undefined && e.available
      const fade = press?.dragging && press.index === i ? 0.3 : press && !press.dragging && press.index === i ? 0.5 : 1
      if (e.prayer && lit(e.prayer)) sprites.push({ src: packAsset('prayer/activated_background.png', pack), x: o.x, y: o.y, w: CELL, h: CELL, width: CELL, height: CELL, opacity: fade })
      const base = hidden.has(e.icon) ? 0.3 : usable ? 1 : 0.4
      sprites.push({ src: packAsset(usable ? `prayer/${e.displayIcon}.png` : `prayer/${e.displayIcon}_disabled.png`, pack), x: o.x, y: o.y, w: CELL, h: CELL, opacity: fade * base })
    })
  }

  const filterRows: FilterRow[] = [
    { key: 'showLowerTiers', label: 'Show lower tiers of tiered prayers', checked: filters.prayer.filterOptions.showLowerTiers, onToggle: () => togglePrayerFilterOption('showLowerTiers') },
    { key: 'showTieredOverMultiskill', label: 'Show tiered prayers even if multi-skill prayers are available', checked: filters.prayer.filterOptions.showTieredOverMultiskill, height: 36, disabled: filters.prayer.filterOptions.showLowerTiers, onToggle: () => togglePrayerFilterOption('showTieredOverMultiskill') },
    { key: 'showRapidHealing', label: <>Show <span style={{ color: '#ffffff' }}>Rapid Healing</span> prayers</>, checked: filters.prayer.filterOptions.showRapidHealing, onToggle: () => togglePrayerFilterOption('showRapidHealing') },
    { key: 'showLackLevel', label: 'Show prayers you lack the Prayer level to activate', checked: filters.prayer.filterOptions.showLackLevel, onToggle: () => togglePrayerFilterOption('showLackLevel') },
    { key: 'showLackRequirements', label: 'Show prayers you lack the requirements to activate', checked: filters.prayer.filterOptions.showLackRequirements, onToggle: () => togglePrayerFilterOption('showLackRequirements') },
  ]

  const onIconDown = (ev: ReactMouseEvent, e: DisplayedPrayer, index: number): void => {
    if (ev.button !== 0) return
    if (reordering && !ev.altKey) {
      const rules = reorderPressRules({ shift: ev.shiftKey, ctrl: ev.ctrlKey }, anti)
      const p: Press = { index, startX: ev.clientX, startY: ev.clientY, startTime: ev.timeStamp, curX: ev.clientX, curY: ev.clientY, dragging: false, canDrag: rules.canDrag, thresholdMs: rules.thresholdMs }
      pressRef.current = p
      setPress(p)
      ev.preventDefault()
      startDrag(ev)
      return
    }
    activate(e)
  }

  const dragEntry = press?.dragging ? shown[press.index] : undefined

  return (
    <div ref={rootRef} style={{ width: CONTENT_BOX.width, height: CONTENT_BOX.height, position: 'relative' }} data-testid="prayer-panel">
      <SpriteLayer width={CONTENT_BOX.width} height={CONTENT_BOX.height} sprites={sprites} />
      {filterView ? (
        <FilterMenu rows={filterRows} />
      ) : (
        shown.map((e, i) => {
          const o = prayerCellOrigin(i)
          const isHidden = hidden.has(e.icon)
          const usable = e.prayer !== undefined && e.available
          const menu = bindContextMenu(() => {
            if (!usable) {
              return reordering
                ? { entries: [{ action: 'Activate', target: e.label }, { action: isHidden ? 'Unhide' : 'Hide', target: e.label, onClick: () => togglePrayerHidden(e.icon) }, { action: 'Cancel' }] }
                : { entries: [{ action: 'Activate', target: e.label }, { action: 'Cancel' }] }
            }
            const on = lit(e.prayer!)
            const toggle = { action: on ? 'Deactivate' : 'Activate', target: e.label, onClick: () => activate(e) }
            return reordering ? { entries: [toggle, { action: isHidden ? 'Unhide' : 'Hide', target: e.label, onClick: () => togglePrayerHidden(e.icon) }, { action: 'Cancel' }] } : { entries: [toggle, { action: 'Cancel' }] }
          })
          return (
            <button
              key={e.icon}
              type="button"
              data-prayer={e.prayer}
              data-prayer-icon={e.icon}
              aria-label={e.label}
              aria-disabled={e.prayer !== undefined && !e.available && !reordering ? true : undefined}
              onMouseDown={(ev) => {
                menu.onMouseDown(ev)
                onIconDown(ev, e, i)
              }}
              onContextMenu={menu.onContextMenu}
              {...(press?.dragging ? {} : bindTooltip(() => (usable ? prayerTooltip(e.label, lit(e.prayer!)) : { lines: [{ spans: [{ text: e.label, color: '#ffffff' }] }] })))}
              style={{ position: 'absolute', left: o.x, top: o.y, width: CELL, height: CELL, background: 'transparent', border: 'none', borderRadius: 0, cursor: 'default', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', outline: 'none' }}
            />
          )
        })
      )}
      {dragEntry && (
        <div ref={ghostRef} style={{ position: 'absolute', left: 0, top: 0, transform: 'translate3d(-100px, -100px, 0)', width: CELL, height: CELL, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 100 }}>
          <PixelSprite
            src={packAsset(`prayer/${dragEntry.displayIcon}.png`, pack)}
            alt={dragEntry.label}
            style={{ opacity: hidden.has(dragEntry.icon) ? 0.3 : 1, filter: dragEntry.prayer && lit(dragEntry.prayer) ? 'brightness(1.3) drop-shadow(0 0 2px rgba(255, 255, 200, 0.6))' : 'none', pointerEvents: 'none', imageRendering: 'pixelated' }}
          />
        </div>
      )}
      {press?.dragging && <div ref={targetRef} style={{ position: 'absolute', left: 0, top: 0, width: PITCH, height: PITCH, background: 'rgba(255, 255, 255, 0.1)', borderRadius: '50%', pointerEvents: 'none', display: 'none', zIndex: 50 }} />}
      {reordering && <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(255, 0, 0, 0.08)', pointerEvents: 'none', zIndex: 1 }} />}
      <div style={{ position: 'absolute', bottom: 8, left: 0, right: 0, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, zIndex: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontFamily: '"RuneScape Plain 11", sans-serif', fontSize: '16px', color: '#ffffff', textShadow: SHADOW }}>
          <PixelSprite src={packAsset('prayer/icon_small.png', pack)} alt="" style={{ width: 17, height: 18, imageRendering: 'pixelated' }} />
          {state.prayerState.points} / {state.prayerState.maxPoints}
        </div>
        {filtering && !reordering && (
          <SmallStoneButton active={modes.prayerFilterViewOpen} onClick={() => panelModesStore.update({ prayerFilterViewOpen: !modes.prayerFilterViewOpen })}>
            Filters
          </SmallStoneButton>
        )}
      </div>
    </div>
  )
}

function cellAt(lx: number, ly: number, count: number): number | null {
  const col = Math.floor((lx - 10) / PITCH)
  const row = Math.floor((ly - 15) / PITCH)
  if (col < 0 || col >= 5 || row < 0) return null
  const i = row * 5 + col
  return i >= 0 && i < count ? i : null
}

export function SmallStoneButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ position: 'relative', width: 56, height: 18, border: 'none', background: 'transparent', padding: '1px 0', margin: 0, cursor: 'default', outline: 'none', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"RuneScape Bold 12", sans-serif', fontSize: '14px', color: active ? clientColors.textHighlight : clientColors.primary, textShadow: SHADOW }}
    >
      <NineSlice selected={active} />
      <span style={{ position: 'relative', zIndex: 1 }}>{children}</span>
    </button>
  )
}

/** Quick-prayer setup view: 5 columns of 37x37 cells from (9,15). */
export function QuickPrayerSetup({ availability, upgraded }: { availability: Availability; upgraded: boolean }) {
  const filters = usePanelFilters()
  const pack = useActivePack()
  const selected = new Set(filters.prayer.quickPrayerSelections)
  const entries = displayedPrayers(PRAYER_BOOK, availability, upgraded)
  return (
    <div style={{ position: 'relative', width: CONTENT_BOX.width, height: CONTENT_BOX.height, userSelect: 'none' }} data-testid="quick-prayer-setup">
      <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
        {entries.map((e, i) => {
          const x = 9 + (i % 5) * 37
          const y = 15 + Math.floor(i / 5) * 37
          const usable = e.prayer !== undefined && e.available
          const base = usable ? (e.basePrayer ?? e.prayer) : undefined
          const on = base !== undefined && selected.has(base)
          return (
            <button
              key={e.icon}
              type="button"
              disabled={!usable}
              onClick={base ? () => toggleQuickPrayerSelection(base, (p) => PRAYER_GROUPS[p]) : undefined}
              style={{ position: 'absolute', left: x, top: y, width: 37, height: 37, background: 'transparent', border: 'none', borderRadius: 0, cursor: 'default', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', outline: 'none' }}
            >
              {on && <PixelSprite src={packAsset('prayer/activated_background.png', pack)} alt="" style={{ position: 'absolute', width: 34, height: 34, left: 1.5, top: 1.5, imageRendering: 'pixelated', pointerEvents: 'none' }} />}
              <PixelSprite src={packAsset(usable ? `prayer/${e.displayIcon}.png` : `prayer/${e.displayIcon}_disabled.png`, pack)} alt={e.label} style={{ opacity: usable ? 1 : 0.4, filter: 'none', pointerEvents: 'none', position: 'relative', imageRendering: 'pixelated' }} />
            </button>
          )
        })}
      </div>
      <div style={{ position: 'absolute', bottom: 12, left: 0, right: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2 }}>
        <button
          type="button"
          onClick={closeQuickPrayerSetup}
          style={{ position: 'relative', fontFamily: '"RuneScape Bold 12", sans-serif', fontSize: '14px', color: clientColors.primary, textShadow: SHADOW, background: `url(${packAsset('buttons/middle.png', pack)}) repeat`, backgroundSize: '12px 12px', imageRendering: 'pixelated', borderTop: '1px solid #6d5a3b', borderLeft: '1px solid #6d5a3b', borderBottom: '1px solid #2a1f15', borderRight: '1px solid #2a1f15', padding: '2px 12px', margin: 0, cursor: 'default', outline: 'none' }}
        >
          Done
        </button>
      </div>
    </div>
  )
}
