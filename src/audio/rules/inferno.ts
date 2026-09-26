/**
 * Inferno / TzKal-Zuk encounter sound layer, scim.gg (bundle
 *, `audio.layerName = "zuk"`). It sits before the core layer in
 * the chain.
 *
 * Only the JalTok-Jad and Yt-HurKot branches can fire in the triple-Jad
 * fight; the Zuk / Jal-Zek / Jal-Xil branches are kept so the layer stays a
 * 1:1 port (their event payloads simply never occur). scim's Jal-MejJak
 * `zuk_healer_cast` / `zuk_ground_effect` rules (155 @51, area r8) are left
 * out because our SimEvent union has no such event types.
 *
 * Every Jad and healer sound is plain sfx: no distance attenuation.
 */
import type { SimEvent } from '../../sim/api'
import { play, type RuleLayer, SILENT, type SoundEntry } from './types'

export const INFERNO_SOUNDS = {
  /** Jad magic wind-up (zuk_jad_cue, style magic). */
  jadMagicCue: 159,
  /** Jad magic release. */
  jadMagic: 162,
  /** Jad magic projectile arrival / Jad range release. */
  jadRangeOrImpact: 163,
  jadMelee: 408,
  jadDeath: 409,
  jadHit: 410,
  healerMelee: 608,
  healerHit: 610,
  zukBlast: 155,
  zukImpact: 156,
  zekXil: 598,
  zekXilDeath: 599,
  zekXilHit: 600,
  mejJakDeath: 899,
  mejJakHit: 900,
} as const

const S = INFERNO_SOUNDS

type Ev<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v)
}

/** scim: finite [x, y]. */
function isTile(v: unknown): boolean {
  return Array.isArray(v) && v.length === 2 && Number.isFinite(v[0]) && Number.isFinite(v[1])
}

/** scim: stamped event. */
function isStamped(e: SimEvent): boolean {
  return Number.isInteger(e.eventId) && Number.isInteger(e.tick)
}

const ATTACKS = new Set(['zuk_blast', 'mager_magic', 'mager_melee', 'ranger_range', 'ranger_melee', 'jad_magic', 'jad_range', 'jad_melee', 'jad_healer_melee'])
const OWNERS = new Set(['zuk', 'shield', 'mager', 'ranger', 'jad', 'jad_healer', 'healer'])


function isValidAttack(e: SimEvent): e is Ev<'zuk_attack'> {
  if (e.type !== 'zuk_attack' || !isStamped(e)) return false
  const a = e as Ev<'zuk_attack'>
  return (
    ATTACKS.has(a.attack) &&
    typeof a.sourceId === 'string' &&
    typeof a.targetId === 'string' &&
    isTile(a.sourcePosition) &&
    isTile(a.targetPosition) &&
    isInt(a.launchTick) &&
    isInt(a.impactTick) &&
    a.impactTick >= a.launchTick &&
    (a.projectileArrivalCycles === undefined || (Number.isFinite(a.projectileArrivalCycles) && a.projectileArrivalCycles >= 0))
  )
}


function isValidOwnerEvent(e: SimEvent, type: 'zuk_hit' | 'zuk_death'): e is Ev<'zuk_hit'> | Ev<'zuk_death'> {
  if (e.type !== type || !isStamped(e)) return false
  const o = e as Ev<'zuk_hit'>
  return typeof o.actorId === 'string' && OWNERS.has(o.npcKind) && isTile(o.position)
}

/** Loose structural check of an inferno_visual payload (scim validates it with a schema `qv`). */
function isValidVisual(e: SimEvent): e is Ev<'inferno_visual'> {
  if (e.type !== 'inferno_visual' || !isStamped(e) || e.eventId < 0 || e.tick < 0) return false
  const v = e as Ev<'inferno_visual'>
  if (!Array.isArray(v.animations) || !Array.isArray(v.projectiles) || !Array.isArray(v.graphics)) return false
  for (const p of v.projectiles) if (!(p.endDelayCycles >= p.startDelayCycles)) return false
  for (const g of v.graphics) {
    if (!isInt(g.spotAnimId) || g.spotAnimId < 0 || !isInt(g.delayCycles) || g.delayCycles < 0) return false
    if (!g.target || (g.target.kind !== 'tile' && g.target.kind !== 'actor') || !isTile(g.target.position)) return false
  }
  return true
}

