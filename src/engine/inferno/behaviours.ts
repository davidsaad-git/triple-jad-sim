import type { AttackStyle, MonsterKey } from '../../data/inferno/monsters'
import { MONSTERS } from '../../data/inferno/monsters'
import { chebyshev, isAdjacent } from '../Collision'
import { stepAlongPath } from '../Movement'
import { Npc, type NpcBehaviour } from '../Npc'
import { Player } from '../Player'
import type { World } from '../World'
import { addCombatEvent } from './events'
import { MonsterBehaviour, findPlayer, hasLineOfSightTo } from './MonsterBehaviour'
import { Pillar } from './Pillar'

/** Jal-Nib: attacks a random surviving pillar; only turns on the player once all pillars are gone. */
export class NibblerBehaviour implements NpcBehaviour {
  onSpawn(world: World, npc: Npc): void {
    npc.spawnTick = world.tick
    npc.frozen = 1
    npc.target = pickPillar(world)
  }

  onTick(world: World, npc: Npc): void {
    if (npc.dead) return
    if (npc.frozen > 0) {
      npc.frozen--
      return
    }
    if (npc.attackDelay > 0) npc.attackDelay--
    let target = npc.target
    if (!target || target.dead) {
      target = pickPillar(world) ?? findPlayer(world)
      npc.target = target
      if (!target) return
    }
    if (isAdjacent(npc.x, npc.y, target.x, target.y, target.size)) {
      if (npc.attackDelay === 0) {
        npc.faceTile(target.x, target.y)
        npc.playAnimation(npc.def.animations.attack, world.tick)
        npc.attackDelay = npc.def.attackSpeed
        const t = target
        world.schedule(1, (w) => {
          if (t.dead) return
          const dmg = t instanceof Pillar ? w.rng.range(2, 4) : w.rng.range(0, npc.def.levels.strength >= 0 ? 4 : 4)
          t.applyDamage(dmg, w.tick)
          addCombatEvent(w, { tick: w.tick, source: npc, target: t, style: 'crush', damage: dmg, prayed: false })
        })
      }
      return
    }
    if (npc.path.length === 0) {
      npc.path = world.pathfinder.findPath(npc.x, npc.y, 1, target.x, target.y, target.size)
    }
    stepAlongPath(npc, world, false)
  }
}

function pickPillar(world: World): Pillar | null {
  const alive = world.actors.filter((a): a is Pillar => a instanceof Pillar && !a.dead)
  return alive.length ? world.rng.pick(alive) : null
}

/** Jal-MejRah: ranged, short range; each hit drains 3 run energy and may drain combat stats by 1. */
export function batBehaviour(): MonsterBehaviour {
  return new MonsterBehaviour({
    onHit: (world, _npc, player, dealt) => {
      if (dealt <= 0) return
      player.runEnergy = Math.max(0, player.runEnergy - 300)
      if (world.rng.chance(0.25)) {
        for (const k of ['attack', 'strength', 'defence', 'ranged', 'magic'] as const) player.drainStat(k, 1)
      }
    },
  })
}

/**
 * Jal-Ak: when in range, reads the player's overhead and attacks with the
 * opposite style 3 ticks later; with no overhead the style is random. Melee
 * when adjacent. Bloblets spawn on death.
 */
export class BlobBehaviour extends MonsterBehaviour {
  constructor() {
    super({
      meleeStyle: 'crush',
      meleeChance: 1,
      needsLineOfSight: true,
      chooseStyle: (world, npc) => {
        const scanned = npc.memory.scannedStyle
        if (scanned === 1) return 'ranged'
        if (scanned === 2) return 'magic'
        return world.rng.chance(0.5) ? 'ranged' : 'magic'
      },
    })
  }

  override onTick(world: World, npc: Npc): void {
    if (npc.dead) return
    // Scan 3 ticks before the attack becomes available.
    const player = npc.target instanceof Player ? npc.target : null
    if (player && npc.attackDelay === 3) {
      const overhead = player.prayers.overhead
      npc.memory.scannedStyle = overhead === 'protectFromMissiles' ? 2 : overhead === 'protectFromMagic' ? 1 : 0
      npc.memory.scannedTick = world.tick
    }
    super.onTick(world, npc)
  }

  override onDeath(world: World, npc: Npc): void {
    const offsets: [MonsterKey, number, number][] = [
      ['blobletRanged', 1, -1],
      ['blobletMelee', 0, 0],
      ['blobletMagic', 2, -2],
    ]
    for (const [key, dx, dy] of offsets) {
      const child = new Npc(MONSTERS[key], key === 'blobletMelee' ? new MonsterBehaviour({ diagonalMelee: true }) : new MonsterBehaviour())
      let x = npc.x + dx
      let y = npc.y + dy
      if (!world.collision.canStand(x, y, 1)) {
        x = npc.x
        y = npc.y
      }
      child.setPosition(x, y)
      child.target = npc.target
      child.attackDelay = 4
      child.spawnTick = world.tick
      world.addActor(child)
    }
  }
}

/** Jal-ImKot: melee only, no diagonal attacks; digs to the player when it cannot reach it. */
export class MeleerBehaviour extends MonsterBehaviour {
  constructor() {
    super({ diagonalMelee: false })
  }

