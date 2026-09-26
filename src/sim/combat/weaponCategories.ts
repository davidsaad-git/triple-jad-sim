/**
 * Weapon categories and combat styles (scim, `vy`,
 * `yy`/`by`/`xy`,
 *; stance).
 */
import type { CombatSupplies, Equipment, EquipmentStats, Spellbook } from '../api'
import { canonicalItemId } from '../items/variants'
import { spellInfo, type SpellInfo } from './spells'
import type { DamageStyle, FormulaStyle } from './types'

export type AttackType = 'Stab' | 'Slash' | 'Crush' | 'Ranged' | 'Magic' | 'None'
export type CombatStyleName =
  | 'Accurate'
  | 'Aggressive'
  | 'Defensive'
  | 'Controlled'
  | 'Rapid'
  | 'Longrange'
  | 'Casting'
  | 'Defensive Casting'
  | 'None'

export interface WeaponStyle {
  name: string
  attackType: AttackType
  combatStyle: CombatStyleName
  icon: string
}

export interface WeaponCategory {
  name: string
  styles: WeaponStyle[]
}

export type WeaponCategoryId =
  | '2h_sword'
  | 'axe'
  | 'banner'
  | 'blunt'
  | 'bludgeon'
  | 'bulwark'
  | 'claw'
  | 'partisan'
  | 'pickaxe'
  | 'polearm'
  | 'scythe'
  | 'slash_sword'
  | 'spear'
  | 'spiked'
  | 'stab_sword'
  | 'unarmed'
  | 'whip'
  | 'bow'
  | 'crossbow'
  | 'thrown'
  | 'staff'
  | 'powered_staff'

function s(name: string, attackType: AttackType, combatStyle: CombatStyleName, icon: string): WeaponStyle {
  return { name, attackType, combatStyle, icon }
}


