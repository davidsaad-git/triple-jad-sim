/**
 * JSON localStorage helpers, the offline equivalent of scim.gg's
 *: no key prefix, values stored as JSON, failures
 * (private mode, quota, corrupt JSON) are swallowed.
 */

export function readJson(key: string): unknown {
  try {
    const raw = globalThis.localStorage?.getItem(key)
    if (raw === null || raw === undefined) return undefined
    return JSON.parse(raw) as unknown
  } catch {
    return undefined
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value))
  } catch {
    // storage unavailable: keep the value in memory only
  }
}

export function removeKey(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key)
  } catch {
    // ignore
  }
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
