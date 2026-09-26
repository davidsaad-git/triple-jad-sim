import { type MouseEvent as ReactMouseEvent, useMemo, useRef, useState } from 'react'
import { antiDragStore, usePluginStore } from '../../../app/plugins/stores'
import { useArmedSpell, setArmedSpell } from '../../../input/armedSpell'
import { bindContextMenu } from '../../../input/contextMenuStore'
import { spellTooltip, type TooltipContent } from '../../../input/menu'
import { bindTooltip } from '../../../input/tooltip'
import type { Spellbook } from '../../../sim/api'
import { checkSpell, spellsOfBook } from '../../../sim/combat/spells'
import { clientColors } from '../../theme/palettes'
import {
  DEFAULT_SPELL_FILTERS,
  panelModesStore,
  setSpellOrder,
  SPELL_CATEGORIES,
  type SpellCategory,
  type SpellFilterOptions,
  toggleSpellCategory,
  toggleSpellFilterOption,
  toggleSpellHidden,
  usePanelFilters,
  usePanelModes,
} from '../clientState'
import { useSimState } from '../context'
import { dragStarted, reorderPressRules, useWindowDrag } from '../drag'
import { CONTENT_BOX, spellGridLayout } from '../layout'
import { PixelSprite } from '../sprites/PixelSprite'
import { usePanelScale } from '../sprites/scale'
import { type LayerSprite, SpriteLayer } from '../sprites/SpriteLayer'
import { FilterMenu, type FilterRow } from './FilterMenu'
import { SmallStoneButton } from './PrayerTab'
import { ANCIENT_GRID, ARCEUUS_GRID, type SpellGridEntry } from './spellbookData'
import { spellIconUrl } from './spellIcons'

/**
 * Spellbook tab. Combat
 * spells the simulator can cast are armed on mouse down (the next NPC click
 * casts them); teleports and unsupported spells are drawn disabled.
 */

const GRIDS: Readonly<Record<Spellbook, readonly SpellGridEntry[]>> = { arceuus: ARCEUUS_GRID, ancient: ANCIENT_GRID, standard: [], lunar: [] }
const CATEGORY_LABEL: Readonly<Record<SpellCategory, string>> = { combat: 'Combat', teleport: 'Teleport', utility: 'Utility' }

export interface SpellContext {
  equipment: Parameters<typeof checkSpell>[1]['equipment']
  inventory: Parameters<typeof checkSpell>[1]['inventory']
  runePouch: Parameters<typeof checkSpell>[1]['runePouch']
  magicLevel: number
}

const isSimulatedCombat = (book: Spellbook, label: string): boolean => spellsOfBook(book).some((s) => s.name === label)

/** Can the spell be cast right now? */
export function spellCastable(entry: SpellGridEntry, book: Spellbook, ctx: SpellContext): boolean {
  if (ctx.magicLevel < entry.level) return false
  if (entry.supported) {
    const r = checkSpell(entry.label, ctx)
    return r.ok || r.reason === 'unknown-spell'
  }
  if (entry.category === 'combat' && isSimulatedCombat(book, entry.label)) return checkSpell(entry.label, ctx).ok
  return false
}

/** Filter-mode visibility. Rune data covers the combat spells and utilities the simulator knows. */
function passes(entry: SpellGridEntry, book: Spellbook, cats: ReadonlySet<SpellCategory>, f: SpellFilterOptions, ctx: SpellContext, baseMagic: number): boolean {
  if (!cats.has(entry.category)) return false
  if (!f.showLackLevel && baseMagic < entry.level && ctx.magicLevel < entry.level) return false
  if (!f.showLackRunes) {
    const r = checkSpell(entry.label, { ...ctx, magicLevel: 99 })
    if (!r.ok && r.reason === 'missing-runes') return false
  }
  if (!f.showUnsimulated && !(entry.supported || (entry.category === 'combat' && isSimulatedCombat(book, entry.label)))) return false
  return true
}