export const WEAPON_CATEGORIES: Readonly<Record<WeaponCategoryId, WeaponCategory>> = {
  '2h_sword': { name: '2h Sword', styles: [s('Chop', 'Slash', 'Accurate', '2h_chop.png'), s('Slash', 'Slash', 'Aggressive', '2h_slash.png'), s('Smash', 'Crush', 'Aggressive', '2h_smash.png'), s('Block', 'Slash', 'Defensive', '2h_block.png')] },
  axe: { name: 'Axe', styles: [s('Chop', 'Slash', 'Accurate', 'axe_chop.png'), s('Hack', 'Slash', 'Aggressive', 'axe_hack.png'), s('Smash', 'Crush', 'Aggressive', 'axe_smash.png'), s('Block', 'Slash', 'Defensive', 'axe_block.png')] },
  banner: { name: 'Banner', styles: [s('Lunge', 'Stab', 'Accurate', 'banner_lunge.png'), s('Swipe', 'Slash', 'Aggressive', 'banner_swipe.png'), s('Pound', 'Crush', 'Controlled', 'banner_pound.png'), s('Block', 'Stab', 'Defensive', 'banner_block.png')] },
  blunt: { name: 'Blunt', styles: [s('Pound', 'Crush', 'Accurate', 'blunt_pound.png'), s('Pummel', 'Crush', 'Aggressive', 'blunt_pummel.png'), s('Block', 'Crush', 'Defensive', 'blunt_block.png')] },
  bludgeon: { name: 'Bludgeon', styles: [s('Pound', 'Crush', 'Aggressive', 'bludgeon_pound.png'), s('Pummel', 'Crush', 'Aggressive', 'bludgeon_pummel.png'), s('Smash', 'Crush', 'Aggressive', 'bludgeon_smash.png')] },
  bulwark: { name: 'Bulwark', styles: [s('Pummel', 'Crush', 'Accurate', 'bulwark_pummel.png'), s('Block', 'None', 'None', 'bulwark_block.png')] },
  claw: { name: 'Claw', styles: [s('Chop', 'Slash', 'Accurate', 'claw_chop.png'), s('Slash', 'Slash', 'Aggressive', 'claw_slash.png'), s('Lunge', 'Stab', 'Controlled', 'claw_lunge.png'), s('Block', 'Slash', 'Defensive', 'claw_block.png')] },
  partisan: { name: 'Partisan', styles: [s('Stab', 'Stab', 'Accurate', 'partisan_stab.png'), s('Lunge', 'Stab', 'Aggressive', 'partisan_lunge.png'), s('Pound', 'Crush', 'Aggressive', 'partisan_pound.png'), s('Block', 'Stab', 'Defensive', 'partisan_block.png')] },
  pickaxe: { name: 'Pickaxe', styles: [s('Spike', 'Stab', 'Accurate', 'pickaxe_spike.png'), s('Impale', 'Stab', 'Aggressive', 'pickaxe_impale.png'), s('Smash', 'Crush', 'Aggressive', 'pickaxe_smash.png'), s('Block', 'Stab', 'Defensive', 'pickaxe_block.png')] },
  polearm: { name: 'Polearm', styles: [s('Jab', 'Stab', 'Controlled', 'polearm_jab.png'), s('Swipe', 'Slash', 'Aggressive', 'polearm_swipe.png'), s('Fend', 'Stab', 'Defensive', 'polearm_fend.png')] },
  scythe: { name: 'Scythe', styles: [s('Reap', 'Slash', 'Accurate', 'scythe_reap.png'), s('Chop', 'Slash', 'Aggressive', 'scythe_chop.png'), s('Jab', 'Crush', 'Aggressive', 'scythe_jab.png'), s('Block', 'Slash', 'Defensive', 'scythe_block.png')] },
  slash_sword: { name: 'Slash Sword', styles: [s('Chop', 'Slash', 'Accurate', 'slash_sword_chop.png'), s('Slash', 'Slash', 'Aggressive', 'slash_sword_slash.png'), s('Lunge', 'Stab', 'Controlled', 'slash_sword_lunge.png'), s('Block', 'Slash', 'Defensive', 'slash_sword_block.png')] },
  spear: { name: 'Spear', styles: [s('Lunge', 'Stab', 'Controlled', 'spear_lunge.png'), s('Swipe', 'Slash', 'Controlled', 'spear_swipe.png'), s('Pound', 'Crush', 'Controlled', 'spear_pound.png'), s('Block', 'Stab', 'Defensive', 'spear_block.png')] },
  spiked: { name: 'Spiked', styles: [s('Pound', 'Crush', 'Accurate', 'spiked_pound.png'), s('Pummel', 'Crush', 'Aggressive', 'spiked_pummel.png'), s('Spike', 'Stab', 'Aggressive', 'spiked_spike.png'), s('Block', 'Crush', 'Defensive', 'spiked_block.png')] },
  stab_sword: { name: 'Stab Sword', styles: [s('Stab', 'Stab', 'Accurate', 'stab_sword_stab.png'), s('Lunge', 'Stab', 'Aggressive', 'stab_sword_lunge.png'), s('Slash', 'Slash', 'Aggressive', 'stab_sword_slash.png'), s('Block', 'Stab', 'Defensive', 'stab_sword_block.png')] },
  unarmed: { name: 'Unarmed', styles: [s('Punch', 'Crush', 'Accurate', 'unarmed_punch.png'), s('Kick', 'Crush', 'Aggressive', 'unarmed_kick.png'), s('Block', 'Crush', 'Defensive', 'unarmed_block.png')] },
  whip: { name: 'Whip', styles: [s('Flick', 'Slash', 'Controlled', 'whip_flick.png'), s('Lash', 'Slash', 'Aggressive', 'whip_lash.png'), s('Deflect', 'Slash', 'Defensive', 'whip_deflect.png')] },
  bow: { name: 'Bow', styles: [s('Accurate', 'Ranged', 'Accurate', 'bow_accurate.png'), s('Rapid', 'Ranged', 'Rapid', 'bow_rapid.png'), s('Longrange', 'Ranged', 'Longrange', 'bow_longrange.png')] },
  crossbow: { name: 'Crossbow', styles: [s('Accurate', 'Ranged', 'Accurate', 'crossbow_accurate.png'), s('Rapid', 'Ranged', 'Rapid', 'crossbow_rapid.png'), s('Longrange', 'Ranged', 'Longrange', 'crossbow_longrange.png')] },
  thrown: { name: 'Thrown', styles: [s('Accurate', 'Ranged', 'Accurate', 'thrown_accurate.png'), s('Rapid', 'Ranged', 'Rapid', 'thrown_rapid.png'), s('Longrange', 'Ranged', 'Longrange', 'thrown_longrange.png')] },
  staff: {
    name: 'Staff',
    styles: [
      s('Bash', 'Crush', 'Accurate', 'staff_bash.png'),
      s('Pound', 'Crush', 'Aggressive', 'staff_pound.png'),
      s('Focus', 'Crush', 'Defensive', 'staff_focus.png'),
      s('Spell', 'Magic', 'Casting', 'staff_spell.png'),
      s('Spell', 'Magic', 'Defensive Casting', 'staff_spell_defensive.png'),
    ],
  },
  powered_staff: { name: 'Powered Staff', styles: [s('Accurate', 'Magic', 'Accurate', 'powered_staff_accurate.png'), s('Longrange', 'Magic', 'Longrange', 'powered_staff_longrange.png')] },
}

