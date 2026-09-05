/**
 * Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
 *
 * Perlin-style procedural height used by the client for plane-0 tiles whose
 * terrain file carries no explicit height (opcode 0).
 */

const COSINE = new Int32Array(2048)
for (let i = 0; i < 2048; i++) {
  COSINE[i] = (65536.0 * Math.cos((i * 360.0) / 2048.0 * (Math.PI / 180))) | 0
}

function interpolate(a: number, b: number, t: number, freq: number): number {
  const f = (65536 - COSINE[((t * 1024) / freq) | 0]!) >> 1
  return ((f * b) >> 16) + (((65536 - f) * a) >> 16)
}

function noise(x: number, y: number): number {
  let n = y * 57 + x
  n = (n << 13) ^ n
  const n2 = (Math.imul(n, Math.imul(Math.imul(n, n), 15731) + 789221) + 1376312589) & 0x7fffffff
  return (n2 >> 19) & 0xff
}

function smoothedNoise(x: number, y: number): number {
  const corners = noise(x - 1, y - 1) + noise(x + 1, y - 1) + noise(x - 1, y + 1) + noise(x + 1, y + 1)
  const sides = noise(x - 1, y) + noise(x + 1, y) + noise(x, y - 1) + noise(x, y + 1)
  const center = noise(x, y)
  return ((center / 4) | 0) + ((sides / 8) | 0) + ((corners / 16) | 0)
}

function interpolateNoise(x: number, y: number, freq: number): number {
  const intX = (x / freq) | 0
  const fracX = x & (freq - 1)
  const intY = (y / freq) | 0
  const fracY = y & (freq - 1)
  const v1 = smoothedNoise(intX, intY)
  const v2 = smoothedNoise(intX + 1, intY)
  const v3 = smoothedNoise(intX, intY + 1)
  const v4 = smoothedNoise(intX + 1, intY + 1)
  const i1 = interpolate(v1, v2, fracX, freq)
  const i2 = interpolate(v3, v4, fracX, freq)
  return interpolate(i1, i2, fracY, freq)
}

/**
 * Height (in "tile height basis" units, 10..60) for a world tile position.
 * The caller adds the client's fixed offsets (932731, 556238) to the world x/y.
 */
export function generateHeight(x: number, y: number): number {
  let n =
    interpolateNoise(x + 45365, y + 91923, 4) -
    128 +
    ((interpolateNoise(x + 10294, y + 37821, 2) - 128) >> 1) +
    ((interpolateNoise(x, y, 1) - 128) >> 2)
  n = ((0.3 * n) | 0) + 35
  if (n < 10) n = 10
  else if (n > 60) n = 60
  return n
}
