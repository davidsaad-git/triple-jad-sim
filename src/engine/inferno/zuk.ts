import {
  MONSTERS,
  ZUK_ENRAGED_ATTACK_SPEED,
  ZUK_ENRAGE_HITPOINTS,
  ZUK_FIRST_SET_TICKS,
  ZUK_HEALERS_HITPOINTS,
  ZUK_JAD_HITPOINTS,
  ZUK_MAX_HIT,
  ZUK_SET_PAUSE_HITPOINTS,
  ZUK_SET_PERIOD_TICKS,
  ZUK_SET_RESUME_BONUS_TICKS,
} from '../../data/inferno/monsters'
import type { Actor } from '../Actor'
import { attackRoll, defenceRoll, effectiveLevel, hitChance, npcEffectiveLevel, rollDamage } from '../combat/formulas'
import { MagerBehaviour, rangerBehaviour } from './behaviours'
import { addCombatEvent } from './events'
import { JadBehaviour } from './jad'
import { MonsterBehaviour, findPlayer } from './MonsterBehaviour'
import { Npc, type NpcBehaviour } from '../Npc'
import { Player } from '../Player'
import type { World, WorldSystem } from '../World'

/** Region-local layout of the Zuk arena (IT coordinates converted: x + 6, 60 - y). */
export const ZUK_LAYOUT = {
  zukSw: { x: 28, y: 52 },
  playerStart: { x: 31, y: 45 },
  shieldStart: { x: 29, y: 47 },
  shieldMinX: 17,
  shieldMaxX: 41,
  shieldWidth: 5,
  shieldY: 47,
  /** Rows 44..46 (just south of the shield row) are covered; anything further south is exposed. */
  exposedRowMinY: 44,
  setMager: { x: 26, y: 39 },
  setRanger: { x: 35, y: 39 },
  jad: { x: 30, y: 35 },
  healers: [
    { x: 22, y: 51 },
    { x: 26, y: 51 },
    { x: 36, y: 51 },
    { x: 40, y: 51 },
  ],
  /** Rows the healer sparks target. */
  sparkMinY: 43,
  sparkMaxY: 46,
} as const

/** The Ancestral Glyph: slides east-west along its row, pausing 5 ticks at each end. */
export class ShieldBehaviour implements NpcBehaviour {
  direction: 1 | -1
  private pause = 1

  constructor(direction: 1 | -1) {
    this.direction = direction
  }

  onTick(_world: World, npc: Npc): void {
    if (npc.dead) return
    if (this.pause > 0) {
      this.pause--
      return
    }
    const next = npc.x + this.direction
    if (next < ZUK_LAYOUT.shieldMinX || next > ZUK_LAYOUT.shieldMaxX) {
      this.direction = this.direction === 1 ? -1 : 1
      this.pause = 5
      return
    }
    npc.x = next
    npc.stepsThisTick = 1
  }
}

/** True when the player is protected by the shield from Zuk's attack. */
export function playerBehindShield(player: Actor, shield: Npc | null): boolean {
  if (!shield || shield.dead) return false
  // Only the three rows just south of the shield's row are in its shadow.
  if (player.y < ZUK_LAYOUT.exposedRowMinY || player.y >= ZUK_LAYOUT.shieldY) return false
  return player.x >= shield.x && player.x < shield.x + ZUK_LAYOUT.shieldWidth
}

/**
 * TzKal-Zuk: one projectile every 10 ticks (7 once enraged) at the shield,
 * or at the player when they are outside its cover. Damage ignores prayer.
 */
export class ZukBehaviour implements NpcBehaviour {
  readonly script: ZukScript

  constructor(script: ZukScript) {
    this.script = script
  }

  onSpawn(world: World, npc: Npc): void {
    npc.spawnTick = world.tick
    npc.frozen = 8
    npc.attackDelay = 14
  }

  onTick(world: World, npc: Npc): void {
    if (npc.dead) return
    if (npc.frozen > 0) {
      npc.frozen--
      return
    }
    if (npc.attackDelay > 0) npc.attackDelay--
    if (npc.attackDelay > 0) return
    const player = findPlayer(world)
    if (!player) return
    const shield = this.script.shield
    const targetShield = playerBehindShield(player, shield) && shield
    const target: Actor = targetShield ? shield : player
    npc.playAnimation(npc.def.animations.attack, world.tick)
    npc.attackDelay = npc.hitpoints <= ZUK_ENRAGE_HITPOINTS ? ZUK_ENRAGED_ATTACK_SPEED : npc.def.attackSpeed
    world.launchProjectile({
      graphicId: 1376,
      fromX: npc.x + 3,
      fromY: npc.y,
      toX: target.x,
      toY: target.y,
      startTick: world.tick,
      landTick: world.tick + 4,
      onLand: (w) => {
        if (target.dead) return
        if (target instanceof Player) {
          const dmg = resolveZukHit(w, npc, target)
          target.applyDamage(dmg, w.tick)
          addCombatEvent(w, { tick: w.tick, source: npc, target, style: 'typeless', damage: dmg, prayed: false })
        }
        // The shield blocks Zuk indefinitely: no damage to it.
      },
    })
  }
}

