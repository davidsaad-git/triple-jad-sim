const GOLDEN_RATIO = 0x9e3779b9
const ROUNDS = 32

/** Decrypt whole 8-byte blocks in place semantics (returns a copy); trailing bytes are left as-is. */
export function xteaDecrypt(data: Uint8Array, keys: readonly number[]): Uint8Array {
  const out = new Uint8Array(data)
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
  const k0 = keys[0]! | 0
  const k1 = keys[1]! | 0
  const k2 = keys[2]! | 0
  const k3 = keys[3]! | 0
  const k = [k0, k1, k2, k3]
  const blocks = Math.floor(out.length / 8)
  for (let b = 0; b < blocks; b++) {
    const off = b * 8
    let v0 = view.getInt32(off)
    let v1 = view.getInt32(off + 4)
    let sum = Math.imul(GOLDEN_RATIO, ROUNDS) | 0
    for (let i = 0; i < ROUNDS; i++) {
      v1 = (v1 - ((((v0 << 4) ^ (v0 >>> 5)) + v0) ^ (sum + k[(sum >>> 11) & 3]!))) | 0
      sum = (sum - GOLDEN_RATIO) | 0
      v0 = (v0 - ((((v1 << 4) ^ (v1 >>> 5)) + v1) ^ (sum + k[sum & 3]!))) | 0
    }
    view.setInt32(off, v0)
    view.setInt32(off + 4, v1)
  }
  return out
}
