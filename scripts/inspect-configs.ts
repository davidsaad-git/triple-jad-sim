/**
 * Smoke test for the config / sprite / texture decoders against the local cache.
 *   npx tsx scripts/inspect-configs.ts [public/osrs-cache/disk.zip] [--sweep]
 *
 * `--sweep` additionally decodes every file of every config archive strictly
 * and reports unknown opcodes / overflows.
 */
import { readFileSync } from 'node:fs'
import { ByteReader } from '../src/cache/ByteReader'
import { CacheSystem, IndexId } from '../src/cache/CacheSystem'
import { openDiskZip } from '../src/cache/loadDiskZip'
import {
  type ConfigTypeLoader,
  EnumTypeLoader,
  HealthBarTypeLoader,
  HitsplatTypeLoader,
  IdkTypeLoader,
  LocTypeLoader,
  NpcTypeLoader,
  ObjTypeLoader,
  OverlayFloorTypeLoader,
  ParamTypeLoader,
  SeqTypeLoader,
  SpotAnimTypeLoader,
  StructTypeLoader,
  UnderlayFloorTypeLoader,
  VarBitTypeLoader,
} from '../src/cache/config'
import { SpriteLoader } from '../src/cache/sprite/SpriteLoader'
import { TextureLoader } from '../src/cache/texture/TextureLoader'

const args = process.argv.slice(2)
const sweep = args.includes('--sweep')
const path = args.find((a) => !a.startsWith('--')) ?? 'public/osrs-cache/disk.zip'

const t0 = performance.now()
const cache = new CacheSystem(openDiskZip(new Uint8Array(readFileSync(path))))
console.log(`opened ${path} in ${(performance.now() - t0).toFixed(0)} ms`)

const npcs = new NpcTypeLoader(cache)
const seqs = new SeqTypeLoader(cache)
const locs = new LocTypeLoader(cache)
const objs = new ObjTypeLoader(cache)
const idks = new IdkTypeLoader(cache)
const underlays = new UnderlayFloorTypeLoader(cache)
const overlays = new OverlayFloorTypeLoader(cache)
const spotAnims = new SpotAnimTypeLoader(cache)
const varbits = new VarBitTypeLoader(cache)
const params = new ParamTypeLoader(cache)
const structs = new StructTypeLoader(cache)
const enums = new EnumTypeLoader(cache)
const hitsplats = new HitsplatTypeLoader(cache)
const healthBars = new HealthBarTypeLoader(cache)

function paramsToString(map: Map<number, number | string | bigint> | null): string {
  if (!map) return 'none'
  return [...map].map(([k, v]) => `${k}=${typeof v === 'string' ? JSON.stringify(v) : v}`).join(' ')
}

for (const id of [7706, 7700, 7691]) {
  const npc = npcs.load(id)
  console.log(`\nNpcType ${id}: "${npc.name}" size ${npc.size} combat ${npc.combatLevel}`)
  console.log(`  models ${npc.modelIds.join(',')} chathead ${npc.chatheadModelIds.join(',')}`)
  console.log(
    `  idle ${npc.idleSeqId} walk ${npc.walkSeqId} run ${npc.runSeqId} turnL ${npc.turnLeftSeqId} turnR ${npc.turnRightSeqId}`,
  )
  console.log(`  scale ${npc.widthScale}x${npc.heightScale} rotationSpeed ${npc.rotationSpeed} height ${npc.height}`)
  console.log(`  actions ${JSON.stringify(npc.actions)} stats ${npc.stats.join(',')}`)
  console.log(`  interactable ${npc.isInteractable} clickable ${npc.isClickable} mapdot ${npc.drawMapDot}`)
  console.log(`  recolor ${npc.recolorFrom.length} retexture ${npc.retextureFrom.length}`)
  console.log(`  transforms ${npc.transforms ? npc.transforms.join(',') : 'none'} varbit ${npc.transformVarbit}`)
  console.log(
    `  footprint ${npc.footprintSize} idleRestart ${npc.idleAnimRestart} hideForOverlap ${npc.canHideForOverlap} zbuf ${npc.zbuf} ops ${npc.ops ? 'yes' : 'none'}`,
  )
  console.log(`  params ${paramsToString(npc.params)}`)
}

