import type { AttackStyle } from '../../data/inferno/monsters'
import type { Actor } from '../Actor'
import { chebyshev, distanceToActor, isAdjacent, isAdjacentOrthogonal } from '../Collision'
import { npcMaxHitFor, resolveNpcAttack } from '../combat/npcAttack'
import { rollDamage } from '../combat/formulas'
import { stepAlongPath } from '../Movement'
import { Npc, type NpcBehaviour } from '../Npc'
import { Player } from '../Player'
import type { World } from '../World'
import { addCombatEvent } from './events'

export interface MonsterBehaviourOptions {
  /** Ticks after the attack animation starts until the hit lands. */
  hitDelay?: number
  /** Melee style used when adjacent, for ranged/magic monsters that also melee. */
  meleeStyle?: AttackStyle
  /** Chance to choose melee when adjacent (blob/ranger/mager). */
  meleeChance?: number
  /** Can it melee diagonally (Jal-ImKot cannot). */
  diagonalMelee?: boolean
  /** Whether the attack goes through line of sight checks (blobs after a scan do not). */
  needsLineOfSight?: boolean
  /** Hook to choose the style for this attack (blob prayer check etc.). */
  chooseStyle?: (world: World, npc: Npc, player: Player) => AttackStyle
  /** Hook run when the attack lands, before damage; return false to cancel. */
  onHit?: (world: World, npc: Npc, player: Player, dealt: number, style: AttackStyle) => void
}

/**
 * The generic Inferno monster loop: acquire the player, walk into range with
 * line of sight, attack on a fixed cycle, melee when adjacent if able.
 */
export class MonsterBehaviour implements NpcBehaviour {
  protected readonly options: MonsterBehaviourOptions

  constructor(options: MonsterBehaviourOptions = {}) {
    this.options = options
  }

  onSpawn(world: World, npc: Npc): void {
    npc.spawnTick = world.tick
    npc.frozen = 1 // spawn stun
    npc.attackDelay = 0
    npc.target = findPlayer(world)
  }

  onDeath(_world: World, _npc: Npc): void {}

  onDamaged(_world: World, _npc: Npc, _amount: number, _source: Actor | null): void {}

  onTick(world: World, npc: Npc): void {
    if (npc.dead) return
    if (npc.frozen > 0) {
      npc.frozen--
      return
    }
    if (npc.attackDelay > 0) npc.attackDelay--
    const target = npc.target
    if (!target || target.dead) {
      npc.target = findPlayer(world)
      return
    }
    if (this.tryAttack(world, npc, target)) return
    this.approach(world, npc, target)
  }

  protected tryAttack(world: World, npc: Npc, target: Actor): boolean {
    if (npc.attackDelay > 0) return false
    if (!(target instanceof Player)) return this.attackObject(world, npc, target)
    const style = this.pickStyle(world, npc, target)
    if (!style) return false
    npc.faceTile(target.x, target.y)
    npc.playAnimation(this.animationFor(npc, style), world.tick)
    npc.attackDelay = npc.def.attackSpeed
    const delay = this.options.hitDelay ?? npc.def.ticksAfterAnimation
    const def = npc.def
    world.schedule(delay, (w) => {
      if (target.dead) return
      const result = resolveNpcAttack(w, def, style, target)
      this.options.onHit?.(w, npc, target, result.dealt, style)
      target.applyDamage(result.dealt, w.tick)
      addCombatEvent(w, { tick: w.tick, source: npc, target, style, damage: result.dealt, prayed: result.prayed })
    })
    return true
  }

  /** Attack a non-player actor (the Zuk shield): plain damage roll, no prayers. */
  protected attackObject(world: World, npc: Npc, target: Actor): boolean {
    const def = npc.def
    const dist = distanceToActor(npc.x + Math.floor(npc.size / 2), npc.y + Math.floor(npc.size / 2), target.x, target.y, target.size)
    const melee = def.attackRange <= 1
    if (melee ? !isAdjacent(target.x, target.y, npc.x, npc.y, npc.size) : dist > def.attackRange) return false
    const style = def.styles.find((s) => s === 'ranged' || s === 'magic') ?? def.styles[0] ?? 'crush'
    npc.faceTile(target.x, target.y)
    npc.playAnimation(this.animationFor(npc, style), world.tick)
    npc.attackDelay = def.attackSpeed
    const maxHit = npcMaxHitFor(def, style)
    world.schedule(this.options.hitDelay ?? def.ticksAfterAnimation, (w) => {
      if (target.dead) return
      const dmg = w.rng.chance(0.5) ? rollDamage(maxHit, () => w.rng.next()) : 0
      target.applyDamage(dmg, w.tick)
      addCombatEvent(w, { tick: w.tick, source: npc, target, style, damage: dmg, prayed: false })
    })
    return true
  }

