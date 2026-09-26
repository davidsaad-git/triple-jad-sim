/**
 * Monster data for the triple-Jad wave, from scim's monster JSON (* entries `"ids":[7700,7704,10623]` and `"ids":[7701,7705,10624]`) mapped
 * through. Ranged defence uses `rangedStandard`.
 */
import type { NpcFormulaStats } from '../core/types'

export interface MonsterEntry {
  readonly ids: readonly number[]
  readonly name: string
  readonly size: number
  readonly hitpoints: number
  readonly attackSpeed: number
  readonly formulaStats: NpcFormulaStats
}

export const JALTOK_JAD: MonsterEntry = {
  ids: [7700, 7704, 10623],
  name: 'JalTok-Jad',
  size: 5,
  hitpoints: 350,
  attackSpeed: 8,
  formulaStats: {
    burnImmunity: 'Normal',
    freezeResistance: 0,
    poisonResistance: 100,
    attributes: [],
    levels: { attack: 750, strength: 1020, defence: 480, ranged: 1020, magic: 510 },
    offensive: { atk: 0, ranged: 80, magic: 100, str: 0, rangedStr: 0, magicStr: 75 },
    defensive: { stab: 0, slash: 0, crush: 0, ranged: 0, magic: 0 },
  },
}

export const YT_HURKOT: MonsterEntry = {
  ids: [7701, 7705, 10624],
  name: 'Yt-HurKot',
  size: 1,
  hitpoints: 90,
  attackSpeed: 4,
  formulaStats: {
    burnImmunity: 'Weak',
    freezeResistance: 0,
    poisonResistance: 0,
    attributes: [],
    levels: { attack: 165, strength: 125, defence: 100, ranged: 150, magic: 150 },
    offensive: { atk: 0, ranged: 80, magic: 100, str: 0, rangedStr: 0, magicStr: 0 },
    defensive: { stab: 0, slash: 0, crush: 0, ranged: 130, magic: 130 },
  },
}

const BY_ID = new Map<number, MonsterEntry>()
for (const m of [JALTOK_JAD, YT_HURKOT]) for (const id of m.ids) BY_ID.set(id, m)

export function monsterById(npcTypeId: number): MonsterEntry | undefined {
  return BY_ID.get(npcTypeId)
}

/** Deep copy (scim uses `structuredClone` of the formula stats per actor). */
export function cloneFormulaStats(s: NpcFormulaStats): NpcFormulaStats {
  return {
    ...s,
    attributes: [...s.attributes],
    levels: { ...s.levels },
    offensive: { ...s.offensive },
    defensive: { ...s.defensive },
  }
}