{
  const seq = seqs.load(7564)
  console.log(`\nSeqType 7564: ${seq.frameCount} frames, total length ${seq.getTotalFrameLength()} ticks`)
  console.log(`  frameIds ${seq.frameIds.map((f) => `${f >> 16}:${f & 0xffff}`).join(' ')}`)
  console.log(`  frameLengths ${seq.frameLengths.join(',')}`)
  console.log(
    `  skeletalId ${seq.skeletalId} range ${seq.skeletalRangeBegin}..${seq.skeletalRangeEnd} masks ${
      seq.skeletalMasks ? seq.skeletalMasks.filter(Boolean).length : 'none'
    }`,
  )
  console.log(
    `  frameStep ${seq.frameStep} priority ${seq.priority} forcedPriority ${seq.forcedPriority} replyMode ${seq.replyMode} looping ${seq.looping} maxLoops ${seq.maxLoops}`,
  )
  console.log(`  sounds ${[...seq.frameSounds].map(([f, s]) => `${f}:[${s.map((e) => e.id).join(',')}]`).join(' ')}`)
  const id2 = 7566
  const seq2 = seqs.load(id2)
  console.log(
    `SeqType ${id2}: ${seq2.frameCount} frames, total ${seq2.getTotalFrameLength()} ticks, skeletalId ${seq2.skeletalId} range ${seq2.skeletalStart}..${seq2.skeletalEnd} name ${seq2.debugName}`,
  )
  console.log(`  frameIds ${seq2.frameIds.map((f) => `${f >> 16}:${f & 0xffff}`).join(' ')}`)
  console.log(`  frameLengths ${seq2.frameLengths.join(',')}`)
  console.log(`  sounds ${[...seq2.frameSounds].map(([f, s]) => `${f}:[${s.map((e) => e.id).join(',')}]`).join(' ')}`)
  // Show one skeletal sequence so the animaya fields are exercised.
  let skeletal: (typeof seq2) | undefined
  for (const id of seqs.ids) {
    const s = seqs.tryLoad(id)
    if (s?.isSkeletalSeq()) {
      skeletal = s
      break
    }
  }
  if (skeletal) {
    console.log(
      `SeqType ${skeletal.id} (first skeletal): skeletalId ${skeletal.skeletalId} range ${skeletal.skeletalRangeBegin}..${skeletal.skeletalRangeEnd} masks ${
        skeletal.skeletalMasks ? skeletal.skeletalMasks.filter(Boolean).length : 'none'
      } frames ${skeletal.frameCount} name ${skeletal.debugName}`,
    )
  }
}

{
  // Inferno region 9043: map group (35 << 8) | 83, file 1 holds the loc list.
  const region = cache.getIndex(IndexId.Maps).getArchive((35 << 8) | 83)
  const locData = region?.getFile(1)
  if (!locData) {
    throw new Error('Inferno loc file missing')
  }
  const r = new ByteReader(locData)
  const seen = new Map<number, number>()
  let first = -1
  let firstPos = ''
  let id = -1
  let idDelta: number
  let total = 0
  while ((idDelta = r.uSmartExtended()) !== 0) {
    id += idDelta
    let pos = 0
    let posDelta: number
    while ((posDelta = r.uSmart()) !== 0) {
      pos += posDelta - 1
      const localX = (pos >> 6) & 0x3f
      const localY = pos & 0x3f
      const level = pos >> 12
      const attributes = r.u8()
      const type = attributes >> 2
      const rotation = attributes & 0x3
      if (first === -1) {
        first = id
        firstPos = `x ${localX} y ${localY} level ${level} shape ${type} rot ${rotation}`
      }
      seen.set(id, (seen.get(id) ?? 0) + 1)
      total++
    }
  }
  console.log(`\nInferno region 9043: ${total} loc placements, ${seen.size} distinct loc ids`)
  const loc = locs.load(first)
  console.log(`LocType ${first} (first placement at ${firstPos}): "${loc.name}"`)
  console.log(`  models ${JSON.stringify(loc.models)} types ${loc.types ? loc.types.join(',') : 'none'}`)
  console.log(`  size ${loc.sizeX}x${loc.sizeY} clipType ${loc.clipType} blocksProjectile ${loc.blocksProjectile}`)
  console.log(`  interactive ${loc.isInteractive} seq ${loc.seqId} contour ${loc.contouredGround} clipped ${loc.clipped}`)
  console.log(`  modelSize ${loc.modelSizeX},${loc.modelSizeHeight},${loc.modelSizeY} offset ${loc.offsetX},${loc.offsetHeight},${loc.offsetY}`)
  console.log(`  actions ${JSON.stringify(loc.actions)} params ${paramsToString(loc.params)}`)
  // Also show the most common loc in the region.
  const [commonId, commonCount] = [...seen].sort((a, b) => b[1] - a[1])[0]!
  const common = locs.load(commonId)
  console.log(`  most common loc ${commonId} "${common.name}" x${commonCount}, models ${JSON.stringify(common.models)}`)
}

