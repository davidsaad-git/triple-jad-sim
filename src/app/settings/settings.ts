import { Store, useStore } from '../GameStore'

/**
 * The global settings blob, mirroring scim.gg's
 * localStorage object (despite the name it holds every global setting).
 * Defaults are scim's (observed live 2026-09-26, see
 *).
 *
 * Plugins with their own storage keys (boss health bar, XP drops, NPC
 * highlights, tile markers, ...) keep them in their own modules.
 */

export type ClientLayoutMode = 'fixed' | 'classic' | 'modern'
export type ResourcePackId = 'pack-vanilla' | 'pack-browntown' | 'pack-toblite' | 'pack-duckscape'
export type InfoboxPinTarget = 'hud' | 'inventory' | 'free'
export type Anchor = 'left' | 'right' | 'top' | 'bottom'

export interface PanelPosition {
  x: number
  y: number
  anchorX: 'left' | 'right'
  anchorY: 'top' | 'bottom'
}

export interface GameResolution {
  /** scim: 'fit' follows the window; 'fixed' uses width/height (presetId 'fit' | preset id | 'custom'). */
  mode: 'fit' | 'fixed'
  width: number
  height: number
  presetId: string
}

export interface Settings {
  // Game > Simulation
  speedMultiplier: 0.5 | 1 | 2
  /** Never persisted; always true after a reload. */
  autoAdvance: boolean
  pauseWhenUnfocused: boolean
  inputLagMs: number
  // Display
  rendererType: 'webgl' | 'canvas2d'
  smoothTerrain: boolean
  brightness: number
  contrast: number
  saturation: number
  renderScaleHardware: number
  renderScaleSoftware: number
  fpsCap: number
  showFps: boolean
  // Interface
  clientLayoutMode: ClientLayoutMode
  gameResolution: GameResolution
  fixedLayoutScale: 'fit' | number
  fixedChatboxVisible: boolean
  activeResourcePack: ResourcePackId
  infoboxPinTarget: InfoboxPinTarget
  infoboxPosition: PanelPosition | null
  infoboxTextOutlineEnabled: boolean
  infoboxTextOutlineColor: string
  showShortcutHints: boolean
  disabledShortcutHints: string[]
  uiScale: number
  gamePanelPosition: PanelPosition
  minimapPosition: PanelPosition
  compactOrbsPosition: PanelPosition
  // Audio (in-game Settings tab)
  masterVolume: number
  sfxVolume: number
  areaVolume: number
  muteWhenUnfocused: boolean
  // Combat tab memory
  attackStylePerCategory: Record<string, number>
  // Encounter memory
  mechanicsConfigPerEncounter: Record<string, Record<string, boolean | string | number>>
  startingHpPerEncounter: Record<string, number>
  // Plugins stored in the main blob
  showTickCounter: boolean
  showTickCounterOverhead: boolean
  tickCounterAbovePrayerIcon: boolean
  showTickCounterInfobox: boolean
  tickCounterMax: number
  tickCounterFontSize: number
  tickCounterColors: Record<string, string>
  tickCounterOffsetX: number
  tickCounterOffsetY: number
  showCoordinates: boolean
  showDebugGrid: boolean
  showNpcClickbox: boolean
  showTickTiming: boolean
  showDetailedDps: boolean
  dpsOverlayShowDetails: boolean
  detailedDpsPosition: PanelPosition | null
  showSoundDebug: boolean
  showModifierKeys: boolean
  cameraPluginEnabled: boolean
  cameraVerticalCamera: boolean
  cameraInvertYaw: boolean
  cameraInvertPitch: boolean
  cameraInnerZoomLevel: number
  cameraOuterZoomLimit: number
  cameraSpeed: number
  cameraDragSpeed: number
  cameraRightClickMovesCamera: boolean
  cameraZoomIncrement: number
  attackTimerMetronomeEnabled: boolean
  attackTimerMetronomeShowBar: boolean
  attackTimerMetronomeShowTicks: boolean
  attackTimerMetronomeFontSize: number
  attackTimerMetronomeAbovePrayerIcon: boolean
  attackTimerMetronomeOffsetX: number
  attackTimerMetronomeOffsetY: number
  npcAttackTimerMetronomeEnabled: boolean
  customMenuSwapsEnabled: boolean
  customMenuSwaps: string
  instantInventoryEnabled: boolean
  instantPrayerEnabled: boolean
  prayerEnabled: boolean
  prayerFlickOrbEnabled: boolean
  prayerFlickAlwaysOn: boolean
  prayerFlickEnabled: boolean
  prayerFlickPosition: PanelPosition | null
  statusBarsEnabled: boolean
  statusBarsShowValues: boolean
  compactOrbsEnabled: boolean
  compactOrbsLayout: 'vertical' | 'horizontal' | 'horizontal-wide'
  compactOrbsOrder: string[]
  hasCompletedTutorial: boolean
  hideHardwareAccelWarning: boolean
  hideMobileWarning: boolean
  /** Anything else a module stores in the blob (kept verbatim). */
  [extra: string]: unknown
}