  /** Style for this attack, or null when the monster cannot attack from here. */
  protected pickStyle(world: World, npc: Npc, player: Player): AttackStyle | null {
    const def = npc.def
    const melee = this.options.meleeStyle ?? (def.attackRange <= 1 ? def.styles[0] ?? null : null)
    const adjacent = this.options.diagonalMelee === false ? isAdjacentOrthogonal(player.x, player.y, npc.x, npc.y, npc.size) : isAdjacent(player.x, player.y, npc.x, npc.y, npc.size)
    if (melee && adjacent) {
      const ranged = def.styles.find((s) => s === 'ranged' || s === 'magic')
      if (!ranged || world.rng.chance(this.options.meleeChance ?? 1)) return melee
    }
    if (def.attackRange <= 1) return null
    const dist = distanceToActor(player.x, player.y, npc.x, npc.y, npc.size)
    if (dist > def.attackRange) return null
    if (this.options.needsLineOfSight !== false && !hasLineOfSightTo(world, npc, player)) return null
    if (this.options.chooseStyle) return this.options.chooseStyle(world, npc, player)
    const primary = def.styles.find((s) => s === 'ranged' || s === 'magic')
    return primary ?? def.styles[0] ?? null
  }

  protected animationFor(npc: Npc, style: AttackStyle): number {
    const a = npc.def.animations
    if (style === 'magic' && a.attackMagic !== undefined) return a.attackMagic
    if (style === 'ranged' && a.attackRanged !== undefined) return a.attackRanged
    if ((style === 'stab' || style === 'slash' || style === 'crush') && a.attackAlt !== undefined && npc.def.attackRange > 1) return a.attackAlt
    return a.attack
  }

  /**
   * Client-like chase: step the SW corner toward the target on both axes,
   * else x only, else y only. Stops when in range with line of sight.
   */
  protected approach(world: World, npc: Npc, target: Actor): void {
    const def = npc.def
    const dist = distanceToActor(target.x, target.y, npc.x, npc.y, npc.size)
    const inRange = def.attackRange <= 1 ? isAdjacent(target.x, target.y, npc.x, npc.y, npc.size) : dist <= def.attackRange && hasLineOfSightTo(world, npc, target)
    if (inRange) return
    if (npc.path.length === 0 || npc.memory.repathTick !== world.tick - 1) {
      npc.path = world.pathfinder.findPath(npc.x, npc.y, npc.size, target.x, target.y, target.size)
    }
    npc.memory.repathTick = world.tick
    if (npc.path.length) {
      stepAlongPath(npc, world, false)
      return
    }
    // Fallback greedy step when no path.
    const dx = Math.sign(target.x - npc.x)
    const dy = Math.sign(target.y - npc.y)
    if (dx !== 0 && dy !== 0 && world.collision.canStep(npc.x, npc.y, npc.size, dx, dy)) {
      npc.x += dx
      npc.y += dy
    } else if (dx !== 0 && world.collision.canStep(npc.x, npc.y, npc.size, dx, 0)) {
      npc.x += dx
    } else if (dy !== 0 && world.collision.canStep(npc.x, npc.y, npc.size, 0, dy)) {
      npc.y += dy
    }
    npc.stepsThisTick = chebyshev(npc.prevX, npc.prevY, npc.x, npc.y)
  }
}

export function findPlayer(world: World): Player | null {
  for (const a of world.actors) if (a instanceof Player && !a.dead) return a
  return null
}

/** Line of sight from any tile of the NPC's footprint to the target tile (client checks from the nearest tile). */
export function hasLineOfSightTo(world: World, npc: Npc, target: Actor): boolean {
  const c = world.collision as { hasLineOfSightActors?: (ax: number, ay: number, aSize: number, bx: number, by: number, bSize: number) => boolean }
  if (c.hasLineOfSightActors) return c.hasLineOfSightActors(npc.x, npc.y, npc.size, target.x, target.y, target.size)
  const fx = clamp(target.x, npc.x, npc.x + npc.size - 1)
  const fy = clamp(target.y, npc.y, npc.y + npc.size - 1)
  return world.collision.hasLineOfSight(fx, fy, target.x, target.y)
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}
