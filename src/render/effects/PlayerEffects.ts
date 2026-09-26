/**
 * Player-owned visual effects: the cast graphic
 * on the player, player projectiles with their impact
 * graphics and the descriptors built from tick events
 *.
 */
import type { NpcState, SimEvent, SimState } from '../../sim/api'
import {
  projectileTiming,
  projectileTimingTable,
  specialAttackVisuals,
  spellVisuals,
  timingCycles,
  weaponVisuals,
  type ItemFacts,
  type ProjectileTiming,
  type WeaponVisuals,
} from '../actors/weaponData'
import { Flight, distanceToFootprint, orientation } from './projectile'
import { oneShot, type SpotAnimSystem } from './SpotAnims'

const SPLASH = { spotAnimId: 85, height: 124, heightMode: 'actor' as const }
const SPELL_CAST_SPOTANIMS = new Set<number>()

interface TargetInfo {
  position: readonly [number, number]
  size: number
  npcTypeId: number
  actorId: string | undefined
}

export type PlayerEffectDescriptor =
  | { kind: 'graphic'; key: string; tick: number; spotAnimId: number; height: number }
  | {
      kind: 'projectile'
      key: string
      tick: number
      source: readonly [number, number]
      target: TargetInfo
      weaponId: number
      visuals: WeaponVisuals
      timing: ProjectileTiming | undefined
      presentation: { origin?: 'caster' | 'target' | undefined; impactHeightMode?: 'actor' | 'sequence' | undefined }
    }
  | { kind: 'impact'; key: string; tick: number; startTick: number; target: TargetInfo; spotAnimId: number; height: number; heightMode: 'actor' | 'sequence' }

function targetOf(state: SimState, id: string): TargetInfo {
  const npc: NpcState | undefined = state.npcs.find((n) => n.id === id)
  return {
    position: npc?.position ?? state.primaryNpcPosition,
    size: npc?.size ?? state.primaryNpcSize,
    npcTypeId: npc?.npcTypeId ?? 0,
    actorId: id,
  }
}