/** Spotanim 659 (Jal-MejJak spark / Zuk falling rock tile graphic). */
const TILE_IMPACT_SPOTANIM = 659

export const INFERNO_LAYER: RuleLayer = {
  name: 'zuk',
  rules: {
    inferno_visual: {
      resolve: (e) => {
        if (!isValidVisual(e)) return SILENT
        const entries: SoundEntry[] = []
        for (const g of e.graphics) {
          if (g.spotAnimId === TILE_IMPACT_SPOTANIM && g.target.kind === 'tile') {
            entries.push({ id: S.zukImpact, delayCycles: g.delayCycles, position: g.target.position, range: 8, channel: 'area' })
          }
        }
        return play(entries)
      },
      preloadIds: [S.zukImpact],
    },
    zuk_attack: {
      resolve: (e) => {
        if (!isValidAttack(e)) return SILENT
        switch (e.attack as string) {
          case 'zuk_blast': {
            const entries: SoundEntry[] = [
              e.targetId === 'player' ? { id: S.zukBlast, channel: 'sfx' } : { id: S.zukBlast, position: e.sourcePosition, range: 15, channel: 'area' },
            ]
            if (e.projectileArrivalCycles !== undefined) {
              entries.push({ id: S.zukImpact, delayCycles: e.projectileArrivalCycles, position: e.targetPosition, range: 10, channel: 'area' })
            }
            return play(entries)
          }
          case 'mager_magic':
            return e.targetId === 'player' ? play(S.zekXil, { channel: 'sfx' }) : play(S.zekXil, { position: e.sourcePosition, range: 10, channel: 'area' })
          case 'ranger_range':
            return play({ id: S.zekXil, delayCycles: 50, channel: 'sfx' })
          case 'mager_melee':
          case 'ranger_melee':
            return SILENT
          case 'jad_magic':
            return play(
              e.projectileArrivalCycles === undefined ? [S.jadMagic] : [S.jadMagic, { id: S.jadRangeOrImpact, delayCycles: e.projectileArrivalCycles }],
              { channel: 'sfx' },
            )
          case 'jad_range':
            return play(S.jadRangeOrImpact, { channel: 'sfx' })
          case 'jad_healer_melee':
            return play(S.healerMelee, { channel: 'sfx' })
          case 'jad_melee':
            return play(S.jadMelee, { channel: 'sfx' })
          default:
            return SILENT
        }
      },
      preloadIds: [S.zukBlast, S.zukImpact, S.zekXil, S.jadMagic, S.jadRangeOrImpact, S.healerMelee, S.jadMelee],
    },
    zuk_jad_cue: {
      resolve: (e) => (e.type === 'zuk_jad_cue' && e.style === 'magic' && typeof e.sourceId === 'string' ? play(S.jadMagicCue, { channel: 'sfx' }) : SILENT),
      preloadIds: [S.jadMagicCue],
    },
    zuk_death: {
      resolve: (e) => {
        if (!isValidOwnerEvent(e, 'zuk_death')) return SILENT
        switch (e.npcKind as string) {
          case 'mager':
          case 'ranger':
            return play(S.zekXilDeath, { channel: 'sfx' })
          case 'jad':
            return play(S.jadDeath, { channel: 'sfx' })
          case 'healer':
            return play(S.mejJakDeath, { channel: 'sfx' })
          default:
            // zuk, shield, jad_healer: silent
            return SILENT
        }
      },
      preloadIds: [S.zekXilDeath, S.jadDeath, S.mejJakDeath],
    },
    zuk_hit: {
      resolve: (e) => {
        if (!isValidOwnerEvent(e, 'zuk_hit')) return SILENT
        switch (e.npcKind as string) {
          case 'zuk':
          case 'jad':
            return play(S.jadHit, { channel: 'sfx' })
          case 'mager':
          case 'ranger':
            return play(S.zekXilHit, { channel: 'sfx' })
          case 'jad_healer':
            return play(S.healerHit, { channel: 'sfx' })
          case 'healer':
            return play(S.mejJakHit, { channel: 'sfx' })
          default:
            // shield: silent
            return SILENT
        }
      },
      preloadIds: [S.jadHit, S.zekXilHit, S.healerHit, S.mejJakHit],
    },
  },
}