/** Zuk's accuracy averages his ranged and magic rolls against the player's averaged ranged/magic defence. */
export function resolveZukHit(world: World, zuk: Npc, player: Player): number {
  const l = zuk.def.levels
  const o = zuk.def.offensive
  const attack = (attackRoll(npcEffectiveLevel(l.ranged), o.rangedAttack) + attackRoll(npcEffectiveLevel(l.magic), o.magicAttack)) / 2
  const prayers = player.prayers
  const effDef = effectiveLevel({ level: player.levels.defence, boost: player.boosts.defence, prayerMultiplier: prayers.multiplier('defence'), styleBonus: 0, voidMultiplier: 1 })
  const effMagic = effectiveLevel({ level: player.levels.magic, boost: player.boosts.magic, prayerMultiplier: prayers.multiplier('magicAttack'), styleBonus: 0, voidMultiplier: 1 })
  const rangedDef = defenceRoll(effDef, player.bonuses.rangedDefence)
  const magicDef = defenceRoll(Math.floor(effMagic * 0.7) + Math.floor(effDef * 0.3), player.bonuses.magicDefence)
  const hit = world.rng.next() < hitChance(attack, (rangedDef + magicDef) / 2)
  return hit ? rollDamage(ZUK_MAX_HIT, () => world.rng.next()) : 0
}

/** Jal-MejJak: heals Zuk every 3 ticks until tagged; then throws lava sparks at the player's row. */
export class ZukHealerBehaviour implements NpcBehaviour {
  private readonly zuk: Npc
  private tagged = false
  private untargetable = 0

  constructor(zuk: Npc) {
    this.zuk = zuk
  }

  get isTagged(): boolean {
    return this.tagged
  }

  onSpawn(world: World, npc: Npc): void {
    npc.spawnTick = world.tick
    npc.attackDelay = 3
  }

  onDamaged(_world: World, npc: Npc, _amount: number, source: Actor | null): void {
    if (!this.tagged && source instanceof Player) {
      this.tagged = true
      this.untargetable = 2
      npc.target = source
    }
  }