/** `_S`: descriptors for the events of one displayed tick. */
export function playerEffectDescriptors(
  state: SimState,
  events: readonly SimEvent[],
  facts: (id: number) => ItemFacts | undefined,
): PlayerEffectDescriptor[] {
  const out: PlayerEffectDescriptor[] = []
  let graphic: PlayerEffectDescriptor | undefined
  for (const ev of events) {
    const key = `event-${ev.eventId}`
    if (ev.type === 'spell_self_cast') {
      const spot = (ev as { spotAnimId?: unknown }).spotAnimId
      const anim = (ev as { animationId?: unknown }).animationId
      if (typeof spot === 'number' && spot >= 0 && typeof anim === 'number') graphic = { kind: 'graphic', key, tick: ev.tick, spotAnimId: spot, height: 0 }
    }
    if ((ev.type !== 'attack_started' && ev.type !== 'spell_targeted') || ev.sourceId !== 'player') continue
    const target = targetOf(state, ev.targetId)
    const spell = ev.spellId === undefined || ev.spellId === null ? undefined : spellVisuals(ev.spellId)
    if (ev.spellId !== undefined && ev.spellId !== null && !spell) continue
    if (spell) {
      const cast = spell.impactTiming || ev.type === 'spell_targeted' ? ev.spellCast : undefined
      const source = cast?.sourcePosition ?? state.playerPosition
      const tgt: TargetInfo = { ...target, position: cast?.targetPosition ?? target.position, size: cast?.targetSize ?? target.size }
      const hit =
        ev.spellCast?.accurate === false
          ? SPLASH
          : { spotAnimId: spell.hitSpotanimId, height: spell.hitSpotanimHeight, heightMode: spell.hitSpotanimHeightMode ?? ('sequence' as const) }
      if (ev.type === 'attack_started' && spell.castSpotanimId >= 0) {
        graphic = { kind: 'graphic', key, tick: ev.tick, spotAnimId: spell.castSpotanimId, height: spell.castSpotanimHeight ?? 0 }
      }
      if (spell.projectileId >= 0) {
        out.push({
          kind: 'projectile',
          key,
          tick: ev.tick,
          source,
          target: tgt,
          weaponId: ev.weaponId ?? 0,
          timing: projectileTimingTable('magic_spell'),
          presentation: { origin: spell.projectileOrigin, impactHeightMode: hit.heightMode },
          visuals: {
            attackAnimation: spell.castAnimationId,
            castSpotanim: spell.castSpotanimId,
            castSpotanimHeight: 0,
            projectileId: spell.projectileId,
            projectileStartHeight: spell.projectileStartHeight,
            projectileEndHeight: spell.projectileEndHeight,
            projectileSlope: spell.projectileSlope,
            projectileStartDelay: spell.projectileStartDelay,
            hitSpotanim: hit.spotAnimId,
            hitSpotanimHeight: hit.height,
          },
        })
      } else if (hit.spotAnimId >= 0) {
        const delay = spell.impactTiming
          ? timingCycles(spell.impactTiming, distanceToFootprint(source[0], source[1], tgt.position[0], tgt.position[1], tgt.size)) / 30
          : ev.impactDelayTicks
        out.push({ kind: 'impact', key, tick: ev.tick, startTick: ev.tick + delay, target: tgt, spotAnimId: hit.spotAnimId, height: hit.height, heightMode: hit.heightMode })
      }
    } else if (ev.type === 'attack_started') {
      const special = ev.usingSpecialAttack === true && ev.weaponId !== undefined ? specialAttackVisuals(ev.weaponId) : undefined
      const base = weaponVisuals(ev.weaponId, ev.ammoId, ev.usingSpecialAttack === true, facts)
      const splashed = ev.style === 'magic' && ev.spellCast?.accurate === false
      const vis = base && splashed ? { ...base, hitSpotanim: SPLASH.spotAnimId, hitSpotanimHeight: SPLASH.height } : base
      if (special?.graphicId !== undefined && special.graphicId >= 0) graphic = { kind: 'graphic', key, tick: ev.tick, spotAnimId: special.graphicId, height: 0 }
      else if (vis && vis.castSpotanim >= 0) graphic = { kind: 'graphic', key, tick: ev.tick, spotAnimId: vis.castSpotanim, height: vis.castSpotanimHeight }
      if (vis && vis.projectileId >= 0 && ev.style !== 'melee') {
        out.push({
          kind: 'projectile',
          key,
          tick: ev.tick,
          source: state.playerPosition,
          target,
          weaponId: ev.weaponId ?? 0,
          visuals: vis,
          timing: projectileTiming(ev.weaponId, ev.usingSpecialAttack === true),
          presentation: splashed ? { impactHeightMode: 'actor' } : {},
        })
      }
      const tg = special?.targetGraphic
      if (tg) {
        let delay: number | undefined
        if (tg.delayCycles !== 'projectile_arrival') delay = tg.delayCycles
        else {
          const cast = ev.spellCast
          const t = ev.weaponId === undefined ? undefined : projectileTiming(ev.weaponId, true)
          if (cast && t) delay = timingCycles(t, distanceToFootprint(cast.sourcePosition[0], cast.sourcePosition[1], cast.targetPosition[0], cast.targetPosition[1], cast.targetSize))
        }
        if (delay !== undefined) {
          out.push({ kind: 'impact', key: `${key}-target-graphic`, tick: ev.tick, startTick: ev.tick + delay / 30, target, spotAnimId: tg.spotAnimId, height: tg.height, heightMode: 'actor' })
        }
      }
    }
  }
  for (const ev of events) {
    if (ev.type === 'npc_graphic_applied') {
      const npc = state.npcs.find((n) => n.id === ev.targetId)
      if (npc) {
        out.push({
          kind: 'impact',
          key: `event-${ev.eventId}`,
          tick: ev.tick,
          startTick: ev.tick,
          target: { position: npc.position, size: npc.size, npcTypeId: npc.npcTypeId, actorId: npc.id },
          spotAnimId: ev.spotAnimId,
          height: ev.height,
          heightMode: 'actor',
        })
      }
    }
    if (ev.type === 'player_graphic_applied') graphic = { kind: 'graphic', key: `event-${ev.eventId}`, tick: ev.tick, spotAnimId: ev.spotAnimId, height: 0 }
  }
  if (graphic) out.unshift(graphic)
  return out
}

interface Projectile {
  id: string
  spotAnimId: number
  flight: Flight
  sourceX: number
  sourceY: number
  sourceSize: number
  target: TargetInfo
  lastKnown: readonly [number, number]
  startHeight: number
  endHeight: number
}

