/**
 * Shared scim.gg controls ( "Shared controls"): setting row
 * with reset, checkbox, switch
 *, number field with hold-to-repeat arrows,
 * colour swatch, info hint + hover card (/`NI`), buttons
 * and the collapsible settings section.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { PACK_PATHS, PackImg } from './packAssets'

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

export type OsrsButtonVariant = 'default' | 'primary' | 'ghost' | 'small' | 'danger'

export function OsrsButton({
  children,
  onClick,
  type = 'button',
  variant = 'default',
  disabled,
  ariaDisabled,
  describedBy,
  fullWidth,
  className = '',
  buttonRef,
}: {
  children: ReactNode
  onClick?: (e: ReactMouseEvent<HTMLButtonElement>) => void
  type?: 'button' | 'submit'
  variant?: OsrsButtonVariant
  disabled?: boolean
  ariaDisabled?: boolean
  describedBy?: string
  fullWidth?: boolean
  className?: string
  buttonRef?: RefObject<HTMLButtonElement | null>
}) {
  return (
    <button
      ref={buttonRef}
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-disabled={ariaDisabled || undefined}
      aria-describedby={describedBy}
      className={`osrs-btn osrs-btn--${variant} ${fullWidth ? 'osrs-btn--full-width' : ''} ${className}`}
    >
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Reset button + setting row
// ---------------------------------------------------------------------------

export function ResetButton({
  onClick,
  disabled,
  className = '',
  ariaLabel = 'Reset to default',
  ariaHidden,
  title,
}: {
  onClick: () => void
  disabled?: boolean
  className?: string
  ariaLabel?: string
  ariaHidden?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`reset-button ${className}`}
      aria-label={ariaLabel}
      aria-hidden={ariaHidden}
      title={title}
      onClick={onClick}
    >
      <PackImg path={disabled ? PACK_PATHS.resetDisabled : PACK_PATHS.resetEnabled} style={{ width: 15, height: 14 }} />
    </button>
  )
}

export function SettingRow({
  children,
  isModified,
  onReset,
  hideReset,
  className,
}: {
  children: ReactNode
  isModified: boolean
  onReset: () => void
  hideReset?: boolean
  className?: string | undefined
}) {
  return (
    <div className={`setting-row${isModified ? ' setting-row--modified' : ''}${className ? ` ${className}` : ''}`}>
      {children}
      {!hideReset && <ResetButton className="setting-row__reset" onClick={onReset} ariaHidden={!isModified} disabled={!isModified} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Checkbox / switch
// ---------------------------------------------------------------------------

export function Checkbox({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: ReactNode; disabled?: boolean | undefined }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} disabled={disabled} className="osrs-checkbox" onClick={() => onChange(!checked)}>
      <span className="osrs-checkbox__box">{checked && <span className="osrs-checkbox__mark" />}</span>
      <span className="osrs-checkbox__label">{label}</span>
    </button>
  )
}

export function Toggle({
  checked,
  onChange,
  disabled,
  size = 'default',
  accessibleLabel,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean | undefined
  size?: 'default' | 'small'
  accessibleLabel?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={accessibleLabel}
      disabled={disabled}
      className={`osrs-toggle osrs-toggle--${size}`}
      onClick={() => onChange(!checked)}
    >
      <span className="osrs-toggle__track">
        <span className="osrs-toggle__knob" />
      </span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Number input (scim: hold-to-repeat 400 ms, 120 ms, 50 ms after 1.2 s)
// ---------------------------------------------------------------------------

const REPEAT_DELAY = 400
const REPEAT_INTERVAL = 120
const REPEAT_FAST = 50
const REPEAT_ACCEL_AFTER = 1200

/** Stops non-left mouse buttons from reaching the game. */
export function stopNonLeft(e: ReactMouseEvent): void {
  if (e.button !== 0) {
    e.preventDefault()
    e.stopPropagation()
  }
}

