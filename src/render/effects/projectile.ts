/**
 * OSRS homing projectile motion as scim implements it: positions in tiles, heights in tiles (z up), time in
 * 20 ms client cycles.
 *
 * - init (first active sample): start = source pushed `startOffset/128`
 *   tiles toward the target; horizontal speed = remaining distance / T;
 *   vz = |vxy| * tan(slope * pi / 128); constant acceleration so the height
 *   reaches the target at the end;
 * - every later sample re-aims at the CURRENT target over the remaining
 *   horizon (vz kept, acceleration re-solved) and integrates dt cycles;
 * - orientation: yaw from the velocity, pitch = -atan2(vz, |vxy|).
 */

export interface Point3 {
  x: number
  y: number
  z: number
}

export interface Motion {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  az: number
}

/**: initial motion. `horizon` = endExclusive - startCycle. */
export function initMotion(source: Point3, target: Point3, startOffset: number, slope: number, horizon: number): Motion {
  const dx = target.x - source.x
  const dy = target.y - source.y
  const dist = Math.hypot(dx, dy)
  const k = dist === 0 ? 0 : startOffset / 128 / dist
  const x = source.x + dx * k
  const y = source.y + dy * k
  const z = source.z
  const vx = (target.x - x) / horizon
  const vy = (target.y - y) / horizon
  const vz = Math.hypot(vx, vy) * Math.tan((slope * Math.PI) / 128)
  const az = (2 * (target.z - z - vz * horizon)) / (horizon * horizon)
  return { x, y, z, vx, vy, vz, az }
}

/**: re-aim at `target` over `remaining` cycles (vz kept). */
export function reaim(m: Motion, target: Point3, remaining: number): Motion {
  const vx = (target.x - m.x) / remaining
  const vy = (target.y - m.y) / remaining
  const az = (2 * (target.z - m.z - m.vz * remaining)) / (remaining * remaining)
  return { ...m, vx, vy, az }
}

/**: integrate `dt` cycles. */
export function integrate(m: Motion, dt: number): Motion {
  return {
    ...m,
    x: m.x + m.vx * dt,
    y: m.y + m.vy * dt,
    z: m.z + m.vz * dt + (m.az * dt * dt) / 2,
    vz: m.vz + m.az * dt,
  }
}

/** Model yaw (0..2047) and pitch (radians, positive = nose down in scim's matrix convention). */
export function orientation(m: Motion): { yaw2048: number; pitchRad: number } {
  const yaw2048 = ((((Math.atan2(m.vx, m.vy) + Math.PI) * 2048) / (2 * Math.PI)) + 2048) % 2048
  const pitch = Math.atan2(m.vz, Math.hypot(m.vx, m.vy))
  return { yaw2048, pitchRad: -pitch }
}

export type FlightSample = { kind: 'pending' } | { kind: 'expired' } | { kind: 'active'; motion: Motion }

/** One projectile flight. */
export class Flight {
  readonly startCycle: number
  readonly endExclusive: number
  readonly startOffset: number
  readonly slope: number
  private cycle: number
  private motion: Motion | null = null

  constructor(startCycle: number, endExclusive: number, startOffset: number, slope: number) {
    this.startCycle = startCycle
    this.endExclusive = endExclusive
    this.startOffset = startOffset
    this.slope = slope
    this.cycle = startCycle
  }

  /** Sample at `cycle` with the current endpoints (fractional cycles re-aim every frame like live scim). */
  sample(cycle: number, source: Point3, target: Point3): FlightSample {
    if (cycle >= this.endExclusive) return { kind: 'expired' }
    if (cycle < this.startCycle) return { kind: 'pending' }
    let m = this.motion ?? initMotion(source, target, this.startOffset, this.slope, this.endExclusive - this.startCycle)
    const dt = cycle - this.cycle
    if (dt > 0) {
      m = integrate(reaim(m, target, this.endExclusive - this.cycle), dt)
      this.cycle = cycle
    }
    this.motion = m
    return { kind: 'active', motion: m }
  }

  /** Frame progress of the flying model. */
  static frameProgress(mode: 'frame-step' | 'full-sequence', elapsed: number, frameLengths: readonly number[], frameStep: number): number {
    const sum = frameLengths.reduce((a, b) => a + b, 0)
    if (mode === 'full-sequence') {
      const l = sum > 0 ? sum : 1
      return (elapsed % l) / l
    }
    if (sum <= 0) return 0
    if (elapsed < sum) return elapsed / sum
    const n = frameLengths.length
    const k = frameStep > 0 && frameStep <= n ? n - frameStep : 0
    let prefix = 0
    for (let i = 0; i < k; i++) prefix += frameLengths[i]!
    const loop = sum - prefix
    return loop > 0 ? (prefix + ((elapsed - sum) % loop)) / sum : 0
  }
}

/**: Chebyshev distance from a tile to the nearest tile of a footprint. */
export function distanceToFootprint(sx: number, sy: number, tx: number, ty: number, size: number): number {
  const dx = sx < tx ? tx - sx : sx > tx + size - 1 ? sx - (tx + size - 1) : 0
  const dy = sy < ty ? ty - sy : sy > ty + size - 1 ? sy - (ty + size - 1) : 0
  return Math.max(dx, dy)
}
