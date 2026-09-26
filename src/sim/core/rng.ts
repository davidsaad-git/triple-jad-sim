/**
 * Seeded randomness.
 *
 * All sim randomness goes through mulberry32 generators. Two independent
 * streams exist: the combat stream (player attack rolls,
 * range-valued damage rolls, elysian procs, engine definition context) and the
 * encounter stream (NPC AI: style picks, NPC accuracy/damage rolls
 * overlap side-steps).
 */

export type RandomFn = () => number

/** Mulberry32. Returns values in [0, 1). */
export function mulberry32(seed: number): RandomFn {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let z = Math.imul(state ^ (state >>> 15), 1 | state)
    z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296
  }
}

/** One-shot 32-bit integer hash. */
export function hash32(value: number): number {
  let x = value >>> 0
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0
  return (x ^ (x >>> 16)) >>> 0
}

/** scim: keep a non-negative integer seed, otherwise draw a fresh one. */
export function resolveSeed(seed: number | undefined): number {
  return seed !== undefined && Number.isInteger(seed) && seed >= 0 ? seed : Math.floor(Math.random() * 4294967295)
}

/** Encounter seeds are validated 0..2^32-1; a missing seed is drawn with `* 4294967296`. */
export function resolveEncounterSeed(seed: number | undefined): number {
  if (seed !== undefined && Number.isInteger(seed) && seed >= 0 && seed <= 4294967295) return seed
  return Math.floor(Math.random() * 4294967296)
}