interface Impact {
  id: string
  spotAnimId: number
  startTick: number
  target: TargetInfo
  lastKnown: readonly [number, number]
  heightOffset: number
  useNpcCenterHeight: boolean
  aimHeight: number
  heightMode: 'actor' | 'sequence'
  onActor: boolean
  spell: boolean
}

export interface PlayerEffectsContext {
  currentTick: number
  interpTick: number
  playerVisual: readonly [number, number]
  facingAngle: number
  playerModelLift: number
  /** Visual SW of an actor ('player' -> player visual). */
  resolveActor(actorId: string): readonly [number, number] | null
  surfaceHeight(x: number, y: number): number
  bilinearHeight(x: number, y: number): number
  /** Footprint ground z (`id`). */
  footprintZ(x: number, y: number, size: number): number
  /** NPC facing for impact graphics. */
  targetFacing: number
  /** Type-level hitsplat height of an NPC type (tiles). */
  typeHitsplatHeight(npcTypeId: number): number
}

export class PlayerEffects {
  private graphic: { spotAnimId: number; startTick: number; height: number } | null = null
  private readonly projectiles = new Map<string, Projectile>()
  private readonly impacts = new Map<string, Impact>()
  private lastObservedTick = -Infinity
  private nextId = 0
  private readonly consumed = new Set<string>()

  constructor() {
    if (SPELL_CAST_SPOTANIMS.size === 0) {
      // Cast graphics of spells get a small depth bias ( style).
    }
  }

  consume(descriptors: readonly PlayerEffectDescriptor[], spots: SpotAnimSystem, typeHitsplatHeight: (npcTypeId: number) => number): void {
    for (const d of descriptors) {
      if (this.consumed.has(`${d.kind}:${d.key}`)) continue
      this.consumed.add(`${d.kind}:${d.key}`)
      if (d.kind === 'graphic') {
        this.graphic = { spotAnimId: d.spotAnimId, startTick: d.tick, height: d.height }
        spots.load(d.spotAnimId)
      } else if (d.kind === 'projectile') this.launch(d, spots, typeHitsplatHeight(d.target.npcTypeId))
      else {
        spots.load(d.spotAnimId)
        const id = `player-projectile-impact-${d.key}`
        this.impacts.set(id, {
          id,
          spotAnimId: d.spotAnimId,
          startTick: d.startTick,
          target: d.target,
          lastKnown: d.target.position,
          heightOffset: d.height / 128,
          useNpcCenterHeight: false,
          aimHeight: 0,
          heightMode: d.heightMode,
          onActor: d.target.actorId !== undefined,
          spell: false,
        })
      }
    }
  }

  private launch(d: Extract<PlayerEffectDescriptor, { kind: 'projectile' }>, spots: SpotAnimSystem, hitsplatHeight: number): void {
    const v = d.visuals
    if (v.projectileId < 0) return
    spots.load(v.projectileId)
    if (v.hitSpotanim >= 0) spots.load(v.hitSpotanim)
    const dist = distanceToFootprint(d.source[0], d.source[1], d.target.position[0], d.target.position[1], d.target.size)
    const t = d.timing ?? projectileTiming(d.weaponId)
    const start = d.tick * 30 + v.projectileStartDelay
    const arrive = d.tick * 30 + (t ? timingCycles(t, dist) : v.projectileStartDelay + 30)
    const id = d.key || String(this.nextId++)
    const fromTarget = d.presentation.origin === 'target'
    const origin = fromTarget ? d.target.position : d.source
    this.projectiles.set(`player-projectile-${id}`, {
      id: `player-projectile-${id}`,
      spotAnimId: v.projectileId,
      flight: new Flight(start, arrive + 1, t?.progress ?? 0, v.projectileSlope),
      sourceX: origin[0],
      sourceY: origin[1],
      sourceSize: fromTarget ? d.target.size : 1,
      target: d.target,
      lastKnown: d.target.position,
      startHeight: v.projectileStartHeight,
      endHeight: v.projectileEndHeight,
    })
    if (v.hitSpotanim >= 0) {
      const iid = `player-projectile-impact-${id}`
      this.impacts.set(iid, {
        id: iid,
        spotAnimId: v.hitSpotanim,
        startTick: arrive / 30,
        target: d.target,
        lastKnown: d.target.position,
        heightOffset: v.hitSpotanimHeight / 128,
        useNpcCenterHeight: d.presentation.impactHeightMode !== 'actor',
        aimHeight: hitsplatHeight,
        heightMode: d.presentation.impactHeightMode ?? 'sequence',
        onActor: d.target.actorId !== undefined,
        spell: d.timing !== undefined && d.presentation.impactHeightMode !== undefined,
      })
    }
  }

