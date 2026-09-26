/**
 * Session and persisted state of the in-game client chrome that is not part
 * of the global settings blob:
 * - the active side-panel tab (session only, scim);
 * - quick-prayer setup mode (session only);
 * - `osrs-panel-filters` (prayer/spellbook hidden, order, filter options and
 *   the quick-prayer selections; scim);
 * - a hook point other modules use to draw over the prayer orb.
 */
import type { ReactNode } from 'react'
import { Store, useStore } from '../../app/GameStore'
import type { PrayerId } from '../../sim/api'
import type { GamePanelTabId } from './layout'

// ---------------------------------------------------------------------------
// Active tab
// ---------------------------------------------------------------------------

export const DEFAULT_TAB: GamePanelTabId = 'inventory'
export const gamePanelTabStore = new Store<{ tab: GamePanelTabId }>({ tab: DEFAULT_TAB })

export function selectGamePanelTab(tab: GamePanelTabId): void {
  if (gamePanelTabStore.get().tab !== tab) gamePanelTabStore.set({ tab })
}

export function useGamePanelTab(): GamePanelTabId {
  return useStore(gamePanelTabStore, (s) => s.tab)
}

/** Fired when the tab changes. */
export const TAB_CHANGED_EVENT = 'tutorial:tab-changed'

// ---------------------------------------------------------------------------
// Quick-prayer setup
// ---------------------------------------------------------------------------

export const quickPrayerSetupStore = new Store<{ open: boolean }>({ open: false })

export function openQuickPrayerSetup(): void {
  quickPrayerSetupStore.set({ open: true })
  selectGamePanelTab('prayer')
}

export function closeQuickPrayerSetup(): void {
  if (quickPrayerSetupStore.get().open) quickPrayerSetupStore.set({ open: false })
}

// ---------------------------------------------------------------------------
// Panel filters (`osrs-panel-filters`)
// ---------------------------------------------------------------------------

export interface PrayerFilterOptions {
  showLowerTiers: boolean
  showTieredOverMultiskill: boolean
  showRapidHealing: boolean
  showLackLevel: boolean
  showLackRequirements: boolean
}

export interface SpellFilterOptions {
  showLackLevel: boolean
  showLackRunes: boolean
  showLackRequirements: boolean
  showUnsimulated: boolean
  iconResizing: boolean
}

export type SpellCategory = 'combat' | 'teleport' | 'utility'

export const DEFAULT_PRAYER_FILTERS: PrayerFilterOptions = {
  showLowerTiers: true,
  showTieredOverMultiskill: true,
  showRapidHealing: true,
  showLackLevel: true,
  showLackRequirements: true,
}

export const DEFAULT_SPELL_FILTERS: SpellFilterOptions = {
  showLackLevel: true,
  showLackRunes: true,
  showLackRequirements: true,
  showUnsimulated: true,
  iconResizing: true,
}

export const SPELL_CATEGORIES: readonly SpellCategory[] = ['combat', 'teleport', 'utility']

export interface PanelFilters {
  prayer: {
    hidden: string[]
    order: string[] | null
    filterOptions: PrayerFilterOptions
    quickPrayerSelections: PrayerId[]
  }
  spellbook: {
    hidden: Record<string, string[]>
    order: Record<string, string[] | null>
    activeCategories: Record<string, SpellCategory[]>
    filterOptions: Record<string, SpellFilterOptions>
  }
}

const FILTERS_KEY = 'osrs-panel-filters'

function obj(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}
function strings(v: unknown): string[] | null {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null
}
function bools<T extends object>(v: unknown, defaults: T): T {
  const o = obj(v)
  const out = { ...defaults } as Record<string, unknown>
  for (const k of Object.keys(defaults)) if (typeof o[k] === 'boolean') out[k] = o[k]
  return out as T
}

export function parsePanelFilters(raw: unknown): PanelFilters {
  const root = obj(raw)
  const p = obj(root.prayer)
  const s = obj(root.spellbook)
  const hidden: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(obj(s.hidden))) {
    const list = strings(v)
    if (list) hidden[k] = list
  }
  const order: Record<string, string[] | null> = {}
  for (const [k, v] of Object.entries(obj(s.order))) order[k] = v === null ? null : strings(v)
  const activeCategories: Record<string, SpellCategory[]> = {}
  for (const [k, v] of Object.entries(obj(s.activeCategories))) {
    if (!Array.isArray(v)) continue
    activeCategories[k] = [...new Set(v.filter((c): c is SpellCategory => SPELL_CATEGORIES.includes(c as SpellCategory)))]
  }
  const filterOptions: Record<string, SpellFilterOptions> = {}
  for (const [k, v] of Object.entries(obj(s.filterOptions))) if (typeof v === 'object' && v && !Array.isArray(v)) filterOptions[k] = bools(v, DEFAULT_SPELL_FILTERS)
  return {
    prayer: {
      hidden: strings(p.hidden) ?? [],
      order: strings(p.order),
      filterOptions: bools(p.filterOptions, DEFAULT_PRAYER_FILTERS),
      quickPrayerSelections: (strings(p.quickPrayerSelections) ?? []) as PrayerId[],
    },
    spellbook: { hidden, order, activeCategories, filterOptions },
  }
}

