/**
 * Debug overlays from Plugins > Debug Overlays:
 * Tick Timing, Sound Debug, Input Display
 *. The Coordinate Overlay lives in the HUD tool stack.
 */
import { useEffect, useState, type CSSProperties } from 'react'
import type { SimRuntime, TickTimingStats } from '../../app/runtime/types'
import { useSetting } from '../../app/settings/settings'
import { getModifiers, inputTracker, onModifiersChange, type ModifierState, type MouseButtonState } from '../../input/modifiers'

/** scim theme `XC.colors` subset. */
const C = {
  surface: '#14100c',
  borderHighlight: '#383023',
  primary: '#d4a54a',
  primaryHover: '#dfc06a',
  text: '#ffffff',
  textMuted: '#6b6b6b',
  success: '#6dba6d',
  danger: '#d46a60',
  warning: '#d4a848',
}

function rgba(hex: string, a: number): string {
  const n = Number.parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

const PANEL: CSSProperties = {
  background: C.surface,
  border: `1px solid ${C.borderHighlight}`,
  borderRadius: 2,
  padding: '8px 12px',
  fontFamily: '"RuneScape Plain 11", monospace',
  fontSize: 13,
  color: C.text,
  pointerEvents: 'none',
  minWidth: 220,
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  textShadow: '1px 1px 0 #000',
  lineHeight: 1.5,
}

const TITLE: CSSProperties = { color: C.primary, fontFamily: '"RuneScape Bold 12", sans-serif', fontSize: 14, marginBottom: 4 }

// ---------------------------------------------------------------------------
// Tick Timing
// ---------------------------------------------------------------------------

/** scim: deviation colour. */
export function deviationColor(ms: number): string {
  const a = Math.abs(ms)
  return a <= 2 ? C.success : a <= 8 ? C.warning : a <= 16 ? C.primaryHover : C.danger
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ color: C.primary }}>{label}</span>
      <span style={{ color: color ?? C.text, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}

/** scim: 200x32 sparkline of recent tick deltas, +-16 ms around expected. */
function Sparkline({ deltas, expectedMs }: { deltas: number[]; expectedMs: number }) {
  if (deltas.length < 2) return null
  const lo = expectedMs - 16
  const hi = expectedMs + 16
  const span = hi - lo
  const step = 196 / (deltas.length - 1)
  let d = ''
  deltas.forEach((v, i) => {
    const x = 2 + i * step
    const y = 30 - ((Math.max(lo, Math.min(hi, v)) - lo) / span) * 28
    d += i === 0 ? `M${x},${y}` : ` L${x},${y}`
  })
  const mid = 30 - ((expectedMs - lo) / span) * 28
  return (
    <svg width={200} height={32} style={{ display: 'block' }} role="img" aria-label="Tick timing sparkline">
      <title>Tick timing sparkline</title>
      <line x1={2} y1={mid} x2={198} y2={mid} stroke={rgba(C.primary, 0.3)} strokeWidth="1" strokeDasharray="3,3" />
      <path d={d} fill="none" stroke={C.success} strokeWidth="1.5" />
    </svg>
  )
}

const f = (v: number | null, digits = 1) => (v === null ? '—' : v.toFixed(digits))

export function TickTimingOverlay({ runtime }: { runtime: SimRuntime }) {
  const visible = useSetting('showTickTiming')
  const [stats, setStats] = useState<TickTimingStats | null>(null)
  useEffect(() => {
    if (!visible) return
    let h = 0
    const loop = () => {
      setStats(runtime.tickStats.getStats())
      h = requestAnimationFrame(loop)
    }
    h = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(h)
  }, [visible, runtime])
  if (!visible || !stats || stats.samples === 0) return null
  const lastDev = stats.lastMs === null ? 0 : stats.lastMs - stats.expectedMs
  return (
    <div style={{ ...PANEL, position: 'absolute', top: 8, left: 8, zIndex: 1000 }}>
      <div style={TITLE}>Tick Timing</div>
      <Row label="Expected" value={`${stats.expectedMs.toFixed(0)}ms`} />
      <Row label="Last" value={`${f(stats.lastMs)}ms (${lastDev >= 0 ? '+' : ''}${lastDev.toFixed(1)})`} color={deviationColor(lastDev)} />
      <Row label="Avg" value={`${f(stats.avgMs)}ms`} color={deviationColor((stats.avgMs ?? stats.expectedMs) - stats.expectedMs)} />
      <Row label="Min / Max" value={`${f(stats.minMs)} / ${f(stats.maxMs)}ms`} />
      <Row
        label="Stddev"
        value={`${f(stats.stddevMs)}ms`}
        color={(stats.stddevMs ?? 0) > 8 ? C.danger : (stats.stddevMs ?? 0) > 4 ? C.warning : C.success}
      />
      <Row label="Max Jitter" value={`${f(stats.maxJitterMs)}ms`} color={deviationColor(stats.maxJitterMs ?? 0)} />
      <Row label="Samples" value={`${stats.samples}`} />
      <div style={{ marginTop: 4 }}>
        <Sparkline deltas={stats.recent} expectedMs={stats.expectedMs} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sound Debug
// ---------------------------------------------------------------------------

export interface SoundPlayRecord {
  eventId: number
  soundId: number
  trigger: string
  timestamp: number
}

/** What the overlay needs from AUDIO's `AudioSystem` (src/audio). */
export interface SoundDebugSource {
  onSoundPlayed(listener: (record: SoundPlayRecord) => void): () => void
  getRecentSoundEvents(limit?: number): SoundPlayRecord[]
}

const SOUND_LIFE_MS = 4000
const SOUND_FADE_AFTER_MS = 3000

export function SoundDebugOverlay({ audio, soundName, controlsVisible = false }: { audio: SoundDebugSource | null; soundName: (id: number) => string | undefined; controlsVisible?: boolean }) {
  const visible = useSetting('showSoundDebug')
  const [rows, setRows] = useState<SoundPlayRecord[]>([])
  const [, force] = useState(0)
  useEffect(() => {
    if (!audio) return
    return audio.onSoundPlayed((r) => setRows((list) => (list.some((x) => x.eventId === r.eventId) ? list : [r, ...list].slice(0, 10))))
  }, [audio])
  useEffect(() => {
    if (!visible || !audio) return
    const fresh = (r: SoundPlayRecord) => Date.now() - r.timestamp < SOUND_LIFE_MS
    const poll = () => {
      const recent = audio.getRecentSoundEvents(10).filter(fresh)
      if (recent.length === 0) return
      setRows((list) => {
        const m = new Map<number, SoundPlayRecord>()
        for (const r of recent) m.set(r.eventId, r)
        for (const r of list.filter(fresh)) if (!m.has(r.eventId)) m.set(r.eventId, r)
        return [...m.values()].sort((a, b) => b.eventId - a.eventId).slice(0, 10)
      })
    }
    poll()
    const a = window.setInterval(poll, 250)
    const b = window.setInterval(() => {
      setRows((list) => list.filter(fresh))
      force((n) => n + 1)
    }, 100)
    return () => {
      window.clearInterval(a)
      window.clearInterval(b)
    }
  }, [visible, audio])
  if (!visible) return null
  const now = Date.now()
  return (
    <div style={{ ...PANEL, position: 'fixed', bottom: 64, left: controlsVisible ? 336 : 16, right: 'auto', zIndex: 65 }}>
      <div style={TITLE}>Sound Debug</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {rows.map((r) => {
          const age = now - r.timestamp
          const opacity = age > SOUND_FADE_AFTER_MS ? 1 - (age - SOUND_FADE_AFTER_MS) / 1000 : 1
          return (
            <div key={r.eventId} style={{ display: 'flex', gap: 6, opacity, transition: 'opacity 0.1s linear', whiteSpace: 'nowrap' }}>
              <span style={{ color: C.text }}>
                {soundName(r.soundId) ?? 'Unknown'} <span style={{ color: C.textMuted }}>({r.soundId}) —</span>
              </span>
              <span style={{ color: C.primary }}>{r.trigger}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Input Display
// ---------------------------------------------------------------------------

const MODS: { label: string; key: keyof ModifierState }[] = [
  { label: 'Shift', key: 'shift' },
  { label: 'Ctrl', key: 'ctrl' },
  { label: 'Alt', key: 'alt' },
  { label: 'Meta', key: 'meta' },
]
const MOUSE_PATHS: Record<keyof MouseButtonState, string> = {
  left: 'M10 1.6C5.3 1.6 1.6 5.4 1.6 10v2.6H10z',
  right: 'M10 1.6c4.7 0 8.4 3.8 8.4 8.4v2.6H10z',
  middle: 'M10 4.4a1.4 1.4 0 0 1 1.4 1.4v3.4a1.4 1.4 0 0 1-2.8 0V5.8A1.4 1.4 0 0 1 10 4.4z',
}

export function InputDisplay() {
  const visible = useSetting('showModifierKeys')
  const [mods, setMods] = useState<ModifierState>(() => getModifiers())
  const [buttons, setButtons] = useState<MouseButtonState>(() => inputTracker.getMouseButtons())
  useEffect(() => {
    if (!visible) return
    setMods(getModifiers())
    const a = onModifiersChange(setMods)
    const b = inputTracker.onMouseButtonsChange(setButtons)
    return () => {
      a()
      b()
    }
  }, [visible])
  if (!visible) return null
  const dim = rgba(C.primary, 0.35)
  return (
    <div style={{ ...PANEL, position: 'absolute', top: 8, left: 152, zIndex: 1000, padding: '6px 10px', minWidth: undefined, backdropFilter: undefined, WebkitBackdropFilter: undefined, lineHeight: 1.4 }}>
      <div style={{ ...TITLE, marginBottom: 2 }}>Input</div>
      <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
        <svg width={17} height={25} viewBox="0 0 20 30" aria-hidden="true" focusable="false" style={{ flexShrink: 0 }}>
          {(Object.keys(MOUSE_PATHS) as (keyof MouseButtonState)[]).map((k) => (
            <path key={k} d={MOUSE_PATHS[k]} data-mouse-button={k} data-held={buttons[k] || undefined} fill={buttons[k] ? C.success : 'none'} stroke={buttons[k] ? C.success : dim} strokeWidth={1.2} />
          ))}
          <rect x={1.6} y={1.6} width={16.8} height={26.8} rx={8.4} fill="none" stroke={dim} strokeWidth={1.2} />
          <path d="M1.6 12.6h16.8" fill="none" stroke={dim} strokeWidth={1.2} />
        </svg>
        <div style={{ display: 'flex', gap: 4 }}>
          {MODS.map(({ label, key }) => (
            <span
              key={key}
              data-modifier={key}
              data-held={mods[key] || undefined}
              style={{ padding: '1px 5px', borderRadius: 2, border: `1px solid ${mods[key] ? C.success : dim}`, color: mods[key] ? C.success : rgba(C.text, 0.45) }}
            >
              {label}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
