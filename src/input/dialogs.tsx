import './dialogs.css'
import { type CSSProperties, type JSX, type MouseEvent as ReactMouseEvent, type RefObject, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { viewportFrameRect } from './dom'
import { ESC_PRIORITY, useEscapeHandler } from './escape'

/**
 * Popover dialogs opened from the in-game menu: the colour picker used for Tile Marker / Line Marker / NPC Tag colours
 * (and reusable for the Inventory Tag colour), and the tile label editor
 *. Open them with `openColorPicker` / `openLabelDialog`;
 * `InputDialogs` renders them (ViewportInput mounts it). Both close on
 * Escape (priority 40), on a mousedown outside, on Apply and on Cancel.
 */

/** Preset swatches. */
export const COLOR_SWATCHES: readonly { name: string; color: string }[] = [
  { name: 'Coral', color: '#FF5A5A' },
  { name: 'Tangerine', color: '#FF8A3D' },
  { name: 'Amber', color: '#FFC23D' },
  { name: 'Emerald', color: '#3FD06A' },
  { name: 'Cyan', color: '#1FCFD6' },
  { name: 'Azure', color: '#3BA9FF' },
  { name: 'Indigo', color: '#6B79FF' },
  { name: 'Violet', color: '#AE7CFF' },
  { name: 'Rose', color: '#FF6BAE' },
  { name: 'Snow', color: '#F1F4FA' },
]

// ---- colour maths (scim z3 / B3 / V3 / H3) ----------------------------------

/** `#RRGGBB` (upper case) or null. */
export function normalizeHex(value: string): string | null {
  const t = value.trim()
  if (!/^#?[0-9a-fA-F]{6}$/.test(t)) return null
  return `#${(t.startsWith('#') ? t.slice(1) : t).toUpperCase()}`
}

export function clampNumber(v: number, min: number, max: number): number {
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min
}

export interface Hsv {
  h: number
  s: number
  v: number
}

export function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) [r, g] = [c, x]
  else if (h < 120) [r, g] = [x, c]
  else if (h < 180) [g, b] = [c, x]
  else if (h < 240) [g, b] = [x, c]
  else if (h < 300) [r, b] = [x, c]
  else [r, b] = [c, x]
  const hex = (n: number): string => Math.round((n + m) * 255).toString(16).padStart(2, '0')
  return `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase()
}

export function hexToHsv(hex: string): Hsv {
  const r = parseInt(hex.slice(1, 3), 16) / 255
  const g = parseInt(hex.slice(3, 5), 16) / 255
  const b = parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  let h = 0
  if (d !== 0) h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4)
  if (h < 0) h += 360
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

const DEFAULT_COLOR = normalizeHex(COLOR_SWATCHES[0]?.color ?? '') ?? '#FFFFFF'

// ---- dialog store --------------------------------------------------------------

export interface ColorPickerRequest {
  title?: string
  subtitle?: string
  /** Client coordinates of the popover's top-left (clamped into the viewport frame, 8 px margin). */
  anchor: { x: number; y: number }
  initialColor: string
  initialOpacity: number
  initialFillOpacity?: number
  showOpacity?: boolean
  showFill?: boolean
  onApply(color: string, opacity: number, fillOpacity: number): void
  onCancel?: () => void
}

export interface LabelRequest {
  tile: readonly [number, number]
  anchor: { x: number; y: number }
  initialLabel?: string | undefined
  /** `undefined` clears the label. */
  onApply(label: string | undefined): void
  onCancel?: () => void
}

interface DialogState {
  color: ColorPickerRequest | null
  label: LabelRequest | null
  /** Bumped on every open so a re-open resets the dialog's local state. */
  seq: number
}

let dialogs: DialogState = { color: null, label: null, seq: 0 }
const listeners = new Set<() => void>()

function setDialogs(next: DialogState): void {
  dialogs = next
  for (const l of [...listeners]) l()
}

export function openColorPicker(request: ColorPickerRequest): void {
  setDialogs({ ...dialogs, color: request, seq: dialogs.seq + 1 })
}

export function openLabelDialog(request: LabelRequest): void {
  setDialogs({ ...dialogs, label: request, seq: dialogs.seq + 1 })
}

export function closeColorPicker(): void {
  if (dialogs.color) setDialogs({ ...dialogs, color: null })
}

export function closeLabelDialog(): void {
  if (dialogs.label) setDialogs({ ...dialogs, label: null })
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

const getDialogs = (): DialogState => dialogs

// ---- shared popover behaviour ----------------------------------------------------

/** Close on a mousedown outside; keep inside the viewport frame with an 8 px margin. */
function usePopover(ref: RefObject<HTMLDivElement | null>, open: boolean, anchor: { x: number; y: number } | null, onCancel: () => void): void {
  const cancelRef = useRef(onCancel)
  cancelRef.current = onCancel
  useEscapeHandler(ESC_PRIORITY.COLOR_PICKER, open, onCancel)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const el = ref.current
      if (!el) return
      if (e.target instanceof Node && el.contains(e.target)) return
      cancelRef.current()
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open, ref])
  useLayoutEffect(() => {
    if (!open || !anchor || !ref.current) return
    const place = (): void => {
      const el = ref.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const b = viewportFrameRect()
      el.style.left = `${Math.max(b.left + 8, Math.min(anchor.x, b.right - r.width - 8))}px`
      el.style.top = `${Math.max(b.top + 8, Math.min(anchor.y, b.bottom - r.height - 8))}px`
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, anchor, ref])
}

// ---- colour picker ----------------------------------------------------------

function ColorPickerDialog({ request, onClose }: { request: ColorPickerRequest; onClose: () => void }): JSX.Element {
  const initial = normalizeHex(request.initialColor) ?? DEFAULT_COLOR
  const showOpacity = request.showOpacity ?? true
  const showFill = request.showFill ?? false
  const [color, setColor] = useState(initial)
  const [hexText, setHexText] = useState(initial)
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(initial))
  const hsvRef = useRef(hsv)
  const [opacity, setOpacity] = useState(request.initialOpacity)
  const [fill, setFill] = useState(request.initialFillOpacity ?? 0)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const svRef = useRef<HTMLButtonElement | null>(null)
  const hueRef = useRef<HTMLButtonElement | null>(null)
  const dragRef = useRef<'sv' | 'hue' | null>(null)

  const cancel = (): void => {
    onClose()
    request.onCancel?.()
  }
  usePopover(rootRef, true, request.anchor, cancel)

  const applyHsv = (next: Hsv): void => {
    const c = { h: clampNumber(next.h, 0, 360), s: clampNumber(next.s, 0, 1), v: clampNumber(next.v, 0, 1) }
    const hex = hsvToHex(c.h, c.s, c.v)
    hsvRef.current = c
    setHsv(c)
    setColor(hex)
    setHexText(hex)
  }
  const pickSv = (x: number, y: number): void => {
    const r = svRef.current?.getBoundingClientRect()
    if (!r || r.width <= 0 || r.height <= 0) return
    applyHsv({ h: hsvRef.current.h, s: clampNumber((x - r.left) / r.width, 0, 1), v: 1 - clampNumber((y - r.top) / r.height, 0, 1) })
  }
  const pickHue = (y: number): void => {
    const r = hueRef.current?.getBoundingClientRect()
    if (!r || r.height <= 0) return
    applyHsv({ h: clampNumber((y - r.top) / r.height, 0, 1) * 360, s: hsvRef.current.s, v: hsvRef.current.v })
  }
  const startDrag = (mode: 'sv' | 'hue', e: ReactMouseEvent): void => {
    if (e.button !== 0) return
    e.preventDefault()
    dragRef.current = mode
    if (mode === 'sv') pickSv(e.clientX, e.clientY)
    else pickHue(e.clientY)
    const onMove = (ev: MouseEvent): void => {
      if (dragRef.current === 'sv') pickSv(ev.clientX, ev.clientY)
      else if (dragRef.current === 'hue') pickHue(ev.clientY)
    }
    const onUp = (): void => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('blur', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('blur', onUp)
  }
  const commitHex = (): void => {
    const hex = normalizeHex(hexText)
    if (!hex) {
      setHexText(color)
      return
    }
    applyHsv(hexToHsv(hex))
  }

  const preview = normalizeHex(hexText) ?? color
  const named = COLOR_SWATCHES.find((s) => s.color.toLowerCase() === color.toLowerCase())
  const svStyle = { '--tile-marker-picker-hue': hsvToHex(hsv.h, 1, 1) } as CSSProperties

  return (
    <div className="tile-marker-picker-backdrop">
      <div className="tile-marker-picker" ref={rootRef}>
        <div className="tile-marker-picker-header">
          <div className="tile-marker-picker-heading">
            <div className="tile-marker-picker-title">{request.title ?? 'Color'}</div>
            {request.subtitle && <div className="tile-marker-picker-subtitle">{request.subtitle}</div>}
          </div>
          <div className="tile-marker-picker-identity">
            {named && <span className="tile-marker-picker-current-name">{named.name}</span>}
            <span className="tile-marker-picker-current" role="img" style={{ backgroundColor: color, opacity }} aria-label="Current color" />
          </div>
        </div>
        <div className="tile-marker-picker-body">
          <div className="tile-marker-picker-field">
            <button type="button" ref={svRef} className="tile-marker-picker-sv" style={svStyle} onMouseDown={(e) => startDrag('sv', e)} aria-label="Saturation and brightness">
              <div className="tile-marker-picker-sv-indicator" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} aria-hidden="true" />
            </button>
            <button type="button" ref={hueRef} className="tile-marker-picker-hue" onMouseDown={(e) => startDrag('hue', e)} aria-label="Hue">
              <div className="tile-marker-picker-hue-thumb" style={{ top: `${(hsv.h / 360) * 100}%` }} aria-hidden="true" />
            </button>
          </div>
          <div className="tile-marker-picker-section">
            <div className="tile-marker-picker-section-label">
              <span>Presets</span>
            </div>
            <div className="tile-marker-picker-swatches">
              {COLOR_SWATCHES.map((s) => {
                const selected = s.color.toLowerCase() === color.toLowerCase()
                return (
                  <button
                    key={s.name}
                    type="button"
                    className={`tile-marker-swatch${selected ? ' selected' : ''}`}
                    title={s.name}
                    style={{ backgroundColor: s.color }}
                    onClick={() => {
                      const hex = normalizeHex(s.color)
                      if (hex) applyHsv(hexToHsv(hex))
                    }}
                    aria-label={`Select ${s.name}`}
                    aria-pressed={selected}
                  />
                )
              })}
            </div>
          </div>
          <div className="tile-marker-picker-section">
            <div className="tile-marker-picker-section-label">
              <span>Hex</span>
              <span className="tile-marker-picker-section-value">{color}</span>
            </div>
            <div className="tile-marker-picker-hex-row">
              <input
                className="tile-marker-picker-hex-input"
                type="text"
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                maxLength={7}
                value={hexText}
                onChange={(e) => {
                  setHexText(e.target.value)
                  const hex = normalizeHex(e.target.value)
                  if (hex) {
                    const next = hexToHsv(hex)
                    hsvRef.current = next
                    setHsv(next)
                    setColor(hsvToHex(next.h, next.s, next.v))
                  }
                }}
                onBlur={commitHex}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitHex()
                  }
                }}
                aria-label="Custom hex color"
              />
              <span className="tile-marker-picker-hex-preview" style={{ backgroundColor: preview }} aria-hidden="true" />
            </div>
          </div>
          {showOpacity && (
            <div className="tile-marker-picker-section">
              <div className="tile-marker-picker-section-label">
                <span>Opacity</span>
                <span className="tile-marker-picker-section-value">{Math.round(opacity * 100)}%</span>
              </div>
              <input className="tile-marker-picker-range" type="range" min={0} max={1} step={0.01} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} />
            </div>
          )}
          {showFill && (
            <div className="tile-marker-picker-section">
              <div className="tile-marker-picker-section-label">
                <span>Fill opacity</span>
                <span className="tile-marker-picker-section-value">{Math.round(fill * 100)}%</span>
              </div>
              <input className="tile-marker-picker-range" type="range" min={0} max={1} step={0.01} value={fill} onChange={(e) => setFill(Number(e.target.value))} />
            </div>
          )}
        </div>
        <div className="tile-marker-picker-footer">
          <button
            type="button"
            className="osrs-btn osrs-btn--primary"
            onClick={() => {
              onClose()
              request.onApply(color, opacity, showFill ? fill : 0)
            }}
          >
            Apply
          </button>
          <button type="button" className="osrs-btn osrs-btn--default" onClick={cancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ---- label editor -----------------------------------------------------------

function LabelDialog({ request, onClose }: { request: LabelRequest; onClose: () => void }): JSX.Element {
  const [text, setText] = useState(request.initialLabel ?? '')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const cancel = (): void => {
    onClose()
    request.onCancel?.()
  }
  usePopover(rootRef, true, request.anchor, cancel)
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])
  const apply = (): void => {
    const t = text.trim()
    onClose()
    request.onApply(t.length > 0 ? t : undefined)
  }
  return (
    <div className="tile-marker-label-backdrop">
      <div className="tile-marker-label-editor" ref={rootRef}>
        <div className="tile-marker-label-header">
          <div className="tile-marker-label-title">Tile Label</div>
          <div className="tile-marker-label-subtitle">
            Tile [{request.tile[0]}, {request.tile[1]}]
          </div>
        </div>
        <div className="tile-marker-label-body">
          <input
            ref={inputRef}
            className="tile-marker-label-input"
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                apply()
              }
            }}
            placeholder="Enter label..."
            autoComplete="off"
            spellCheck={false}
          />
          {request.initialLabel && (
            <button
              type="button"
              className="tile-marker-label-clear"
              onClick={() => {
                onClose()
                request.onApply(undefined)
              }}
            >
              Clear existing label
            </button>
          )}
        </div>
        <div className="tile-marker-label-footer">
          <button type="button" className="osrs-btn osrs-btn--primary" onClick={apply}>
            Apply
          </button>
          <button type="button" className="osrs-btn osrs-btn--default" onClick={cancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

/** Renders whichever dialogs are open (portal on document.body). */
export function InputDialogs(): JSX.Element | null {
  const state = useSyncExternalStore(subscribe, getDialogs, getDialogs)
  if (typeof document === 'undefined' || (!state.color && !state.label)) return null
  return createPortal(
    <>
      {state.color && <ColorPickerDialog key={`color-${state.seq}`} request={state.color} onClose={closeColorPicker} />}
      {state.label && <LabelDialog key={`label-${state.seq}`} request={state.label} onClose={closeLabelDialog} />}
    </>,
    document.body,
  )
}
