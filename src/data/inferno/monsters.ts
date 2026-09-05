/**
 * Inferno monster definitions. Levels and bonuses from the OSRS wiki; see
 * docs/INFERNO_DATA.md for sources and open questions.
 */
export type AttackStyle = 'stab' | 'slash' | 'crush' | 'ranged' | 'magic' | 'typeless'

export interface OffensiveBonuses {
  attack: number
  strength: number
  magicAttack: number
  magicDamage: number
  rangedAttack: number
  rangedStrength: number
}

export interface DefensiveBonuses {
  stab: number
  slash: number
  crush: number
  magic: number
  ranged: number
}

export interface MonsterLevels {
  hitpoints: number
  attack: number
  strength: number
  defence: number
  magic: number
  ranged: number
}

export interface MonsterAnimations {
  /** Client sequence ids. */
  idle: number
  walk: number
  attack: number
  attackAlt?: number
  attackMagic?: number
  attackRanged?: number
  defend: number
  death: number
  special?: number
}

export interface MonsterDef {
  key: MonsterKey
  name: string
  npcIds: readonly number[]
  combatLevel: number
  size: number
  levels: MonsterLevels
  offensive: OffensiveBonuses
  defensive: DefensiveBonuses
  /** Ticks between attacks. */
  attackSpeed: number
  /** Tiles; 1 = melee only. */
  attackRange: number
  styles: readonly AttackStyle[]
  /** Ticks from attack animation start until the hit lands. */
  ticksAfterAnimation: number
  animations: MonsterAnimations
}

export type MonsterKey =
  | 'nibbler'
  | 'bat'
  | 'blob'
  | 'blobletMelee'
  | 'blobletRanged'
  | 'blobletMagic'
  | 'meleer'
  | 'ranger'
  | 'mager'
  | 'jad'
  | 'jadHealer'
  | 'zuk'
  | 'zukHealer'
  | 'ancestralGlyph'

const zeroOff: OffensiveBonuses = { attack: 0, strength: 0, magicAttack: 0, magicDamage: 0, rangedAttack: 0, rangedStrength: 0 }
const zeroDef: DefensiveBonuses = { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 0 }

