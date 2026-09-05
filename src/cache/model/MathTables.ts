// Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.

/**
 * Fixed-point sine/cosine tables over the 2048-step RuneScape circle,
 * scaled by 65536 (the client's `Rasterizer3D.SINE/COSINE`).
 */
export const SINE = new Int32Array(2048)
export const COSINE = new Int32Array(2048)

const RS_TO_RADIANS = (Math.PI * 2) / 2048

for (let i = 0; i < 2048; i++) {
  SINE[i] = (65536 * Math.sin(i * RS_TO_RADIANS)) | 0
  COSINE[i] = (65536 * Math.cos(i * RS_TO_RADIANS)) | 0
}