for (const id of [12926, 20997]) {
  const obj = objs.load(id)
  console.log(`\nObjType ${id}: "${obj.name}" model ${obj.model} price ${obj.price} members ${obj.isMembers}`)
  console.log(`  stackability ${obj.stackability} noted ${obj.isNoted} notedId ${obj.notedId} weight ${obj.weight}g`)
  console.log(`  male ${obj.maleModel},${obj.maleModel1},${obj.maleModel2} female ${obj.femaleModel},${obj.femaleModel1},${obj.femaleModel2}`)
  console.log(`  wearPos ${obj.wearPos1},${obj.wearPos2},${obj.wearPos3} recolor ${obj.recolorFrom.length} retexture ${obj.retextureFrom.length}`)
  console.log(`  inv actions ${JSON.stringify(obj.inventoryActions)} ground ${JSON.stringify(obj.groundActions)}`)
  console.log(`  2d zoom ${obj.zoom2d} rot ${obj.xan2d},${obj.yan2d},${obj.zan2d} offset ${obj.offsetX2d},${obj.offsetY2d}`)
  console.log(`  params ${paramsToString(obj.params)}`)
}
{
  const noted = objs.load(20998)
  console.log(`ObjType 20998 (noted tbow): "${noted.name}" model ${noted.model} noted ${noted.isNoted} price ${noted.price}`)
}

{
  const idk = idks.load(0)
  console.log(`\nIdkType 0: bodyPart ${idk.bodyPartId} models ${idk.modelIds.join(',')} ifModels ${idk.ifModelIds.join(',')} recolor ${idk.recolorFrom.length}`)
  const u = underlays.load(0)
  console.log(`Underlay 0: rgb #${u.rgbColor.toString(16).padStart(6, '0')} hue ${u.hue} sat ${u.saturation} light ${u.lightness} hueMul ${u.hueMultiplier}`)
  const o = overlays.load(0)
  console.log(`Overlay 0: rgb #${o.primaryRgb.toString(16).padStart(6, '0')} texture ${o.textureId} hideUnderlay ${o.hideUnderlay} hue ${o.hue} sat ${o.saturation} light ${o.lightness}`)
  const sa = spotAnims.load(1)
  console.log(`SpotAnim 1: model ${sa.modelId} seq ${sa.sequenceId} scale ${sa.widthScale}x${sa.heightScale}`)
  const vb = varbits.load(1)
  console.log(`VarBit 1: varp ${vb.baseVar} bits ${vb.startBit}..${vb.endBit}`)
  const p = params.load(1)
  console.log(`Param 1: type ${p.type} (id ${p.typeId}) defaultInt ${p.defaultInt} defaultString ${p.defaultString}`)
  const st = structs.load(structs.ids[0]!)
  console.log(`Struct ${st.id}: ${paramsToString(st.params)}`)
  const en = enums.load(enums.ids[0]!)
  console.log(`Enum ${en.id}: ${en.inputType}->${en.outputType} ${en.outputCount} entries`)
  const hs = hitsplats.load(hitsplats.ids[0]!)
  console.log(`Hitsplat ${hs.id}: font ${hs.fontId} color #${hs.textColor.toString(16)} format ${JSON.stringify(hs.stringFormat)} bg ${hs.backgroundSpriteId}`)
  const hb = healthBars.load(healthBars.ids[0]!)
  console.log(`HealthBar ${hb.id}: front ${hb.frontSpriteId} back ${hb.backSpriteId} width ${hb.width}`)
}