// Animation ids not yet confirmed from the cache are marked with the closest known
// id and verified once NpcType decoding lands (NpcType gives idle/walk directly).
export const MONSTERS: Record<MonsterKey, MonsterDef> = {
  nibbler: {
    key: 'nibbler',
    name: 'Jal-Nib',
    npcIds: [7691],
    combatLevel: 32,
    size: 1,
    levels: { hitpoints: 10, attack: 1, strength: 1, defence: 15, magic: 15, ranged: 1 },
    offensive: zeroOff,
    defensive: { stab: -20, slash: -20, crush: -20, magic: -20, ranged: -20 },
    attackSpeed: 4,
    attackRange: 1,
    styles: ['crush'],
    ticksAfterAnimation: 4,
    animations: { idle: 7573, walk: 7572, attack: 7574, defend: 7575, death: 7576 },
  },
  bat: {
    key: 'bat',
    name: 'Jal-MejRah',
    npcIds: [7692],
    combatLevel: 85,
    size: 2,
    levels: { hitpoints: 25, attack: 0, strength: 0, defence: 55, magic: 120, ranged: 120 },
    offensive: { ...zeroOff, rangedAttack: 30, rangedStrength: 30 },
    defensive: { stab: 30, slash: 30, crush: 30, magic: -20, ranged: 45 },
    attackSpeed: 3,
    attackRange: 4,
    styles: ['ranged'],
    ticksAfterAnimation: 3,
    animations: { idle: 7577, walk: 7579, attack: 7578, defend: 7579, death: 7580 },
  },
  blob: {
    key: 'blob',
    name: 'Jal-Ak',
    npcIds: [7693],
    combatLevel: 165,
    size: 3,
    levels: { hitpoints: 40, attack: 160, strength: 160, defence: 95, magic: 160, ranged: 160 },
    offensive: { ...zeroOff, strength: 45, magicDamage: 45, rangedStrength: 45 },
    defensive: { stab: 25, slash: 25, crush: 25, magic: 25, ranged: 25 },
    attackSpeed: 6,
    attackRange: 15,
    styles: ['magic', 'ranged', 'crush'],
    ticksAfterAnimation: 6,
    animations: { idle: 7584, walk: 7585, attack: 7582, attackRanged: 7581, attackMagic: 7583, defend: 7586, death: 7587 },
  },
  blobletMelee: {
    key: 'blobletMelee',
    name: 'Jal-AkRek-Ket',
    npcIds: [7696],
    combatLevel: 70,
    size: 1,
    levels: { hitpoints: 15, attack: 120, strength: 120, defence: 95, magic: 1, ranged: 1 },
    offensive: { ...zeroOff, strength: 25 },
    defensive: { stab: 25, slash: 25, crush: 25, magic: 0, ranged: 0 },
    attackSpeed: 4,
    attackRange: 1,
    styles: ['crush'],
    ticksAfterAnimation: 4,
    animations: { idle: 7584, walk: 7585, attack: 7582, defend: 7586, death: 7587 },
  },
  blobletRanged: {
    key: 'blobletRanged',
    name: 'Jal-AkRek-Xil',
    npcIds: [7695],
    combatLevel: 70,
    size: 1,
    levels: { hitpoints: 15, attack: 1, strength: 1, defence: 95, magic: 1, ranged: 120 },
    offensive: { ...zeroOff, rangedAttack: 25, rangedStrength: 25 },
    defensive: { stab: 0, slash: 0, crush: 0, magic: 0, ranged: 25 },
    attackSpeed: 4,
    attackRange: 15,
    styles: ['ranged'],
    ticksAfterAnimation: 4,
    animations: { idle: 7584, walk: 7585, attack: 7581, defend: 7586, death: 7587 },
  },
  blobletMagic: {
    key: 'blobletMagic',
    name: 'Jal-AkRek-Mej',
    npcIds: [7694],
    combatLevel: 70,
    size: 1,
    levels: { hitpoints: 15, attack: 1, strength: 1, defence: 95, magic: 120, ranged: 1 },
    offensive: { ...zeroOff, magicAttack: 25, magicDamage: 25 },
    defensive: { stab: 0, slash: 0, crush: 0, magic: 25, ranged: 0 },
    attackSpeed: 4,
    attackRange: 15,
    styles: ['magic'],
    ticksAfterAnimation: 4,
    animations: { idle: 7584, walk: 7585, attack: 7583, defend: 7586, death: 7587 },
  },
  meleer: {
    key: 'meleer',
    name: 'Jal-ImKot',
    npcIds: [7697],
    combatLevel: 240,
    size: 4,
    levels: { hitpoints: 75, attack: 210, strength: 290, defence: 120, magic: 120, ranged: 220 },
    offensive: { ...zeroOff, strength: 40 },
    defensive: { stab: 65, slash: 65, crush: 65, magic: 30, ranged: 50 },
    attackSpeed: 4,
    attackRange: 1,
    styles: ['slash'],
    ticksAfterAnimation: 4,
    animations: { idle: 7595, walk: 7596, attack: 7597, defend: 7598, death: 7599, special: 7600 },
  },
  ranger: {
    key: 'ranger',
    name: 'Jal-Xil',
    npcIds: [7698, 7702],
    combatLevel: 370,
    size: 3,
    levels: { hitpoints: 125, attack: 140, strength: 180, defence: 60, magic: 90, ranged: 250 },
    offensive: { ...zeroOff, rangedAttack: 40, rangedStrength: 50 },
    defensive: zeroDef,
    attackSpeed: 4,
    attackRange: 98,
    styles: ['ranged', 'crush'],
    ticksAfterAnimation: 4,
    animations: { idle: 7601, walk: 7602, attack: 7605, attackAlt: 7604, defend: 7606, death: 7607 },
  },
  mager: {
    key: 'mager',
    name: 'Jal-Zek',
    npcIds: [7699, 7703],
    combatLevel: 490,
    size: 4,
    levels: { hitpoints: 220, attack: 370, strength: 510, defence: 260, magic: 300, ranged: 510 },
    offensive: { ...zeroOff, magicDamage: 80 },
    defensive: zeroDef,
    attackSpeed: 4,
    attackRange: 98,
    styles: ['magic', 'stab'],
    ticksAfterAnimation: 4,
    animations: { idle: 7608, walk: 7609, attack: 7610, attackAlt: 7612, defend: 7613, death: 7614, special: 7611 },
  },
  jad: {
    key: 'jad',
    name: 'JalTok-Jad',
    npcIds: [7700, 7704],
    combatLevel: 900,
    size: 5,
    levels: { hitpoints: 350, attack: 750, strength: 1020, defence: 480, magic: 510, ranged: 1020 },
    offensive: { ...zeroOff, magicAttack: 100, magicDamage: 75, rangedAttack: 80 },
    defensive: zeroDef,
    attackSpeed: 8,
    attackRange: 99,
    styles: ['ranged', 'magic', 'stab'],
    ticksAfterAnimation: 3,
    animations: { idle: 7588, walk: 7589, attack: 7590, attackMagic: 7592, attackRanged: 7593, defend: 7591, death: 7594 },
  },
  jadHealer: {
    key: 'jadHealer',
    name: 'Yt-HurKot',
    npcIds: [7701, 7705],
    combatLevel: 141,
    size: 1,
    levels: { hitpoints: 90, attack: 165, strength: 125, defence: 100, magic: 150, ranged: 150 },
    offensive: zeroOff,
    defensive: { stab: 0, slash: 0, crush: 0, magic: 100, ranged: 100 },
    attackSpeed: 4,
    attackRange: 1,
    styles: ['crush'],
    ticksAfterAnimation: 4,
    animations: { idle: 2637, walk: 2638, attack: 2639, defend: 2640, death: 2641, special: 2642 },
  },
  zuk: {
    key: 'zuk',
    name: 'TzKal-Zuk',
    npcIds: [7706],
    combatLevel: 1400,
    size: 7,
    levels: { hitpoints: 1200, attack: 350, strength: 600, defence: 260, magic: 150, ranged: 400 },
    offensive: { attack: 0, strength: 200, magicAttack: 550, magicDamage: 450, rangedAttack: 550, rangedStrength: 200 },
    defensive: { stab: 0, slash: 0, crush: 0, magic: 350, ranged: 100 },
    attackSpeed: 10,
    attackRange: 99,
    styles: ['typeless'],
    ticksAfterAnimation: 10,
    animations: { idle: 7564, walk: 7564, attack: 7566, defend: 7565, death: 7562, special: 7563 },
  },
  zukHealer: {
    key: 'zukHealer',
    name: 'Jal-MejJak',
    npcIds: [7708],
    combatLevel: 250,
    size: 1,
    levels: { hitpoints: 75, attack: 1, strength: 1, defence: 100, magic: 1, ranged: 1 },
    offensive: zeroOff,
    defensive: zeroDef,
    attackSpeed: 3,
    attackRange: 99,
    styles: ['typeless'],
    ticksAfterAnimation: 3,
    animations: { idle: 2857, walk: 2857, attack: 2858, defend: 2859, death: 2860 },
  },
  ancestralGlyph: {
    key: 'ancestralGlyph',
    name: 'Ancestral Glyph',
    npcIds: [7707],
    combatLevel: 0,
    size: 5,
    levels: { hitpoints: 600, attack: 1, strength: 1, defence: 1, magic: 1, ranged: 1 },
    offensive: zeroOff,
    defensive: zeroDef,
    attackSpeed: 0,
    attackRange: 0,
    styles: [],
    ticksAfterAnimation: 0,
    animations: { idle: 7567, walk: 7567, attack: 7567, defend: 7568, death: 7569 },
  },
}

export const ZUK_ENRAGE_HITPOINTS = 240
export const ZUK_ENRAGED_ATTACK_SPEED = 7
export const ZUK_JAD_HITPOINTS = 480
export const ZUK_HEALERS_HITPOINTS = 240
export const ZUK_SET_PAUSE_HITPOINTS = 600
export const ZUK_SET_PERIOD_TICKS = 350
export const ZUK_FIRST_SET_TICKS = 72
export const ZUK_SET_RESUME_BONUS_TICKS = 175
export const ZUK_MAX_HIT = 148
export const ZUK_SHIELD_HITPOINTS = 600
export const JAD_HEALER_TRIGGER_FRACTION = 0.5
export const JAD_HEALER_COUNT_SINGLE = 5
export const JAD_HEALER_COUNT_TRIPLE = 3
