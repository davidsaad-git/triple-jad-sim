/**
 * Smoke test for model + animation decoding against the local OpenRS2 mirror.
 *   npx tsx scripts/inspect-model.ts [public/osrs-cache/disk.zip] [--no-sweep] [--full]
 *
 * Decodes the Inferno NPCs (TzKal-Zuk, JalTok-Jad, Jal-Nib), lights them,
 * poses their idle animation at frames 0 and 1, exports Zuk frame 0 as OBJ,
 * then sweeps every model in index 7 and every frame referenced by the
 * Inferno sequences 7559-7614.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { CacheSystem, IndexId } from '../src/cache/CacheSystem'
import { openDiskZip } from '../src/cache/loadDiskZip'
import { NpcTypeLoader, SeqTypeLoader, type NpcType } from '../src/cache/config'
import { ModelData } from '../src/cache/model/ModelData'
import { ModelLoader } from '../src/cache/model/ModelLoader'
import { buildModelMesh } from '../src/cache/model/ModelMesh'
import { hsl16ToRgb } from '../src/cache/model/ColorPalette'
import {
  animateModel,
  createAnimLoaders,
  isSkeletalSeq,
  seqFrameCount,
  seqFrameLengths,
  SeqBase,
  SeqFrame,
  SkeletalSeq,
  type AnimatedFrame,
} from '../src/cache/anim'

const args = process.argv.slice(2)
const path = args.find((a) => !a.startsWith('--')) ?? 'public/osrs-cache/disk.zip'
const sweep = !args.includes('--no-sweep')
const full = args.includes('--full')
const OBJ_PATH =
  'C:/Users/User/AppData/Local/Temp/claude/C--Users-User-Desktop-zuk/f215424a-b315-4fcf-b6ff-b28606f3c2ae/scratchpad/zuk-frame0.obj'

const t0 = performance.now()
const cache = new CacheSystem(openDiskZip(new Uint8Array(readFileSync(path))))
const npcs = new NpcTypeLoader(cache)
const seqs = new SeqTypeLoader(cache)
const models = new ModelLoader(cache)
const anim = createAnimLoaders(cache)
console.log(`opened ${path} in ${(performance.now() - t0).toFixed(0)} ms`)

function checksum(frame: AnimatedFrame): string {
  let h = 2166136261
  const mix = (v: number): void => {
    h ^= v & 0xffff
    h = Math.imul(h, 16777619)
    h ^= (v >>> 16) & 0xffff
    h = Math.imul(h, 16777619)
  }
  for (let i = 0; i < frame.verticesX.length; i++) {
    mix(frame.verticesX[i]!)
    mix(frame.verticesY[i]!)
    mix(frame.verticesZ[i]!)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

function countDiff(a: AnimatedFrame, b: AnimatedFrame): number {
  let n = 0
  for (let i = 0; i < a.verticesX.length; i++) {
    if (a.verticesX[i] !== b.verticesX[i] || a.verticesY[i] !== b.verticesY[i] || a.verticesZ[i] !== b.verticesZ[i]) n++
  }
  return n
}

function describeModel(label: string, m: ModelData): void {
  const colors = new Map<number, number>()
  for (let i = 0; i < m.faceCount; i++) colors.set(m.faceColors[i]!, (colors.get(m.faceColors[i]!) ?? 0) + 1)
  const topColors = [...colors.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([c, n]) => `${c}(#${hsl16ToRgb(c).toString(16).padStart(6, '0')} x${n})`)
  const textures = new Set<number>()
  if (m.faceTextures) for (let i = 0; i < m.faceCount; i++) if (m.faceTextures[i] !== -1) textures.add(m.faceTextures[i]!)
  let alphaFaces = 0
  if (m.faceAlphas) for (let i = 0; i < m.faceCount; i++) if (m.faceAlphas[i] !== 0) alphaFaces++
  let boned = 0
  let maxBones = 0
  const bones = new Set<number>()
  if (m.animMayaGroups) {
    for (const g of m.animMayaGroups) {
      if (g && g.length > 0) boned++
      if (g && g.length > maxBones) maxBones = g.length
      if (g) for (const b of g) bones.add(b)
    }
  }
  const priorities = m.faceRenderPriorities ? `per-face (${new Set(m.faceRenderPriorities).size} distinct)` : `model ${m.priority}`
  console.log(
    `  ${label}: v${m.version} vertices ${m.vertexCount} faces ${m.faceCount} texFaces ${m.textureFaceCount}` +
      ` | colours ${colors.size}: ${topColors.join(' ')}` +
      `\n    textures [${[...textures].join(',')}] alphaFaces ${alphaFaces} priorities ${priorities}` +
      ` renderTypes ${m.faceRenderTypes ? 'yes' : 'no'}` +
      `\n    vertexSkins ${m.vertexSkins ? m.vertexLabels.length + ' labels' : 'none'} faceSkins ${m.faceSkins ? m.faceLabels.length + ' labels' : 'none'}` +
      ` boneWeights ${m.animMayaGroups ? `${boned}/${m.vertexCount} vertices, max ${maxBones}/vertex, ${bones.size} bones` : 'none'}`,
  )
}

function writeObj(frame: AnimatedFrame, model: ModelData, file: string): void {
  const lines: string[] = ['# TzKal-Zuk frame 0 (client units, Y flipped to be up)']
  for (let i = 0; i < model.vertexCount; i++) {
    lines.push(`v ${frame.verticesX[i]} ${-frame.verticesY[i]!} ${frame.verticesZ[i]}`)
  }
  for (let i = 0; i < model.faceCount; i++) {
    lines.push(`f ${model.indices1[i]! + 1} ${model.indices2[i]! + 1} ${model.indices3[i]! + 1}`)
  }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, lines.join('\n') + '\n')
  const b = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity]
  for (let i = 0; i < model.vertexCount; i++) {
    b[0] = Math.min(b[0]!, frame.verticesX[i]!)
    b[1] = Math.max(b[1]!, frame.verticesX[i]!)
    b[2] = Math.min(b[2]!, frame.verticesY[i]!)
    b[3] = Math.max(b[3]!, frame.verticesY[i]!)
    b[4] = Math.min(b[4]!, frame.verticesZ[i]!)
    b[5] = Math.max(b[5]!, frame.verticesZ[i]!)
  }
  console.log(
    `  wrote ${file} (${model.vertexCount} v, ${model.faceCount} f) bounds x ${b[0]}..${b[1]} y ${b[2]}..${b[3]} z ${b[4]}..${b[5]}`,
  )
}

/** First npc whose idle sequence is skeletal and whose model has bone weights, to exercise the animaya path. */
function findSkeletalNpc(): number | undefined {
  for (const id of npcs.ids) {
    const npc = npcs.load(id)
    if (npc.idleSeqId === -1 || npc.modelIds.length === 0) continue
    const seq = seqs.load(npc.idleSeqId)
    if (!isSkeletalSeq(seq)) continue
    const m = models.load(npc.modelIds[0]!)
    if (m?.animMayaGroups) return id
  }
  return undefined
}

