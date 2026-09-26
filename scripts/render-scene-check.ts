/**
 * Headless check of the render pipeline (no WebGL): builds the scene
 * compositor from the cache, drives it with a scripted fake SimState
 * (3 JalTok-Jads, healers, the Max Tbow player) and prints what the renderer
 * would draw: command counts, triangles per actor, spot-anim instances,
 * overlays and frame-sound states.
 *   npx tsx scripts/render-scene-check.ts
 */
import { readFileSync } from 'node:fs'
import { CacheSystem } from '../src/cache/CacheSystem'
import { openDiskZip } from '../src/cache/loadDiskZip'
import { TextureLoader } from '../src/cache/texture/TextureLoader'
import type { NpcState, SimEvent, SimState } from '../src/sim/api'
import { Camera } from '../src/render/camera/Camera'
import { buildTextureArray } from '../src/render/gl/textures'
import { SceneCompositor, type FrameInput } from '../src/render/SceneCompositor'
import { DEFAULT_TILE_INDICATORS } from '../src/app/plugins/stores'
import { pickNpcs } from '../src/render/picking'

const cache = new CacheSystem(openDiskZip(new Uint8Array(readFileSync('public/osrs-cache/disk.zip'))))
const t0 = performance.now()
const tex = buildTextureArray(TextureLoader.load(cache))
console.log(`texture array: ${tex.layers} layers in ${(performance.now() - t0).toFixed(0)} ms`)

function npc(id: string, type: number, x: number, y: number, size: number, extra: Partial<NpcState> = {}): NpcState {
  return {
    id,
    npcTypeId: type,
    archetypeId: type === 7700 ? 'jad' : 'jad_healer',
    role: 'minion',
    alive: true,
    position: [x, y],
    previousPosition: [x, y],
    facingAngle: 0,
    combatTargetId: 'player',
    size,
    hp: type === 7700 ? 350 : 90,
    maxHp: type === 7700 ? 350 : 90,
    history: new Map(),
    ...extra,
  }
}

function state(tick: number, npcs: NpcState[], extra: Partial<SimState> = {}): SimState {
  return {
    currentTick: tick,
    playerPosition: [31, 33],
    playerPreviousPosition: [31, 33],
    playerMovementPath: [],
    playerFacingAngle: 1024,
    playerIsMoving: false,
    playerIsRunning: true,
    primaryNpcPosition: [0, 0],
    primaryNpcPreviousPosition: [0, 0],
    primaryNpcFacingAngle: 0,
    primaryNpcSize: 1,
    npcs,
    encounter: { kind: 'tripleJad', state: {}, visuals: {} },
    encounterOutcome: { phase: 'active' },
    isAlive: true,
    activePrayer: 'ProtectMagic',
    offensivePrayer: 'Rigour',
    independentPrayers: [],
    failedCondition: null,
    playerHistory: new Map(),
    playerHP: 99,
    maxHP: 99,
    playerEquipment: { head: 25912, cape: 28951, amulet: 33639, weapon: 20997, body: 27238, legs: 27241, hands: 26235, boots: 31097, ring: 28310 },
    attackTarget: 'jad1',
    lastAttackTarget: 'jad1',
    ...extra,
  } as unknown as SimState
}

let eventId = 0
const ev = (tick: number, body: Record<string, unknown>): SimEvent => ({ ...body, tick, eventId: ++eventId }) as unknown as SimEvent

const jads = (tick: number): NpcState[] => [
  npc('jad1', 7700, 24, 36, 5),
  npc('jad2', 7700, 34, 36, 5, tick >= 12 ? { alive: false, hp: 0 } : {}),
  npc('jad3', 7700, 29, 25, 5, tick >= 6 && tick < 8 ? { position: [29, 26], previousPosition: [29, 25] } : tick >= 8 ? { position: [29, 26], previousPosition: [29, 26] } : {}),
  ...(tick >= 10 ? [npc('h1', 7701, 24, 42, 1, { combatTargetId: null }), npc('h2', 7701, 25, 41, 1, { combatTargetId: null })] : []),
]

