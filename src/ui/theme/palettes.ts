/**
 * Resource-pack colour palettes applied as CSS
 * custom properties on :root, plus the JS theme
 * object the canvas/inline-styled chrome reads (scim, patched per
 * pack by).
 */
import type { ResourcePackId } from '../../app/settings/settings'

/** CSS variables written on :root when a pack is activated. */
export const THEME_CSS_VARIABLES = [
  'color-primary',
  'color-primary-hover',
  'color-primary-structure',
  'color-secondary',
  'color-bg',
  'color-bg-solid',
  'color-bg-elevated',
  'color-surface',
  'color-surface-inset',
  'color-surface-hover',
  'color-surface-highlight',
  'color-border',
  'color-text-body',
  'color-text-muted',
  'color-text-dim',
  'color-error',
  'color-success',
  'color-warning',
  'color-info',
  'color-limited-notice',
  'shadow-glow',
  'hud-bg',
  'hud-border',
  'color-surface-translucent',
  'color-border-translucent',
  'infobox-tint',
] as const

export type ThemeCssVariable = (typeof THEME_CSS_VARIABLES)[number]

export interface PackPalette extends Record<ThemeCssVariable, string> {
  borderHighlight: string
  borderDark: string
  primaryDim: string
  secondaryHover: string
}

export const PACK_PALETTES: Readonly<Record<ResourcePackId, PackPalette>> = {
  'pack-browntown': {
    'color-primary': '#d4a54a',
    'color-primary-hover': '#dfc06a',
    'color-primary-structure': '#5d5245',
    'color-secondary': '#c8aa6e',
    'color-bg': 'rgb(30, 24, 18)',
    'color-bg-solid': '#1e1812',
    'color-bg-elevated': '#241d16',
    'color-surface': '#14100c',
    'color-surface-inset': '#0a0805',
    'color-surface-hover': '#363229',
    'color-surface-highlight': 'rgba(255, 255, 255, 0.05)',
    'color-border': '#383023',
    'color-text-body': '#d2bea0',
    'color-text-muted': '#8a7a5c',
    'color-text-dim': '#5a4d3e',
    'color-error': '#d46a60',
    'color-success': '#6dba6d',
    'color-warning': '#d4a848',
    'color-info': '#6898c0',
    'color-limited-notice': '#8c8c8c',
    'shadow-glow': '0 0 10px rgba(212, 165, 74, 0.1)',
    'hud-bg': 'rgba(30, 24, 18, 0.88)',
    'hud-border': 'rgba(56, 48, 35, 0.25)',
    'color-surface-translucent': 'rgba(20, 16, 12, 0.92)',
    'color-border-translucent': 'rgba(56, 48, 35, 0.5)',
    'infobox-tint': 'rgba(15, 12, 8, 0.75)',
    borderHighlight: '#383023',
    borderDark: '#101010',
    primaryDim: 'rgba(212, 165, 74, 0.15)',
    secondaryHover: '#dcc48e',
  },
  'pack-vanilla': {
    'color-primary': '#ff981f',
    'color-primary-hover': '#ffac4d',
    'color-primary-structure': '#6a5e4e',
    'color-secondary': '#c8aa6e',
    'color-bg': 'rgb(34, 28, 20)',
    'color-bg-solid': '#221c14',
    'color-bg-elevated': '#2a221a',
    'color-surface': '#181410',
    'color-surface-inset': '#0c0a06',
    'color-surface-hover': '#3e3828',
    'color-surface-highlight': 'rgba(255, 255, 255, 0.05)',
    'color-border': '#3e3428',
    'color-text-body': '#d6c4a8',
    'color-text-muted': '#8e7c5e',
    'color-text-dim': '#5e5040',
    'color-error': '#f87171',
    'color-success': '#4ade80',
    'color-warning': '#e8b13c',
    'color-info': '#60a5fa',
    'color-limited-notice': '#8c8c8c',
    'shadow-glow': '0 0 10px rgba(255, 152, 31, 0.12)',
    'hud-bg': 'rgba(34, 28, 20, 0.88)',
    'hud-border': 'rgba(62, 52, 40, 0.25)',
    'color-surface-translucent': 'rgba(24, 20, 14, 0.92)',
    'color-border-translucent': 'rgba(62, 52, 40, 0.5)',
    'infobox-tint': 'rgba(18, 14, 10, 0.75)',
    borderHighlight: '#3e3428',
    borderDark: '#121210',
    primaryDim: 'rgba(255, 152, 31, 0.15)',
    secondaryHover: '#dcc48e',
  },
  'pack-toblite': {
    'color-primary': '#c45050',
    'color-primary-hover': '#d46a6a',
    'color-primary-structure': '#564060',
    'color-secondary': '#b08a94',
    'color-bg': 'rgb(26, 18, 28)',
    'color-bg-solid': '#1a121c',
    'color-bg-elevated': '#201826',
    'color-surface': '#120e14',
    'color-surface-inset': '#08060a',
    'color-surface-hover': '#342a38',
    'color-surface-highlight': 'rgba(255, 255, 255, 0.05)',
    'color-border': '#3a2d3e',
    'color-text-body': '#c8b8c8',
    'color-text-muted': '#7a6878',
    'color-text-dim': '#4a3c4a',
    'color-error': '#d85858',
    'color-success': '#5cb878',
    'color-warning': '#d0a4bc',
    'color-info': '#7088c0',
    'color-limited-notice': '#8c8c8c',
    'shadow-glow': '0 0 10px rgba(196, 80, 80, 0.12)',
    'hud-bg': 'rgba(26, 18, 28, 0.88)',
    'hud-border': 'rgba(58, 45, 62, 0.25)',
    'color-surface-translucent': 'rgba(18, 14, 22, 0.92)',
    'color-border-translucent': 'rgba(58, 45, 62, 0.5)',
    'infobox-tint': 'rgba(12, 8, 14, 0.75)',
    borderHighlight: '#3a2d3e',
    borderDark: '#100e12',
    primaryDim: 'rgba(196, 80, 80, 0.15)',
    secondaryHover: '#c8a0aa',
  },
  'pack-duckscape': {
    'color-primary': '#8a9ca0',
    'color-primary-hover': '#9cacb0',
    'color-primary-structure': '#4a5258',
    'color-secondary': '#a09888',
    'color-bg': 'rgb(22, 18, 26)',
    'color-bg-solid': '#16121a',
    'color-bg-elevated': '#1c1822',
    'color-surface': '#100c14',
    'color-surface-inset': '#080612',
    'color-surface-hover': '#302a38',
    'color-surface-highlight': 'rgba(255, 255, 255, 0.05)',
    'color-border': '#38303e',
    'color-text-body': '#c4bcc8',
    'color-text-muted': '#706478',
    'color-text-dim': '#453a4e',
    'color-error': '#c07070',
    'color-success': '#78a888',
    'color-warning': '#b8a060',
    'color-info': '#7898b0',
    'color-limited-notice': '#8c8c8c',
    'shadow-glow': '0 0 10px rgba(138, 156, 160, 0.1)',
    'hud-bg': 'rgba(22, 18, 26, 0.88)',
    'hud-border': 'rgba(56, 48, 62, 0.25)',
    'color-surface-translucent': 'rgba(16, 12, 20, 0.92)',
    'color-border-translucent': 'rgba(56, 48, 62, 0.5)',
    'infobox-tint': 'rgba(10, 8, 14, 0.75)',
    borderHighlight: '#38303e',
    borderDark: '#120e16',
    primaryDim: 'rgba(138, 156, 160, 0.15)',
    secondaryHover: '#b4ac9a',
  },
}

