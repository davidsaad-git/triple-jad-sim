/**
 * Player model assembly smoke test against the local OpenRS2 mirror.
 *   npx tsx scripts/inspect-player.ts [public/osrs-cache/disk.zip]
 *
 * Builds the default male appearance, then the same character in a ranged
 * set (twisted bow, Masori (f), anguish, Zaryte vambraces, Pegasian boots,
 * Dizana's quiver), prints slot resolution and vertex / face counts, poses
 * the equipped model with idle 808 and the bow attack 7552 at frames 0 and 1,
 * exports idle frame 0 as OBJ, and dumps the stance-related item params of
 * the three ranged weapons.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { CacheSystem } from '../src/cache/CacheSystem'
import { openDiskZip } from '../src/cache/loadDiskZip'
import { SeqTypeLoader } from '../src/cache/config'
import type { ModelData } from '../src/cache/model/ModelData'
import { hsl16ToRgb } from '../src/cache/model/ColorPalette'
import { buildModelMesh } from '../src/cache/model/ModelMesh'
import { animateModel, createAnimLoaders, seqFrameCount, type AnimatedFrame } from '../src/cache/anim'
import {
  BODY_COLOR_FROM,
  BODY_COLOR_TABLES,
  defaultAppearance,
  type PlayerAppearance,
  type PlayerEquipment,
} from '../src/render/models/PlayerAppearance'
import {
  describeWeaponParams,
  playerModelBuilder,
  weaponStanceSequence,
  type PlayerModel,
} from '../src/render/models/PlayerModelBuilder'

const args = process.argv.slice(2)
const path = args.find((a) => !a.startsWith('--')) ?? 'public/osrs-cache/disk.zip'
const OBJ_PATH =
  'C:/Users/User/AppData/Local/Temp/claude/C--Users-User-Desktop-zuk/f215424a-b315-4fcf-b6ff-b28606f3c2ae/scratchpad/player.obj'

const t0 = performance.now()
const cache = new CacheSystem(openDiskZip(new Uint8Array(readFileSync(path))))
const seqs = new SeqTypeLoader(cache)
const anim = createAnimLoaders(cache)
const builder = playerModelBuilder(cache)
console.log(`opened ${path} in ${(performance.now() - t0).toFixed(0)} ms`)

interface ItemEntry {
  name: string
  id: number
  slot: string
}
const itemList = JSON.parse(readFileSync('scripts/item-list.json', 'utf8')) as ItemEntry[]
function itemId(name: string): number {
  const entry = itemList.find((e) => e.name.toLowerCase() === name.toLowerCase())
  if (!entry) throw new Error(`item "${name}" not in scripts/item-list.json`)
  return entry.id
}

const SLOT_NAMES = ['head', 'cape', 'neck', 'weapon', 'torso', 'shield', 'arms', 'legs', 'hair', 'hands', 'feet', 'jaw']

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

function hex(hsl: number): string {
  return '#' + hsl16ToRgb(hsl).toString(16).padStart(6, '0')
}

function bounds(m: ModelData, frame?: AnimatedFrame): string {
  const vx = frame?.verticesX ?? m.verticesX
  const vy = frame?.verticesY ?? m.verticesY
  const vz = frame?.verticesZ ?? m.verticesZ
  const b = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity]
  for (let i = 0; i < m.vertexCount; i++) {
    b[0] = Math.min(b[0]!, vx[i]!)
    b[1] = Math.max(b[1]!, vx[i]!)
    b[2] = Math.min(b[2]!, vy[i]!)
    b[3] = Math.max(b[3]!, vy[i]!)
    b[4] = Math.min(b[4]!, vz[i]!)
    b[5] = Math.max(b[5]!, vz[i]!)
  }
  return `x ${b[0]}..${b[1]} y ${b[2]}..${b[3]} z ${b[4]}..${b[5]}`
}

function describe(label: string, appearance: PlayerAppearance): PlayerModel {
  console.log(`\n${label}: ${appearance.male ? 'male' : 'female'} kits [${appearance.kits.join(',')}] colours [${appearance.colors.join(',')}]`)
  const slots = builder.resolveSlots(appearance)
  slots.forEach((slot, i) => {
    const name = SLOT_NAMES[i]!.padEnd(6)
    if (slot.kind === 'item') console.log(`  ${String(i).padStart(2)} ${name} item ${slot.id} "${slot.name}" models [${slot.modelIds.join(',')}]`)
    else if (slot.kind === 'kit') console.log(`  ${String(i).padStart(2)} ${name} kit ${slot.id} (bodyPart ${slot.bodyPart}) models [${slot.modelIds.join(',')}]`)
    else console.log(`  ${String(i).padStart(2)} ${name} -${slot.hiddenBy !== undefined ? ` (hidden by item ${slot.hiddenBy})` : ''}`)
  })
  const ts = performance.now()
  const model = builder.build(appearance)
  const again = builder.build(appearance)
  const { data, lit } = model
  const colors = new Map<number, number>()
  for (let i = 0; i < data.faceCount; i++) colors.set(data.faceColors[i]!, (colors.get(data.faceColors[i]!) ?? 0) + 1)
  const top = [...colors.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([c, n]) => `${c}(${hex(c)} x${n})`)
  const textures = new Set<number>()
  if (data.faceTextures) for (let i = 0; i < data.faceCount; i++) if (data.faceTextures[i] !== -1) textures.add(data.faceTextures[i]!)
  const mesh = buildModelMesh(lit)
  let hidden = 0
  for (let i = 0; i < lit.faceCount; i++) if (lit.faceColors3[i] === -2) hidden++
  console.log(
    `  built in ${(performance.now() - ts).toFixed(1)} ms (cache hit: ${again === model}): vertices ${data.vertexCount} faces ${data.faceCount}` +
      ` texFaces ${data.textureFaceCount} textures [${[...textures].join(',')}] bounds ${bounds(data)}` +
      `\n  lit: ${mesh.vertexCount} corners, ${hidden} hidden faces, uvs ${lit.uvs ? 'yes' : 'no'}; colours ${colors.size}: ${top.join(' ')}` +
      `\n  vertexSkins ${data.vertexSkins ? 'yes' : 'none'} faceSkins ${data.faceSkins ? 'yes' : 'none'}`,
  )
  return model
}

function pose(model: PlayerModel, seqId: number, frames: number[]): AnimatedFrame[] {
  const seq = seqs.load(seqId)
  const count = seqFrameCount(seq)
  const base: AnimatedFrame = {
    verticesX: model.data.verticesX,
    verticesY: model.data.verticesY,
    verticesZ: model.data.verticesZ,
    faceAlphas: undefined,
    faceColors: undefined,
  }
  console.log(`  seq ${seqId}: ${count} frames, lengths [${seq.frameLengths.slice(0, 8).join(',')}${count > 8 ? ',...' : ''}] lh ${seq.leftHandItem} rh ${seq.rightHandItem}`)
  const out: AnimatedFrame[] = []
  for (const idx of frames) {
    const f = animateModel(model.lit, seq, idx, anim)
    out.push(f)
    console.log(`    frame ${idx}: checksum ${checksum(f)} moved ${countDiff(base, f)}/${model.data.vertexCount} vs base, bounds ${bounds(model.data, f)}`)
  }
  if (out.length >= 2) {
    const d = countDiff(out[0]!, out[1]!)
    console.log(`    frame ${frames[0]} vs frame ${frames[1]}: ${d} vertices differ (${d > 0 ? 'DIFFERENT' : 'SAME'})`)
  }
  return out
}

function writeObj(frame: AnimatedFrame, model: ModelData, file: string): void {
  const lines: string[] = ['# player, idle 808 frame 0 (client units, Y flipped to be up)']
  for (let i = 0; i < model.vertexCount; i++) {
    lines.push(`v ${frame.verticesX[i]} ${-frame.verticesY[i]!} ${frame.verticesZ[i]}`)
  }
  for (let i = 0; i < model.faceCount; i++) {
    lines.push(`f ${model.indices1[i]! + 1} ${model.indices2[i]! + 1} ${model.indices3[i]! + 1}`)
  }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, lines.join('\n') + '\n')
  console.log(`  wrote ${file} (${model.vertexCount} v, ${model.faceCount} f)`)
}

// ------------------------------------------------------------------ run

console.log(
  `\nBody colour tables: from [${BODY_COLOR_FROM.map((c) => `${c} ${hex(c)}`).join(', ')}]` +
    `\n  sizes hair ${BODY_COLOR_TABLES[0]!.length} torso ${BODY_COLOR_TABLES[1]!.length} legs ${BODY_COLOR_TABLES[2]!.length} feet ${BODY_COLOR_TABLES[3]!.length} skin ${BODY_COLOR_TABLES[4]!.length}`,
)

const plain = describe('Default appearance', defaultAppearance(true))
pose(plain, 808, [0, 1])

const equipment: PlayerEquipment = {
  weapon: itemId('Twisted bow'),
  head: itemId('Masori mask (f)'),
  body: itemId('Masori body (f)'),
  legs: itemId('Masori chaps (f)'),
  neck: itemId('Necklace of anguish'),
  hands: itemId('Zaryte vambraces'),
  feet: itemId('Pegasian boots'),
  cape: itemId("Dizana's quiver"),
}
const geared: PlayerAppearance = { ...defaultAppearance(true), equipment }
const equipped = describe('Ranged set', geared)
const idleFrames = pose(equipped, 808, [0, 1])
pose(equipped, 7552, [0, 1])
writeObj(idleFrames[0]!, equipped.data, OBJ_PATH)

// A recolour + shield-with-2h check: bare body with other colours, holding the bow and a buckler (must be hidden by the bow).
const variant: PlayerAppearance = {
  ...defaultAppearance(true),
  colors: [3, 8, 2, 1, 4],
  equipment: { weapon: itemId('Twisted bow'), shield: itemId('Twisted buckler') },
}
describe('Bare body + tbow + buckler (should be hidden) + colours [3,8,2,1,4]', variant)

console.log('\nWeapon stance params')
const PARAM_NOTES: Record<number, string> = {
  0: 'stab attack',
  1: 'slash attack',
  2: 'crush attack',
  3: 'magic attack',
  4: 'ranged attack',
  5: 'stab defence',
  6: 'slash defence',
  7: 'crush defence',
  8: 'magic defence',
  9: 'ranged defence',
  10: 'melee strength',
  11: 'prayer bonus',
  12: 'ranged strength',
  13: 'attack range',
  14: 'attack speed',
  23: 'ranged strength (hidden)',
  189: 'weight class?',
  434: 'req skill 1',
  436: 'req level 1',
  435: 'req skill 2',
  437: 'req level 2',
  1562: 'req skill (secondary)',
  1563: 'req level (secondary)',
  1564: 'equipment slot',
  2257: 'charged variant',
}
for (const name of ['Twisted bow', 'Toxic blowpipe', 'Zaryte crossbow']) {
  const id = itemId(name)
  const info = describeWeaponParams(cache, id)
  console.log(`  ${id} "${info.name}":`)
  for (const [k, v] of info.params) {
    console.log(`    param ${String(k).padStart(5)} = ${String(v).padEnd(8)} ${PARAM_NOTES[k] ?? ''}`)
  }
  const stanceParams = info.params.filter(([k]) => k === 644 || k === 645 || k === 646)
  console.log(`    params 644/645/646: ${stanceParams.length ? stanceParams.map(([k, v]) => `${k}=${v}`).join(' ') : 'absent'}`)
  const s = weaponStanceSequence(cache, id)
  console.log(
    `    stance -> idle ${s.idle} walk ${s.walk} walkBack ${s.walkBack} side ${s.sideLeft}/${s.sideRight} turn ${s.turn} run ${s.run} attack ${s.attack}` +
      ` speed ${s.attackSpeed ?? '-'} range ${s.attackRange ?? '-'} [${s.source}]`,
  )
}
const unarmed = weaponStanceSequence(cache, undefined)
console.log(`  unarmed -> idle ${unarmed.idle} walk ${unarmed.walk} run ${unarmed.run} attack ${unarmed.attack} [${unarmed.source}]`)

console.log(`\ndone in ${((performance.now() - t0) / 1000).toFixed(1)} s`)
