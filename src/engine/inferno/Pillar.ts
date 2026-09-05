import { PILLAR_HITPOINTS, type PillarInfo } from '../../data/inferno/waves'
import { Actor } from '../Actor'

/** The three "Rocky support" pillars: 3x3, 255 HP, attacked only by nibblers. */
export class Pillar extends Actor {
  readonly info: PillarInfo
  /** NPC id 7709 while standing, 7710 while collapsing. */
  npcId = 7709

  constructor(info: PillarInfo) {
    super()
    this.info = info
    this.size = 3
    this.maxHitpoints = PILLAR_HITPOINTS
    this.hitpoints = PILLAR_HITPOINTS
    this.setPosition(info.centre.x - 1, info.centre.y - 1)
  }

  override get name(): string {
    return 'Rocky support'
  }
}