function inspectNpc(id: number, seqOverride?: number, exportObj = false): void {
  const npc: NpcType = npcs.load(id)
  console.log(`\nNPC ${id} "${npc.name}" models [${npc.modelIds.join(',')}] idle ${npc.idleSeqId} size ${npc.size}`)
  const parts = npc.modelIds.map((mid) => {
    const m = models.load(mid)
    if (!m) console.log(`  model ${mid}: MISSING`)
    else describeModel(`model ${mid}`, m)
    return m
  })
  const merged = parts.length === 1 && parts[0] ? parts[0].copy() : ModelData.merge(parts)
  merged.replaceColors(npc.recolorFrom, npc.recolorTo)
  merged.replaceTextures(npc.retextureFrom, npc.retextureTo)
  describeModel('merged', merged)

  const lit = merged.light(npc.ambient + 64, npc.contrast + 850, -30, -50, -30)
  const mesh = buildModelMesh(lit)
  let hidden = 0
  for (let i = 0; i < lit.faceCount; i++) if (lit.faceColors3[i] === -2) hidden++
  let texturedCorners = 0
  if (mesh.texcoords) for (let i = 0; i < mesh.vertexCount; i++) if (mesh.texcoords[i * 3 + 2] !== -1) texturedCorners++
  const c0 = mesh.colors.subarray(0, 4)
  console.log(
    `  lit: ${mesh.vertexCount} corners (${hidden} hidden faces), textured corners ${texturedCorners}, first rgba ${[...c0].join(',')}, uvs ${lit.uvs ? 'yes' : 'no'}`,
  )

  const seqId = seqOverride ?? npc.idleSeqId
  const seq = seqs.load(seqId)
  const count = seqFrameCount(seq)
  console.log(
    `  seq ${seqId}: ${isSkeletalSeq(seq) ? `skeletal id ${seq.skeletalId} range ${seq.skeletalStart}..${seq.skeletalEnd}` : `legacy ${seq.frameIds.length} frames`}` +
      ` frames ${count} lengths [${seqFrameLengths(seq).slice(0, 12).join(',')}${count > 12 ? ',...' : ''}] frameStep ${seq.frameStep}`,
  )
  if (isSkeletalSeq(seq)) {
    const sk = anim.skeletal.load(seq.skeletalId)
    if (sk) {
      const [lo, hi] = sk.tickRange()
      console.log(`    skeletal: base ${sk.base.id} bones ${sk.skeletalBase.boneCount} poses ${sk.skeletalBase.poseCount} pose ${sk.poseId} curves ${sk.curveCount} ticks ${lo}..${hi} alpha ${sk.hasAlphaTransform}`)
    } else {
      console.log('    skeletal: FAILED to load')
    }
  } else {
    const f0 = seq.frameIds[0]
    if (f0 !== undefined) {
      const fr = anim.frames.load(f0)
      console.log(
        `    frame0 id ${f0} (archive ${f0 >>> 16} file ${f0 & 0xffff}): ${fr ? `base ${fr.base.id} groups ${fr.base.count} active ${fr.transformCount} alpha ${fr.hasAlphaTransform}` : 'FAILED'}`,
      )
    }
  }

  const base: AnimatedFrame = {
    verticesX: merged.verticesX,
    verticesY: merged.verticesY,
    verticesZ: merged.verticesZ,
    faceAlphas: undefined,
    faceColors: undefined,
  }
  const frames: AnimatedFrame[] = []
  for (const idx of [0, 1, Math.max(0, count - 1)]) {
    const f = animateModel(lit, seq, idx, anim)
    frames.push(f)
    console.log(`    frame ${idx}: checksum ${checksum(f)} moved ${countDiff(base, f)}/${merged.vertexCount} vs base`)
  }
  console.log(`    frame0 vs frame1: ${countDiff(frames[0]!, frames[1]!)} vertices differ (${frames[0] && frames[1] && checksum(frames[0]) !== checksum(frames[1]) ? 'DIFFERENT' : 'SAME'})`)
  if (exportObj && frames[0]) writeObj(frames[0], merged, OBJ_PATH)
}

