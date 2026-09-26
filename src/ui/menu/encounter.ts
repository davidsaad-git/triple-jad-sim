/**
 * The triple-Jad encounter as the menus see it (scim's registry entry adapted:
 *) plus everything the Configure dialog persists:
 *
 * - `osrs-encounter-equipment[tripleJad]`   current loadout
 * - `osrs-custom-equipment-presets[tripleJad]` saved custom loadouts
 * - `osrs-player-stats`                     7 base levels
 * - `osrs-hiscores-username`                last Hiscores name
 * - `osrs-yama-settings.mechanicsConfigPerEncounter.tripleJad` / `__player__`
 *   mechanics overrides, only keys that differ from the defaults
 *
 * The integrator starts a run from `EncounterStartConfig` (see `loadStartConfig`).
 */
import type { Loadout, MechanicsConfig, SkillName } from '../../sim/api'
import { settingsStore } from '../../app/settings/settings'
import {
  allNinetyNine,
  clampLevel,
  CUSTOM_KEY,
  equipmentEqual,
  inventoryEqual,
  normalizeLoadout,
  SKILL_BOUNDS,
  SKILLS,
  type BaseLevels,
} from './loadoutModel'
import { DEFAULT_PRESET_ID, LOADOUT_PRESETS, TRIPLE_JAD_CONTROLS, type LoadoutPreset, type MechanicsToggleDef } from './simBridge'
import { isRecord, readJson, writeJson } from './storage'

// ---------------------------------------------------------------------------
// Encounter descriptor
// ---------------------------------------------------------------------------

export const ENCOUNTER_KEY = 'tripleJad'

export const TRIPLE_JAD_ENCOUNTER = {
  kind: ENCOUNTER_KEY,
  displayName: 'Triple Jads',
  tagline: 'Inferno · Wave 68',
  description: 'Three JalTok-Jads at once: Inferno wave 68.',
  blurb:
    'Face three JalTok-Jads and their Yt-HurKot healers in the Inferno\'s wave 68. Their attacks are staggered three ticks apart, so every prayer switch counts.',
  wikiUrl: 'https://oldschool.runescape.wiki/w/Inferno',
  /** scim's victory descriptor shape (``), adapted. */
  victory: { eyebrow: 'Triumphant', title: 'VICTORY', narrative: 'TRIPLE JADS DEFEATED', accent: 'gold' as const },
} as const

// ---------------------------------------------------------------------------
// Start config handed to the integrator
// ---------------------------------------------------------------------------

export interface EncounterStartConfig {
  loadout: Loadout
  baseLevels: Record<SkillName, number>
  mechanics: MechanicsConfig
}

// ---------------------------------------------------------------------------
// Player stats
// ---------------------------------------------------------------------------

export const PLAYER_STATS_KEY = 'osrs-player-stats'
export const HISCORES_USERNAME_KEY = 'osrs-hiscores-username'

/** scim: any invalid stored skill => all 99. */
export function loadPlayerStats(): BaseLevels {
  const v = readJson(PLAYER_STATS_KEY)
  if (!isRecord(v)) return allNinetyNine()
  const out = allNinetyNine()
  for (const s of SKILLS) {
    const x = v[s]
    const { min, max } = SKILL_BOUNDS[s]
    if (typeof x !== 'number' || !Number.isInteger(x) || x < min || x > max) return allNinetyNine()
    out[s] = x
  }
  return out
}

export function savePlayerStats(levels: BaseLevels): void {
  const out = {} as BaseLevels
  for (const s of SKILLS) out[s] = clampLevel(s, levels[s])
  writeJson(PLAYER_STATS_KEY, out)
}

export function loadHiscoresUsername(): string {
  const v = readJson(HISCORES_USERNAME_KEY)
  return typeof v === 'string' ? v : ''
}

export function saveHiscoresUsername(name: string): void {
  writeJson(HISCORES_USERNAME_KEY, name)
}

// ---------------------------------------------------------------------------
// Loadouts
// ---------------------------------------------------------------------------

