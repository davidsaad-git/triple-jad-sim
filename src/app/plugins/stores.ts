import { Store, useStore } from '../GameStore'

/**
 * Plugins that keep their own localStorage key in scim.gg. Plugins stored in the main settings blob live in
 * src/app/settings/settings.ts instead.
 *
 * Shared between the renderer (world-space overlays), the input layer
 * (menus: tag / mark entries) and the Plugins panel (editing).
 */

function persistentStore<T extends object>(key: string, defaults: T): Store<T> & { patch(p: Partial<T>): void } {
  let initial = defaults
  try {
    const raw = globalThis.localStorage?.getItem(key)
    if (raw) initial = { ...defaults, ...(JSON.parse(raw) as Partial<T>) }
  } catch {
    initial = defaults
  }
  const store = new Store<T>(initial) as Store<T> & { patch(p: Partial<T>): void }
  store.patch = (p: Partial<T>) => {
    const next = { ...store.get(), ...p }
    store.set(next)
    try {
      globalThis.localStorage?.setItem(key, JSON.stringify(next))
    } catch {
      // storage unavailable
    }
  }
  return store
}

// --- Tile Indicators (`osrs-tile-indicators`, defaults) ---------

export interface TileIndicatorStyle {
  enabled: boolean
  color: string
  opacity: number
  /** Setting units; world width = width * 0.02 tiles. */
  width: number
  cornerOnly: boolean
}

export interface TileIndicatorsSettings {
  enabled: boolean
  config: {
    trueTile: TileIndicatorStyle
    hoverTile: TileIndicatorStyle
    destinationTile: TileIndicatorStyle
  }
}

export const DEFAULT_TILE_INDICATORS: TileIndicatorsSettings = {
  enabled: true,
  config: {
    trueTile: { enabled: true, color: '#0E8FDB', opacity: 0.84, width: 1.5, cornerOnly: false },
    hoverTile: { enabled: true, color: '#ED2420', opacity: 1, width: 1.5, cornerOnly: true },
    destinationTile: { enabled: true, color: '#14D60A', opacity: 1, width: 1.5, cornerOnly: true },
  },
}

export const tileIndicatorsStore = persistentStore('osrs-tile-indicators', DEFAULT_TILE_INDICATORS)

// --- NPC Highlights (`osrs-npc-highlights`) -------------------------------

export type NpcHighlightMode = 'trueTile' | 'swTile' | 'clickbox'

export interface NpcHighlight {
  npcName: string
  npcTypeId: number
  mode: NpcHighlightMode
  color: string
}

export interface NpcHighlightsSettings {
  highlights: NpcHighlight[]
  showHighlights: boolean
  lastColor: string
  colorMenuEntries: boolean
  /** Npc type ids already auto-seeded (so deleting a seeded highlight sticks). */
  seededBossDefaults: number[]
}

export const DEFAULT_NPC_HIGHLIGHTS: NpcHighlightsSettings = {
  highlights: [],
  showHighlights: true,
  lastColor: '#6fb0ae',
  colorMenuEntries: false,
  seededBossDefaults: [],
}

export const npcHighlightsStore = persistentStore('osrs-npc-highlights', DEFAULT_NPC_HIGHLIGHTS)

// --- Tile Markers (`osrs-tile-markers`) -----------------------------------

export interface TileMarker {
  x: number
  y: number
  color: string
  opacity: number
  fillOpacity?: number
  label?: string
}

export interface TileMarkersSettings {
  markersByEncounter: Record<string, TileMarker[]>
  showMarkers: boolean
  showLabels: boolean
  lastColor: string
  lastOpacity: number
  lastFillOpacity: number
  markerWidth: number
  /** presetId -> enabled override (per encounter). */
  presetOverrides: Record<string, boolean>
}

export const DEFAULT_TILE_MARKERS: TileMarkersSettings = {
  markersByEncounter: {},
  showMarkers: true,
  showLabels: true,
  lastColor: '#3BA9FF',
  lastOpacity: 1,
  lastFillOpacity: 0,
  markerWidth: 2,
  presetOverrides: {},
}

export const tileMarkersStore = persistentStore('osrs-tile-markers', DEFAULT_TILE_MARKERS)

// --- Line Markers (`osrs-line-markers`) -----------------------------------

export interface LineMarker {
  x: number
  y: number
  orientation: 'horizontal' | 'vertical'
  color: string
  opacity: number
  label?: string
}

export interface LineMarkersSettings {
  linesByEncounter: Record<string, LineMarker[]>
  showLines: boolean
  showLabels: boolean
  lastColor: string
  lastOpacity: number
  lineWidth: number
}

export const DEFAULT_LINE_MARKERS: LineMarkersSettings = {
  linesByEncounter: {},
  showLines: true,
  showLabels: true,
  lastColor: '#3BA9FF',
  lastOpacity: 1,
  lineWidth: 1,
}

export const lineMarkersStore = persistentStore('osrs-line-markers', DEFAULT_LINE_MARKERS)

// --- Boss Health Bar (`osrs-boss-health-bar`) -------------------------------

export interface WidgetPosition {
  x: number
  y: number
  anchorX: 'left' | 'right'
  anchorY: 'top' | 'bottom'
}

export interface BossHealthBarSettings {
  enabled: boolean
  showName: boolean
  showValues: boolean
  showPercentage: boolean
  position: WidgetPosition | null
}

export const bossHealthBarStore = persistentStore<BossHealthBarSettings>('osrs-boss-health-bar', {
  enabled: true,
  showName: true,
  showValues: true,
  showPercentage: true,
  position: null,
})

// --- XP Drops (`osrs-xp-drops`) ------------------------------------------

export interface XpDropsSettings {
  enabled: boolean
  showPredictedHit: boolean
  grouped: boolean
  showIcons: boolean
  /** px per second. */
  speed: number
  position: WidgetPosition | null
}

export const xpDropsStore = persistentStore<XpDropsSettings>('osrs-xp-drops', {
  enabled: true,
  showPredictedHit: true,
  grouped: true,
  showIcons: true,
  speed: 44,
  position: null,
})

// --- Anti Drag (`osrs-anti-drag`) ------------------------------------------

export interface AntiDragSettings {
  enabled: boolean
  requireShift: boolean
  ctrlDragImmediately: boolean
  /** ms */
  dragDelay: number
}

export const antiDragStore = persistentStore<AntiDragSettings>('osrs-anti-drag', {
  enabled: true,
  requireShift: false,
  ctrlDragImmediately: true,
  dragDelay: 300,
})

// --- Inventory Tags (`osrs-inventory-tags`) ---------------------------------

export interface InventoryTagsSettings {
  tags: Record<string, string>
  showTags: boolean
  lastColor: string
}

export const inventoryTagsStore = persistentStore<InventoryTagsSettings>('osrs-inventory-tags', {
  tags: {},
  showTags: true,
  lastColor: '#ff0000',
})

export function usePluginStore<T extends object, S>(store: Store<T>, selector: (s: T) => S): S {
  return useStore(store, selector)
}
