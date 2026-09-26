/**
 * Synthesises every sound id the audio rules can play (plus the frame sounds
 * of the sequences that matter for the fight) from the local cache and
 * reports durations, sample counts, levels and synthesis time.
 *
 *   npx tsx scripts/audio-check-sounds.ts [public/osrs-cache/disk.zip]
 *
 * Exit code 1 when any id is missing or fails to synthesise.
 */
import { readFileSync } from 'node:fs'
import { allAudioSoundIds } from '../src/audio'
import { CacheSystem, IndexId } from '../src/cache/CacheSystem'
import { SeqTypeLoader, SpotAnimTypeLoader } from '../src/cache/config'
import { openDiskZip } from '../src/cache/loadDiskZip'
import { SAMPLE_RATE, SoundEffectLoader } from '../src/cache/sound'

const path = process.argv[2] ?? 'public/osrs-cache/disk.zip'
const t0 = performance.now()
const cache = new CacheSystem(openDiskZip(new Uint8Array(readFileSync(path))))
console.log(`opened ${path} in ${(performance.now() - t0).toFixed(0)} ms`)
console.log(`index 4: ${cache.getIndex(IndexId.SoundEffects).archiveIds.length} sound effects`)

// Frame sounds of the sequences scim tracks in this fight.
const seqs = new SeqTypeLoader(cache)
const spots = new SpotAnimTypeLoader(cache)
const seqIds = [
  ...[7588, 7589, 7590, 7591, 7592, 7593, 7594], // JalTok-Jad
  ...[2634, 2635, 2636, 2637, 2638, 2639, 2640, 2641, 2642], // Yt-HurKot
  ...[426, 7552, 5061, 11057, 9493, 1167, 11430, 10091, 10092, 1978, 1979, 7855, 1162, 829, 836, 12394], // player
]
const spotIds = [448, 449, 450, 451, 444, 447, 1375, 1376, 1377, 659, 660, 1887, 1888, 1116, 1120, 226, 758, 753, 2125, 1539, 1540, 1541, 2126, 2127, 3366, 3367, 3368, 2710, 2712]
const frameSoundIds = new Set<number>()
const describeSeq = (label: string, seqId: number) => {
  const seq = seqs.tryLoad(seqId)
  if (!seq || seq.frameSounds.size === 0) return
  const parts = [...seq.frameSounds.entries()].map(([f, es]) => `f${f}: ${es.map((e) => `${e.id} (loops ${e.loops}, location ${e.location}, retain ${e.retain})`).join(' + ')}`)
  for (const es of seq.frameSounds.values()) for (const e of es) frameSoundIds.add(e.id)
  console.log(`  ${label} seq ${seqId} (${seq.frameIds.length} frames, frameStep ${seq.frameStep}): ${parts.join('; ')}`)
}
console.log('frame sounds:')
for (const id of seqIds) describeSeq('', id)
for (const id of spotIds) {
  const spot = spots.tryLoad(id)
  if (spot && spot.sequenceId >= 0) describeSeq(`spotanim ${id} ->`, spot.sequenceId)
}

const ruleIds = allAudioSoundIds()
const ids = [...new Set([...ruleIds, ...frameSoundIds])].sort((a, b) => a - b)
console.log(`\nsynthesising ${ids.length} ids (${ruleIds.length} from the rules)`)

const expectedSamples: Record<number, number> = { 159: 45202, 162: 33516, 163: 28665, 408: 34177, 410: 11025 }
const loader = new SoundEffectLoader(cache)
let failures = 0
let totalMs = 0
let slowest = { id: -1, ms: 0 }
const rows: string[] = []
for (const id of ids) {
  try {
    const effect = loader.load(id)
    if (!effect) {
      failures++
      rows.push(`${id}\tMISSING`)
      continue
    }
    const s = performance.now()
    const pcm = effect.toPcm()
    const ms = performance.now() - s
    totalMs += ms
    if (ms > slowest.ms) slowest = { id, ms }
    let peak = 0
    let sum = 0
    for (const v of pcm) {
      peak = Math.max(peak, Math.abs(v))
      sum += v * v
    }
    const rms = pcm.length ? Math.sqrt(sum / pcm.length) : 0
    const want = expectedSamples[id]
    const check = want === undefined ? '' : pcm.length === want ? '  samples == scim .ogg' : `  SAMPLE MISMATCH (scim ${want})`
    if (want !== undefined && pcm.length !== want) failures++
    if (pcm.length === 0) {
      failures++
      rows.push(`${id}\tEMPTY`)
      continue
    }
    rows.push(
      `${id}\t${effect.durationMs} ms\t${pcm.length} samples\t${(pcm.length / SAMPLE_RATE).toFixed(3)} s\tpeak ${peak.toFixed(3)}\trms ${rms.toFixed(3)}\tsynth ${ms.toFixed(1)} ms${check}`,
    )
  } catch (e) {
    failures++
    rows.push(`${id}\tERROR ${(e as Error).message}`)
  }
}
console.log('id\tduration\tsamples\tseconds\tpeak\trms\tsynth time')
for (const r of rows) console.log(r)
console.log(`\ntotal synthesis ${totalMs.toFixed(0)} ms for ${ids.length} ids; slowest ${slowest.id} (${slowest.ms.toFixed(1)} ms)`)
console.log(failures === 0 ? 'OK: every id synthesised' : `FAILED: ${failures} problem(s)`)
process.exit(failures === 0 ? 0 : 1)