/** Palette for a pack id; unknown ids use Brown Theme like scim's. */
export function paletteFor(pack: string): PackPalette {
  return (PACK_PALETTES as Record<string, PackPalette | undefined>)[pack] ?? PACK_PALETTES['pack-browntown']
}

/**
 * The chrome's JS colour table (scim subset). Read it at render
 * time; `applyPackTheme` patches it in place like scim's.
 */
export const clientColors = {
  background: 'rgb(30, 24, 18)',
  surface: '#14100c',
  surfaceDark: '#0a0805',
  border: 'rgba(16, 16, 16, 0.8)',
  borderHighlight: '#383023',
  borderDark: '#101010',
  primary: '#d4a54a',
  primaryHover: '#dfc06a',
  primaryDim: 'rgba(212, 165, 74, 0.15)',
  secondary: '#c8aa6e',
  secondaryHover: '#dcc48e',
  text: '#ffffff',
  textSecondary: '#c8aa6e',
  textMuted: '#6b6b6b',
  textHighlight: '#ffffff',
  success: '#6dba6d',
  danger: '#d46a60',
  warning: '#d4a848',
  info: '#6898c0',
}

function patchClientColors(p: PackPalette): void {
  clientColors.background = p['color-bg']
  clientColors.surface = p['color-surface']
  clientColors.surfaceDark = p['color-surface-inset']
  clientColors.borderHighlight = p['color-border']
  clientColors.borderDark = p.borderDark
  clientColors.primary = p['color-primary']
  clientColors.primaryHover = p['color-primary-hover']
  clientColors.primaryDim = p.primaryDim
  clientColors.secondary = p['color-secondary']
  clientColors.secondaryHover = p.secondaryHover
  clientColors.textSecondary = p['color-secondary']
  clientColors.textMuted = p['color-text-muted']
  clientColors.success = p['color-success']
  clientColors.danger = p['color-error']
  clientColors.warning = p['color-warning']
  clientColors.info = p['color-info']
}

/** Write the pack's palette onto :root and body. Safe without a DOM. */
export function applyPackTheme(pack: string): PackPalette {
  const palette = paletteFor(pack)
  patchClientColors(palette)
  if (typeof document !== 'undefined') {
    const root = document.documentElement
    for (const name of THEME_CSS_VARIABLES) root.style.setProperty(`--${name}`, palette[name])
    if (document.body) document.body.style.background = palette['color-surface-inset']
  }
  return palette
}
