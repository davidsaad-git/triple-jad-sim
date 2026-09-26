/**
 * URLs of files under public/, prefixed with Vite's base path so the app also
 * works when hosted under a sub-path (GitHub Pages serves it from
 * /triple-jad-sim/).
 */
export function baseUrl(): string {
  const b = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/'
  return b.endsWith('/') ? b : `${b}/`
}

/** URL of `path` (with or without a leading slash) under public/. */
export function publicUrl(path: string): string {
  return `${baseUrl()}${path.replace(/^\/+/, '')}`
}
