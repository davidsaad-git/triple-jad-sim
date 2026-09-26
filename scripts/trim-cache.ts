/**
 * Build the trimmed OSRS cache the hosted site loads (scim.gg does the same:
 * 190 MB -> ~11 MB). Every subsystem runs against the full cache while its
 * reads are traced, then only the traced archives are written to a new
 * dat2/idx set in public/osrs-cache/trimmed/disk.zip.
 *
 *   npx tsx scripts/trim-cache.ts [--measure] [--no-equipment]
 *
 * --measure       report the bytes each phase pulls in, write nothing
 * --no-equipment  skip the worn models of every equippable catalog item
 *                 (the loadout editor's full item list)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { CacheSystem } from '../src/cache/CacheSystem'
import { openDiskZip } from '../src/cache/loadDiskZip'
import { NpcTypeLoader, ObjTypeLoader, SeqTypeLoader } from '../src/cache/config'
import { SpotAnimTypeLoader } from '../src/cache/config/SpotAnimType'
import { createAnimLoaders } from '../src/cache/anim'
import { ModelLoader } from '../src/cache/model/ModelLoader'
import { TextureLoader } from '../src/cache/texture/TextureLoader'
import { ArenaSceneBuilder } from '../src/scene/arena/ArenaScene'
import { TRIPLE_JAD_ARENA } from '../src/render/arenaConfig'
import { buildTextureArray } from '../src/render/gl/textures'
import { SceneCompositor } from '../src/render/SceneCompositor'
import { Camera } from '../src/render/camera/Camera'
import { PlayerVisualFeed } from '../src/render/actors/PlayerVisualFeed'
import { NPC_RENDER_CONFIGS } from '../src/render/actors/npcConfig'
import { DEFAULT_TILE_INDICATORS } from '../src/app/plugins/stores'
import { createTripleJadEngine } from '../src/sim/createEngine'
import { LOADOUT_PRESETS } from '../src/sim/loadouts/presets'
import { allAudioSoundIds } from '../src/audio'
import { CacheSoundBank } from '../src/audio/SoundBank'
import { minimapImageFor } from '../src/ui/client/minimapData'
import { getItemCatalog } from '../src/ui/menu/itemCatalog'
import renderTables from '../src/render/data/scimTables.json'
import type { EquipSlot } from '../src/sim/api'

const args = process.argv.slice(2)
const MEASURE = args.includes('--measure')
const EQUIPMENT = !args.includes('--no-equipment')
const FULL = 'public/osrs-cache/disk.zip'
const OUT = 'public/osrs-cache/trimmed'

const t0 = performance.now()
const store = openDiskZip(new Uint8Array(readFileSync(FULL)))
const cache = new CacheSystem(store)

// ---- tracing ---------------------------------------------------------------------------------
const needed = new Map<number, Set<number>>()
const byPhase = new Map<string, Set<string>>()
let phaseName = 'setup'
store.onRead = (index, archive) => {
  let set = needed.get(index)
  if (!set) needed.set(index, (set = new Set()))
  set.add(archive)
  let p = byPhase.get(phaseName)
  if (!p) byPhase.set(phaseName, (p = new Set()))
  p.add(`${index}:${archive}`)
}
function phase(name: string, fn: () => void): void {
  phaseName = name
  const start = performance.now()
  try {
    fn()
  } catch (e) {
    console.warn(`  ${name}: ${(e as Error).stack ?? e}`)
  }
  console.log(`  ${name}: ${((performance.now() - start) / 1000).toFixed(1)} s`)
}
function tryDo(fn: () => void): void {
  try {
    fn()
  } catch {
    // missing ids are fine
  }
}

const models = new ModelLoader(cache)
const objs = new ObjTypeLoader(cache)
const seqTypes = new SeqTypeLoader(cache)
const spotTypes = new SpotAnimTypeLoader(cache)
const anims = createAnimLoaders(cache)

function loadSeq(id: number): void {
  if (id < 0) return
  tryDo(() => {
    const seq = seqTypes.load(id) as unknown as { frameIds?: number[]; skeletalId?: number }
    if (seq.skeletalId !== undefined && seq.skeletalId >= 0) tryDo(() => anims.skeletal.load(seq.skeletalId!))
    for (const f of seq.frameIds ?? []) tryDo(() => anims.frames.load(f))
  })
}
function loadSpotAnim(id: number): void {
  if (id < 0) return
  tryDo(() => {
    const s = spotTypes.load(id)
    if (s.modelId >= 0) tryDo(() => models.load(s.modelId))
    loadSeq(s.sequenceId)
  })
}

let catalogIds = new Set<number>()

console.log('tracing...')

phase('arena', () => {
  const textures = TextureLoader.load(cache)
  const tex = buildTextureArray(textures)
  for (const smoothTerrain of [false, true]) {
    new ArenaSceneBuilder(cache, TRIPLE_JAD_ARENA).build({ smoothTerrain, textureLayer: (id) => tex.layerOf.get(id) ?? -1 })
  }
})

phase('minimap', () => {
  for (const [dx, dy] of [[0, 0], [0, 1], [1, 0], [0, -1], [-1, 0]] as const) minimapImageFor(cache, 35 + dx, 83 + dy)
})

phase('fights', () => {
  const tex = buildTextureArray(TextureLoader.load(cache))
  for (const preset of LOADOUT_PRESETS) {
    const engine = createTripleJadEngine({ cache, loadout: preset.loadout, mechanics: { infiniteHealth: true }, combatSeed: 7, encounterSeed: 7 })
    const comp = new SceneCompositor(cache, (id) => tex.layerOf.get(id) ?? -1, engine.getState())
    comp.load(false, engine.getState())
    const s0 = engine.getState()
    const camera = new Camera({ width: 988, height: 914, dpr: 1 }, { pitch: -22.5, yaw: 0, distance: 24, targetX: s0.playerPosition[0] + 0.5, targetY: s0.playerPosition[1] + 0.5 })
    camera.setTerrainHeights(comp.terrainHeights)
    const feed = new PlayerVisualFeed(s0.currentTick)
    feed.reset(s0.currentTick, comp.player.movement)
    const foodSlot = s0.inventory.findIndex((it) => it !== null)
    for (let t = 0; t < 500; t++) {
      const st = engine.getState()
      const target = st.npcs.find((n) => n.alive && n.id === st.attackTarget) ?? st.npcs.find((n) => n.alive)
      if (target && st.attackTarget !== target.id && t % 5 === 0) engine.applyAction({ attackTarget: target.id })
      if (t === 3) engine.queueProtectionPrayer('ProtectMagic')
      if (t === 30 || t === 200) engine.queueSpecialAttackToggle()
      if (t === 60 && foodSlot >= 0) engine.queueItemAction(foodSlot, 'default')
      const walkTo: [number, number] = t > 480 ? [st.playerPosition[0] + 3, st.playerPosition[1]] : st.playerPosition
      engine.advanceTick(walkTo)
      const state = engine.getState()
      for (let f = 0; f < 6; f++) {
        feed.feed(comp.player.movement, state, comp.player.controller)
        const visual = comp.player.movement.advance(100, 1)
        comp.frame({
          state,
          events: f === 0 ? engine.lastTickEvents : [],
          interpTick: state.currentTick + f / 6,
          frameDeltaMs: 100,
          speed: 1,
          camera,
          playerVisual: visual,
          hoverTile: null,
          destinationTile: null,
          settings: { brightness: 0.6, contrast: 1, saturation: 1, smoothTerrain: false, showDebugGrid: false, showNpcClickbox: false },
          plugins: {
            tileIndicators: { enabled: true, ...DEFAULT_TILE_INDICATORS.config },
            tileMarkers: [],
            showTileMarkerLabels: false,
            tileMarkerWidth: 2,
            lineMarkers: [],
            showLineMarkerLabels: false,
            lineMarkerWidth: 1,
            npcHighlights: [],
          },
        })
      }
      if (!engine.canAdvance()) break
    }
  }
})

phase('npcs', () => {
  const npcs = new NpcTypeLoader(cache)
  for (const [id, cfg] of Object.entries(NPC_RENDER_CONFIGS)) {
    tryDo(() => {
      const type = npcs.load(Number(id)) as unknown as { models?: number[]; modelIds?: number[]; idleSeqId: number; walkSeqId: number }
      for (const m of type.models ?? type.modelIds ?? []) tryDo(() => models.load(m))
      loadSeq(type.idleSeqId)
      loadSeq(type.walkSeqId)
    })
    collectNumbers(cfg, (n) => loadSeq(n))
  }
})

phase('render-tables', () => {
  // Every sequence / spot anim the renderer's weapon, spell and special tables can reference.
  const seqKeys = /seq|anim|block|stand|walk|run|turn|idle|attack/i
  const spotKeys = /spot|graphic|projectile|impact|cast/i
  walk(renderTables, '', (key, n) => {
    if (spotKeys.test(key)) loadSpotAnim(n)
    else if (seqKeys.test(key)) loadSeq(n)
  })
})

phase('audio', () => {
  const bank = new CacheSoundBank(cache, (fn) => fn())
  for (const id of allAudioSoundIds()) bank.getPcm(id)
})

phase('catalog', () => {
  const catalog = getItemCatalog(cache)
  const slots: EquipSlot[] = ['head', 'cape', 'amulet', 'weapon', 'body', 'shield', 'legs', 'hands', 'boots', 'ring']
  const ids = new Set<number>()
  for (const s of slots) for (const it of catalog.equipment(s)) ids.add(it.id)
  for (const it of catalog.ammo()) ids.add(it.id)
  for (const it of catalog.quiverAmmo()) ids.add(it.id)
  for (const it of catalog.inventory()) ids.add(it.id)
  catalogIds = ids
})

if (EQUIPMENT) {
  phase('equipment-models', () => {
    for (const id of catalogIds) {
      tryDo(() => {
        const o = objs.load(id) as unknown as Record<string, number>
        for (const k of ['maleModel', 'maleModel1', 'maleModel2', 'maleHeadModel', 'maleHeadModel2']) {
          const m = o[k]
          if (typeof m === 'number' && m >= 0) tryDo(() => models.load(m))
        }
      })
    }
  })
}


function walk(v: unknown, key: string, visit: (key: string, n: number) => void): void {
  if (typeof v === 'number') {
    if (Number.isInteger(v) && v >= 0) visit(key, v)
  } else if (Array.isArray(v)) {
    for (const x of v) walk(x, key, visit)
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) walk(x, /^\d+$/.test(k) ? key : k, visit)
  }
}
function collectNumbers(v: unknown, visit: (n: number) => void): void {
  walk(v, '', (_k, n) => visit(n))
}

// ---- report ---------------------------------------------------------------------------------
const sizeOf = (key: string): number => {
  const [i, a] = key.split(':').map(Number) as [number, number]
  return store.entry(i, a)?.size ?? 0
}
const counted = new Set<string>()
for (const [name, keys] of byPhase) {
  let fresh = 0
  let freshBytes = 0
  for (const k of keys) {
    if (counted.has(k)) continue
    counted.add(k)
    fresh++
    freshBytes += sizeOf(k)
  }
  console.log(`  ${name.padEnd(18)} +${String(fresh).padStart(6)} archives  +${(freshBytes / 1e6).toFixed(2)} MB`)
}
// Reference tables for every index we keep.
needed.set(255, new Set(needed.keys()))
const total = [...needed.entries()].reduce((n, [i, s]) => n + [...s].reduce((m, a) => m + (store.entry(i, a)?.size ?? 0), 0), 0)
console.log(`traced ${[...needed.values()].reduce((n, s) => n + s.size, 0)} archives, ${(total / 1e6).toFixed(1)} MB (before zip) in ${((performance.now() - t0) / 1000).toFixed(1)} s`)
if (MEASURE) process.exit(0)

// ---- rewrite dat2 / idx (JS5 disk layout, 520-byte sectors) ------------------------------------
const SECTOR = 520
const chunks: Uint8Array[] = [new Uint8Array(SECTOR)] // sector 0 is unused
let nextSector = 1
const idxFiles = new Map<number, Uint8Array>()
let copied = 0
for (const [index, archives] of needed) {
  const idx = new Uint8Array(store.archiveCount(index) * 6)
  for (const archive of [...archives].sort((a, b) => a - b)) {
    const data = store.entry(index, archive) ? store.read(index, archive) : null
    if (!data) continue
    const extended = archive > 0xffff
    const headerSize = extended ? 10 : 8
    const dataSize = SECTOR - headerSize
    const first = nextSector
    let written = 0
    let part = 0
    while (written < data.length) {
      const sector = new Uint8Array(SECTOR)
      const n = Math.min(dataSize, data.length - written)
      const next = written + n < data.length ? nextSector + 1 : 0
      let p = 0
      if (extended) {
        sector[p++] = (archive >>> 24) & 0xff
        sector[p++] = (archive >>> 16) & 0xff
      }
      sector[p++] = (archive >>> 8) & 0xff
      sector[p++] = archive & 0xff
      sector[p++] = (part >>> 8) & 0xff
      sector[p++] = part & 0xff
      sector[p++] = (next >>> 16) & 0xff
      sector[p++] = (next >>> 8) & 0xff
      sector[p++] = next & 0xff
      sector[p++] = index
      sector.set(data.subarray(written, written + n), headerSize)
      chunks.push(sector)
      nextSector++
      written += n
      part++
    }
    const e = archive * 6
    idx[e] = (data.length >>> 16) & 0xff
    idx[e + 1] = (data.length >>> 8) & 0xff
    idx[e + 2] = data.length & 0xff
    idx[e + 3] = (first >>> 16) & 0xff
    idx[e + 4] = (first >>> 8) & 0xff
    idx[e + 5] = first & 0xff
    copied++
  }
  idxFiles.set(index, idx)
}
const dat2 = new Uint8Array(chunks.length * SECTOR)
chunks.forEach((c, i) => dat2.set(c, i * SECTOR))
const files: Record<string, Uint8Array> = { 'cache/main_file_cache.dat2': dat2 }
for (const [index, idx] of idxFiles) files[`cache/main_file_cache.idx${index}`] = idx
const zip = zipSync(files, { level: 9 })
mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'disk.zip'), zip)
writeFileSync(
  join(OUT, 'manifest.json'),
  JSON.stringify(
    {
      source: 'OpenRS2 cache 2720 (build 240), https://archive.openrs2.org/caches/runescape/2720',
      trimmedAt: new Date().toISOString(),
      archives: copied,
      dat2Bytes: dat2.length,
      zipBytes: zip.length,
      equipmentModels: EQUIPMENT,
      indexes: [...needed.keys()].sort((a, b) => a - b),
    },
    null,
    2,
  ),
)
console.log(`wrote ${OUT}/disk.zip: ${copied} archives, dat2 ${(dat2.length / 1e6).toFixed(1)} MB, zip ${(zip.length / 1e6).toFixed(1)} MB`)

// ---- self-check: the trimmed cache must build the arena and run a fight ------------------------
const trimmed = new CacheSystem(openDiskZip(zip))
const scene = new ArenaSceneBuilder(trimmed, TRIPLE_JAD_ARENA).build({ smoothTerrain: false, textureLayer: () => -1 })
const e2 = createTripleJadEngine({ cache: trimmed, loadout: LOADOUT_PRESETS[0]!.loadout, combatSeed: 1, encounterSeed: 1 })
for (let t = 0; t < 30; t++) e2.advanceTick(e2.getState().playerPosition)
console.log(`self-check: ${scene.stats.renderedLocs} locs, ${scene.stats.terrainTriangles} terrain triangles, fight at tick ${e2.getState().currentTick}`)