export function NumInput({
  value,
  min,
  max,
  step = 1,
  disabled,
  id,
  className,
  placeholder,
  describedBy,
  fieldWidth,
  suffix,
  onChange,
  onBlur,
  onMouseDown = stopNonLeft,
  onKeyDown,
}: {
  value: number | string
  min?: number
  max?: number
  step?: number
  disabled?: boolean | undefined
  id?: string
  className?: string
  placeholder?: string
  describedBy?: string | undefined
  fieldWidth?: number
  suffix?: string
  onChange: (e: ChangeEvent<HTMLInputElement>) => void
  onBlur?: (e: ReactFocusEvent<HTMLInputElement>) => void
  onMouseDown?: (e: ReactMouseEvent<HTMLInputElement>) => void
  onKeyDown?: (e: ReactKeyboardEvent<HTMLInputElement>) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const delayRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startRef = useRef(0)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const stepOnce = useCallback(
    (dir: 1 | -1) => {
      const el = inputRef.current
      if (!el || disabled) return
      if (dir === 1) el.stepUp()
      else el.stepDown()
      setDraft(el.value)
      onChangeRef.current({ target: el, currentTarget: el } as unknown as ChangeEvent<HTMLInputElement>)
    },
    [disabled],
  )
  const stop = useCallback(() => {
    if (delayRef.current) clearTimeout(delayRef.current)
    if (intervalRef.current) clearInterval(intervalRef.current)
    delayRef.current = null
    intervalRef.current = null
  }, [])
  const start = useCallback(
    (dir: 1 | -1) => {
      stop()
      startRef.current = Date.now()
      delayRef.current = setTimeout(() => {
        intervalRef.current = setInterval(() => {
          stepOnce(dir)
          if (Date.now() - startRef.current > REPEAT_ACCEL_AFTER && intervalRef.current) {
            clearInterval(intervalRef.current)
            intervalRef.current = setInterval(() => stepOnce(dir), REPEAT_FAST)
          }
        }, REPEAT_INTERVAL)
      }, REPEAT_DELAY)
    },
    [stepOnce, stop],
  )
  useEffect(() => stop, [stop])
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(null)
  }, [value])

  const shown = draft ?? value
  const n = typeof shown === 'number' ? shown : Number.parseFloat(shown)
  const atMax = max !== undefined && Number.isFinite(n) && n >= max
  const atMin = min !== undefined && Number.isFinite(n) && n <= min
  useEffect(() => {
    if (disabled || atMax || atMin) stop()
  }, [disabled, atMax, atMin, stop])

  const press = (e: ReactMouseEvent, dir: 1 | -1) => {
    e.preventDefault()
    stepOnce(dir)
    start(dir)
  }
  return (
    <div className={`num-input ${disabled ? 'num-input--disabled' : ''} ${className ?? ''}`}>
      <input
        ref={inputRef}
        id={id}
        className="num-input__field"
        type="number"
        value={shown}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        placeholder={placeholder}
        aria-describedby={describedBy}
        style={fieldWidth === undefined ? undefined : { width: fieldWidth }}
        onChange={(e) => {
          setDraft(e.target.value)
          onChange(e)
        }}
        onBlur={(e) => {
          setDraft(null)
          onBlur?.(e)
        }}
        onMouseDown={onMouseDown}
        onKeyDown={onKeyDown}
      />
      {suffix !== undefined && <span className="num-input__suffix">{suffix}</span>}
      <div className="num-input__arrows">
        <button type="button" className="num-input__btn" tabIndex={-1} disabled={disabled || atMax} onMouseDown={(e) => press(e, 1)} onMouseUp={stop} onMouseLeave={stop} aria-label="Increment">
          <svg width="7" height="4" viewBox="0 0 7 4" fill="currentColor" aria-hidden="true" focusable="false">
            <path d="M3.5 0L7 4H0z" />
          </svg>
        </button>
        <button type="button" className="num-input__btn" tabIndex={-1} disabled={disabled || atMin} onMouseDown={(e) => press(e, -1)} onMouseUp={stop} onMouseLeave={stop} aria-label="Decrement">
          <svg width="7" height="4" viewBox="0 0 7 4" fill="currentColor" aria-hidden="true" focusable="false">
            <path d="M3.5 4L0 0h7z" />
          </svg>
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Colour swatch (scim: commits on the native `change` event)
// ---------------------------------------------------------------------------

export function ColorSwatch({ color, onCommit, onMouseDown = stopNonLeft }: { color: string; onCommit: (c: string) => void; onMouseDown?: (e: ReactMouseEvent<HTMLInputElement>) => void }) {
  const [draft, setDraft] = useState(color)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => setDraft(color), [color])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const h = () => {
      if (el.value.toLowerCase() !== color.toLowerCase()) onCommit(el.value)
    }
    el.addEventListener('change', h)
    return () => el.removeEventListener('change', h)
  }, [color, onCommit])
  return (
    <label className="ti-swatch" style={{ backgroundColor: draft }}>
      <input ref={ref} type="color" value={draft} onInput={(e) => setDraft(e.currentTarget.value)} onMouseDown={onMouseDown} />
    </label>
  )
}

/** scim: draft colour + commit-on-change for colour inputs inside labels. */
export function useColorDraft(color: string, onCommit: (c: string) => void) {
  const [draft, setDraft] = useState(color)
  const inputRef = useRef<HTMLInputElement>(null)
  const latest = useRef({ color, onCommit })
  latest.current = { color, onCommit }
  useEffect(() => setDraft(color), [color])
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    const h = () => {
      const v = el.value.toLowerCase()
      if (v !== latest.current.color.toLowerCase()) latest.current.onCommit(v)
    }
    el.addEventListener('change', h)
    return () => el.removeEventListener('change', h)
  }, [])
  return { draft, setDraft, inputRef }
}

// ---------------------------------------------------------------------------
// Hover card + info hint (scim, dwell 90 ms)
// ---------------------------------------------------------------------------

