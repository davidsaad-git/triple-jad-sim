import { findItem, type EquipmentItem, type EquipmentSlot } from '../data/items'
import type { EquipmentBonuses } from './Player'
import { ZERO_BONUSES } from './Player'

export type WeaponKind = 'melee' | 'ranged' | 'magic'

export interface WeaponInfo {
  kind: WeaponKind
  /** Ticks between attacks in the current style. */
  speed: number
  /** Attack range in tiles. */
  range: number
  /** Sequence id of the attack animation. */
  attackAnimation: number
  /** Stance sequences. */
  idleAnimation: number
  walkAnimation: number
  runAnimation: number
  /** Which style bonus applies to accuracy: +3 accurate, 0 rapid, +3 longrange (defence). */
  styleBonus: number
  /** Hit delay function of distance. */
  hitDelay: (distance: number) => number
  /** Named special cases. */
  special: 'twistedBow' | 'blowpipe' | 'zaryteCrossbow' | null
}

export interface Loadout {
  equipment: Partial<Record<EquipmentSlot, EquipmentItem>>
  bonuses: EquipmentBonuses
  weapon: WeaponInfo
}

export type RangedStyle = 'accurate' | 'rapid' | 'longrange'

const UNARMED_ANIMS = { idle: 808, walk: 819, run: 824 }

/** Weapon table keyed by item name; speed/range from the wiki, animations from RuneLite gameval ids. */
const WEAPONS: Record<string, Partial<WeaponInfo> & { kind: WeaponKind; baseSpeed: number; range: number; attackAnimation: number }> = {
  'twisted bow': { kind: 'ranged', baseSpeed: 6, range: 10, attackAnimation: 7552, idleAnimation: 4591, walkAnimation: 4226, runAnimation: 4228, special: 'twistedBow' },
  'toxic blowpipe': { kind: 'ranged', baseSpeed: 3, range: 5, attackAnimation: 5061, idleAnimation: 808, walkAnimation: 819, runAnimation: 824, special: 'blowpipe' },
  'bow of faerdhinen (c)': { kind: 'ranged', baseSpeed: 5, range: 10, attackAnimation: 426, idleAnimation: 808, walkAnimation: 819, runAnimation: 824, special: null },
  'zaryte crossbow': { kind: 'ranged', baseSpeed: 6, range: 8, attackAnimation: 9168, idleAnimation: 4591, walkAnimation: 4226, runAnimation: 4228, special: 'zaryteCrossbow' },
  'armadyl crossbow': { kind: 'ranged', baseSpeed: 6, range: 8, attackAnimation: 7552, idleAnimation: 4591, walkAnimation: 4226, runAnimation: 4228, special: null },
  'dragon crossbow': { kind: 'ranged', baseSpeed: 6, range: 7, attackAnimation: 7552, idleAnimation: 4591, walkAnimation: 4226, runAnimation: 4228, special: null },
  'rune crossbow': { kind: 'ranged', baseSpeed: 6, range: 7, attackAnimation: 7552, idleAnimation: 4591, walkAnimation: 4226, runAnimation: 4228, special: null },
  'magic shortbow (i)': { kind: 'ranged', baseSpeed: 4, range: 7, attackAnimation: 426, idleAnimation: 808, walkAnimation: 819, runAnimation: 824, special: null },
  'eclipse atlatl': { kind: 'ranged', baseSpeed: 4, range: 6, attackAnimation: 11057, idleAnimation: 808, walkAnimation: 819, runAnimation: 824, special: null },
}

export function bowHitDelayFn(distance: number): number {
  return 1 + Math.floor((3 + distance) / 6)
}

export function thrownHitDelayFn(distance: number): number {
  return 1 + Math.floor(distance / 6)
}

