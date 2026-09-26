/**
 * Drives the render compositor (headless, no WebGL) with the real triple-Jad
 * SIM engine: the player attacks a Jad, prays mage, and the script reports
 * what the renderer shows per tick (NPC animations, spot anims, hitsplats,
 * health bars) and the average scene-build time.
 *   npx tsx scripts/render-engine-check.ts [presetId] [walk]
 */
import { readFileSync } from 'node:fs'
import { CacheSystem } from '../src/cache/CacheSystem'
import { openDiskZip } from '../src/cache/loadDiskZip'
import { TextureLoader } from '../src/cache/texture/TextureLoader'
import { createTripleJadEngine } from '../src/sim/createEngine'
import { LOADOUT_PRESETS } from '../src/sim/loadouts/presets'
import { Camera } from '../src/render/camera/Camera'
import { buildTextureArray } from '../src/render/gl/textures'
import { SceneCompositor } from '../src/render/SceneCompositor'
import { PlayerVisualFeed } from '../src/render/actors/PlayerVisualFeed'
import { DEFAULT_TILE_INDICATORS } from '../src/app/plugins/stores'

const cache = new CacheSystem(openDiskZip(new Uint8Array(readFileSync('public/osrs-cache/disk.zip'))))
const tex = buildTextureArray(TextureLoader.load(cache))
const preset = LOADOUT_PRESETS.find((p) => p.id === (process.argv[2] ?? 'max_tbow')) ?? LOADOUT_PRESETS[0]!
const engine = createTripleJadEngine({ cache, loadout: preset.loadout, combatSeed: 1, encounterSeed: 1 })
const comp = new SceneCompositor(cache, (id) => tex.layerOf.get(id) ?? -1, engine.getState())
comp.load(false, engine.getState())
const s0 = engine.getState()
const camera = new Camera({ width: 988, height: 914, dpr: 1 }, { pitch: -22.5, yaw: 0, distance: 24, targetX: s0.playerPosition[0] + 0.5, targetY: s0.playerPosition[1] + 0.5 })
camera.setTerrainHeights(comp.terrainHeights)
console.log(`preset ${preset.id}; npcs at start: ${s0.npcs.map((n) => `${n.id}(${n.npcTypeId})@${n.position}`).join(' ')}`)

engine.queueProtectionPrayer('ProtectMagic')
const feed = new PlayerVisualFeed(s0.currentTick)
feed.reset(s0.currentTick, comp.player.movement)
let buildMs = 0
let frames = 0
const seenSpots = new Map<number, number>()
const seenSeqs = new Set<string>()
for (let t = 0; t < 60; t++) {
  const st = engine.getState()
  const jad = st.npcs.find((n) => n.npcTypeId === 7700 && n.alive)
  const walk = process.argv[3] === 'walk'
  if (!walk && t === 2 && jad) engine.applyAction({ attackTarget: jad.id })
  // walk mode: step east 5 tiles, then back west, to exercise walk/run/turn sequences
  const target: [number, number] = walk ? (t < 10 ? [s0.playerPosition[0] + 5, s0.playerPosition[1]] : [s0.playerPosition[0], s0.playerPosition[1] + 1]) : st.playerPosition
  engine.advanceTick(target)
  const state = engine.getState()
  const events = engine.lastTickEvents
  for (let f = 0; f < 36; f++) {
    const interp = state.currentTick + Math.min(1, (f * 16.67) / 600)
    feed.feed(comp.player.movement, state, comp.player.controller)
    const visual = comp.player.movement.advance(16.67, 1)
    const b0 = performance.now()
    const out = comp.frame({
      state,
      events,
      interpTick: interp,
      frameDeltaMs: 16.67,
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
    buildMs += performance.now() - b0
    frames++
    for (const i of comp.spots.instances.values()) seenSpots.set(i.spotAnimId, (seenSpots.get(i.spotAnimId) ?? 0) + 1)
    for (const s of out.frameStates) seenSeqs.add(`${s.key}:${s.seqId}`)
    if (f === 0) {
      const types = [...new Set(events.map((e) => e.type))].join(',')
      console.log(
        `tick ${state.currentTick}: events[${types}] hp=${state.playerHP} spots=${comp.spots.instances.size} hitsplats=${out.hitsplats.length} bars=${out.healthBars.length} cmds=${out.queue.commands.length} npcs=${state.npcs.map((n) => `${n.id}${n.alive ? '' : '(dead)'}`).join(',')}`,
      )
    }
  }
}
console.log('spot anims seen (frames):', Object.fromEntries(seenSpots))
console.log('sequences seen:', [...seenSeqs].sort().join(' '))
console.log(`average scene build ${(buildMs / frames).toFixed(2)} ms over ${frames} frames`)