inspectNpc(7706, 7564, true)
inspectNpc(7700)
inspectNpc(7691)

const skeletalNpc = findSkeletalNpc()
console.log(`\nSkeletal sample: ${skeletalNpc === undefined ? 'no npc found' : `npc ${skeletalNpc}`}`)
if (skeletalNpc !== undefined) inspectNpc(skeletalNpc)

if (sweep) {
  console.log('\nSweep: all models in index 7')
  const ts = performance.now()
  const index = cache.getIndex(IndexId.Models)
  const failures: [number, string][] = []
  const versions = new Map<number, number>()
  let ok = 0
  let withBones = 0
  let withTextures = 0
  for (const id of index.archiveIds) {
    try {
      const m = models.load(id)
      if (!m) {
        failures.push([id, 'missing file'])
        continue
      }
      ok++
      versions.set(m.version, (versions.get(m.version) ?? 0) + 1)
      if (m.animMayaGroups) withBones++
      if (m.faceTextures) withTextures++
      // Light a sample to exercise normals/uvs on every format.
      if (id % 97 === 0) m.light(64, 850, -30, -50, -30)
    } catch (e) {
      failures.push([id, (e as Error).message])
    }
    models.clear()
  }
  console.log(
    `  ${ok}/${index.archiveIds.length} decoded in ${((performance.now() - ts) / 1000).toFixed(1)} s; versions ${[...versions.entries()].map(([v, n]) => `v${v}:${n}`).join(' ')}; bones ${withBones}; textured ${withTextures}`,
  )
  console.log(`  failures: ${failures.length}${failures.length ? ' first: ' + failures.slice(0, 10).map(([id, m]) => `${id} (${m})`).join('; ') : ''}`)

  console.log('\nSweep: Inferno sequences 7559-7614')
  let seqOk = 0
  let frameOk = 0
  let skeletalCount = 0
  const seqFailures: string[] = []
  for (let id = 7559; id <= 7614; id++) {
    if (!seqs.has(id)) {
      seqFailures.push(`${id}: no config`)
      continue
    }
    const seq = seqs.load(id)
    try {
      if (isSkeletalSeq(seq)) {
        skeletalCount++
        const sk = anim.skeletal.load(seq.skeletalId)
        if (!sk) throw new Error(`skeletal ${seq.skeletalId} missing`)
        const [lo, hi] = sk.tickRange()
        if (lo > seq.skeletalStart || hi < seq.skeletalEnd - 1) {
          seqFailures.push(`${id}: skeletal ticks ${lo}..${hi} vs range ${seq.skeletalStart}..${seq.skeletalEnd}`)
        }
        frameOk += seqFrameCount(seq)
      } else {
        for (const fid of seq.frameIds) {
          const f = anim.frames.load(fid)
          if (!f) throw new Error(`frame ${fid} (${fid >>> 16}:${fid & 0xffff}) failed: ${anim.frames.failures.get(`${fid >>> 16}:${fid & 0xffff}`) ?? 'missing'}`)
          frameOk++
        }
      }
      seqOk++
    } catch (e) {
      seqFailures.push(`${id}: ${(e as Error).message}`)
    }
  }
  console.log(`  ${seqOk}/56 sequences ok (${skeletalCount} skeletal), ${frameOk} frames decoded, frame decode failures so far ${anim.frames.failures.size}`)
  console.log(`  failures: ${seqFailures.length}${seqFailures.length ? '\n    ' + seqFailures.slice(0, 15).join('\n    ') : ''}`)
}