/** scim: item (canonical id) -> weapon category. */
export const WEAPON_CATEGORY_BY_ITEM: Readonly<Record<number, WeaponCategoryId>> = {
  29594: 'staff', 29589: 'slash_sword', 11802: '2h_sword', 11804: '2h_sword', 11806: '2h_sword', 11808: '2h_sword', 26233: '2h_sword', 20593: '2h_sword',
  4587: 'slash_sword', 27690: 'slash_sword', 22324: 'stab_sword', 4151: 'whip', 12006: 'whip', 13576: 'blunt', 21003: 'blunt', 28338: 'axe', 28810: 'axe',
  22325: 'scythe', 22486: 'scythe', 25736: 'scythe', 25738: 'scythe', 25739: 'scythe', 25741: 'scythe', 28543: 'scythe', 28545: 'scythe',
  11235: 'bow', 20997: 'bow', 25865: 'bow', 25867: 'bow', 29000: 'bow', 29591: 'bow', 9185: 'crossbow', 11785: 'crossbow', 26374: 'crossbow',
  11905: 'powered_staff', 11907: 'powered_staff', 12899: 'powered_staff', 22288: 'powered_staff', 22292: 'powered_staff', 22323: 'powered_staff',
  22481: 'powered_staff', 22552: 'powered_staff', 22555: 'powered_staff', 23898: 'powered_staff', 23899: 'powered_staff', 23900: 'powered_staff',
  25731: 'powered_staff', 25733: 'powered_staff', 27275: 'powered_staff', 27277: 'powered_staff', 27662: 'powered_staff', 27665: 'powered_staff',
  28547: 'powered_staff', 28549: 'powered_staff', 28583: 'powered_staff', 28585: 'powered_staff', 28796: 'powered_staff', 31113: 'powered_staff',
  31115: 'powered_staff', 33314: 'powered_staff', 33318: 'powered_staff', 33322: 'powered_staff', 33323: 'powered_staff', 33326: 'powered_staff',
  12926: 'thrown', 6914: 'staff', 4675: 'staff', 11791: 'staff', 21006: 'staff', 22296: 'staff', 27624: 'staff', 27676: 'staff', 27679: 'staff', 30070: 'staff',
  26219: 'partisan', 13652: 'claw', 29577: 'claw', 23528: 'spiked', 24417: 'spiked', 28997: 'spiked', 29850: 'spiked', 30759: 'spiked',
  11824: 'spear', 11889: 'spear', 22978: 'spear', 23987: 'polearm', 11920: 'pickaxe', 13243: 'pickaxe', 13263: 'bludgeon', 21015: 'bulwark',
}

/** scim: default autocast per spellbook. */
const DEFAULT_AUTOCAST: Readonly<Record<number, Partial<Record<Spellbook, string>>>> = {
  4675: { ancient: 'Blood Barrage' },
  6914: { ancient: 'Blood Barrage' },
  21006: { ancient: 'Blood Barrage', arceuus: 'Dark Demonbane' },
  27624: { ancient: 'Blood Barrage' },
  29594: { arceuus: 'Dark Demonbane' },
  30070: { ancient: 'Blood Barrage' },
}

