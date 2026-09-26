/**
 * Player levels (scim, `SA`, `AA`, `MA`, bundle
 *) and preset requirements (`FA`).
 */
import type { Equipment, Inventory, PlayerStats, SkillName } from '../api'

export const SKILLS: readonly SkillName[] = ['attack', 'strength', 'defence', 'ranged', 'magic', 'prayer', 'hitpoints']

export const SKILL_BOUNDS: Readonly<Record<SkillName, { min: number; max: number }>> = {
  attack: { min: 1, max: 99 },
  strength: { min: 1, max: 99 },
  defence: { min: 1, max: 99 },
  ranged: { min: 1, max: 99 },
  magic: { min: 1, max: 99 },
  prayer: { min: 1, max: 99 },
  hitpoints: { min: 10, max: 99 },
}


export function clampLevel(skill: SkillName, value: number): number {
  const b = SKILL_BOUNDS[skill]
  return Number.isFinite(value) ? Math.min(b.max, Math.max(b.min, Math.trunc(value))) : b.min
}

/** scim: all 99. */
export function defaultBaseLevels(): Record<SkillName, number> {
  return { attack: 99, strength: 99, defence: 99, ranged: 99, magic: 99, prayer: 99, hitpoints: 99 }
}

/** scim: base levels -> stats with current = max. */
export function statsFromLevels(levels: Record<SkillName, number>): PlayerStats {
  const s = (v: number): { current: number; max: number } => ({ current: v, max: v })
  return {
    attack: s(levels.attack),
    strength: s(levels.strength),
    defence: s(levels.defence),
    ranged: s(levels.ranged),
    magic: s(levels.magic),
    prayer: s(levels.prayer),
    hitpoints: s(levels.hitpoints),
  }
}

/** Clamp every configured level (scim validates stored stats with `CA`, UI input with). */
export function sanitizeLevels(levels: Partial<Record<SkillName, number>> | undefined): Record<SkillName, number> {
  const base = defaultBaseLevels()
  if (!levels) return base
  for (const k of SKILLS) {
    const v = levels[k]
    if (v !== undefined) base[k] = clampLevel(k, v)
  }
  return base
}

/** scim: combat level. */
export function combatLevel(l: Record<SkillName, number>): number {
  const base = 0.25 * (l.defence + l.hitpoints + Math.floor(l.prayer / 2))
  const melee = 0.325 * (l.attack + l.strength)
  const range = 0.325 * (Math.floor(l.ranged / 2) + l.ranged)
  const mage = 0.325 * (Math.floor(l.magic / 2) + l.magic)
  return Math.floor(base + Math.max(melee, range, mage))
}


export const ITEM_REQUIREMENTS: Readonly<Record<number, Partial<Record<SkillName, number>>>> = {
  22325: { attack: 80, strength: 90 }, 21003: { attack: 75, strength: 75 }, 26219: { attack: 82 }, 24417: { attack: 80 }, 29589: { attack: 77 },
  11806: { attack: 75 }, 27690: { attack: 75 }, 12006: { attack: 75 }, 13652: { attack: 60 }, 29577: { attack: 60 }, 22322: { attack: 70, defence: 70 },
  27275: { magic: 85 }, 31113: { magic: 83 }, 29594: { attack: 50, magic: 77 }, 27679: { magic: 70 }, 6889: { magic: 60 }, 29591: { ranged: 77 },
  20997: { ranged: 85 }, 25865: { ranged: 80 }, 12926: { ranged: 75 }, 29000: { ranged: 75, attack: 50, strength: 50 }, 11785: { ranged: 70 },
  21902: { ranged: 64 }, 9185: { ranged: 61 }, 21006: { magic: 80 }, 27624: { magic: 70, strength: 60, attack: 50 }, 30070: { magic: 65 },
  6914: { magic: 60 }, 26382: { defence: 80 }, 28254: { defence: 80 }, 26384: { defence: 80 }, 26386: { defence: 80 }, 30753: { defence: 78 },
  30756: { defence: 78 }, 30779: { defence: 78 }, 30781: { defence: 78 }, 22981: { attack: 80, defence: 80 }, 12931: { defence: 75 },
  12954: { defence: 60 }, 28945: { defence: 75 }, 29025: { strength: 75, defence: 50 }, 10551: { defence: 40 }, 22326: { defence: 75 },
  4753: { defence: 70 }, 21733: { defence: 75 }, 27235: { ranged: 80, defence: 80 }, 27238: { ranged: 80, defence: 80 },
  27241: { ranged: 80, defence: 80 }, 26235: { ranged: 80, defence: 45 }, 13237: { ranged: 75, defence: 75 }, 22109: { ranged: 70 },
  23971: { defence: 70 }, 23975: { defence: 70 }, 23979: { defence: 70 }, 29035: { ranged: 75, defence: 50 }, 29031: { ranged: 75, defence: 50 },
  29033: { ranged: 75, defence: 50 }, 30076: { ranged: 70, defence: 40 }, 30079: { ranged: 70 }, 12492: { ranged: 70, defence: 40 },
  12494: { ranged: 70 }, 19921: { ranged: 70, defence: 40 }, 21018: { magic: 75, defence: 65 }, 21021: { magic: 75, defence: 65 },
  21024: { magic: 75, defence: 65 }, 27251: { magic: 80, defence: 80, prayer: 80 }, 6920: { magic: 50, defence: 25 },
  29019: { magic: 75, defence: 50 }, 29013: { magic: 75, defence: 50 }, 29016: { magic: 75, defence: 50 }, 29037: { magic: 75, defence: 50 },
  26243: { magic: 78, defence: 75 }, 26245: { magic: 78, defence: 75 }, 4712: { magic: 70, defence: 70 }, 4714: { magic: 70, defence: 70 },
  25404: { magic: 60, defence: 60 }, 25416: { magic: 60, defence: 60 }, 12002: { magic: 70 }, 28933: { prayer: 60, defence: 40 },
  28936: { prayer: 60, defence: 40 }, 28939: { prayer: 60, defence: 40 }, 22954: { prayer: 60 }, 22986: { prayer: 70 },
  12817: { defence: 75, prayer: 75 }, 31097: { defence: 80, strength: 80, ranged: 80, magic: 80 }, 31106: { hitpoints: 90 },
  19544: { hitpoints: 75 }, 29801: { hitpoints: 90 }, 29804: { hitpoints: 90 },
}

/** scim: per-skill maximum over equipped and carried items. */
export function loadoutRequirements(equipment: Equipment, inventory: Inventory): Partial<Record<SkillName, number>> {
  const out: Partial<Record<SkillName, number>> = {}
  const add = (id: number): void => {
    const req = ITEM_REQUIREMENTS[id]
    if (!req) return
    for (const k of SKILLS) {
      const v = req[k]
      if (v !== undefined && v > (out[k] ?? 0)) out[k] = v
    }
  }
  for (const id of Object.values(equipment)) if (typeof id === 'number') add(id)
  for (const item of inventory) if (item) add(item.id)
  return out
}
