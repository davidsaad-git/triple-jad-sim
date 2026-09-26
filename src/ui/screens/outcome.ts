/**
 * Outcome selection and the data behind the victory / defeat screens
 * (scim, fight record, death table helpers
 * `tee`/`ree`/`am`).
 */
import type { DamageHistoryEntry, SimState } from '../../sim/api'

export type OutcomeScreen = 'death' | 'victory' | 'none'


export function selectOutcome(o: { playerFailed: boolean; outcomePhase: string; tutorialOwned?: boolean; isReplaying: boolean; hasVictoryDescriptor: boolean }): OutcomeScreen {
  if (o.playerFailed) return 'death'
  return o.outcomePhase === 'victory' && !o.tutorialOwned && !o.isReplaying && o.hasVictoryDescriptor ? 'victory' : 'none'
}

export interface FightRecord {
  killTime: string
  damageDealt: number
  damageTaken: number
  hpRemaining: string
  prayerRemaining: string
}


export function fightRecord(s: SimState): FightRecord | null {
  const o = s.encounterOutcome
  if (o.phase !== 'victory') return null
  const actors = new Set(o.completionActorIds ?? [])
  const secs = Math.floor(((o.decisiveTick ?? s.currentTick) * 600) / 1000)
  const dealt = s.damageHistory.filter((e) => e.source === 'PlayerAttack' && actors.has(e.targetId)).reduce((a, e) => a + Math.max(0, e.hpBefore - e.hpAfter), 0)
  const taken = s.damageHistory.filter((e) => e.targetId === 'player').reduce((a, e) => a + e.effectiveDamage, 0)
  return {
    killTime: `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`,
    damageDealt: dealt,
    damageTaken: taken,
    hpRemaining: `${s.playerHP} / ${s.maxHP}`,
    prayerRemaining: `${s.prayerState.points} / ${s.prayerState.maxPoints}`,
  }
}

const REASONS: Record<string, string> = { Death: 'Slain in combat' }

function splitCamel(s: string): string {
  return s.replace(/([A-Z])/g, ' $1').trim()
}

/** scim: failed condition -> reason line. */
export function deathReason(failedCondition: string | null | undefined): string {
  if (!failedCondition) return 'Slain in combat'
  return REASONS[failedCondition] ?? splitCamel(failedCondition)
}

const SOURCE_LABELS: Record<string, string> = { PlayerAttack: 'Self', Death: 'Death' }

/** NPC names for the damage table (scim from the NPC table). */
export const NPC_NAMES: Record<number, string> = { 7700: 'JalTok-Jad', 7701: 'Yt-HurKot', 7704: 'JalTok-Jad', 7705: 'Yt-HurKot' }


export function damageSource(e: DamageHistoryEntry, npcName: (id: number) => string | undefined = (id) => NPC_NAMES[id]): string {
  const byType = e.sourceNpcTypeId === undefined ? undefined : npcName(e.sourceNpcTypeId)
  return byType ?? SOURCE_LABELS[e.source] ?? splitCamel(e.source)
}

const STYLE: Record<string, string> = { melee: 'melee', range: 'ranged', magic: 'magic' }
const PRAYER: Record<string, string> = { ProtectMagic: 'Mage', ProtectRange: 'Range', ProtectMelee: 'Melee' }

export interface DeathRow {
  key: string
  tick: number
  source: string
  style: string | undefined
  amount: number
  prayer: string
  wrong: boolean
  unprayed: boolean
}

/** Last 10 hits on the player, newest first. */
export function deathRows(history: readonly DamageHistoryEntry[], npcName?: (id: number) => string | undefined): DeathRow[] {
  return [...history]
    .filter((e) => e.targetId === 'player')
    .reverse()
    .slice(0, 10)
    .map((e) => {
      const wrong = e.prayedCorrectly === false
      const typeless = e.attackType === 'typeless'
      return {
        key: `${e.tick}-${e.source}-${e.effectiveDamage}-${e.hpAfter}`,
        tick: e.tick,
        source: damageSource(e, npcName),
        style: STYLE[e.attackType],
        amount: e.effectiveDamage,
        prayer: (e.activePrayer ? (PRAYER[e.activePrayer] ?? null) : null) || (typeless ? '—' : 'None'),
        wrong,
        unprayed: !wrong && !typeless && !e.activePrayer,
      }
    })
}

/** scim: title card name split ("Hero - rest · subtitle"). */
export function splitTitle(name: string, subtitle: string | null): { heroName: string; subtitle: string | null } {
  const [first = '', ...rest] = name.split(' · ')
  const i = first.indexOf(' - ')
  const hero = i === -1 ? first : first.slice(0, i)
  const parts = [i === -1 ? null : first.slice(i + 3), subtitle ?? (rest.length ? rest.join(' · ') : null)].filter((p): p is string => p !== null && p !== '')
  return { heroName: hero, subtitle: parts.length ? parts.join(' · ') : null }
}
