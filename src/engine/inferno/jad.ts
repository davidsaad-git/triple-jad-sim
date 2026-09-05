import type { AttackStyle } from '../../data/inferno/monsters'
import { JAD_HEALER_TRIGGER_FRACTION, MONSTERS } from '../../data/inferno/monsters'
import type { Actor } from '../Actor'
import { isAdjacent } from '../Collision'
import { stepAlongPath } from '../Movement'
import { Npc } from '../Npc'
import { Player } from '../Player'
import type { World } from '../World'
import { addCombatEvent } from './events'
import { MonsterBehaviour, findPlayer } from './MonsterBehaviour'

export interface JadOptions {
  attackSpeed: number
  healerCount: number
  /** Ticks the Jad stays frozen on spawn (wave 68 staggers them 1/4/7). */
  spawnStun: number
  /** What the Jad targets first (the shield on wave 69). */
  initialTarget?: Actor | null
}

/**
 * JalTok-Jad: alternates mage and range at random, melee when adjacent. The
 * attack animation starts, and the hit lands 3 ticks later, giving the
 * player time to read the cue. Healers appear at half health.
 */
export class JadBehaviour extends MonsterBehaviour {
  readonly jadOptions: JadOptions
  private healersSpawned = false
  readonly healers: Npc[] = []

  constructor(options: JadOptions) {
    super({
      meleeStyle: 'stab',
      meleeChance: 0.5,
      hitDelay: 3,
      chooseStyle: (world) => (world.rng.chance(0.5) ? 'ranged' : 'magic'),
    })
    this.jadOptions = options
  }

  override onSpawn(world: World, npc: Npc): void {
    super.onSpawn(world, npc)
    npc.frozen = this.jadOptions.spawnStun
    if (this.jadOptions.initialTarget) npc.target = this.jadOptions.initialTarget
  }

  override onTick(world: World, npc: Npc): void {
    if (npc.dead) return
    if (!this.healersSpawned && npc.hitpoints <= Math.floor(npc.maxHitpoints * JAD_HEALER_TRIGGER_FRACTION)) {
      this.healersSpawned = true
      this.spawnHealers(world, npc)
    }
    super.onTick(world, npc)
  }

  protected override tryAttack(world: World, npc: Npc, target: Actor): boolean {
    if (npc.attackDelay > 0) return false
    if (target instanceof Player) {
      const ok = super.tryAttack(world, npc, target)
      if (ok) npc.attackDelay = this.jadOptions.attackSpeed
      return ok
    }
    // Attacking the shield (wave 69): no prayer logic, straight damage.
    if (!isAdjacent(target.x, target.y, npc.x, npc.y, npc.size) && !world.collision.hasLineOfSight(npc.x, npc.y, target.x, target.y)) return false
    const style: AttackStyle = world.rng.chance(0.5) ? 'ranged' : 'magic'
    npc.faceTile(target.x, target.y)
    npc.playAnimation(style === 'magic' ? (npc.def.animations.attackMagic ?? npc.def.animations.attack) : (npc.def.animations.attackRanged ?? npc.def.animations.attack), world.tick)
    npc.attackDelay = this.jadOptions.attackSpeed
    world.schedule(3, (w) => {
      if (target.dead) return
      const dmg = w.rng.range(0, 40)
      target.applyDamage(dmg, w.tick)
      addCombatEvent(w, { tick: w.tick, source: npc, target, style, damage: dmg, prayed: false })
    })
    return true
  }

  override onDeath(world: World, npc: Npc): void {
    void npc
    for (const h of this.healers) {
      if (!h.dead) {
        h.dead = true
        h.removeWhenDead = true
        world.removeActor(h)
      }
    }
  }

  private spawnHealers(world: World, jad: Npc): void {
    for (let i = 0; i < this.jadOptions.healerCount; i++) {
      const healer = new Npc(MONSTERS.jadHealer, new JadHealerBehaviour(jad))
      let placed = false
      for (let attempt = 0; attempt < 20 && !placed; attempt++) {
        const x = jad.x + world.rng.range(-5, 5)
        const y = jad.y + world.rng.range(-5, 9)
        if (world.collision.canStand(x, y, 1)) {
          healer.setPosition(x, y)
          placed = true
        }
      }
      if (!placed) healer.setPosition(jad.x, jad.y - 1)
      healer.target = jad
      healer.spawnTick = world.tick
      this.healers.push(healer)
      world.addActor(healer)
    }
  }
}

/** Yt-HurKot: walks to Jad and heals it every 4 ticks; turns on the player once attacked. */
export class JadHealerBehaviour extends MonsterBehaviour {
  private readonly jad: Npc
  private aggro = false

  constructor(jad: Npc) {
    super({ diagonalMelee: true })
    this.jad = jad
  }

  override onDamaged(_world: World, npc: Npc, _amount: number, source: Actor | null): void {
    if (source instanceof Player) {
      this.aggro = true
      npc.target = source
    }
  }

  override onTick(world: World, npc: Npc): void {
    if (npc.dead) return
    if (this.aggro || this.jad.dead) {
      if (this.jad.dead) {
        npc.target = findPlayer(world)
      }
      super.onTick(world, npc)
      return
    }
    if (npc.attackDelay > 0) npc.attackDelay--
    if (isAdjacent(npc.x, npc.y, this.jad.x, this.jad.y, this.jad.size)) {
      if (npc.attackDelay === 0) {
        npc.attackDelay = 4
        npc.faceTile(this.jad.x + 2, this.jad.y + 2)
        npc.playAnimation(npc.def.animations.special ?? npc.def.animations.attack, world.tick)
        const healed = this.jad.heal(world.rng.range(15, 24), world.tick, true)
        addCombatEvent(world, { tick: world.tick, source: npc, target: this.jad, style: 'heal', damage: healed, prayed: false })
      }
      return
    }
    if (npc.path.length === 0) npc.path = world.pathfinder.findPath(npc.x, npc.y, 1, this.jad.x, this.jad.y, this.jad.size)
    stepAlongPath(npc, world, false)
  }
}
