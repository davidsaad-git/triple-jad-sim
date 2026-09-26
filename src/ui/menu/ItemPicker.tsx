/**
 * Loadout slot item picker:
 * portal popover anchored to the clicked slot, search box, category filters
 * for the inventory catalog, max 40 results, unverified items hidden unless
 * "Show unverified items" (persisted in `osrs-slot-picker-show-unverified`).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Checkbox, InfoHint } from './controls'
import { itemIconUrl, type CatalogItem, type ItemCategory } from './itemCatalog'
import { readJson, writeJson } from './storage'

export const SHOW_UNVERIFIED_KEY = 'osrs-slot-picker-show-unverified'
const MAX_RESULTS = 40
const EDGE = 4
const GAP = 4


const FILTERS: { key: 'all' | ItemCategory; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'food', label: 'Food' },
  { key: 'potions', label: 'Potions' },
  { key: 'runes', label: 'Runes' },
  { key: 'gear', label: 'Gear' },
]

/** scim: pinned first with no search and "All". */
const PINNED = [13441, 3144, 6685, 3024, 10925, 12695, 27641, 27281]

export function ItemIcon({ id, style, className }: { id: number; style?: CSSProperties; className?: string }) {
  const [hidden, setHidden] = useState(false)
  useEffect(() => setHidden(false), [id])
  return (
    <img
      crossOrigin="anonymous"
      className={className}
      src={itemIconUrl(id)}
      alt=""
      draggable={false}
      style={{ maxWidth: 36, maxHeight: 32, imageRendering: 'pixelated', pointerEvents: 'none', ...(hidden ? { visibility: 'hidden' } : {}), ...style }}
      onError={() => setHidden(true)}
    />
  )
}

/** Sorting and filtering of the picker list (pure, tested). */
export function filterCatalog(
  catalog: readonly CatalogItem[],
  query: string,
  category: 'all' | ItemCategory,
  showUnverified: boolean,
  hasCategories: boolean,
): { shown: CatalogItem[]; total: number; hiddenUnverified: number } {
  const q = query.trim().toLowerCase()
  const base = showUnverified ? catalog : catalog.filter((i) => i.verified)
  const matches = base.filter((i) => (category === 'all' || i.category === category) && i.name.toLowerCase().includes(q))
  if (hasCategories) {
    matches.sort((a, b) => {
      if (q === '' && category === 'all') {
        const pa = PINNED.indexOf(a.id)
        const pb = PINNED.indexOf(b.id)
        const d = (pa === -1 ? PINNED.length : pa) - (pb === -1 ? PINNED.length : pb)
        if (d !== 0) return d
      }
      if (a.category === 'potions' && b.category === 'potions') {
        const ma = /^(.*)\((\d+)\)$/.exec(a.name)
        const mb = /^(.*)\((\d+)\)$/.exec(b.name)
        if (ma && mb && ma[1] === mb[1]) return Number(mb[2]) - Number(ma[2])
      }
      return a.name.localeCompare(b.name)
    })
  }
  const hiddenUnverified =
    showUnverified || q === '' || matches.length > 0 ? 0 : catalog.filter((i) => !i.verified && (category === 'all' || i.category === category) && i.name.toLowerCase().includes(q)).length
  return { shown: matches.slice(0, MAX_RESULTS), total: matches.length, hiddenUnverified }
}

export interface ItemPickerProps {
  anchor: HTMLElement
  dialogLabel: string
  searchLabel: string
  listLabel: string
  catalogNoun: string
  catalog: readonly CatalogItem[]
  currentItemId: number | undefined
  currentName: string | undefined
  emptyIcon?: ReactNode
  /** Inventory catalogs get the category filters. */
  withCategories?: boolean
  onChoose: (id: number | undefined) => void
  /** `refocus` = return focus to the anchor. */
  onDismiss: (refocus: boolean) => void
}

