// Ported from rs-map-viewer (BSD-2-Clause, Copyright (c) 2022-2023 dennisdev), see NOTICE.md.
//
// Minimal column-major 4x4 matrix + quaternion helpers with gl-matrix
// semantics (translation in elements 12..14), matching the client's Matrix.

export type Mat4 = Float32Array
export type Quat = Float32Array
export type Vec3 = Float32Array

export function mat4Create(): Mat4 {
  const m = new Float32Array(16)
  m[0] = m[5] = m[10] = m[15] = 1
  return m
}

export function mat4Identity(out: Mat4): Mat4 {
  out.fill(0)
  out[0] = out[5] = out[10] = out[15] = 1
  return out
}

export function mat4Copy(out: Mat4, a: Mat4): Mat4 {
  out.set(a)
  return out
}

/** out = a * b (column vectors: apply b first, then a). Safe for aliasing. */
export function mat4Mul(out: Mat4, a: Mat4, b: Mat4): Mat4 {
  const a00 = a[0]!, a01 = a[1]!, a02 = a[2]!, a03 = a[3]!
  const a10 = a[4]!, a11 = a[5]!, a12 = a[6]!, a13 = a[7]!
  const a20 = a[8]!, a21 = a[9]!, a22 = a[10]!, a23 = a[11]!
  const a30 = a[12]!, a31 = a[13]!, a32 = a[14]!, a33 = a[15]!

  let b0 = b[0]!, b1 = b[1]!, b2 = b[2]!, b3 = b[3]!
  out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30
  out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31
  out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32
  out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33

  b0 = b[4]!; b1 = b[5]!; b2 = b[6]!; b3 = b[7]!
  out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30
  out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31
  out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32
  out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33

  b0 = b[8]!; b1 = b[9]!; b2 = b[10]!; b3 = b[11]!
  out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30
  out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31
  out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32
  out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33

  b0 = b[12]!; b1 = b[13]!; b2 = b[14]!; b3 = b[15]!
  out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30
  out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31
  out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32
  out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33
  return out
}

export function mat4Add(out: Mat4, a: Mat4, b: Mat4): Mat4 {
  for (let i = 0; i < 16; i++) out[i] = a[i]! + b[i]!
  return out
}

/** out = a * s (every element, translation included). */
export function mat4MulScalar(out: Mat4, a: Mat4, s: number): Mat4 {
  for (let i = 0; i < 16; i++) out[i] = a[i]! * s
  return out
}

/** Inverse of `a`; leaves `out` as identity when `a` is singular. */
export function mat4Invert(out: Mat4, a: Mat4): Mat4 {
  const a00 = a[0]!, a01 = a[1]!, a02 = a[2]!, a03 = a[3]!
  const a10 = a[4]!, a11 = a[5]!, a12 = a[6]!, a13 = a[7]!
  const a20 = a[8]!, a21 = a[9]!, a22 = a[10]!, a23 = a[11]!
  const a30 = a[12]!, a31 = a[13]!, a32 = a[14]!, a33 = a[15]!

  const b00 = a00 * a11 - a01 * a10
  const b01 = a00 * a12 - a02 * a10
  const b02 = a00 * a13 - a03 * a10
  const b03 = a01 * a12 - a02 * a11
  const b04 = a01 * a13 - a03 * a11
  const b05 = a02 * a13 - a03 * a12
  const b06 = a20 * a31 - a21 * a30
  const b07 = a20 * a32 - a22 * a30
  const b08 = a20 * a33 - a23 * a30
  const b09 = a21 * a32 - a22 * a31
  const b10 = a21 * a33 - a23 * a31
  const b11 = a22 * a33 - a23 * a32

  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06
  if (!det) return mat4Identity(out)
  det = 1 / det

  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det
  return out
}

export function mat4FromScaling(out: Mat4, x: number, y: number, z: number): Mat4 {
  mat4Identity(out)
  out[0] = x
  out[5] = y
  out[10] = z
  return out
}

export function mat4FromQuat(out: Mat4, q: Quat): Mat4 {
  const x = q[0]!, y = q[1]!, z = q[2]!, w = q[3]!
  const x2 = x + x, y2 = y + y, z2 = z + z
  const xx = x * x2, yx = y * x2, yy = y * y2
  const zx = z * x2, zy = z * y2, zz = z * z2
  const wx = w * x2, wy = w * y2, wz = w * z2

  out[0] = 1 - yy - zz
  out[1] = yx + wz
  out[2] = zx - wy
  out[3] = 0
  out[4] = yx - wz
  out[5] = 1 - xx - zz
  out[6] = zy + wx
  out[7] = 0
  out[8] = zx + wy
  out[9] = zy - wx
  out[10] = 1 - xx - yy
  out[11] = 0
  out[12] = 0
  out[13] = 0
  out[14] = 0
  out[15] = 1
  return out
}

export function mat4GetTranslation(out: Vec3, m: Mat4): Vec3 {
  out[0] = m[12]!
  out[1] = m[13]!
  out[2] = m[14]!
  return out
}

/** Column lengths, i.e. the client's `getVectorMagnitudes`. */
export function mat4GetScaling(out: Vec3, m: Mat4): Vec3 {
  out[0] = Math.hypot(m[0]!, m[1]!, m[2]!)
  out[1] = Math.hypot(m[4]!, m[5]!, m[6]!)
  out[2] = Math.hypot(m[8]!, m[9]!, m[10]!)
  return out
}

export function quatCreate(): Quat {
  const q = new Float32Array(4)
  q[3] = 1
  return q
}

export function quatSetAxisAngle(out: Quat, ax: number, ay: number, az: number, rad: number): Quat {
  const half = rad * 0.5
  const s = Math.sin(half)
  out[0] = s * ax
  out[1] = s * ay
  out[2] = s * az
  out[3] = Math.cos(half)
  return out
}

/** out = a * b (Hamilton product). Safe for aliasing. */
export function quatMul(out: Quat, a: Quat, b: Quat): Quat {
  const ax = a[0]!, ay = a[1]!, az = a[2]!, aw = a[3]!
  const bx = b[0]!, by = b[1]!, bz = b[2]!, bw = b[3]!
  out[0] = ax * bw + aw * bx + ay * bz - az * by
  out[1] = ay * bw + aw * by + az * bx - ax * bz
  out[2] = az * bw + aw * bz + ax * by - ay * bx
  out[3] = aw * bw - ax * bx - ay * by - az * bz
  return out
}
