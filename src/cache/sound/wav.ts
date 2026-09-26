/** Minimal RIFF/WAVE writer: mono 16-bit PCM from float samples in -1..1. */
export function encodeWav(pcm: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = pcm.length * 2
  const out = new Uint8Array(44 + dataBytes)
  const view = new DataView(out.buffer)
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) out[offset + i] = text.charCodeAt(i)
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, dataBytes, true)
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.max(-1, Math.min(1, pcm[i]!))
    view.setInt16(44 + i * 2, Math.round(v < 0 ? v * 32768 : v * 32767), true)
  }
  return out
}