function loadFilters(): PanelFilters {
  try {
    const raw = globalThis.localStorage?.getItem(FILTERS_KEY)
    return parsePanelFilters(raw ? JSON.parse(raw) : null)
  } catch {
    return parsePanelFilters(null)
  }
}

class PanelFiltersStore extends Store<PanelFilters> {
  update2(fn: (f: PanelFilters) => PanelFilters): void {
    const next = fn(this.get())
    this.set(next)
    try {
      globalThis.localStorage?.setItem(FILTERS_KEY, JSON.stringify(next))
    } catch {
      // storage unavailable
    }
  }
}

export const panelFiltersStore = new PanelFiltersStore(loadFilters())

export function usePanelFilters(): PanelFilters {
  return useStore(panelFiltersStore, (s) => s)
}

/** Toggle a quick-prayer selection; protection/offensive replace their group. */
export function toggleQuickPrayerSelection(prayer: PrayerId, groupOf: (p: PrayerId) => 'protection' | 'offensive' | 'independent'): void {
  panelFiltersStore.update2((f) => {
    const cur = f.prayer.quickPrayerSelections
    if (cur.includes(prayer)) return { ...f, prayer: { ...f.prayer, quickPrayerSelections: cur.filter((p) => p !== prayer) } }
    const g = groupOf(prayer)
    const kept = g === 'protection' || g === 'offensive' ? cur.filter((p) => groupOf(p) !== g) : cur
    return { ...f, prayer: { ...f.prayer, quickPrayerSelections: [...kept, prayer] } }
  })
}

export function togglePrayerHidden(icon: string): void {
  panelFiltersStore.update2((f) => ({ ...f, prayer: { ...f.prayer, hidden: f.prayer.hidden.includes(icon) ? f.prayer.hidden.filter((h) => h !== icon) : [...f.prayer.hidden, icon] } }))
}

export function setPrayerOrder(order: string[]): void {
  panelFiltersStore.update2((f) => ({ ...f, prayer: { ...f.prayer, order } }))
}

export function togglePrayerFilterOption(key: keyof PrayerFilterOptions): void {
  panelFiltersStore.update2((f) => ({ ...f, prayer: { ...f.prayer, filterOptions: { ...f.prayer.filterOptions, [key]: !f.prayer.filterOptions[key] } } }))
}

export function toggleSpellHidden(book: string, icon: string): void {
  panelFiltersStore.update2((f) => {
    const cur = f.spellbook.hidden[book] ?? []
    return { ...f, spellbook: { ...f.spellbook, hidden: { ...f.spellbook.hidden, [book]: cur.includes(icon) ? cur.filter((h) => h !== icon) : [...cur, icon] } } }
  })
}

export function setSpellOrder(book: string, order: string[]): void {
  panelFiltersStore.update2((f) => ({ ...f, spellbook: { ...f.spellbook, order: { ...f.spellbook.order, [book]: order } } }))
}

export function toggleSpellCategory(book: string, cat: SpellCategory): void {
  panelFiltersStore.update2((f) => {
    const cur = f.spellbook.activeCategories.global ?? f.spellbook.activeCategories[book] ?? [...SPELL_CATEGORIES]
    const next = cur.includes(cat) ? cur.filter((c) => c !== cat) : [...cur, cat]
    return { ...f, spellbook: { ...f.spellbook, activeCategories: { ...f.spellbook.activeCategories, global: next } } }
  })
}

export function toggleSpellFilterOption(book: string, key: keyof SpellFilterOptions): void {
  panelFiltersStore.update2((f) => {
    const cur = f.spellbook.filterOptions.global ?? f.spellbook.filterOptions[book] ?? DEFAULT_SPELL_FILTERS
    return { ...f, spellbook: { ...f.spellbook, filterOptions: { ...f.spellbook.filterOptions, global: { ...cur, [key]: !cur[key] } } } }
  })
}

/** Session-only reorder/filter modes toggled from the tab right-click menus. */
export const panelModesStore = new Store<{ prayerReordering: boolean; prayerFiltering: boolean; spellReordering: boolean; spellFiltering: boolean; prayerFilterViewOpen: boolean; spellFilterViewOpen: boolean }>({
  prayerReordering: false,
  prayerFiltering: false,
  spellReordering: false,
  spellFiltering: false,
  prayerFilterViewOpen: false,
  spellFilterViewOpen: false,
})

export function usePanelModes() {
  return useStore(panelModesStore, (s) => s)
}

// ---------------------------------------------------------------------------
// Prayer orb overlay hook (the Prayer plugin's flick sweep)
// ---------------------------------------------------------------------------

export type PrayerOrbOverlay = () => ReactNode
export const prayerOrbOverlayStore = new Store<{ render: PrayerOrbOverlay | null }>({ render: null })

/**
 * Replace the prayer-orb flick sweep with a custom renderer (drawn inside the
 * orb's 26x26 fill disc at (27,4)); pass null to restore the built-in sweep.
 */
export function setPrayerOrbOverlay(render: PrayerOrbOverlay | null): void {
  prayerOrbOverlayStore.set({ render })
}
