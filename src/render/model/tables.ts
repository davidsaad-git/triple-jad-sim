/**
 * Fixed-point sine/cosine tables (65536 scale, 2048 steps) exactly as scim
 * builds them (: angle step = 360/2048 * PI/180), used by
 * model rotation and the legacy animation transforms.
 */
export const SIN = new Int32Array(2048)
export const COS = new Int32Array(2048)

const STEP = (360 / 2048) * (Math.PI / 180)
for (let i = 0; i < 2048; i++) {
  SIN[i] = (65536 * Math.sin(i * STEP)) | 0
  COS[i] = (65536 * Math.cos(i * STEP)) | 0
}

/** Float sine/cosine per 2048-unit angle (painter sort, `ku`). */
export const SIN_F = new Float64Array(2048)
export const COS_F = new Float64Array(2048)
for (let i = 0; i < 2048; i++) {
  const t = (i / 2048) * 2 * Math.PI
  SIN_F[i] = Math.sin(t)
  COS_F[i] = Math.cos(t)
}
