/**
 * Facing rules (2048 units, 0 = south, 512 = west, 1024 = north, 1536 = east).
 * scim, `calculateAngleTowardActor`
 *, `RO` and the player's.
 */
import type { Tile } from '../api'

/** 8-way angle from a step delta; (0,0) keeps `keep`. */
export function angleFromDelta(dx: number, dy: number, keep: number): number {
  if (dx === 0 && dy === 0) return keep
  if (dx === 0) return dy > 0 ? 1024 : 0
  if (dx > 0) return dy > 0 ? 1280 : dy < 0 ? 1792 : 1536
  return dy > 0 ? 768 : dy < 0 ? 256 : 512
}

/** Stationary NPC facing: target centre clamped into the NPC's tile box, then 8-way. */
export function angleTowardActor(
  npc: { position: Tile; size: number; facing: number },
  target: { position: Tile; size: number },
): number {
  const cx = target.position[0] + (target.size - 1) / 2
  const cy = target.position[1] + (target.size - 1) / 2
  const maxX = npc.position[0] + npc.size - 1
  const maxY = npc.position[1] + npc.size - 1
  const qx = Math.max(npc.position[0], Math.min(cx, maxX))
  const qy = Math.max(npc.position[1], Math.min(cy, maxY))
  return angleFromDelta(cx - qx, cy - qy, npc.facing)
}

/** scim: exact facing from footprint centre to footprint centre (mutates `facing`). */
export function faceExact(actor: { position: Tile; size: number; facing: number }, target: { position: Tile; size: number }): void {
  const dx = target.position[0] + target.size / 2 - actor.position[0] - actor.size / 2
  const dy = target.position[1] + target.size / 2 - actor.position[1] - actor.size / 2
  if (dx !== 0 || dy !== 0) actor.facing = (Math.round(Math.atan2(-dx, -dy) * (2048 / (2 * Math.PI))) + 2048) % 2048
}

/** scim: the player faces the target's centre from its tile centre. */
export function facePlayerToward(player: { position: Tile; facing: number }, target: { position: Tile; size: number }): void {
  const dx = target.position[0] + target.size / 2 - (player.position[0] + 0.5)
  const dy = target.position[1] + target.size / 2 - (player.position[1] + 0.5)
  if (dx === 0 && dy === 0) return
  const a = Math.atan2(-dx, -dy)
  player.facing = ((Math.round(a * (2048 / (2 * Math.PI))) % 2048) + 2048) % 2048
}