  onTick(world: World, npc: Npc): void {
    if (npc.dead) return
    if (this.untargetable > 0) this.untargetable--
    if (npc.attackDelay > 0) npc.attackDelay--
    if (npc.attackDelay > 0) return
    npc.attackDelay = 3
    if (!this.tagged) {
      if (this.zuk.dead) return
      const healed = this.zuk.heal(world.rng.range(15, 24), world.tick, true)
      npc.playAnimation(npc.def.animations.attack, world.tick)
      addCombatEvent(world, { tick: world.tick, source: npc, target: this.zuk, style: 'heal', damage: healed, prayed: false })
      return
    }
    const player = findPlayer(world)
    if (!player) return
    npc.playAnimation(npc.def.animations.attack, world.tick)
    for (let i = 0; i < 3; i++) {
      const tx = clamp(player.x + world.rng.range(-5, 5), npc.x - 5, npc.x + 5)
      const ty = world.rng.range(ZUK_LAYOUT.sparkMinY, ZUK_LAYOUT.sparkMaxY)
      world.launchProjectile({
        graphicId: 660,
        fromX: npc.x,
        fromY: npc.y,
        toX: tx,
        toY: ty,
        startTick: world.tick,
        landTick: world.tick + 3,
        onLand: (w) => {
          const p = findPlayer(w)
          if (!p || Math.abs(p.x - tx) > 1 || Math.abs(p.y - ty) > 1) return
          const dmg = w.rng.range(5, 10)
          p.applyDamage(dmg, w.tick)
          addCombatEvent(w, { tick: w.tick, source: npc, target: p, style: 'typeless', damage: dmg, prayed: false })
        },
      })
    }
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

export type ZukEvent = 'setSpawned' | 'jadSpawned' | 'healersSpawned' | 'enraged' | 'zukDead'

/**
 * Wave 69 director: spawns Zuk and the shield, runs the set timer, spawns
 * Jad at 480 and the healers at 240, and reports events for the HUD.
 */
export class ZukScript implements WorldSystem {
  zuk: Npc | null = null
  shield: Npc | null = null
  jad: Npc | null = null
  readonly healers: Npc[] = []
  readonly sets: Npc[] = []
  /** Ticks until the next set spawns (the "set timer"). */
  setTimer = ZUK_FIRST_SET_TICKS
  setTimerPaused = false
  private resumeBonusGiven = false
  private jadSpawned = false
  private healersSpawned = false
  private enraged = false
  private readonly onEvent: ((e: ZukEvent) => void) | undefined

  constructor(onEvent?: (e: ZukEvent) => void) {
    this.onEvent = onEvent
  }

  spawn(world: World): Npc[] {
    const zuk = new Npc(MONSTERS.zuk, new ZukBehaviour(this))
    zuk.setPosition(ZUK_LAYOUT.zukSw.x, ZUK_LAYOUT.zukSw.y)
    zuk.facing = 0
    world.addActor(zuk)
    zuk.behaviour.onSpawn?.(world, zuk)
    this.zuk = zuk

    const shield = new Npc(MONSTERS.ancestralGlyph, new ShieldBehaviour(world.rng.chance(0.5) ? 1 : -1))
    shield.setPosition(ZUK_LAYOUT.shieldStart.x, ZUK_LAYOUT.shieldStart.y)
    shield.size = ZUK_LAYOUT.shieldWidth
    world.addActor(shield)
    this.shield = shield
    return [zuk, shield]
  }

  /** Ticks before the next set for the HUD timer. */
  get ticksUntilSet(): number {
    return this.setTimer
  }

  npcPhase(world: World): void {
    const zuk = this.zuk
    if (!zuk || zuk.dead) return
    // Set timer.
    const paused = this.setTimerPaused || (zuk.hitpoints < ZUK_SET_PAUSE_HITPOINTS && !this.jadSpawned)
    if (!paused) {
      this.setTimer--
      if (this.setTimer <= 0) {
        this.spawnSet(world)
        this.setTimer = ZUK_SET_PERIOD_TICKS
      }
    }
    if (!this.jadSpawned && zuk.hitpoints < ZUK_JAD_HITPOINTS) {
      this.jadSpawned = true
      if (!this.resumeBonusGiven) {
        this.resumeBonusGiven = true
        this.setTimer += ZUK_SET_RESUME_BONUS_TICKS
      }
      this.spawnJad(world)
    }
    if (!this.healersSpawned && zuk.hitpoints < ZUK_HEALERS_HITPOINTS) {
      this.healersSpawned = true
      this.spawnHealers(world)
    }
    if (!this.enraged && zuk.hitpoints <= ZUK_ENRAGE_HITPOINTS) {
      this.enraged = true
      this.onEvent?.('enraged')
    }
  }

  postTick(world: World): void {
    const zuk = this.zuk
    if (zuk && zuk.dead && !zuk.memory.victoryHandled) {
      zuk.memory.victoryHandled = 1
      for (const a of world.actors) {
        if (a instanceof Npc && a !== zuk && !a.dead) {
          a.dead = true
          a.removeWhenDead = true
        }
      }
      this.onEvent?.('zukDead')
    }
  }

  private spawnSet(world: World): void {
    const shield = this.shield
    const mager = new Npc(MONSTERS.mager, new MagerBehaviour(false), 7703)
    const ranger = new Npc(MONSTERS.ranger, rangerBehaviour(), 7702)
    mager.setPosition(ZUK_LAYOUT.setMager.x, ZUK_LAYOUT.setMager.y)
    ranger.setPosition(ZUK_LAYOUT.setRanger.x, ZUK_LAYOUT.setRanger.y)
    for (const [npc, delay] of [
      [mager, 7],
      [ranger, 9],
    ] as const) {
      world.schedule(delay, (w) => {
        w.addActor(npc)
        npc.behaviour.onSpawn?.(w, npc)
        npc.target = shield && !shield.dead ? shield : findPlayer(w)
        this.sets.push(npc)
      })
    }
    this.onEvent?.('setSpawned')
  }

  private spawnJad(world: World): void {
    const jad = new Npc(MONSTERS.jad, new JadBehaviour({ attackSpeed: 8, healerCount: 3, spawnStun: 1, initialTarget: this.shield }), 7704)
    jad.setPosition(ZUK_LAYOUT.jad.x, ZUK_LAYOUT.jad.y)
    world.schedule(7, (w) => {
      w.addActor(jad)
      jad.behaviour.onSpawn?.(w, jad)
      this.jad = jad
      this.onEvent?.('jadSpawned')
    })
  }

  private spawnHealers(world: World): void {
    const zuk = this.zuk
    if (!zuk) return
    for (const pos of ZUK_LAYOUT.healers) {
      const healer = new Npc(MONSTERS.zukHealer, new ZukHealerBehaviour(zuk))
      healer.setPosition(pos.x, pos.y)
      world.addActor(healer)
      healer.behaviour.onSpawn?.(world, healer)
      this.healers.push(healer)
    }
    this.onEvent?.('healersSpawned')
  }
}

/** A minion that only ever hits the shield or the player, used when the generic behaviour targets the shield. */
export function shieldAwareBehaviour(): MonsterBehaviour {
  return new MonsterBehaviour()
}