export const DEFAULT_SETTINGS: Settings = {
  speedMultiplier: 1,
  autoAdvance: true,
  pauseWhenUnfocused: true,
  inputLagMs: 20,
  rendererType: 'webgl',
  smoothTerrain: false,
  brightness: 0.6,
  contrast: 1,
  saturation: 1,
  renderScaleHardware: 1,
  renderScaleSoftware: 0.5,
  fpsCap: 144,
  showFps: true,
  clientLayoutMode: 'modern',
  gameResolution: { mode: 'fit', width: 765, height: 503, presetId: 'fit' },
  fixedLayoutScale: 'fit',
  fixedChatboxVisible: true,
  activeResourcePack: 'pack-browntown',
  infoboxPinTarget: 'inventory',
  infoboxPosition: null,
  infoboxTextOutlineEnabled: true,
  infoboxTextOutlineColor: '#000000',
  showShortcutHints: true,
  disabledShortcutHints: [],
  uiScale: 1,
  gamePanelPosition: { x: 0, y: 0, anchorX: 'right', anchorY: 'bottom' },
  minimapPosition: { x: 0, y: 0, anchorX: 'right', anchorY: 'top' },
  compactOrbsPosition: { x: 0, y: 60, anchorX: 'right', anchorY: 'top' },
  masterVolume: 0.1,
  sfxVolume: 0.1,
  areaVolume: 0.1,
  muteWhenUnfocused: true,
  attackStylePerCategory: {},
  mechanicsConfigPerEncounter: {},
  startingHpPerEncounter: {},
  showTickCounter: true,
  showTickCounterOverhead: false,
  tickCounterAbovePrayerIcon: false,
  showTickCounterInfobox: true,
  tickCounterMax: 4,
  tickCounterFontSize: 24,
  tickCounterColors: {},
  tickCounterOffsetX: 0,
  tickCounterOffsetY: 0,
  showCoordinates: false,
  showDebugGrid: false,
  showNpcClickbox: false,
  showTickTiming: false,
  showDetailedDps: false,
  dpsOverlayShowDetails: false,
  detailedDpsPosition: null,
  showSoundDebug: false,
  showModifierKeys: false,
  cameraPluginEnabled: true,
  cameraVerticalCamera: false,
  cameraInvertYaw: false,
  cameraInvertPitch: false,
  cameraInnerZoomLevel: 0,
  cameraOuterZoomLimit: 0,
  cameraSpeed: 1,
  cameraDragSpeed: 1,
  cameraRightClickMovesCamera: false,
  cameraZoomIncrement: 25,
  attackTimerMetronomeEnabled: false,
  attackTimerMetronomeShowBar: true,
  attackTimerMetronomeShowTicks: false,
  attackTimerMetronomeFontSize: 24,
  attackTimerMetronomeAbovePrayerIcon: false,
  attackTimerMetronomeOffsetX: 0,
  attackTimerMetronomeOffsetY: 0,
  npcAttackTimerMetronomeEnabled: false,
  customMenuSwapsEnabled: false,
  customMenuSwaps: '',
  instantInventoryEnabled: false,
  instantPrayerEnabled: true,
  prayerEnabled: true,
  prayerFlickOrbEnabled: true,
  prayerFlickAlwaysOn: false,
  prayerFlickEnabled: false,
  prayerFlickPosition: null,
  statusBarsEnabled: false,
  statusBarsShowValues: true,
  compactOrbsEnabled: false,
  compactOrbsLayout: 'vertical',
  compactOrbsOrder: ['hitpoints', 'prayer', 'run', 'special'],
  hasCompletedTutorial: false,
  hideHardwareAccelWarning: false,
  hideMobileWarning: false,
}

export const SETTINGS_STORAGE_KEY = 'osrs-yama-settings'

/** Keys that are never persisted. */
const TRANSIENT_KEYS = new Set<string>(['autoAdvance'])

function loadSettings(): Settings {
  let stored: Record<string, unknown> = {}
  try {
    const raw = globalThis.localStorage?.getItem(SETTINGS_STORAGE_KEY)
    if (raw) stored = JSON.parse(raw) as Record<string, unknown>
  } catch {
    stored = {}
  }
  const merged: Settings = { ...DEFAULT_SETTINGS, ...stored }
  merged.autoAdvance = true
  return merged
}

function saveSettings(s: Settings): void {
  try {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(s)) if (!TRANSIENT_KEYS.has(k)) out[k] = v
    globalThis.localStorage?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(out))
  } catch {
    // storage unavailable (private mode, quota): settings stay in memory
  }
}

class SettingsStore extends Store<Settings> {
  /** Merge a patch, notify subscribers and persist. */
  patch(patch: Partial<Settings>): void {
    const next = { ...this.get(), ...patch }
    this.set(next)
    saveSettings(next)
  }

  resetKey<K extends keyof Settings>(key: K): void {
    this.patch({ [key]: DEFAULT_SETTINGS[key] } as Partial<Settings>)
  }
}

export const settingsStore = new SettingsStore(loadSettings())

export function useSetting<K extends keyof Settings>(key: K): Settings[K] {
  return useStore(settingsStore, (s) => s[key])
}

export function useSettings<S>(selector: (s: Settings) => S): S {
  return useStore(settingsStore, selector)
}