export function ItemPicker({ anchor, dialogLabel, searchLabel, listLabel, catalogNoun, catalog, currentItemId, currentName, emptyIcon, withCategories = false, onChoose, onDismiss }: ItemPickerProps) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<'all' | ItemCategory>('all')
  const [active, setActive] = useState<number | null>(null)
  const [showUnverified, setShowUnverified] = useState(() => readJson(SHOW_UNVERIFIED_KEY) === true)
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const scopeRef = useRef<HTMLDivElement>(null)
  const supportRef = useRef<HTMLSpanElement>(null)
  const { shown, total, hiddenUnverified } = useMemo(() => filterCatalog(catalog, query, category, showUnverified, withCategories), [catalog, query, category, showUnverified, withCategories])
  const anyUnverified = useMemo(() => catalog.some((i) => !i.verified), [catalog])
  const current = currentItemId === undefined ? undefined : catalog.find((i) => i.id === currentItemId)
  const q = query.trim()
  const activeIndex = active === null ? (q !== '' && shown.length > 0 ? 0 : -1) : Math.min(active, shown.length - 1)

  useEffect(() => searchRef.current?.focus(), [])
  useEffect(() => {
    if (activeIndex < 0) return
    listRef.current?.querySelectorAll('[role="option"]')[activeIndex]?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex])
  // Placement: below the anchor if it fits, else above; clamped to the window.
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const place = () => {
      const a = anchor.getBoundingClientRect()
      const w = el.offsetWidth
      const h = el.offsetHeight
      const below = a.bottom + GAP
      const above = a.top - GAP - h
      const fitsBelow = below + h + EDGE <= window.innerHeight
      const fitsAbove = above >= EDGE
      const side = fitsBelow || !fitsAbove ? 'below' : 'above'
      const top = Math.max(EDGE, Math.min(side === 'below' ? below : above, window.innerHeight - h - EDGE))
      const left = Math.max(EDGE, Math.min(a.left, window.innerWidth - w - EDGE))
      el.style.left = `${left}px`
      el.style.top = `${top}px`
      el.style.transformOrigin = side === 'below' ? 'top left' : 'bottom left'
      el.dataset.placement = side
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchor, shown.length, showUnverified, query, category])
  useEffect(() => {
    const h = (e: MouseEvent) => {
      const t = e.target
      if (t instanceof Node && !rootRef.current?.contains(t) && !anchor.contains(t)) onDismiss(false)
    }
    window.addEventListener('mousedown', h)
    return () => window.removeEventListener('mousedown', h)
  }, [anchor, onDismiss])

  const move = (d: 1 | -1) => {
    if (shown.length === 0) return
    setActive((prev) => {
      const cur = prev ?? activeIndex
      return cur === -1 ? (d === 1 ? 0 : shown.length - 1) : (cur + d + shown.length) % shown.length
    })
  }
  const choose = (id: number | undefined) => {
    onChoose(id)
    onDismiss(true)
  }

  return createPortal(
    <div
      ref={rootRef}
      className="slot-picker"
      role="dialog"
      aria-label={dialogLabel}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onDismiss(true)
        } else if (e.key === 'ArrowDown') {
          e.preventDefault()
          move(1)
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          move(-1)
        } else if (e.key === 'Enter' && e.target === searchRef.current) {
          const item = activeIndex === -1 ? undefined : shown[activeIndex]
          if (item) {
            e.preventDefault()
            choose(item.id)
          }
        }
      }}
    >
      <div className="slot-picker__heading">
        <span>{dialogLabel}</span>
        <button type="button" className="slot-picker__close" aria-label="Close item picker" onClick={() => onDismiss(true)}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 2L10 10M10 2L2 10" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
      </div>
      <fieldset className="slot-picker__current" aria-label="Current item">
        <span className="slot-picker__current-icon" aria-hidden="true">
          {currentItemId === undefined ? emptyIcon : <ItemIcon id={currentItemId} />}
        </span>
        <span className="slot-picker__current-name">
          <span className="slot-picker__current-label">Current{current?.verified === false ? ' / Unverified' : ''}</span>
          {currentItemId === undefined ? 'Empty' : (current?.name ?? currentName ?? 'Unsupported item')}
        </span>
        <button type="button" className="slot-picker__clear" aria-label="Clear slot" disabled={currentItemId === undefined} onClick={() => choose(undefined)}>
          Clear
        </button>
      </fieldset>
      <input
        ref={searchRef}
        className="slot-picker__search"
        type="text"
        value={query}
        placeholder={withCategories ? (category === 'all' ? 'Search all inventory items' : `Search ${category}`) : 'Search items'}
        autoComplete="off"
        spellCheck={false}
        aria-label={searchLabel}
        role="combobox"
        aria-expanded={true}
        aria-autocomplete="list"
        onChange={(e) => {
          setQuery(e.currentTarget.value)
          setActive(null)
        }}
      />
      {withCategories && (
        <fieldset className="slot-picker__filters" aria-label="Item categories">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={category === f.key}
              onClick={() => {
                setCategory(f.key)
                setActive(null)
              }}
            >
              {f.label}
            </button>
          ))}
        </fieldset>
      )}
      <div className="slot-picker__results">
        <div className="slot-picker__list" role="listbox" aria-label={listLabel} ref={listRef}>
          {shown.map((item, i) => {
            const selected = item.id === currentItemId
            return (
              <button
                key={item.id}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={selected}
                className={`slot-picker__option${selected ? ' slot-picker__option--selected' : ''}${i === activeIndex ? ' slot-picker__option--active' : ''}`}
                onClick={() => choose(item.id)}
              >
                <span className="slot-picker__icon" aria-hidden="true">
                  <ItemIcon id={item.id} />
                </span>
                <span className="slot-picker__name">
                  {item.name}
                  {!item.verified && <span className="slot-picker__unverified">Unverified</span>}
                </span>
              </button>
            )
          })}
        </div>
      </div>
      {shown.length === 0 && <p className="slot-picker__note">{`No supported ${catalogNoun} matches "${q}".`}</p>}
      {hiddenUnverified > 0 && <p className="slot-picker__note">{`${hiddenUnverified} unverified ${hiddenUnverified === 1 ? 'match' : 'matches'} hidden.`}</p>}
      {total > shown.length && <p className="slot-picker__note">{`${shown.length} of ${total.toLocaleString()} shown. Type to narrow.`}</p>}
      <div className="slot-picker__footer">
        {anyUnverified && (
          <div className="slot-picker__scope info-hint-region" ref={scopeRef}>
            <Checkbox
              checked={showUnverified}
              onChange={(v) => {
                setShowUnverified(v)
                writeJson(SHOW_UNVERIFIED_KEY, v)
              }}
              label="Show unverified items"
            />
            <InfoHint
              label="Show unverified items"
              hoverRegionRef={scopeRef}
              placement="above"
              cardClassName="slot-picker-support-card"
              text="Unverified items are not fully implemented. We have not checked them end to end, so their animations, sounds, projectiles or special attacks may be missing or wrong."
            />
          </div>
        )}
        <span className="slot-picker__support info-hint-region" ref={supportRef}>
          Item support
          <InfoHint label="Item support" hoverRegionRef={supportRef} placement="above" cardClassName="slot-picker-support-card" text="Stats and most set effects are simulated. Many item effects are not." />
        </span>
      </div>
    </div>,
    document.body,
  )
}
