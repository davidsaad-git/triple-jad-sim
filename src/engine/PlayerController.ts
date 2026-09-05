import { distanceToActor, isAdjacent } from './Collision'
import { resolveRangedAttack } from './combat/playerAttack'
import { addCombatEvent } from './inferno/events'
import { hasLineOfSightTo } from './inferno/MonsterBehaviour'
import type { Loadout } from './Loadout'
import { stepAlongPath } from './Movement'
import { Npc } from './Npc'
import type { Player } from './Player'
import type { World, WorldSystem } from './World'

/**
 * Per-tick player logic: prayers, following/attacking the target, walking,
 * stat and hitpoint regeneration, run energy.
 */
export class PlayerController implements WorldSystem {
  readonly player: Player
  loadout: Loadout
  autoRetaliate = false
  private boostTimer = 100

  constructor(player: Player, loadout: Loadout) {
    this.player = player
    this.loadout = loadout
    player.bonuses = loadout.bonuses
  }

  setLoadout(loadout: Loadout): void {
    this.loadout = loadout
    this.player.bonuses = loadout.bonuses
  }

  preTick(): void {
    this.player.prayers.applyQueued()
  }

  playerPhase(world: World): void {
    const p = this.player
    if (p.dead) return
    if (p.attackDelay > 0) p.attackDelay--
    if (p.foodDelay > 0) p.foodDelay--
    if (p.potionDelay > 0) p.potionDelay--
    if (p.karambwanDelay > 0) p.karambwanDelay--

    const target = p.target
    if (target instanceof Npc && !target.dead) {
      this.pursue(world, p, target)
    } else {
      if (target) p.target = null
      stepAlongPath(p, world, p.running && p.runEnergy > 0)
    }

    if (p.stepsThisTick === 2) {
      p.runEnergy = Math.max(0, p.runEnergy - 67) // ~0.67% per running tile at max weight-free rate
      if (p.runEnergy === 0) p.running = false
    } else if (p.runEnergy < 10000) {
      p.runEnergy = Math.min(10000, p.runEnergy + 8)
    }

    p.prayers.drain(p.bonuses.prayer)
    p.regenTimer--
    if (p.regenTimer <= 0) {
      p.regenTimer = 100
      if (p.hitpoints < p.maxHitpoints) p.hitpoints++
    }
    this.boostTimer--
    if (this.boostTimer <= 0) {
      this.boostTimer = 100
      p.tickBoosts()
    }
  }

  private pursue(world: World, p: import('./Player').Player, target: Npc): void {
    const w = this.loadout.weapon
    const dist = distanceToActor(p.x, p.y, target.x, target.y, target.size)
    const inRange = w.range <= 1 ? isAdjacent(p.x, p.y, target.x, target.y, target.size) : dist <= w.range && world.collision.hasLineOfSight(p.x, p.y, nearestTileX(p, target), nearestTileY(p, target))
    if (!inRange) {
      if (p.path.length === 0 || p.memoryRepath !== world.tick - 1) {
        p.path = world.pathfinder.findPath(p.x, p.y, 1, target.x, target.y, target.size)
      }
      p.memoryRepath = world.tick
      stepAlongPath(p, world, p.running && p.runEnergy > 0)
      return
    }
    p.path = []
    p.faceTile(target.x + Math.floor(target.size / 2), target.y + Math.floor(target.size / 2))
    if (p.attackDelay > 0) return
    p.attackDelay = w.speed
    p.playAnimation(w.attackAnimation, world.tick)
    const delay = w.hitDelay(dist) + 1 // NPCs are processed before players: hits on NPCs land a tick later
    const loadout = this.loadout
    const npc = target
    world.launchProjectile({
      graphicId: -1,
      fromX: p.x,
      fromY: p.y,
      toX: npc.x,
      toY: npc.y,
      startTick: world.tick,
      landTick: world.tick + delay,
      onLand: (ww) => {
        if (npc.dead) return
        const result = resolveRangedAttack(ww, p, loadout, npc)
        npc.applyDamage(result.damage, ww.tick)
        npc.behaviour.onDamaged?.(ww, npc, result.damage, p)
        addCombatEvent(ww, { tick: ww.tick, source: p, target: npc, style: 'ranged', damage: result.damage, prayed: false })
      },
    })
  }
}

function nearestTileX(p: { x: number }, t: { x: number; size: number }): number {
  return Math.max(t.x, Math.min(p.x, t.x + t.size - 1))
}

function nearestTileY(p: { y: number }, t: { y: number; size: number }): number {
  return Math.max(t.y, Math.min(p.y, t.y + t.size - 1))
}

void hasLineOfSightTo
