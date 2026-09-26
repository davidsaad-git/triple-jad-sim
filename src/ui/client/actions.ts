/**
 * Every game action the chrome performs, all through the runtime (inputs get
 * scim's input lag via `dispatch`; drag-swaps are immediate). Labels feed the
 * Prayer Flick Helper (`prayer:on|off`, `quick-prayer:on|off`).
 */
import type { SimRuntime } from '../../app/runtime/types'
import type { EquipSlot, PrayerId } from '../../sim/api'
import type { ClientPresentation } from './presentation'
import { PRAYER_GROUPS } from './presentation'

export function togglePrayer(runtime: SimRuntime, presentation: ClientPresentation, prayer: PrayerId, instantPrayer: boolean): void {
  const state = runtime.getSnapshot().state
  const { activates, retire } = presentation.pressPrayer(state, prayer, instantPrayer)
  const group = PRAYER_GROUPS[prayer]
  runtime.dispatch(
    (e) => {
      if (group === 'protection') e.queueProtectionPrayer(prayer)
      else if (group === 'offensive') e.queueOffensivePrayer(prayer)
      else e.queueIndependentPrayer(prayer)
      retire(e.getState().currentTick)
    },
    activates ? 'prayer:on' : 'prayer:off',
  )
}

export function toggleQuickPrayers(runtime: SimRuntime, selections: readonly PrayerId[]): void {
  const state = runtime.getSnapshot().state
  const turningOn = !state.quickPrayersActive
  const list = [...selections]
  runtime.dispatch((e) => e.queueQuickPrayerToggle(list), turningOn ? 'quick-prayer:on' : 'quick-prayer:off')
}

export function toggleRun(runtime: SimRuntime, presentation: ClientPresentation): void {
  const shown = presentation.run.get() ?? runtime.getSnapshot().state.isRunEnabled
  const retire = presentation.run.show(!shown)
  runtime.dispatch((e) => {
    e.queueRunToggle()
    retire()
  }, 'run')
}

export function toggleSpecialAttack(runtime: SimRuntime, presentation: ClientPresentation): void {
  const retire = presentation.pressSpecial()
  runtime.dispatch((e) => {
    e.queueSpecialAttackToggle()
    retire()
  }, 'special-attack')
}

export function selectAttackStyle(runtime: SimRuntime, presentation: ClientPresentation, index: number): void {
  const retire = presentation.attackStyle.show(index)
  runtime.dispatch((e) => {
    e.setSelectedAttackStyleIndex(index)
    retire()
  }, 'attack-style')
}

export function selectSpell(runtime: SimRuntime, presentation: ClientPresentation, spell: string | null): void {
  const retire = presentation.selectedSpell.show(spell)
  runtime.dispatch((e) => {
    e.setSelectedSpell(spell)
    retire()
  }, 'selected-spell')
}

export function equipFromInventory(runtime: SimRuntime, index: number, itemId: number, slot: EquipSlot | 'ammo'): void {
  runtime.dispatch((e) => {
    if (slot === 'ammo') e.queueEquipAmmoFromInventory(index, itemId)
    else e.queueEquipFromInventory(index, itemId, slot)
  }, 'equip')
}

export function activateItem(runtime: SimRuntime, index: number, option: 'default' | 'guzzle' = 'default'): void {
  runtime.dispatch((e) => e.queueItemAction(index, option), 'use-item')
}

export function dropItem(runtime: SimRuntime, index: number): void {
  runtime.dispatch((e) => e.queueDropItem(index), 'drop-item')
}

export function swapInventorySlots(runtime: SimRuntime, from: number, to: number): void {
  runtime.dispatchImmediate((e) => e.swapInventorySlots(from, to), 'swap-inventory')
}

export function unequipSlot(runtime: SimRuntime, slot: EquipSlot): void {
  runtime.dispatch((e) => e.queueUnequip(slot), 'unequip')
}

export function unequipAmmo(runtime: SimRuntime): void {
  runtime.dispatch((e) => e.queueUnequipAmmo(), 'unequip')
}