export function weaponInfoFor(item: EquipmentItem | undefined, style: RangedStyle = 'rapid'): WeaponInfo {
  const w = item ? WEAPONS[item.name.toLowerCase()] : undefined
  if (!w) {
    return {
      kind: 'melee',
      speed: 4,
      range: 1,
      attackAnimation: 422,
      idleAnimation: UNARMED_ANIMS.idle,
      walkAnimation: UNARMED_ANIMS.walk,
      runAnimation: UNARMED_ANIMS.run,
      styleBonus: 3,
      hitDelay: () => 0,
      special: null,
    }
  }
  const rapid = style === 'rapid'
  return {
    kind: w.kind,
    speed: rapid ? w.baseSpeed - 1 : w.baseSpeed,
    range: style === 'longrange' ? Math.min(10, w.range + 2) : w.range,
    attackAnimation: w.attackAnimation,
    idleAnimation: w.idleAnimation ?? UNARMED_ANIMS.idle,
    walkAnimation: w.walkAnimation ?? UNARMED_ANIMS.walk,
    runAnimation: w.runAnimation ?? UNARMED_ANIMS.run,
    styleBonus: style === 'accurate' ? 3 : 0,
    hitDelay: w.special === 'blowpipe' ? thrownHitDelayFn : bowHitDelayFn,
    special: w.special ?? null,
  }
}

export function sumBonuses(items: Iterable<EquipmentItem | undefined>): EquipmentBonuses {
  const b: EquipmentBonuses = { ...ZERO_BONUSES }
  for (const it of items) {
    if (!it) continue
    b.stabAttack += it.astab
    b.slashAttack += it.aslash
    b.crushAttack += it.acrush
    b.magicAttack += it.amagic
    b.rangedAttack += it.arange
    b.stabDefence += it.dstab
    b.slashDefence += it.dslash
    b.crushDefence += it.dcrush
    b.magicDefence += it.dmagic
    b.rangedDefence += it.drange
    b.meleeStrength += it.str
    b.rangedStrength += it.rstr
    b.magicDamagePercent += it.mdmg
    b.prayer += it.prayer
  }
  return b
}

export function buildLoadout(names: Partial<Record<EquipmentSlot, string>>, style: RangedStyle = 'rapid'): Loadout {
  const equipment: Partial<Record<EquipmentSlot, EquipmentItem>> = {}
  for (const [slot, name] of Object.entries(names) as [EquipmentSlot, string][]) {
    const item = findItem(name)
    if (item) equipment[slot] = item
  }
  return { equipment, bonuses: sumBonuses(Object.values(equipment)), weapon: weaponInfoFor(equipment.weapon, style) }
}

export const LOADOUT_PRESETS: Record<string, Partial<Record<EquipmentSlot, string>>> = {
  'Max Tbow': {
    head: 'Masori mask (f)',
    cape: "Dizana's quiver",
    neck: 'Necklace of anguish',
    ammo: 'Dragon arrow',
    weapon: 'Twisted bow',
    body: 'Masori body (f)',
    legs: 'Masori chaps (f)',
    hands: 'Zaryte vambraces',
    feet: 'Pegasian boots',
    ring: 'Venator ring',
  },
  'Max Blowpipe': {
    head: 'Masori mask (f)',
    cape: "Dizana's quiver",
    neck: 'Necklace of anguish',
    ammo: 'Dragon dart',
    weapon: 'Toxic blowpipe',
    body: 'Masori body (f)',
    legs: 'Masori chaps (f)',
    hands: 'Zaryte vambraces',
    feet: 'Pegasian boots',
    ring: 'Venator ring',
  },
  'Budget Range': {
    head: 'Slayer helmet (i)',
    cape: "Ava's assembler",
    neck: 'Necklace of anguish',
    ammo: 'Diamond dragon bolts (e)',
    weapon: 'Armadyl crossbow',
    body: 'Armadyl chestplate',
    legs: 'Armadyl chainskirt',
    hands: 'Barrows gloves',
    feet: 'Pegasian boots',
    ring: 'Archers ring (i)',
    shield: 'Twisted buckler',
  },
}