/** Default spellbook when a loadout has none. */
export const DEFAULT_SPELLBOOK: Spellbook = 'arceuus'


export function weaponCategoryId(weaponId: number | undefined): WeaponCategoryId | undefined {
  return weaponId === undefined ? undefined : WEAPON_CATEGORY_BY_ITEM[canonicalItemId(weaponId)]
}

/** scim: category id, `unarmed` without a weapon or an unknown one. */
export function weaponCategoryKey(weaponId: number | undefined): WeaponCategoryId {
  return weaponCategoryId(weaponId) ?? 'unarmed'
}


export function weaponCategory(weaponId: number | undefined): WeaponCategory {
  return WEAPON_CATEGORIES[weaponCategoryKey(weaponId)]
}

/** scim: the weapon's default autocast for a spellbook. */
function defaultAutocast(weaponId: number | undefined, spellbook: Spellbook): SpellInfo | null {
  if (weaponId === undefined) return null
  const name = DEFAULT_AUTOCAST[canonicalItemId(weaponId)]?.[spellbook]
  return name ? spellInfo(name) : null
}

/** scim: the style picked when a weapon is equipped without a remembered choice. */
export function defaultStyleIndex(weaponId: number | undefined, spellbook: Spellbook = DEFAULT_SPELLBOOK): number {
  if (weaponCategoryId(weaponId) === undefined) return 0
  const cat = weaponCategory(weaponId)
  if (defaultAutocast(weaponId, spellbook)) {
    const i = cat.styles.findIndex((st) => st.combatStyle === 'Casting')
    if (i >= 0) return i
  }
  let best = 0
  let bestScore = -1
  cat.styles.forEach((st, i) => {
    const score =
      (st.combatStyle === 'Rapid' ? 100 : 0) +
      (st.combatStyle === 'Longrange' ? 10 : 0) +
      (st.combatStyle === 'Aggressive' ? 3 : st.combatStyle === 'Controlled' ? 1 : 0)
    if (score > bestScore) {
      best = i
      bestScore = score
    }
  })
  return best
}


export function isCastingStyle(weaponId: number | undefined, styleIndex: number): boolean {
  if (weaponId === undefined) return false
  const st = weaponCategory(weaponId).styles[styleIndex]
  return st ? st.combatStyle === 'Casting' || st.combatStyle === 'Defensive Casting' : false
}

export interface AutocastSpell {
  name: string
  icon: string
  spellbook: Spellbook
  attackRange: number
  fixedHitDelay?: number
}

/** scim: the spell an autocasting staff uses (selected spell, else the weapon default). */
export function autocastSpell(args: {
  weaponId: number | undefined
  selectedStyleIndex: number
  selectedSpell: string | null | undefined
  spellbook: Spellbook
}): AutocastSpell | null {
  if (!isCastingStyle(args.weaponId, args.selectedStyleIndex)) return null
  if (args.selectedSpell) {
    const sp = spellInfo(args.selectedSpell)
    if (sp) {
      return {
        name: sp.name,
        icon: sp.icon,
        spellbook: sp.spellbook,
        attackRange: sp.attackRange,
        ...(sp.fixedHitDelay === undefined ? {} : { fixedHitDelay: sp.fixedHitDelay }),
      }
    }
  }
  const d = defaultAutocast(args.weaponId, args.spellbook)
  return d
    ? { name: d.name, icon: d.icon, spellbook: d.spellbook, attackRange: d.attackRange, ...(d.fixedHitDelay === undefined ? {} : { fixedHitDelay: d.fixedHitDelay }) }
    : null
}

const ATTACK_TYPE_TO_FORMULA: Readonly<Partial<Record<AttackType, FormulaStyle>>> = {
  Stab: 'melee_stab',
  Slash: 'melee_slash',
  Crush: 'melee_crush',
  Ranged: 'ranged',
  Magic: 'magic',
}