if (full) {
  console.log('\nFull sweep: indexes 1 (bases), 22 (skeletal), 0 (frames)')
  let ts = performance.now()
  const baseIndex = cache.getIndex(IndexId.FrameMaps)
  const bases = new Map<number, SeqBase>()
  const baseFailures: string[] = []
  let withSkeleton = 0
  for (const id of baseIndex.archiveIds) {
    try {
      const b = SeqBase.decode(id, baseIndex.getFile(id, 0)!)
      bases.set(id, b)
      if (b.skeletalBase) withSkeleton++
    } catch (e) {
      baseFailures.push(`${id}: ${(e as Error).message}`)
    }
  }
  console.log(
    `  index 1: ${bases.size}/${baseIndex.archiveIds.length} bases (${withSkeleton} with skeletons) in ${((performance.now() - ts) / 1000).toFixed(1)} s; failures ${baseFailures.length} ${baseFailures.slice(0, 5).join('; ')}`,
  )

  const sweepIndex = (indexId: number, label: string, decode: (archiveId: number, fileId: number, data: Uint8Array) => void): void => {
    ts = performance.now()
    const index = cache.getIndex(indexId)
    let ok = 0
    let files = 0
    const fails: string[] = []
    for (const archiveId of index.archiveIds) {
      const archive = index.getArchive(archiveId)
      if (!archive) continue
      for (const [fileId, data] of archive) {
        files++
        try {
          decode(archiveId, fileId, data)
          ok++
        } catch (e) {
          fails.push(`${archiveId}:${fileId}: ${(e as Error).message}`)
        }
      }
    }
    console.log(
      `  index ${indexId}: ${ok}/${files} ${label} in ${index.archiveIds.length} archives in ${((performance.now() - ts) / 1000).toFixed(1)} s; failures ${fails.length} ${fails.slice(0, 5).join('; ')}`,
    )
  }
  sweepIndex(IndexId.Animations, 'skeletal seqs', (a, f, data) => SkeletalSeq.decode((a << 16) | f, data, (b) => bases.get(b)))
  sweepIndex(IndexId.Frames, 'frames', (_a, _f, data) => SeqFrame.decode(data, (b) => bases.get(b)))
}

console.log(`\ndone in ${((performance.now() - t0) / 1000).toFixed(1)} s`)