function orderGrid(order: readonly string[] | null | undefined, grid: readonly SpellGridEntry[]): SpellGridEntry[] {
  if (!order) return [...grid]
  const pos = new Map(order.map((icon, i) => [icon, i]))
  return [...grid].sort((a, b) => {
    const ia = pos.get(a.icon)
    const ib = pos.get(b.icon)
    if (ia !== undefined && ib !== undefined) return ia - ib
    if (ia === undefined && ib === undefined) return grid.indexOf(a) - grid.indexOf(b)
    return ia === undefined ? 1 : -1
  })
}

interface Press {
  index: number
  startX: number
  startY: number
  startTime: number
  dragging: boolean
  canDrag: boolean
  thresholdMs: number
}

export function SpellbookTab({ onHomeTeleport }: { onHomeTeleport?: () => void }) {
  const state = useSimState()
  const book = state.playerCombatSupplies.spellbook
  const filters = usePanelFilters()
  const modes = usePanelModes()
  const anti = usePluginStore(antiDragStore, (s) => s)
  const armed = useArmedSpell()
  const scale = usePanelScale()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const ghostRef = useRef<HTMLDivElement | null>(null)
  const targetRef = useRef<HTMLDivElement | null>(null)
  const pressRef = useRef<Press | null>(null)
  const [press, setPress] = useState<Press | null>(null)

  const reordering = modes.spellReordering
  const filtering = modes.spellFiltering
  const filterView = modes.spellFilterViewOpen && filtering
  const hidden = useMemo(() => new Set(filters.spellbook.hidden[book] ?? []), [filters.spellbook.hidden, book])
  const cats = useMemo(() => new Set(filters.spellbook.activeCategories.global ?? filters.spellbook.activeCategories[book] ?? SPELL_CATEGORIES), [filters.spellbook.activeCategories, book])
  const opts = filters.spellbook.filterOptions.global ?? filters.spellbook.filterOptions[book] ?? DEFAULT_SPELL_FILTERS
  const ctx: SpellContext = { equipment: state.playerEquipment, inventory: state.inventory, runePouch: state.playerCombatSupplies.runePouch, magicLevel: state.stats.magic.current }
  const ordered = orderGrid(filters.spellbook.order[book], GRIDS[book])
  const visible = reordering ? ordered : ordered.filter((e) => !hidden.has(e.icon)).filter((e) => !filtering || passes(e, book, cats, opts, ctx, state.stats.magic.max))
  const layout = spellGridLayout(filtering, visible.length, book, opts.iconResizing)
  const visibleRef = useRef(visible)
  visibleRef.current = visible
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  const cellOrigin = (i: number) => ({ x: layout.startX + (i % layout.cols) * (layout.slotSize + layout.gapX), y: layout.startY + Math.floor(i / layout.cols) * (layout.slotSize + layout.gapY) })

  const cellAt = (lx: number, ly: number): number | null => {
    const l = layoutRef.current
    const px = lx - l.startX
    const py = ly - l.startY
    const col = Math.floor(px / (l.slotSize + l.gapX))
    const row = Math.floor(py / (l.slotSize + l.gapY))
    if (col < 0 || col >= l.cols || row < 0) return null
    const ix = px - col * (l.slotSize + l.gapX)
    const iy = py - row * (l.slotSize + l.gapY)
    if (ix < 0 || ix > l.slotSize || iy < 0 || iy > l.slotSize) return null
    const i = row * l.cols + col
    return i < visibleRef.current.length ? i : null
  }

  const { startDrag } = useWindowDrag({
    onMove: (x, y, t) => {
      const p = pressRef.current
      const root = rootRef.current
      if (!p || !root) return
      if (!p.dragging && dragStarted({ startX: p.startX, startY: p.startY, startTime: p.startTime, thresholdMs: p.thresholdMs, canDrag: p.canDrag }, x, y, t)) {
        p.dragging = true
        setPress({ ...p })
      }
      if (!p.dragging) return
      const rect = root.getBoundingClientRect()
      const lx = (x - rect.left) / scale
      const ly = (y - rect.top) / scale
      const s = layoutRef.current.slotSize
      if (ghostRef.current) ghostRef.current.style.transform = `translate3d(${lx - s / 2}px, ${ly - s / 2}px, 0)`
      if (targetRef.current) {
        const hit = cellAt(lx, ly)
        const target = hit === p.index ? null : hit
        if (target === null) targetRef.current.style.display = 'none'
        else {
          const l = layoutRef.current
          targetRef.current.style.display = ''
          targetRef.current.style.transform = `translate3d(${l.startX + (target % l.cols) * (l.slotSize + l.gapX)}px, ${l.startY + Math.floor(target / l.cols) * (l.slotSize + l.gapY)}px, 0)`
        }
      }
    },
    onEnd: (x, y) => {
      const p = pressRef.current
      pressRef.current = null
      setPress(null)
      if (!p || !p.dragging || !rootRef.current) return
      const rect = rootRef.current.getBoundingClientRect()
      const target = cellAt((x - rect.left) / scale, (y - rect.top) / scale)
      if (target === null || target === p.index) return
      const icons = visibleRef.current.map((e) => e.icon)
      const [moved] = icons.splice(p.index, 1)
      icons.splice(target, 0, moved!)
      setSpellOrder(book, icons)
    },
  })

  const sprites: LayerSprite[] = filterView
    ? []
    : visible.map((e, i) => {
        const o = cellOrigin(i)
        const fade = press?.dragging && press.index === i ? 0.3 : press && !press.dragging && press.index === i ? 0.7 : 1
        return { src: spellIconUrl(book, e.icon, layout.slotSize, spellCastable(e, book, ctx)), x: o.x, y: o.y, w: layout.slotSize, h: layout.slotSize, width: layout.slotSize, height: layout.slotSize, opacity: fade * (hidden.has(e.icon) ? 0.3 : 1) }
      })

  const filterRows: FilterRow[] = [
    ...SPELL_CATEGORIES.map((c) => ({ key: c, label: <>Show <span style={{ color: clientColors.textHighlight }}>{CATEGORY_LABEL[c]}</span> spells</>, checked: cats.has(c), onToggle: () => toggleSpellCategory(book, c) })),
    { key: 'showLackLevel', label: 'Show spells you lack the Magic level to cast', checked: opts.showLackLevel, onToggle: () => toggleSpellFilterOption(book, 'showLackLevel') },
    { key: 'showLackRunes', label: 'Show spells you lack the runes to cast', checked: opts.showLackRunes, onToggle: () => toggleSpellFilterOption(book, 'showLackRunes') },
    { key: 'showLackRequirements', label: 'Show spells you lack the requirements to cast', checked: opts.showLackRequirements, onToggle: () => toggleSpellFilterOption(book, 'showLackRequirements') },
    { key: 'showUnsimulated', label: 'Show spells this simulator cannot cast', checked: opts.showUnsimulated, onToggle: () => toggleSpellFilterOption(book, 'showUnsimulated') },
    { key: 'iconResizing', label: 'Enable icon resizing', checked: opts.iconResizing, onToggle: () => toggleSpellFilterOption(book, 'iconResizing') },
  ]

  const dragEntry = press?.dragging ? visible[press.index] : undefined

  return (
    <div ref={rootRef} style={{ width: CONTENT_BOX.width, height: CONTENT_BOX.height, position: 'relative' }} data-testid="spellbook-panel">
      <SpriteLayer width={CONTENT_BOX.width} height={CONTENT_BOX.height} sprites={sprites} />
      {filterView ? (
        <FilterMenu rows={filterRows} />
      ) : (
        <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}>
          {filtering && visible.length === 0 && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 12px', boxSizing: 'border-box', fontFamily: '"RuneScape Plain 12", sans-serif', fontSize: '16px', lineHeight: '13px', color: clientColors.primary, textShadow: '1px 1px 0 #000', textAlign: 'center', pointerEvents: 'none' }}>
              No spells match your selected filters.
            </div>
          )}
          {visible.map((e, i) => {
            const o = cellOrigin(i)
            const isHidden = hidden.has(e.icon)
            const isHome = e.icon === 'home_teleport'
            const utility = isHome || e.label === 'Mark of Darkness' || e.label === 'Death Charge'
            const castable = spellCastable(e, book, ctx)
            const cast = castable ? (isHome ? onHomeTeleport : undefined) : undefined
            const armable = !utility && castable && e.category === 'combat'
            const isArmed = armed === e.label
            const tip: TooltipContent =
              utility || armable ? { lines: [{ spans: [{ text: 'Cast ', color: '#00ff00' }, { text: isHome ? 'Teleport to Lobby' : e.label, color: clientColors.info }] }] } : spellTooltip(e.label)
            const menu = bindContextMenu(() => {
              if (reordering) return { entries: [...(cast ? [{ action: 'Cast', target: e.label, onClick: cast }] : []), { action: isHidden ? 'Unhide' : 'Hide', target: e.label, onClick: () => toggleSpellHidden(book, e.icon) }, { action: 'Cancel' }] }
              if (utility) return { entries: [{ action: isHome ? 'Teleport to Lobby' : 'Cast', target: e.label, ...(cast ? { onClick: cast } : {}) }, { action: 'Cancel' }] }
              if (armable) return { entries: [{ action: 'Cast', target: e.label, onClick: () => setArmedSpell(isArmed ? null : e.label) }, { action: 'Cancel' }] }
              return { entries: [{ action: 'Cast', target: e.label }, { action: 'Cancel' }] }
            })
            const onDown = (ev: ReactMouseEvent): void => {
              menu.onMouseDown(ev)
              if (ev.button !== 0) return
              if (reordering && !ev.altKey) {
                const rules = reorderPressRules({ shift: ev.shiftKey, ctrl: ev.ctrlKey }, anti)
                const p: Press = { index: i, startX: ev.clientX, startY: ev.clientY, startTime: ev.timeStamp, dragging: false, canDrag: rules.canDrag, thresholdMs: rules.thresholdMs }
                pressRef.current = p
                setPress(p)
                ev.preventDefault()
                startDrag(ev)
                return
              }
              if (!isHome && cast) cast()
              else if (armable) setArmedSpell(isArmed ? null : e.label)
            }
            return (
              <button
                key={e.icon}
                type="button"
                data-spell={e.icon}
                aria-label={e.label}
                onMouseDown={onDown}
                onContextMenu={menu.onContextMenu}
                onClick={!reordering && isHome && cast ? cast : undefined}
                {...(press?.dragging ? {} : bindTooltip(() => tip))}
                style={{ position: 'absolute', left: o.x, top: o.y, width: layout.slotSize, height: layout.slotSize, background: 'transparent', border: 'none', borderRadius: 0, boxShadow: isArmed ? `inset 0 0 0 1px ${clientColors.primary}` : 'none', cursor: 'default', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', outline: 'none' }}
              />
            )
          })}
        </div>
      )}
      {dragEntry && (
        <div ref={ghostRef} style={{ position: 'absolute', left: 0, top: 0, transform: 'translate3d(-100px, -100px, 0)', width: layout.slotSize, height: layout.slotSize, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none', zIndex: 100 }}>
          <PixelSprite src={spellIconUrl(book, dragEntry.icon, layout.slotSize, spellCastable(dragEntry, book, ctx))} alt={dragEntry.label} style={{ width: layout.slotSize, height: layout.slotSize, opacity: hidden.has(dragEntry.icon) ? 0.3 : 1, pointerEvents: 'none', imageRendering: 'pixelated' }} />
        </div>
      )}
      {press?.dragging && <div ref={targetRef} style={{ position: 'absolute', left: 0, top: 0, width: layout.slotSize, height: layout.slotSize, background: 'rgba(255, 255, 255, 0.12)', pointerEvents: 'none', display: 'none', zIndex: 50 }} />}
      {reordering && <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(255, 0, 0, 0.08)', pointerEvents: 'none', zIndex: 1 }} />}
      {filtering && !reordering && (
        <div style={{ position: 'absolute', bottom: 8, left: 0, right: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 2 }}>
          <SmallStoneButton active={modes.spellFilterViewOpen} onClick={() => panelModesStore.update({ spellFilterViewOpen: !modes.spellFilterViewOpen })}>
            Filters
          </SmallStoneButton>
        </div>
      )}
    </div>
  )
}