/** scim: the formula style of a weapon style. */
export function formulaStyleOf(weaponId: number | undefined, styleIndex = 0): FormulaStyle {
  const cat = weaponCategory(weaponId)
  const st = cat.styles[styleIndex] ?? cat.styles[0]
  return st ? (ATTACK_TYPE_TO_FORMULA[st.attackType] ?? 'melee_crush') : 'melee_crush'
}

/** scim: style adjustments to the weapon's speed and range. */
export function styleAdjustedParams(
  attackSpeed: number,
  attackRange: number,
  weaponId: number | undefined,
  styleIndex: number,
): { attackSpeed: number; attackRange: number } {
  const cat = weaponCategory(weaponId)
  const idx = Math.min(Math.max(0, styleIndex), cat.styles.length - 1)
  const st = cat.styles[idx]
  if (!st) return { attackSpeed, attackRange }
  let speed = attackSpeed
  let range = attackRange
  if (st.attackType === 'Ranged' && st.combatStyle === 'Rapid') speed -= 1
  else if (st.combatStyle === 'Casting' || st.combatStyle === 'Defensive Casting') speed = 5
  if (st.combatStyle === 'Longrange') range += 2
  speed = Math.max(speed, 1)
  return { attackSpeed: speed, attackRange: range }
}

/** scim: the player's attack speed and range. */
export function playerCombatParams(player: {
  equipmentStats: EquipmentStats
  equipment: Equipment
  selectedAttackStyleIndex: number
  combatSupplies?: CombatSupplies | undefined
}): { attackSpeed: number; attackRange: number } {
  const p = styleAdjustedParams(player.equipmentStats.attackSpeed, player.equipmentStats.attackRange, player.equipment.weapon, player.selectedAttackStyleIndex)
  const spell = autocastSpell({
    weaponId: player.equipment.weapon,
    selectedStyleIndex: player.selectedAttackStyleIndex,
    selectedSpell: player.combatSupplies?.selectedSpell,
    spellbook: player.combatSupplies?.spellbook ?? DEFAULT_SPELLBOOK,
  })
  if (spell) p.attackRange = spell.attackRange
  return p
}


export function damageStyleOf(style: FormulaStyle): DamageStyle {
  return style === 'ranged' ? 'range' : style === 'magic' ? 'magic' : 'melee'
}


export function attackKindOf(style: FormulaStyle): string {
  switch (style) {
    case 'melee_stab':
      return 'melee_stab'
    case 'melee_slash':
      return 'melee_slash'
    case 'melee_crush':
      return 'melee_crush'
    case 'ranged':
      return 'range_arrow'
    case 'magic':
      return 'magic_fire'
  }
}

export type LegacyDelayCategory = 'melee' | 'bow' | 'thrown' | 'magic' | 'magic_slow'

const LEGACY_DELAY_BY_CATEGORY: Readonly<Partial<Record<WeaponCategoryId, LegacyDelayCategory>>> = {
  bow: 'bow',
  crossbow: 'bow',
  thrown: 'thrown',
  powered_staff: 'magic',
}

/** scim: the legacy hit-delay category. */
export function legacyDelayCategory(weaponId: number | undefined, style: FormulaStyle): LegacyDelayCategory {
  if (weaponId !== undefined) {
    if (canonicalItemId(weaponId) === 27275) return 'magic_slow'
    const cat = weaponCategoryId(weaponId)
    if (cat) return LEGACY_DELAY_BY_CATEGORY[cat] ?? 'melee'
  }
  return style === 'magic' ? 'magic' : 'melee'
}

export type Stance = 'Accurate' | 'Aggressive' | 'Defensive' | 'Controlled' | 'Longrange' | 'Casting' | 'Defensive Casting' | 'Other' | 'Manual Cast'

/** scim: the selected style's stance (Rapid/None -> Other). */
export function stanceOf(player: { equipment: Equipment; selectedAttackStyleIndex: number }): Stance {
  const styles = weaponCategory(player.equipment.weapon).styles
  const st = styles[Math.min(Math.max(0, player.selectedAttackStyleIndex), styles.length - 1)] ?? styles[0]
  if (!st) return 'Other'
  return st.combatStyle === 'Rapid' || st.combatStyle === 'None' ? 'Other' : st.combatStyle
}