const events: Record<number, SimEvent[]> = {
  5: [ev(5, { type: 'inferno_visual', animations: [{ actorId: 'jad1', clipId: 'magic', delayCycles: 0 }], projectiles: [], graphics: [] })],
  6: [
    ev(6, { type: 'attack_started', sourceId: 'player', targetId: 'jad1', style: 'range', attackKind: 'range_arrow', impactDelayTicks: 2, weaponId: 20997, ammoId: 11212 }),
    ev(6, { type: 'inferno_visual', animations: [{ actorId: 'jad3', clipId: 'range', delayCycles: 0 }], projectiles: [], graphics: [] }),
  ],
  8: [
    ev(8, {
      type: 'inferno_visual',
      animations: [],
      projectiles: [448, 449, 450].map((id, i) => ({
        spotAnimId: id,
        sourcePosition: [26.5, 38.5],
        target: { kind: 'actor', actorId: 'player', size: 1, position: [31, 33] },
        startDelayCycles: [2, 6, 10][i],
        endDelayCycles: [2, 6, 12][i]! + 8 * 5,
        slope: 16,
        startOffset: 32,
        startHeight: 512,
        endHeight: 124,
      })),
      graphics: [],
    }),
  ],
  9: [
    ev(9, { type: 'inferno_visual', animations: [], projectiles: [], graphics: [{ spotAnimId: 451, target: { kind: 'tile', position: [31, 33] }, delayCycles: 0, height: 92 }] }),
    ev(9, { type: 'hitsplat_spawned', targetId: 'jad1', amount: 42, hitsplatType: 'damage' }),
    ev(9, { type: 'hitsplat_spawned', targetId: 'player', amount: 0, hitsplatType: 'block' }),
    ev(9, { type: 'inferno_visual', animations: [{ actorId: 'jad1', clipId: 'defend', delayCycles: 0 }], projectiles: [], graphics: [] }),
  ],
  11: [
    ev(11, { type: 'inferno_visual', animations: [{ actorId: 'h1', clipId: 'heal', delayCycles: 0 }], projectiles: [], graphics: [{ spotAnimId: 444, target: { kind: 'actor', actorId: 'jad1', size: 5, position: [24, 36] }, delayCycles: 0, height: 256 }] }),
    ev(11, { type: 'hitsplat_spawned', targetId: 'jad1', amount: 10, hitsplatType: 'heal' }),
  ],
  18: [ev(18, { type: 'actor_despawned', actorId: 'jad2' })],
}

const first = state(0, jads(0))
const comp = new SceneCompositor(cache, (id) => tex.layerOf.get(id) ?? -1, first)
const t1 = performance.now()
comp.load(false, first)
console.log(`scene loaded in ${(performance.now() - t1).toFixed(0)} ms`, comp.arenaStats)
const camera = new Camera({ width: 988, height: 914, dpr: 1 }, { pitch: -22.5, yaw: 0, distance: 24, targetX: 31.5, targetY: 33.5, targetZ: 0 })
camera.setTerrainHeights(comp.terrainHeights)
camera.update({ targetZ: camera.playerCenterZ(31.5, 33.5) })

const frameMs = 1000 / 60
let buildMs = 0
let frames = 0
for (let tick = 0; tick <= 22; tick++) {
  const s = state(tick, jads(tick))
  const evs = events[tick] ?? []
  for (let f = 0; f < 36; f++) {
    const interp = tick + Math.min(1, (f * frameMs) / 600)
    const visual = comp.player.movement.advance(frameMs, 1)
    const input: FrameInput = {
      state: s,
      events: evs,
      interpTick: interp,
      frameDeltaMs: frameMs,
      speed: 1,
      camera,
      playerVisual: visual,
      hoverTile: [30, 30],
      destinationTile: null,
      settings: { brightness: 0.6, contrast: 1, saturation: 1, smoothTerrain: false, showDebugGrid: false, showNpcClickbox: false },
      plugins: {
        tileIndicators: { enabled: true, ...DEFAULT_TILE_INDICATORS.config },
        tileMarkers: [{ x: 31, y: 30, color: '#3BA9FF', opacity: 1, fillOpacity: 0.3, label: 'A' }],
        showTileMarkerLabels: true,
        tileMarkerWidth: 2,
        lineMarkers: [{ x: 30, y: 30, orientation: 'horizontal', color: '#FF0000', opacity: 1 }],
        showLineMarkerLabels: true,
        lineMarkerWidth: 1,
        npcHighlights: [{ npcTypeId: 7700, mode: 'trueTile', color: '#6fb0ae' }],
      },
    }
    const b0 = performance.now()
    const out = comp.frame(input)
    buildMs += performance.now() - b0
    frames++
    if (f === 12) {
      const byKind: Record<string, number> = {}
      for (const c of out.queue.commands) {
        const k = c.meshId.replace(/-\d.*$/, '').replace(/v\d+-/, '')
        byKind[k] = (byKind[k] ?? 0) + c.positions.length / 9
      }
      const spots = [...comp.spots.instances.values()].map((i) => `${i.instanceId}:${i.spotAnimId}`)
      const tris = Object.entries(byKind).map(([k, n]) => `${k}=${n}`).join(' ')
      console.log(
        `tick ${tick}: cmds=${out.queue.commands.length} | ${tris} | spots=[${spots.join(', ')}] | hitsplats=${out.hitsplats.length} bars=${out.healthBars.length} icons=${out.icons.length} labels=${out.labels.length} | sounds=${out.frameStates.map((x) => `${x.key}:${x.seqId}/${x.frame}`).join(' ')}`,
      )
    }
  }
}
const hits = comp.npcs.hitTestData()
const jad1 = camera.project(26.5, 38.5, 1.5)
console.log('pick at jad1 centre:', jad1 && pickNpcs(camera, jad1.x, jad1.y, hits), 'tile:', jad1 && camera.screenToTile(jad1.x, jad1.y))
console.log(`average scene build ${(buildMs / frames).toFixed(2)} ms over ${frames} frames`)
