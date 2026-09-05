import type { MonsterKey } from '../../data/inferno/monsters'
import { NIBBLER_SPAWN_BLOCK, SPAWN_TILES, waveCounts, type RegionTile } from '../../data/inferno/waves'
import type { Random } from '../Random'

export interface SpawnPlan {
  key: MonsterKey
  x: number
  y: number
}

/**
 * Roll the spawn positions for a standard wave (1..66): shuffle the nine
 * spawn tiles and hand them out mager, ranger, meleer, blob, bat; nibblers
 * take random tiles of the centre block. Deterministic for a given RNG state.
 */
export function rollWaveSpawns(wave: number, rng: Random): SpawnPlan[] {
  const [nibblers, bats, blobs, meleers, rangers, magers] = waveCounts(wave)
  const tiles = rng.shuffle([...SPAWN_TILES])
  const plan: SpawnPlan[] = []
  let next = 0
  const take = (key: MonsterKey, n: number) => {
    for (let i = 0; i < n; i++) {
      const t = tiles[next++]
      if (!t) throw new Error('ran out of spawn tiles')
      plan.push({ key, x: t.x, y: t.y })
    }
  }
  take('mager', magers)
  take('ranger', rangers)
  take('meleer', meleers)
  take('blob', blobs)
  take('bat', bats)

  const block = rng.shuffle([...NIBBLER_SPAWN_BLOCK])
  for (let i = 0; i < nibblers; i++) {
    const t: RegionTile | undefined = block[i]
    if (!t) break
    plan.push({ key: 'nibbler', x: t.x, y: t.y })
  }
  return plan
}

/** Encode a plan as a scouter-style string for sharing / replays. */
export function encodeSpawnPlan(plan: readonly SpawnPlan[]): string {
  const letters: Record<string, string> = { bat: 'Y', blob: 'B', ranger: 'R', meleer: 'X', mager: 'M' }
  return SPAWN_TILES.map((t) => {
    const s = plan.find((p) => p.x === t.x && p.y === t.y && p.key !== 'nibbler')
    return s ? letters[s.key] ?? 'o' : 'o'
  }).join('')
}
