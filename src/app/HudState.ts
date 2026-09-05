import type { PrayerKey } from '../data/prayers'
import { Store } from './GameStore'

export type SideTab = 'combat' | 'stats' | 'inventory' | 'equipment' | 'prayer' | 'magic' | 'settings'

export interface InventoryItem {
  id: number
  name: string
  quantity: number
}

export interface HudSnapshot {
  tick: number
  hitpoints: number
  maxHitpoints: number
  prayerPoints: number
  maxPrayerPoints: number
  runEnergy: number
  running: boolean
  specialEnergy: number
  activePrayers: readonly PrayerKey[]
  overhead: PrayerKey | null
  activeTab: SideTab
  inventory: readonly (InventoryItem | null)[]
  equipment: Readonly<Record<string, InventoryItem | null>>
  /** Current encounter title / wave text for the HUD. */
  wave: number
  targetName: string | null
  targetHitpoints: number
  targetMaxHitpoints: number
  compass: number
}

export const initialHud: HudSnapshot = {
  tick: 0,
  hitpoints: 99,
  maxHitpoints: 99,
  prayerPoints: 99,
  maxPrayerPoints: 99,
  runEnergy: 100,
  running: true,
  specialEnergy: 100,
  activePrayers: [],
  overhead: null,
  activeTab: 'inventory',
  inventory: Array.from({ length: 28 }, () => null),
  equipment: {},
  wave: 0,
  targetName: null,
  targetHitpoints: 0,
  targetMaxHitpoints: 0,
  compass: 0,
}

export const hudStore = new Store<HudSnapshot>(initialHud)

/** Actions the UI can dispatch; the app wires these to the engine. */
export interface UiActions {
  togglePrayer(key: PrayerKey): void
  toggleQuickPrayers(): void
  toggleRun(): void
  setTab(tab: SideTab): void
  clickInventory(slot: number): void
  clickEquipment(slot: string): void
}

export const noopActions: UiActions = {
  togglePrayer: () => {},
  toggleQuickPrayers: () => {},
  toggleRun: () => {},
  setTab: (tab) => hudStore.update({ activeTab: tab }),
  clickInventory: () => {},
  clickEquipment: () => {},
}