  private aim(target: TargetInfo, ctx: PlayerEffectsContext, remember: { lastKnown: readonly [number, number] }): readonly [number, number] {
    if (target.actorId === undefined) return target.position
    const r = ctx.resolveActor(target.actorId)
    if (r) remember.lastKnown = r
    return remember.lastKnown
  }

  update(spots: SpotAnimSystem, ctx: PlayerEffectsContext): void {
    if (ctx.currentTick < this.lastObservedTick) this.clear(spots)
    this.lastObservedTick = ctx.currentTick
    const now = ctx.interpTick * 30
    // cast graphic on the player
    if (this.graphic) {
      const g = this.graphic
      const state = oneShot(
        spots,
        {
          instanceId: 'player-graphic-active',
          spotAnimId: g.spotAnimId,
          startCycle: g.startTick * 30,
          transform: () => {
            const x = ctx.playerVisual[0] + 0.5
            const y = ctx.playerVisual[1] + 0.5
            return { x, y, z: -ctx.bilinearHeight(x, y) / 128 + ctx.playerModelLift + g.height / 128, yaw2048: ctx.facingAngle }
          },
          heightOffsetMode: 'actor',
          fallbackDurationCycles: 90,
        },
        now,
      )
      if (state === 'expired') this.graphic = null
    } else spots.despawn('player-graphic-active')
    for (const [id, p] of this.projectiles) {
      const [ax, ay] = this.aim(p.target, ctx, p)
      const tx = ax + p.target.size / 2
      const ty = ay + p.target.size / 2
      const sx = p.sourceX + p.sourceSize / 2
      const sy = p.sourceY + p.sourceSize / 2
      const s = p.flight.sample(now, { x: sx, y: sy, z: (p.startHeight - ctx.surfaceHeight(sx, sy)) / 128 }, { x: tx, y: ty, z: (p.endHeight - ctx.surfaceHeight(tx, ty)) / 128 })
      if (s.kind === 'expired') {
        spots.despawn(id)
        this.projectiles.delete(id)
        continue
      }
      if (s.kind === 'pending' || !spots.isLoaded(p.spotAnimId)) {
        spots.despawn(id)
        continue
      }
      const o = orientation(s.motion)
      const lengths = spots.frameLengths(p.spotAnimId) ?? []
      spots.upsert({
        instanceId: id,
        spotAnimId: p.spotAnimId,
        transform: { x: s.motion.x, y: s.motion.y, z: s.motion.z, yaw2048: o.yaw2048, pitchRad: o.pitchRad },
        lifecycle: { kind: 'duration', startTick: p.flight.startCycle / 30, endTick: p.flight.endExclusive / 30 },
        frameProgress: Flight.frameProgress('full-sequence', now - p.flight.startCycle, lengths, -1),
        heightOffsetMode: 'sequence',
      })
    }
    for (const [id, imp] of this.impacts) {
      const state = oneShot(
        spots,
        {
          instanceId: id,
          spotAnimId: imp.spotAnimId,
          startCycle: imp.startTick * 30,
          transform: () => {
            const [ax, ay] = this.aim(imp.target, ctx, imp)
            const size = imp.target.size
            return {
              x: ax + size / 2,
              y: ay + size / 2,
              z: ctx.footprintZ(ax, ay, size) + (imp.useNpcCenterHeight ? imp.aimHeight : 0) + imp.heightOffset,
              yaw2048: imp.onActor ? ctx.targetFacing : 0,
            }
          },
          style: imp.spell ? { depthBias: 5e-4 } : undefined,
          heightOffsetMode: imp.heightMode,
          fallbackDurationCycles: 90,
        },
        now,
      )
      if (state === 'expired') this.impacts.delete(id)
    }
  }

  clear(spots: SpotAnimSystem): void {
    this.graphic = null
    spots.despawn('player-graphic-active')
    for (const id of this.projectiles.keys()) spots.despawn(id)
    for (const id of this.impacts.keys()) spots.despawn(id)
    this.projectiles.clear()
    this.impacts.clear()
    this.consumed.clear()
  }
}
