/**
 * Special-attack table and lookup/`ey`.
 * The formula side (profiles) lives in attackPlan.ts (`vq`).
 */
import { canonicalItemId } from '../items/variants'
import type { FormulaStyle, OnKillEffect, PostHitEffect } from './types'

export interface TargetGraphic {
  spotAnimId: number
  delayCycles: number | 'projectile_arrival'
  height: number
}

export interface SpecialAttackDef {
  energyCost?: number
  defenceStyle?: FormulaStyle
  animationId?: number
  graphicId?: number
  targetGraphic?: TargetGraphic
  postHitEffects?: PostHitEffect[]
  onFireEffects?: PostHitEffect[]
  onKillEffect?: OnKillEffect
  isMultiHit?: boolean
  instantEffect?: 'powerOfDeath'
  poweredSpellWeaponId?: number
  styleOverride?: 'magic' | 'range' | 'melee'
  attackKindOverride?: string
  attackSpeedOverride?: number
  hitDelayTicks?: number
  targetAttribute?: string
  guaranteedHit?: boolean
  launchHeal?: { percentOfDamage: number; minimumHeal: number }
}

const VOIDWAKER_LIKE: SpecialAttackDef = {
  energyCost: 50,
  defenceStyle: 'melee_crush',
  animationId: 11124,
  graphicId: 2804,
  postHitEffects: [{ effect: 'drain_defence', percent: 35 }],
}
const ACCURSED: SpecialAttackDef = {
  energyCost: 50,
  poweredSpellWeaponId: 27665,
  styleOverride: 'magic',
  attackKindOverride: 'magic_fire',
  animationId: 9961,
  postHitEffects: [{ effect: 'condemn' }],
}
const ABYSSAL_TENTACLE: SpecialAttackDef = {
  energyCost: 50,
  animationId: 1658,
  targetGraphic: { spotAnimId: 341, delayCycles: 0, height: 96 },
  onFireEffects: [
    { effect: 'freeze', durationTicks: 8 },
    { effect: 'poison', severity: 4, chancePercent: 50 },
  ],
}
const POWER_OF_DEATH: SpecialAttackDef = { energyCost: 100, instantEffect: 'powerOfDeath' }
const DDS: SpecialAttackDef = { defenceStyle: 'melee_slash', animationId: 1062 }
const DRAGON_CLAWS: SpecialAttackDef = { defenceStyle: 'melee_slash', energyCost: 50, isMultiHit: true, animationId: 7514, graphicId: 1171 }
const SGS: SpecialAttackDef = {
  defenceStyle: 'melee_slash',
  energyCost: 50,
  animationId: 7640,
  graphicId: 1209,
  postHitEffects: [
    { effect: 'heal_hp', percentOfDamage: 50 },
    { effect: 'restore_prayer', percentOfDamage: 25 },
  ],
}
const BGS: SpecialAttackDef = { defenceStyle: 'melee_slash', energyCost: 50, animationId: 7642, postHitEffects: [{ effect: 'drain_defence', flat: true }] }
const AGS: SpecialAttackDef = { defenceStyle: 'melee_slash', energyCost: 50, animationId: 7644, graphicId: 1211 }
const ZGS: SpecialAttackDef = { defenceStyle: 'melee_slash', energyCost: 50, animationId: 7638, graphicId: 1210, postHitEffects: [{ effect: 'freeze', durationTicks: 32 }] }
const WHIP: SpecialAttackDef = { energyCost: 50, defenceStyle: 'melee_slash', animationId: 1658, targetGraphic: { spotAnimId: 341, delayCycles: 0, height: 96 } }
const ANIM = (animationId: number, defenceStyle?: FormulaStyle): SpecialAttackDef =>
  defenceStyle === undefined ? { animationId } : { defenceStyle, animationId }


