/**
 * Single import point for the SIM data the menus need (BUILD_PLAN "Cross-module
 * entry points"): loadout presets, the triple-Jad controls and item tables.
 * The UI-side types are structural supersets of SIM's (choices / dependsOn /
 * bossHpPresets are optional extras the editor understands).
 */
import type { EncounterCommand, Loadout, MechanicsConfig, SkillName, Spellbook } from '../../sim/api'
import { TRIPLE_JAD_CONTROLS as SIM_CONTROLS } from '../../sim/encounters/tripleJad/controls'
import { DEFAULT_PRESET_ID as SIM_DEFAULT_PRESET_ID, LOADOUT_PRESETS as SIM_PRESETS } from '../../sim/loadouts/presets'
import { SPELLS } from '../../sim/combat/spells'
import { WEAPON_CATEGORY_BY_ITEM } from '../../sim/combat/weaponCategories'
import { CONSUMABLE_NAMES, CONSUMABLES } from '../../sim/items/consumables'

export interface LoadoutPreset {
  id: string
  name: string
  loadout: Loadout
  requirements: Partial<Record<SkillName, number>>
  isFallback?: boolean
}

export interface MechanicsChoice {
  value: string | number | boolean
  label: string
  /** scim choice icon id (`left` / `right` arrows, ...). */
  icon?: string
}

/** One Configure / Practice row (scim toggle definitions + `um`). */
export interface MechanicsToggleDef {
  key: string
  label: string
  /** `aid` = Practice Aids, `player` = Configure combat stats block. */
  group?: string
  info?: string
  setup?: boolean
  choices?: MechanicsChoice[]
  dependsOn?: string
}

export interface DebugActionDef {
  command: EncounterCommand
  label: string
  purpose?: string
}

export interface EncounterControls {
  defaultMechanicsConfig: Partial<MechanicsConfig>
  mechanicsToggles: MechanicsToggleDef[]
  debugActions: DebugActionDef[]
  /** Optional boss-HP style presets for the Fight Setup widget. */
  bossHpPresets?: { label: string; hp: number; hint?: string }[]
}

/** scim's Zuk presets in scim's order (max_tbow ... naked) from SIM. */
export const LOADOUT_PRESETS: LoadoutPreset[] = SIM_PRESETS

export const DEFAULT_PRESET_ID: string = SIM_DEFAULT_PRESET_ID

/** SIM's triple-Jad Configure / Practice controls. */
export const TRIPLE_JAD_CONTROLS: EncounterControls = SIM_CONTROLS

/** Consumables in the inventory catalog (scim, from SIM's consumable table). */
export const CONSUMABLE_ITEM_IDS: readonly number[] = Object.keys(CONSUMABLE_NAMES).map(Number)

/** Consumables whose track is food / combo food; everything else with "(n)" is a potion. */
export const FOOD_ITEM_IDS: ReadonlySet<number> = new Set(
  Object.entries(CONSUMABLES)
    .filter(([, d]) => d.track === 'food' || d.track === 'combo_food')
    .map(([id]) => Number(id)),
)

/** Weapons SIM knows how to attack with (verified in the item picker). */
export const VERIFIED_WEAPON_IDS: ReadonlySet<number> = new Set(Object.keys(WEAPON_CATEGORY_BY_ITEM).map(Number))

/** Spellbook of a spell name (keeps the selected spell when the book matches). */
export function spellBookOf(spell: string): Spellbook | undefined {
  return SPELLS.find((s) => s.name === spell)?.spellbook
}