{
  const sprites = new SpriteLoader(cache)
  console.log(`\nSprites: ${sprites.count} archives`)
  const firstId = sprites.spriteIds[0]!
  const sheet = sprites.loadSheet(firstId)!
  const s = sheet.sprites[0]!
  console.log(
    `sprite ${firstId}: ${sheet.sprites.length} frame(s), bounds ${sheet.width}x${sheet.height}, frame 0 ${s.subWidth}x${s.subHeight} at ${s.xOffset},${s.yOffset}, palette ${sheet.palette.length}`,
  )
  const rgba = s.getPixelsRgba()
  let opaque = 0
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 0) opaque++
  console.log(`  rgba ${rgba.length} bytes, ${opaque} opaque texels`)

  const textures = TextureLoader.load(cache, sprites)
  console.log(`\nTextures: ${textures.count} definitions`)
  const tid = textures.textureIds[0]!
  const def = textures.getDefinition(tid)!
  const native = textures.getNativeSize(tid)
  const argb = textures.getPixelsArgb(tid, 128)
  const trgba = textures.getPixelsRgba(tid, 128)
  console.log(
    `texture ${tid}: sprite ${def.spriteId} native ${native}x${native} opaque ${def.opaque} avgHsl ${def.averageHsl} anim ${def.animationDirection}/${def.animationSpeed} transparent ${textures.isTransparent(tid)}`,
  )
  console.log(`  128x128 argb ${argb.length} px, rgba ${trgba.length} bytes, first px #${(argb[0]! >>> 0).toString(16)}`)
  const sizes = new Map<number, number>()
  let alphaTextures = 0
  for (const id of textures.textureIds) {
    const n = textures.getNativeSize(id)
    sizes.set(n, (sizes.get(n) ?? 0) + 1)
    if (textures.loadTextureSprite(id).alpha) alphaTextures++
  }
  console.log(`  native sizes: ${[...sizes].map(([n, c]) => `${n}px x${c}`).join(', ')}; ${alphaTextures} with alpha plane`)
}

if (sweep) {
  console.log('\nSweeping every config file...')
  const loaders: ConfigTypeLoader<unknown>[] = [
    npcs,
    seqs,
    locs,
    objs,
    idks,
    underlays,
    overlays,
    spotAnims,
    varbits,
    params,
    structs,
    enums,
    hitsplats,
    healthBars,
  ]
  let failures = 0
  for (const loader of loaders) {
    let ok = 0
    const errors = new Map<string, number[]>()
    for (const id of loader.ids) {
      try {
        loader.tryLoad(id)
        ok++
      } catch (e) {
        const msg = (e as Error).message.replace(/^\w+ \d+: /, '')
        const ids = errors.get(msg) ?? []
        ids.push(id)
        errors.set(msg, ids)
        failures++
      }
    }
    const errText = [...errors].map(([m, ids]) => `${m} x${ids.length} (ids ${ids.slice(0, 5).join(',')})`).join('; ')
    console.log(`  ${loader.typeName}: ${ok}/${loader.ids.length} ok${errText ? ` -- ${errText}` : ''}`)
  }
  const sprites = new SpriteLoader(cache)
  let spriteOk = 0
  for (const id of sprites.spriteIds) {
    try {
      sprites.loadSheet(id)
      spriteOk++
    } catch (e) {
      failures++
      console.log(`  sprite ${id} failed: ${(e as Error).message}`)
    }
  }
  console.log(`  sprites: ${spriteOk}/${sprites.spriteIds.length} ok`)
  console.log(`sweep failures: ${failures}`)
}

console.log(`\ndone in ${(performance.now() - t0).toFixed(0)} ms`)