export const ENCOUNTER_EQUIPMENT_KEY = 'osrs-encounter-equipment'
export const CUSTOM_PRESETS_KEY = 'osrs-custom-equipment-presets'

export function getPresets(): LoadoutPreset[] {
  return LOADOUT_PRESETS
}

export function defaultPreset(): LoadoutPreset {
  const presets = getPresets()
  return presets.find((p) => p.id === DEFAULT_PRESET_ID) ?? presets.find((p) => !p.isFallback) ?? presets[0]!
}

/** Current loadout for the encounter; missing key => the first (default) preset. */
export function loadCurrentLoadout(): Loadout {
  const all = readJson(ENCOUNTER_EQUIPMENT_KEY)
  const stored = isRecord(all) ? all[ENCOUNTER_KEY] : undefined
  if (stored === undefined) return normalizeLoadout(defaultPreset().loadout)
  const l = normalizeLoadout(stored)
  // Repair: inventory equals a preset's but equipment differs and has <= 2 items.
  const match = getPresets()
    .map((p) => normalizeLoadout(p.loadout))
    .find((pl) => inventoryEqual(pl.inventory, l.inventory))
  if (match && !equipmentEqual(match.equipment, l.equipment) && Object.keys(l.equipment).length <= 2) {
    return { ...l, equipment: match.equipment }
  }
  return l
}

export function saveCurrentLoadout(l: Loadout): void {
  const all = readJson(ENCOUNTER_EQUIPMENT_KEY)
  const next = isRecord(all) ? { ...all } : {}
  next[ENCOUNTER_KEY] = l
  writeJson(ENCOUNTER_EQUIPMENT_KEY, next)
}

export interface VerificationIssue {
  id: number
  name: string
  reason: 'unverified' | 'unsupported'
  omitted: boolean
}

export interface CustomPreset {
  id: string
  name: string
  loadout: Loadout
  verificationIssues?: VerificationIssue[]
}

export function loadCustomPresets(): CustomPreset[] {
  const all = readJson(CUSTOM_PRESETS_KEY)
  const list = isRecord(all) ? all[ENCOUNTER_KEY] : undefined
  if (!Array.isArray(list)) return []
  const out: CustomPreset[] = []
  for (const e of list) {
    if (!isRecord(e) || typeof e.id !== 'string' || typeof e.name !== 'string' || e.id.length === 0) continue
    out.push({ id: e.id, name: e.name, loadout: normalizeLoadout(e.loadout) })
  }
  return out
}

export function saveCustomPresets(list: readonly CustomPreset[]): void {
  const all = readJson(CUSTOM_PRESETS_KEY)
  const next = isRecord(all) ? { ...all } : {}
  next[ENCOUNTER_KEY] = list
  writeJson(CUSTOM_PRESETS_KEY, next)
}

// ---------------------------------------------------------------------------
// Mechanics config
// ---------------------------------------------------------------------------

export const PLAYER_GROUP_KEY = '__player__'

/** scim with the contract's key names. */
export const GLOBAL_MECHANICS_DEFAULTS: MechanicsConfig = {
  infiniteHealth: false,
  infiniteSpecialAttack: false,
  autoPrepot: true,
  doubleDeathCharge: true,
  deadeyeMysticVigour: true,
  vialSmasher: true,
}

/** scim: prepended to every encounter's Configure rail. */
export const AUTO_PREPOT_TOGGLE: MechanicsToggleDef = {
  key: 'autoPrepot',
  label: 'Auto-Prepot',
  group: 'aid',
  setup: true,
  info: 'Also casts spell buffs your loadout allows, like Mark of Darkness.',
}

