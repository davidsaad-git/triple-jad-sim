/**
 * Headless triple-Jad fight driver (dev aid): a simple bot that prays against
 * each Jad cue, attacks the lowest-HP Jad and drinks brews/restores.
 * Run: npx tsx scripts/sim-run-fight.ts [presetId] [combatSeed] [encounterSeed] [verbose]
 */
import { readFileSync } from 'node:fs'
import { CacheSystem } from '../src/cache/CacheSystem'
import { openDiskZip } from '../src/cache/loadDiskZip'
import type { PrayerId, SimEvent } from '../src/sim/api'
import { createTripleJadEngine } from '../src/sim/createEngine'
import { presetLoadout } from '../src/sim/loadouts/presets'

const presetId = process.argv[2] ?? 'max_tbow'
const combatSeed = Number(process.argv[3] ?? 1)
const encounterSeed = Number(process.argv[4] ?? 2)
const verbose = process.argv[5] === 'v'
const cache = new CacheSystem(openDiskZip(new Uint8Array(readFileSync('public/osrs-cache/disk.zip'))))
const engine = createTripleJadEngine({ cache, loadout: presetLoadout(presetId), combatSeed, encounterSeed })
engine.queueOffensivePrayer(presetId === 'mage_tank' ? 'Augury' : 'Rigour')
const prayerFor = { magic: 'ProtectMagic', range: 'ProtectRange', melee: 'ProtectMelee' } as const
// Release queue: tick -> prayer needed at that release.
const releases = new Map<number, PrayerId>()
let lastTarget: string | null = null
const counts: Record<string, number> = {}
for (let i = 0; i < 400 && engine.canAdvance(); i++) {
  const s = engine.getState()
  // Pray for the next release (Jad cue -> release 3 ticks later; set prayer the tick before).
  const want = releases.get(s.currentTick + 1)
  if (want && s.activePrayer !== want) engine.queueProtectionPrayer(want)
  const alive = s.npcs.filter((n) => n.alive && n.archetypeId === 'zuk_jad').sort((a, b) => a.hp - b.hp)
  const healers = s.npcs.filter((n) => n.alive && n.archetypeId === 'zuk_jad_healer')
  const tgt = healers[0] ?? alive[0]
  if (tgt && tgt.id !== lastTarget) {
    engine.applyAction({ attackTarget: tgt.id })
    lastTarget = tgt.id
  }
  if (s.playerHP < 60) {
    const idx = s.inventory.findIndex((it) => it && [6685, 6687, 6689, 6691].includes(it.id))
    if (idx >= 0) engine.queueItemAction(idx, 'default')
  } else if (s.prayerState.points < 40) {
    const idx = s.inventory.findIndex((it) => it && [3024, 3026, 3028, 3030].includes(it.id))
    if (idx >= 0) engine.queueItemAction(idx, 'default')
  }
  engine.advanceTick(s.playerPosition)
  const evs: readonly SimEvent[] = engine.lastTickEvents
  for (const e of evs) {
    counts[e.type] = (counts[e.type] ?? 0) + 1
    if (e.type === 'zuk_jad_cue') {
      const releaseTick = e.tick + (e.style === 'melee' ? 0 : 3)
      releases.set(releaseTick, prayerFor[e.style])
    }
    if (verbose || e.type === 'zuk_jad_cue' || e.type === 'zuk_attack' || e.type === 'zuk_death' || e.type === 'actor_died' || (e.type === 'hit_applied' && e.targetId === 'player')) {
      const { type, tick, eventId: _eventId, ...rest } = e
      console.log(tick, type, JSON.stringify(rest).slice(0, 200))
    }
  }
  lastTarget = engine.getState().attackTarget
}
const s = engine.getState()
console.log('end tick', s.currentTick, 'alive', s.isAlive, 'hp', s.playerHP, 'prayer', s.prayerState.points, 'outcome', JSON.stringify(s.encounterOutcome))
console.log('npcs', s.npcs.map((n) => `${n.id}:${n.alive ? n.hp : 'dead'}`).join(' '))
console.log(counts)
console.log('dps', JSON.stringify(engine.getAdjustedTheoreticalDps()))
