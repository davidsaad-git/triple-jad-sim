/**
 * Angle helpers and the NPC visual facing tracker. Angles are 0..2047 with 0 = south,
 * 512 = west, 1024 = north, 1536 = east.
 */

/** Angle from (x0, y0) looking at (x1, y1) (`KC`). */
export function angleTo(x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0
  const dy = y1 - y0
  if (dx === 0 && dy === 0) return 0
  const a = Math.atan2(-dx, -dy)
  return ((Math.round(a * (2048 / (2 * Math.PI))) % 2048) + 2048) % 2048
}

/** 8-way direction of a step (`ex`), `fallback` when dx = dy = 0. */
export function direction8(dx: number, dy: number, fallback: number): number {
  if (dx === 0 && dy === 0) return fallback
  if (dx === 0) return dy > 0 ? 1024 : 0
  if (dx > 0) return dy > 0 ? 1280 : dy < 0 ? 1792 : 1536
  return dy > 0 ? 768 : dy < 0 ? 256 : 512
}

/** Visual angle stepping `turnSpeed` units per 20 ms cycle toward the target, the short way round. */
export class FacingTracker {
  angle: number
  target: number
  turnSpeed: number
  private remainderMs = 0

  constructor(angle = 0, turnSpeed = 32) {
    this.angle = angle & 2047
    this.target = this.angle
    this.turnSpeed = turnSpeed
  }

  snap(target?: number): number {
    if (target !== undefined) this.target = target & 2047
    this.angle = this.target
    this.remainderMs = 0
    return this.angle
  }

  setTarget(target: number): void {
    this.target = target & 2047
  }

  advance(ms: number): number {
    if (!Number.isFinite(ms) || ms <= 0) return this.angle
    this.remainderMs += ms
    let cycles = Math.floor(this.remainderMs / 20)
    this.remainderMs -= cycles * 20
    cycles = Math.min(cycles, 50)
    for (let i = 0; i < cycles; i++) this.step()
    return this.angle
  }

  private step(): void {
    const d = (this.target - this.angle) & 2047
    if (d === 0) return
    const dir = d > 1024 ? -1 : 1
    this.angle = (this.angle + dir * this.turnSpeed) & 2047
    if (d < this.turnSpeed || d > 2048 - this.turnSpeed) this.angle = this.target
  }
}