export type HoverPlacement = 'inline' | 'above'

export function useHoverCard({
  content,
  anchorRef,
  regionRef,
  placement = 'inline',
  dwellMs = 90,
  forceOpen = false,
  className,
}: {
  content: ReactNode
  anchorRef: RefObject<HTMLElement | null>
  regionRef?: RefObject<HTMLElement | null> | undefined
  placement?: HoverPlacement
  dwellMs?: number
  forceOpen?: boolean
  className?: string | undefined
}): { open: boolean; card: ReactNode; cardId: string } {
  const [hover, setHover] = useState(false)
  const timer = useRef<number | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const cardId = useId()
  const [pos, setPos] = useState<{ left: number; top: number; side: 'left' | 'bottom' } | null>(null)
  useEffect(() => {
    const region = regionRef?.current ?? anchorRef.current
    if (!region) return
    const enter = () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setHover(true), dwellMs)
    }
    const leave = () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = null
      setHover(false)
    }
    region.addEventListener('pointerenter', enter)
    region.addEventListener('pointerleave', leave)
    return () => {
      region.removeEventListener('pointerenter', enter)
      region.removeEventListener('pointerleave', leave)
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [anchorRef, regionRef, dwellMs])
  const open = hover || forceOpen
  useLayoutEffect(() => {
    if (!open) return
    const a = anchorRef.current
    const c = cardRef.current
    if (!a || !c) return
    const r = a.getBoundingClientRect()
    const w = c.offsetWidth
    const h = c.offsetHeight
    if (placement === 'above') {
      const left = Math.max(4, Math.min(window.innerWidth - w - 4, r.left + r.width / 2 - w / 2))
      setPos({ left, top: Math.max(4, r.top - h - 8), side: 'bottom' })
    } else {
      setPos({ left: Math.min(window.innerWidth - w - 4, r.right + 8), top: Math.max(4, r.top + r.height / 2 - h / 2), side: 'left' })
    }
  }, [open, placement, anchorRef, content])
  const card = open
    ? createPortal(
        <div
          ref={cardRef}
          id={cardId}
          role="tooltip"
          className={`hover-card${className ? ` ${className}` : ''}`}
          style={{ transform: pos ? `translate(${pos.left}px, ${pos.top}px)` : 'translate(-9999px, -9999px)' }}
        >
          <span className="hover-card-caret" data-side={pos?.side === 'bottom' ? 'bottom' : 'left'} />
          {content}
        </div>,
        document.body,
      )
    : null
  return { open, card, cardId }
}

/** The 4x6 pixel "i" glyph. */
function InfoGlyph() {
  const px: [number, number][] = [
    [1, 0],
    [2, 0],
    [0, 1],
    [3, 1],
    [3, 2],
    [2, 3],
    [2, 5],
  ]
  return (
    <svg width={4} height={6} viewBox="0 0 4 6" aria-hidden="true" focusable="false">
      {px.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="currentColor" />
      ))}
    </svg>
  )
}

export function InfoHint({
  label,
  text,
  hoverRegionRef,
  placement = 'inline',
  cardClassName,
}: {
  label: string
  text: ReactNode
  hoverRegionRef?: RefObject<HTMLElement | null>
  placement?: HoverPlacement
  cardClassName?: string
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const [focused, setFocused] = useState(false)
  const { open, card, cardId } = useHoverCard({ content: text, anchorRef: ref, regionRef: hoverRegionRef, placement, forceOpen: focused, className: cardClassName })
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`info-hint${open ? ' is-open' : ''}`}
        aria-label={`About ${label}`}
        aria-expanded={open}
        aria-describedby={open ? cardId : undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        <InfoGlyph />
      </button>
      {card}
    </>
  )
}

// ---------------------------------------------------------------------------
// Collapsible section
// ---------------------------------------------------------------------------

export function Caret({ className }: { className: string }) {
  return (
    <svg className={className} width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true" focusable="false">
      <path d="M3 1.5L7 5L3 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function Collapsible({ title, defaultExpanded = false, children }: { title: string; defaultExpanded?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultExpanded)
  return (
    <div className={`collapsible-section ${open ? 'expanded' : ''}`}>
      <button type="button" className="collapsible-header" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Caret className="collapse-indicator" />
        <span className="section-title">{title}</span>
      </button>
      <div className={`collapsible-content-wrapper ${open ? 'expanded' : ''}`} inert={!open || undefined}>
        <div className="collapsible-content">{children}</div>
      </div>
    </div>
  )
}

export function CloseIcon({ size = 12, d = 'M1 1L11 11M11 1L1 11', viewBox = '0 0 12 12', strokeWidth = 1.5 }: { size?: number; d?: string; viewBox?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox={viewBox} fill="none" aria-hidden="true" focusable="false">
      <path d={d} stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" />
    </svg>
  )
}

export const hiddenStyle: CSSProperties = { visibility: 'hidden' }
