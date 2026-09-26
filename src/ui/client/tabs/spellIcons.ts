import type { Spellbook } from '../../../sim/api'
import { packAsset } from '../../packs'

/** Spell icon folder per book (scim iconDir). */
export const SPELL_ICON_DIRS: Readonly<Record<Spellbook, string>> = {
  arceuus: 'spells/arceuus_spell',
  ancient: 'spells/ancient_spell',
  standard: 'spells/normal_spell',
  lunar: 'spells/lunar_spell',
}

/**
 * Spell icon path: slots of 40 px or more use the
 * `_resized` art; uncastable spells use `_disabled`.
 */
export function spellIconPath(book: Spellbook, icon: string, slotSize: number, castable: boolean): string {
  const big = slotSize >= 40
  const suffix = castable ? (big ? '_resized' : '') : big ? '_disabled_resized' : '_disabled'
  return `${SPELL_ICON_DIRS[book]}/${icon}${suffix}.png`
}

export function spellIconUrl(book: Spellbook, icon: string, slotSize: number, castable: boolean): string {
  return packAsset(spellIconPath(book, icon, slotSize, castable))
}