  override onTick(world: World, npc: Npc): void {
    if (npc.dead) return
    const target = npc.target
    if (target && !npc.dead && npc.frozen === 0) {
      const idle = (npc.memory.idleTicks ?? 0) + 1
      npc.memory.idleTicks = isAdjacent(target.x, target.y, npc.x, npc.y, npc.size) ? 0 : idle
      const sinceSpawn = world.tick - npc.spawnTick
      const canDig = sinceSpawn >= 50 && npc.memory.idleTicks >= 40 && world.tick - (npc.memory.lastHitTick ?? -100) > 15
      if (canDig && !hasLineOfSightTo(world, npc, target)) {
        this.dig(world, npc, target.x, target.y)
        return
      }
    }
    super.onTick(world, npc)
  }

  override onDamaged(world: World, npc: Npc): void {
    npc.memory.lastHitTick = world.tick
  }

  private dig(world: World, npc: Npc, tx: number, ty: number): void {
    npc.playAnimation(npc.def.animations.special ?? npc.def.animations.attack, world.tick)
    npc.frozen = 6
    npc.memory.idleTicks = 0
    world.schedule(6, (w) => {
      const candidates: [number, number][] = [
        [tx - 3, ty + 3],
        [tx - npc.size, ty],
        [tx, ty + 1],
        [tx - 1, ty + 1],
      ]
      for (const [x, y] of candidates) {
        if (w.collision.canStand(x, y, npc.size)) {
          npc.setPosition(x, y)
          break
        }
      }
      npc.attackDelay = 6
      npc.frozen = 2
    })
  }
}

/** Jal-Xil: ranged from anywhere with LOS; 50% melee when adjacent. Projectile lands 2 ticks after the animation plus travel. */
export function rangerBehaviour(): MonsterBehaviour {
  return new MonsterBehaviour({ meleeStyle: 'crush', meleeChance: 0.5 })
}

/** Jal-Zek: magic; 50% melee when adjacent; 10% chance per attack opportunity to revive a dead monster instead. */
export class MagerBehaviour extends MonsterBehaviour {
  private readonly revivesEnabled: boolean

  constructor(revivesEnabled = true) {
    super({ meleeStyle: 'stab', meleeChance: 0.5 })
    this.revivesEnabled = revivesEnabled
  }

  protected override tryAttack(world: World, npc: Npc, target: import('../Actor').Actor): boolean {
    if (npc.attackDelay > 0) return false
    if (this.revivesEnabled && world.rng.chance(0.1)) {
      const dead = deadRevivable(world)
      if (dead) {
        this.revive(world, npc, dead)
        return true
      }
    }
    return super.tryAttack(world, npc, target)
  }

  private revive(world: World, npc: Npc, dead: Npc): void {
    npc.playAnimation(npc.def.animations.special ?? npc.def.animations.attack, world.tick)
    npc.attackDelay = 8
    const spot = findReviveTile(world, dead.size)
    dead.revived = true
    dead.dead = false
    dead.hitpoints = Math.floor(dead.maxHitpoints / 2)
    if (spot) dead.setPosition(spot.x, spot.y)
    dead.attackDelay = 8
    dead.frozen = 0
    dead.target = npc.target
    if (!world.actors.includes(dead)) world.addActor(dead)
  }
}

function deadRevivable(world: World): Npc | null {
  const dead = graveyard.get(world) ?? []
  const candidates = dead.filter((n) => !n.revived && n.def.key !== 'nibbler' && !n.def.key.startsWith('bloblet'))
  if (!candidates.length) return null
  const pick = world.rng.pick(candidates)
  dead.splice(dead.indexOf(pick), 1)
  return pick
}

function findReviveTile(world: World, size: number): { x: number; y: number } | null {
  // Near the centre / south side of the north pillar (region 32..38, 24..36 in IT coords -> region x+6, 60-y).
  for (let y = 36; y >= 24; y--) {
    for (let x = 32; x <= 38; x++) {
      if (world.collision.canStand(x, y, size)) return { x, y }
    }
  }
  return null
}

/** Dead monsters eligible for revival, per world. */
const graveyard = new WeakMap<World, Npc[]>()

export function recordDeath(world: World, npc: Npc): void {
  const list = graveyard.get(world) ?? []
  list.push(npc)
  graveyard.set(world, list)
}

export function clearGraveyard(world: World): void {
  graveyard.set(world, [])
}

export function behaviourFor(key: MonsterKey, options: { revives?: boolean } = {}): NpcBehaviour {
  switch (key) {
    case 'nibbler':
      return new NibblerBehaviour()
    case 'bat':
      return batBehaviour()
    case 'blob':
      return new BlobBehaviour()
    case 'meleer':
      return new MeleerBehaviour()
    case 'ranger':
      return rangerBehaviour()
    case 'mager':
      return new MagerBehaviour(options.revives ?? true)
    default:
      return new MonsterBehaviour()
  }
}

export function styleLabel(style: AttackStyle): string {
  return style
}

export function distanceBetween(a: Npc, b: Npc): number {
  return chebyshev(a.x, a.y, b.x, b.y)
}
