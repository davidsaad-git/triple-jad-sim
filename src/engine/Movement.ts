import type { Actor } from './Actor'
import type { World } from './World'

/**
 * Walk the actor along its queued path: one tile per tick, two when running.
 * Diagonal steps are allowed where the collision map permits (the pathfinder
 * only emits legal steps, but we re-check so dynamic blockers are honoured).
 */
export function stepAlongPath(actor: Actor, world: World, run: boolean): void {
  const steps = run ? 2 : 1
  for (let i = 0; i < steps; i++) {
    const next = actor.path[0]
    if (!next) break
    const dx = Math.sign(next.x - actor.x)
    const dy = Math.sign(next.y - actor.y)
    if (dx === 0 && dy === 0) {
      actor.path.shift()
      i--
      continue
    }
    if (!world.collision.canStep(actor.x, actor.y, actor.size, dx, dy)) {
      actor.path.length = 0
      break
    }
    actor.x += dx
    actor.y += dy
    actor.stepsThisTick++
    actor.faceTile(actor.x + dx, actor.y + dy)
    if (actor.x === next.x && actor.y === next.y) actor.path.shift()
  }
}

/** Replace the actor's path with a fresh route to the destination. */
export function routeTo(actor: Actor, world: World, destX: number, destY: number, destSize = 1): void {
  actor.path = world.pathfinder.findPath(actor.x, actor.y, actor.size, destX, destY, destSize)
}
