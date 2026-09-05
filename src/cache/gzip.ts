import { gunzipSync } from 'fflate'

export function gzipDecompress(payload: Uint8Array): Uint8Array {
  return gunzipSync(payload)
}