/** scim: player-wide toggles shown under the combat stats. */
export const PLAYER_TOGGLES: MechanicsToggleDef[] = [
  { key: 'doubleDeathCharge', label: 'Double Death Charge', group: 'player' },
  {
    key: 'deadeyeMysticVigour',
    label: 'Deadeye & Mystic Vigour',
    group: 'player',
    info: 'Replaces Eagle Eye and Mystic Might in the prayer book once your Prayer level allows.',
  },
  { key: 'vialSmasher', label: 'Vial Smasher', group: 'player', info: "Smashes the empty vial when you drink a potion's last dose." },
]

const PLAYER_KEYS = new Set(PLAYER_TOGGLES.map((t) => t.key))

/** scim: um + dm + encounter toggles, deduplicated by key. */
export function allMechanicsToggles(): MechanicsToggleDef[] {
  const out: MechanicsToggleDef[] = []
  const seen = new Set<string>()
  for (const t of [AUTO_PREPOT_TOGGLE, ...PLAYER_TOGGLES, ...TRIPLE_JAD_CONTROLS.mechanicsToggles]) {
    if (seen.has(t.key)) continue
    seen.add(t.key)
    out.push(t)
  }
  return out
}

/** Encounter defaults: `{...lm, ...encounter defaults}`. */
export function encounterMechanicsDefaults(): MechanicsConfig {
  return { ...GLOBAL_MECHANICS_DEFAULTS, ...(TRIPLE_JAD_CONTROLS.defaultMechanicsConfig as Partial<MechanicsConfig>) } as MechanicsConfig
}

type Overrides = Record<string, boolean | string | number>

/** Effective config = defaults + `__player__` + encounter overrides. */
export function mergedMechanicsConfig(perEncounter: Record<string, Overrides> = settingsStore.get().mechanicsConfigPerEncounter): MechanicsConfig {
  return {
    ...encounterMechanicsDefaults(),
    ...(perEncounter[PLAYER_GROUP_KEY] ?? {}),
    ...(perEncounter[ENCOUNTER_KEY] ?? {}),
  } as MechanicsConfig
}

/**
 * scim: store only the keys that differ; player keys go to
 * `__player__` (compared with the global defaults), the rest under the encounter.
 */
export function mechanicsOverridesFor(config: Partial<MechanicsConfig>, prev: Record<string, Overrides>): Record<string, Overrides> {
  const defaults = encounterMechanicsDefaults() as Overrides
  const enc: Overrides = {}
  const player: Overrides = { ...(prev[PLAYER_GROUP_KEY] ?? {}) }
  for (const [k, v] of Object.entries(config)) {
    if (v === undefined) continue
    if (PLAYER_KEYS.has(k)) {
      if ((GLOBAL_MECHANICS_DEFAULTS as Overrides)[k] === v) delete player[k]
      else player[k] = v
      continue
    }
    if (defaults[k] !== v) enc[k] = v
  }
  const next: Record<string, Overrides> = { ...prev }
  if (Object.keys(enc).length > 0) next[ENCOUNTER_KEY] = enc
  else delete next[ENCOUNTER_KEY]
  if (Object.keys(player).length > 0) next[PLAYER_GROUP_KEY] = player
  else delete next[PLAYER_GROUP_KEY]
  return next
}

export function saveMechanicsConfig(config: Partial<MechanicsConfig>): void {
  const prev = settingsStore.get().mechanicsConfigPerEncounter
  settingsStore.patch({ mechanicsConfigPerEncounter: mechanicsOverridesFor(config, prev) })
}

/** Opening Configure / "Enter" wipes the encounter's overrides; `__player__` stays. */
export function resetEncounterMechanics(): void {
  const prev = settingsStore.get().mechanicsConfigPerEncounter
  if (!(ENCOUNTER_KEY in prev)) return
  const next = { ...prev }
  delete next[ENCOUNTER_KEY]
  settingsStore.patch({ mechanicsConfigPerEncounter: next })
}

/** Everything the integrator needs to (re)start a run from persisted state. */
export function loadStartConfig(): EncounterStartConfig {
  return { loadout: loadCurrentLoadout(), baseLevels: loadPlayerStats(), mechanics: mergedMechanicsConfig() }
}

export { CUSTOM_KEY }
