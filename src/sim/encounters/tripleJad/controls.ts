/**
 * Practice/Configure controls for the triple-Jad mode (scim, bundle
 *, adapted: no Zuk toggles; the aid toggles `rce`/`ice` appended as
 * in scim's map).
 */
import type { EncounterCommand, MechanicsConfig } from '../../api'
import { BASE_MECHANICS } from '../../core/Engine'
import { TRIPLE_JAD_DEFAULT_MECHANICS } from './TripleJadEncounter'

export interface MechanicsToggle {
  key: string
  label: string
  group?: 'aid' | 'player'
  info?: string
  setup?: boolean
}

export interface DebugAction {
  command: EncounterCommand
  label: string
}

export interface EncounterControls {
  defaultMechanicsConfig: MechanicsConfig
  mechanicsToggles: MechanicsToggle[]
  debugActions: DebugAction[]
}

/** scim + `dm`: global toggles the Configure dialog lists before the encounter toggles. */
export const GLOBAL_MECHANICS_TOGGLES: MechanicsToggle[] = [
  { key: 'autoPrepot', label: 'Auto-Prepot', group: 'aid', setup: true, info: 'Also casts spell buffs your loadout allows, like Mark of Darkness.' },
  { key: 'doubleDeathCharge', label: 'Double Death Charge', group: 'player' },
  {
    key: 'deadeyeMysticVigour',
    label: 'Deadeye & Mystic Vigour',
    group: 'player',
    info: 'Replaces Eagle Eye and Mystic Might in the prayer book once your Prayer level allows.',
  },
  { key: 'vialSmasher', label: 'Vial Smasher', group: 'player', info: "Smashes the empty vial when you drink a potion's last dose." },
]

export const TRIPLE_JAD_CONTROLS: EncounterControls = {
  defaultMechanicsConfig: { ...BASE_MECHANICS, ...TRIPLE_JAD_DEFAULT_MECHANICS } as MechanicsConfig,
  mechanicsToggles: [
    { key: 'infiniteHealth', label: 'Infinite Health', group: 'aid' },
    { key: 'infiniteSpecialAttack', label: 'Infinite Special Attack', group: 'aid' },
  ],
  debugActions: [
    { command: { type: 'spawn-jad-healers' }, label: 'Spawn healers' },
    { command: { type: 'clear-healers' }, label: 'Clear healers' },
    { command: { type: 'set-jad-hp', hp: 176 }, label: 'Jads to 176 HP' },
    { command: { type: 'restart-wave' }, label: 'Reset wave' },
  ],
}