export const SPECIAL_ATTACKS: Readonly<Record<number, SpecialAttackDef>> = {
  29589: { energyCost: 50, defenceStyle: 'melee_stab', animationId: 11138, graphicId: 2810, postHitEffects: [{ effect: 'weaken' }] },
  27665: ACCURSED,
  27679: ACCURSED,
  27676: ACCURSED,
  11791: POWER_OF_DEATH,
  12904: POWER_OF_DEATH,
  22296: POWER_OF_DEATH,
  24144: POWER_OF_DEATH,
  12006: ABYSSAL_TENTACLE,
  26484: ABYSSAL_TENTACLE,
  13652: DRAGON_CLAWS,
  20784: DRAGON_CLAWS,
  11806: SGS,
  20372: SGS,
  11804: BGS,
  20370: BGS,
  11802: AGS,
  20368: AGS,
  11808: ZGS,
  20374: ZGS,
  13576: { defenceStyle: 'melee_crush', energyCost: 50, animationId: 1378, postHitEffects: [{ effect: 'drain_defence', percent: 30 }] },
  31113: { energyCost: 50, animationId: 12394, graphicId: 3364, attackSpeedOverride: 5, postHitEffects: [{ effect: 'drain_magic', base: 0, percentOfDamage: 100 }] },
  29594: { energyCost: 25, styleOverride: 'magic', onKillEffect: { refundSpecEnergy: 25, reduceAttackDelayTicks: 3 } },
  27690: {
    energyCost: 50,
    styleOverride: 'magic',
    attackKindOverride: 'magic_fire',
    guaranteedHit: true,
    animationId: 11275,
    graphicId: 2834,
    targetGraphic: { spotAnimId: 2363, delayCycles: 0, height: 0 },
  },
  29591: {
    energyCost: 25,
    targetAttribute: 'demon',
    animationId: 11133,
    graphicId: 2806,
    targetGraphic: { spotAnimId: 2808, delayCycles: 'projectile_arrival', height: 0 },
    hitDelayTicks: 3,
    onFireEffects: [
      { effect: 'bind', delayTicks: 2, durationTicks: 21 },
      { effect: 'burn', firstPulseDelayTicks: 3, pulses: 6, severity: 'normal' },
    ],
  },
  29577: {
    energyCost: 35,
    isMultiHit: true,
    animationId: 11140,
    graphicId: 2814,
    postHitEffects: [{ effect: 'burn', pulses: 10, severity: 'normal', chancePercentByBranch: [15, 30, 45] }],
  },
  11785: { energyCost: 50, animationId: 7552 },
  12926: { energyCost: 50, animationId: 5061, launchHeal: { percentOfDamage: 50, minimumHeal: 0 } },
  1215: DDS,
  1231: DDS,
  5680: DDS,
  5698: DDS,
  13265: ANIM(3300, 'melee_slash'),
  13267: ANIM(3300, 'melee_slash'),
  13269: ANIM(3300, 'melee_slash'),
  13271: ANIM(3300, 'melee_slash'),
  1305: ANIM(1058, 'melee_slash'),
  21009: ANIM(7515, 'melee_stab'),
  4587: { energyCost: 55, defenceStyle: 'melee_slash', animationId: 1872 },
  1434: ANIM(1060, 'melee_crush'),
  11061: ANIM(6147, 'melee_crush'),
  4153: ANIM(1667),
  12848: ANIM(1667),
  1377: ANIM(1056),
  3204: ANIM(1203, 'melee_slash'),
  23987: ANIM(1203, 'melee_slash'),
  23986: ANIM(1203, 'melee_slash'),
  1249: { energyCost: 25, animationId: 1064 },
  1263: { energyCost: 25, animationId: 1064 },
  5716: { energyCost: 25, animationId: 1064 },
  5730: { energyCost: 25, animationId: 1064 },
  11824: { energyCost: 25, animationId: 1064 },
  11889: { energyCost: 25, animationId: 1064 },
  4151: WHIP,
  12773: WHIP,
  12774: WHIP,
  26482: WHIP,
  11838: ANIM(1132),
  12809: ANIM(1132),
  13263: { animationId: 3299, targetGraphic: { spotAnimId: 1284, delayCycles: 15, height: 0 } },
  21003: VOIDWAKER_LIKE,
  27100: VOIDWAKER_LIKE,
  21015: ANIM(7511, 'melee_crush'),
  11235: ANIM(426),
  12765: ANIM(426),
  12766: ANIM(426),
  12767: ANIM(426),
  12768: ANIM(426),
  861: ANIM(426),
  12788: ANIM(426),
  19478: ANIM(7555),
  19481: ANIM(7555),
  21902: ANIM(4230),
  26219: { defenceStyle: 'melee_stab', energyCost: 25, animationId: 9471 },
  27246: { defenceStyle: 'melee_stab', energyCost: 25, animationId: 9471 },
  23995: ANIM(390),
  24551: ANIM(390),
  25870: ANIM(390),
  25872: ANIM(390),
  25874: ANIM(390),
  25876: ANIM(390),
  25878: ANIM(390),
  25880: ANIM(390),
  25882: ANIM(390),
  24424: ANIM(8532),
  24425: ANIM(8532),
  22613: ANIM(7515, 'melee_stab'),
  22622: ANIM(7515, 'melee_stab'),
  22616: ANIM(1378, 'melee_crush'),
  22625: ANIM(1378, 'melee_crush'),
  22610: ANIM(8184),
  22619: ANIM(8184),
  22634: ANIM(929),
  22636: ANIM(929),
  22631: ANIM(929),
  22633: ANIM(929),
  11920: ANIM(400),
  12797: ANIM(400),
  23677: ANIM(400),
  25376: ANIM(400),
  4755: ANIM(2062),
  4982: ANIM(2062),
}

/** scim: the special-attack definition for a weapon (the blowpipe variant 28688 uses anim 10656). */
export function specialAttackOf(weaponId: number): SpecialAttackDef | undefined {
  const def = SPECIAL_ATTACKS[canonicalItemId(weaponId)]
  return def !== undefined && weaponId === 28688 ? { ...def, animationId: 10656 } : def
}


export function hasSpecialAttack(weaponId: number): boolean {
  return specialAttackOf(weaponId) !== undefined
}
