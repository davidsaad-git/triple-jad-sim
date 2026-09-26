/**
 * Feeds the SIM's per-tick player movement into the client movement
 * interpolator once per new tick (scim render loop):
 * a tick going backwards (restart / rewind) or a jump of more than 8 ticks
 * snaps the visual to the SIM tile; a jump of 2..8 ticks only skips the
 * missed ticks. Shared by GameViewport and the headless check scripts.
 */
import type { SimState } from '../../sim/api'
import type { PlayerAnimController } from './PlayerAnimController'
import type { PlayerMovement } from './PlayerMovement'

export type PlayerFeedState = Pick<
  SimState,
  'currentTick' | 'playerPosition' | 'playerFacingAngle' | 'playerMovementPath' | 'playerIsRunning' | 'attackTarget'
>

export class PlayerVisualFeed {
  private lastTickSeen: number

  constructor(tick: number) {
    this.lastTickSeen = tick
  }

  /** Start over from `tick` (scene rebuilt): the next frame re-feeds the current tick. */
  reset(tick: number, pm: PlayerMovement): void {
    this.lastTickSeen = tick
    pm.lastProcessedTick = -1
  }

  /** Feed one rendered frame. Returns true when the tick went backwards (snap the camera too). */
  feed(pm: PlayerMovement, state: PlayerFeedState, controller: PlayerAnimController | null): boolean {
    const delta = state.currentTick - this.lastTickSeen
    let snapped = false
    if (delta < 0) {
      pm.reset(state.playerPosition[0], state.playerPosition[1])
      pm.facingAngle = state.playerFacingAngle
      snapped = true
    } else if (delta > 1) {
      if (delta > 8) {
        pm.reset(state.playerPosition[0], state.playerPosition[1])
        pm.facingAngle = state.playerFacingAngle
      }
      pm.lastProcessedTick = state.currentTick - 1
    }
    this.lastTickSeen = state.currentTick
    if (state.currentTick !== pm.lastProcessedTick) {
      pm.enqueueTickMovement(state.currentTick, state.playerMovementPath, state.playerIsRunning)
      if (state.playerMovementPath.length === 0) pm.setTargetAngle(state.playerFacingAngle)
      pm.setInteracting(!!state.attackTarget)
      pm.setForcedFacing(state.attackTarget ? state.playerFacingAngle : null)
    }
    const block = controller?.movementBlock() ?? { blocksRunning: false, blocksWalking: false }
    pm.setPrimaryAnimBlocking(block.blocksRunning, block.blocksWalking)
    return snapped
  }
}
