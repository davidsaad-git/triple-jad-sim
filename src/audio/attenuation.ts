/**
 * Area-sound distance attenuation, scim.gg.
 *
 * Distance is the Manhattan distance between source and listener minus one
 * (so the same tile and the four orthogonal neighbours are full volume), and
 * the volume falls off linearly to silence at `range` tiles. `retain` (the
 * cache frame-sound byte; 0 for every event rule) gives an inner radius of
 * `(retain & 31) - 1` tiles inside which the sound stays at full volume.
 *
 * No direction, no panning: the result is a single gain factor in 0..1.
 */

export type Point = readonly [number, number]

/** scim's default area range when a rule gives none (: `?? 15`). */
export const DEFAULT_AREA_RANGE = 15

export function areaAttenuation(source: Point, listener: Point, range: number, retain = 0): number {
  const d = Math.max(Math.abs(source[0] - listener[0]) + Math.abs(source[1] - listener[1]) - 1, 0)
  if (d >= range) return 0
  const inner = Math.max((retain & 31) - 1, 0)
  if (inner >= range) return 1
  return Math.min(Math.max((range - d) / (range - inner), 0), 1)
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}
