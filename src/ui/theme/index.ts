/**
 * Theme entry point: import once (fonts + palette tokens), then call
 * `installPackTheme()` so the active resource pack's palette follows the
 * `activeResourcePack` setting.
 */
import './fonts.css'
import './tokens.css'
import { settingsStore } from '../../app/settings/settings'
import { resolvePackId } from '../packs'
import { applyPackTheme } from './palettes'

export { applyPackTheme, clientColors, PACK_PALETTES, paletteFor, THEME_CSS_VARIABLES, type PackPalette } from './palettes'

let installed: (() => void) | null = null

/** Apply the current pack's palette and keep it in sync with settings (idempotent). Unknown ids use Vanilla. */
export function installPackTheme(): () => void {
  if (installed) return installed
  let current = settingsStore.get().activeResourcePack
  applyPackTheme(resolvePackId(current))
  const unsubscribe = settingsStore.subscribe(() => {
    const next = settingsStore.get().activeResourcePack
    if (next !== current) {
      current = next
      applyPackTheme(resolvePackId(next))
    }
  })
  installed = () => {
    unsubscribe()
    installed = null
  }
  return installed
}
