/**
 * Settings side panel (scim with `ibe`/`abe`/`obe`/`sbe`/`cbe`). Bound to `settingsStore`. No account zone
 * (offline build); Privacy is inert; the Legal footer is adapted.
 */
import './styles/tokens.css'
import './styles/controls.css'
import './styles/settings.css'
import { useEffect, useState, type ReactNode } from 'react'
import { DEFAULT_SETTINGS, settingsStore, useSetting, type ClientLayoutMode, type GameResolution, type InfoboxPinTarget, type ResourcePackId, type Settings } from '../../app/settings/settings'
import { Checkbox, CloseIcon, ColorSwatch, Collapsible, ResetButton, SettingRow } from './controls'
import { ESC_PRIORITY, useEscapeLayer } from './escape'
import { menuController, useMenuState } from './menuState'

/** Title shown where scim shows "SCIM.GG". */
export const APP_TITLE = 'TRIPLE JADS'

const DEF = DEFAULT_SETTINGS
const EPS = 5e-3

function set<K extends keyof Settings>(key: K, value: Settings[K]): void {
  settingsStore.patch({ [key]: value } as Partial<Settings>)
}

/** scim: mobile = coarse pointer and no fine pointer. */
export function useIsMobile(): boolean {
  const query = '(any-pointer: coarse) and (not (any-pointer: fine))'
  const [m, setM] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(query)
    const h = (e: MediaQueryListEvent) => setM(e.matches)
    setM(mq.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])
  return m
}

// ---------------------------------------------------------------------------
// Slider row (label text + inline reset + value, range input)
// ---------------------------------------------------------------------------

function SliderRow({
  label,
  value,
  display,
  min,
  max,
  step,
  defaultValue,
  onChange,
  resetLabel,
  ariaLabel,
  ariaValueText,
}: {
  label: string
  value: number
  display: ReactNode
  min: number
  max: number
  step: number
  defaultValue: number
  onChange: (v: number) => void
  resetLabel: string
  ariaLabel?: string
  ariaValueText?: string
}) {
  const modified = Math.abs(value - defaultValue) > EPS
  return (
    <SettingRow isModified={modified} onReset={() => onChange(defaultValue)} hideReset>
      <div className="slider-control">
        <div className="slider-label">
          <span className="slider-label-text">
            {label}
            {modified && <ResetButton className="setting-row__reset-inline" onClick={() => onChange(defaultValue)} ariaLabel={resetLabel} />}
          </span>
          <span className="slider-label-value">{display}</span>
        </div>
        <input
          type="range"
          min={String(min)}
          max={String(max)}
          step={String(step)}
          aria-label={ariaLabel}
          aria-valuetext={ariaValueText}
          value={value}
          onChange={(e) => onChange(Number.parseFloat(e.target.value))}
          className={`slider-input${modified ? ' slider-input--modified' : ''}`}
        />
      </div>
    </SettingRow>
  )
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

function SimulationSection({ onRestart, restartDisabled }: { onRestart: (() => void) | undefined; restartDisabled: boolean }) {
  const speed = useSetting('speedMultiplier')
  const inputLag = useSetting('inputLagMs')
  const autoAdvance = useSetting('autoAdvance')
  const pause = useSetting('pauseWhenUnfocused')
  return (
    <div className="controls-container">
      <div className="control-group control-group--no-border">
        <button type="button" onClick={onRestart} className="control-button restart-button" disabled={restartDisabled || !onRestart}>
          <span>Restart Simulation</span>
          <kbd className="restart-keybind">(Ctrl+R)</kbd>
        </button>
      </div>
      <div className="control-group">
        <div className="group-title">Playback Speed</div>
        <div className="speed-buttons">
          {([0.5, 1, 2] as const).map((v) => (
            <button key={v} type="button" onClick={() => set('speedMultiplier', v)} className={`control-button ${speed === v ? 'active' : ''}`}>
              {v}x
            </button>
          ))}
        </div>
      </div>
      <div className="control-group">
        <SliderRow
          label="Input Lag"
          value={inputLag}
          display={`${inputLag} ms`}
          min={0}
          max={1000}
          step={10}
          defaultValue={DEF.inputLagMs}
          onChange={(v) => set('inputLagMs', v)}
          resetLabel="Reset input lag to default"
          ariaLabel="Input lag in milliseconds"
          ariaValueText={`${inputLag} milliseconds`}
        />
      </div>
      <div className="control-group control-group--no-border">
        <SettingRow isModified={autoAdvance !== DEF.autoAdvance} onReset={() => set('autoAdvance', DEF.autoAdvance)}>
          <Checkbox checked={autoAdvance} onChange={(v) => set('autoAdvance', v)} label="Auto-Advance" />
        </SettingRow>
        <SettingRow isModified={pause !== DEF.pauseWhenUnfocused} onReset={() => set('pauseWhenUnfocused', DEF.pauseWhenUnfocused)}>
          <Checkbox checked={pause} onChange={(v) => set('pauseWhenUnfocused', v)} label="Pause simulator when unfocused" />
        </SettingRow>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------


const FPS_OPTIONS = [
  { value: 0, label: 'Uncapped' },
  { value: 144, label: '144 FPS' },
  { value: 120, label: '120 FPS' },
  { value: 90, label: '90 FPS' },
  { value: 60, label: '60 FPS' },
  { value: 30, label: '30 FPS' },
]

function DisplaySection({ gpuStatus }: { gpuStatus: 'hardware' | 'software' }) {
  const renderer = useSetting('rendererType')
  const smooth = useSetting('smoothTerrain')
  const brightness = useSetting('brightness')
  const contrast = useSetting('contrast')
  const saturation = useSetting('saturation')
  const scaleKey = gpuStatus === 'hardware' ? 'renderScaleHardware' : 'renderScaleSoftware'
  const renderScale = useSetting(scaleKey)
  const fpsCap = useSetting('fpsCap')
  return (
    <div className="controls-container">
      <div className="control-group">
        <div className="group-title">View Mode</div>
        <SettingRow isModified={renderer !== DEF.rendererType} onReset={() => set('rendererType', DEF.rendererType)}>
          <select value={renderer} onChange={(e) => set('rendererType', e.target.value === 'canvas2d' ? 'canvas2d' : 'webgl')} className="select-input">
            <option value="webgl">3D View (WebGL)</option>
            <option value="canvas2d">2D View (Debug)</option>
          </select>
        </SettingRow>
        {renderer === 'canvas2d' && (
          <p className="view-mode-note setting-row-aside" role="status">
            2D view is a debugging aid, not intended to be fully playable.
          </p>
        )}
      </div>
      <div className="control-group">
        <div className="group-title">Display Options</div>
        <SettingRow isModified={smooth !== DEF.smoothTerrain} onReset={() => set('smoothTerrain', DEF.smoothTerrain)}>
          <Checkbox checked={smooth} onChange={(v) => set('smoothTerrain', v)} label="Smooth Terrain" />
        </SettingRow>
        <SliderRow label="Brightness" value={brightness} display={brightness.toFixed(2)} min={0.4} max={1.2} step={0.05} defaultValue={DEF.brightness} onChange={(v) => set('brightness', v)} resetLabel="Reset brightness to default" />
        <SliderRow label="Contrast" value={contrast} display={contrast.toFixed(2)} min={0.5} max={2} step={0.05} defaultValue={DEF.contrast} onChange={(v) => set('contrast', v)} resetLabel="Reset contrast to default" />
        <SliderRow label="Saturation" value={saturation} display={saturation.toFixed(2)} min={0} max={2} step={0.05} defaultValue={DEF.saturation} onChange={(v) => set('saturation', v)} resetLabel="Reset saturation to default" />
        <SliderRow
          label="Render Scale"
          value={renderScale}
          display={renderScale.toFixed(2)}
          min={0.25}
          max={1}
          step={0.05}
          defaultValue={DEF.renderScaleHardware}
          onChange={(v) => set(scaleKey, v)}
          resetLabel="Reset render scale to default"
        />
      </div>
      <div className="control-group">
        <div className="group-title">FPS Cap</div>
        <SettingRow isModified={fpsCap !== DEF.fpsCap} onReset={() => set('fpsCap', DEF.fpsCap)}>
          <select value={fpsCap} onChange={(e) => set('fpsCap', Number(e.target.value))} className="select-input" aria-label="Frame rate cap">
            {FPS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </SettingRow>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------


const LAYOUTS: { id: ClientLayoutMode; label: string }[] = [
  { id: 'fixed', label: 'Fixed' },
  { id: 'classic', label: 'Resizable - Classic layout' },
  { id: 'modern', label: 'Resizable - Modern layout' },
]


export const VIEWPORT_PRESETS = [
  { id: 'osrs-fixed', label: 'OSRS Fixed (765 × 503)', width: 765, height: 503 },
  { id: 'hd-720', label: '720p (1280 × 720)', width: 1280, height: 720 },
  { id: 'hd-1080', label: '1080p (1920 × 1080)', width: 1920, height: 1080 },
]
const MAX_VIEWPORT = 7680
/** scim: fixed layout multipliers. */
const FIXED_SCALES = [1, 1.5, 2, 2.5, 3]
const FIXED_W = 765
const FIXED_H = 503

function fixedSize(mult: number): { width: number; height: number } {
  const width = Math.round(FIXED_W * mult)
  return { width, height: Math.round(FIXED_H * (width / FIXED_W)) }
}


export const RESOURCE_PACKS: { id: ResourcePackId; name: string; description: string; author?: string; authorUrl?: string }[] = [
  { id: 'pack-vanilla', name: 'Vanilla', description: 'Default OSRS interface' },
  { id: 'pack-browntown', name: 'Brown Theme', description: 'Warm brown classic OSRS look', author: 'Nichy' },
  { id: 'pack-toblite', name: 'TOBLite', description: 'Theatre of Blood inspired dark theme', author: 'Sayolko', authorUrl: 'https://sayolko.framer.website' },
  { id: 'pack-duckscape', name: 'Duckscape', description: 'Playful duck-themed interface', author: 'Sayolko', authorUrl: 'https://sayolko.framer.website' },
]

const PIN_TARGETS: [InfoboxPinTarget, string][] = [
  ['hud', 'HUD'],
  ['inventory', 'Inventory'],
  ['free', 'Free'],
]


function pinUnavailable(target: InfoboxPinTarget, layout: ClientLayoutMode): string | null {
  return target === 'inventory' && layout === 'fixed' ? 'Inventory does not work in Fixed mode.' : null
}

function PinIcon({ target }: { target: InfoboxPinTarget }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true" focusable="false">
      <rect x="2" y="3" width="14" height="12" rx="1.6" stroke="currentColor" strokeWidth="1.2" {...(target === 'free' ? { strokeDasharray: '2.4 1.8' } : {})} />
      {target === 'hud' && <rect x="3.4" y="10.6" width="5" height="2.6" rx="0.8" fill="currentColor" />}
      {target === 'inventory' && <rect x="9.6" y="10.6" width="5" height="2.6" rx="0.8" fill="currentColor" />}
      {target === 'free' && <rect x="6.5" y="7.4" width="5" height="2.6" rx="0.8" fill="currentColor" />}
    </svg>
  )
}

function ViewportControls({ viewportSizeWarning }: { viewportSizeWarning: { width: number; height: number; replay?: boolean } | null }) {
  const layout = useSetting('clientLayoutMode')
  const res = useSetting('gameResolution')
  const fixedScale = useSetting('fixedLayoutScale')
  const [w, setW] = useState(String(res.width))
  const [h, setH] = useState(String(res.height))
  useEffect(() => setW(String(res.width)), [res.width])
  useEffect(() => setH(String(res.height)), [res.height])
  const defRes = DEF.gameResolution
  const resModified = res.mode !== defRes.mode || res.width !== defRes.width || res.height !== defRes.height || res.presetId !== defRes.presetId
  const setRes = (g: GameResolution) => set('gameResolution', g)
  const choosePreset = (id: string) => {
    if (id === 'fit') return setRes({ ...defRes })
    if (id === 'custom') return setRes({ mode: 'fixed', width: res.mode === 'fixed' ? res.width : defRes.width, height: res.mode === 'fixed' ? res.height : defRes.height, presetId: 'custom' })
    const p = VIEWPORT_PRESETS.find((x) => x.id === id)
    if (p) setRes({ mode: 'fixed', width: p.width, height: p.height, presetId: p.id })
  }
  const clampDim = (v: number) => Math.round(Math.max(320, Math.min(MAX_VIEWPORT, v)))
  const commitW = (text: string) => {
    const n = Number.parseInt(text, 10)
    const v = Number.isFinite(n) ? clampDim(n) : res.width
    setW(String(v))
    if (v !== res.width) setRes({ mode: 'fixed', width: v, height: res.height, presetId: 'custom' })
  }
  const commitH = (text: string) => {
    const n = Number.parseInt(text, 10)
    const v = Number.isFinite(n) ? clampDim(n) : res.height
    setH(String(v))
    if (v !== res.height) setRes({ mode: 'fixed', width: res.width, height: v, presetId: 'custom' })
  }
  // Fixed layout scale
  const [customScale, setCustomScale] = useState(() => typeof fixedScale === 'number' && !FIXED_SCALES.includes(fixedScale))
  const [scaleDraft, setScaleDraft] = useState(() => String(typeof fixedScale === 'number' ? fixedScale : 1))
  useEffect(() => {
    setScaleDraft(String(typeof fixedScale === 'number' ? fixedScale : 1))
    if (fixedScale === 'fit') setCustomScale(false)
    else if (!FIXED_SCALES.includes(fixedScale)) setCustomScale(true)
  }, [fixedScale])
  const scaleValue = fixedScale === 'fit' ? 'fit' : customScale ? 'custom' : String(fixedScale)
  const chooseScale = (v: string) => {
    if (v === 'fit') {
      setCustomScale(false)
      set('fixedLayoutScale', 'fit')
      return
    }
    if (v === 'custom') {
      setCustomScale(true)
      if (typeof fixedScale !== 'number') set('fixedLayoutScale', 1)
      return
    }
    const m = FIXED_SCALES.find((x) => String(x) === v)
    if (m !== undefined) {
      setCustomScale(false)
      set('fixedLayoutScale', m)
    }
  }
  const commitScale = (text: string) => {
    const n = Number.parseFloat(text)
    const cur = typeof fixedScale === 'number' ? fixedScale : 1
    const v = Number.isFinite(n) ? Math.round(Math.max(0.5, Math.min(6, n)) * 100) / 100 : cur
    setScaleDraft(String(v))
    if (v !== fixedScale) set('fixedLayoutScale', v)
  }
  const scaled = fixedSize(typeof fixedScale === 'number' ? fixedScale : 1)
  return (
    <>
      <div className="control-group">
        <div className="group-title">Layout</div>
        <SettingRow isModified={layout !== 'modern'} onReset={() => set('clientLayoutMode', 'modern')}>
          <select id="client-layout-mode" value={layout} onChange={(e) => set('clientLayoutMode', e.target.value as ClientLayoutMode)} className="select-input" aria-label="Client layout">
            {LAYOUTS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </SettingRow>
      </div>
      <div className="control-group">
        <div className="group-title">Viewport</div>
        {layout === 'fixed' ? (
          <>
            <SettingRow isModified={fixedScale !== DEF.fixedLayoutScale} onReset={() => chooseScale('fit')}>
              <select id="fixed-scale-preset" value={scaleValue} onChange={(e) => chooseScale(e.target.value)} className="select-input" aria-label="Fixed layout scale">
                <option value="fit">Fit Window</option>
                {FIXED_SCALES.map((m) => {
                  const s = fixedSize(m)
                  return (
                    <option key={m} value={String(m)}>{`${m}× (${s.width} × ${s.height})`}</option>
                  )
                })}
                <option value="custom">Custom…</option>
              </select>
            </SettingRow>
            {scaleValue === 'custom' && (
              <SettingRow isModified={false} onReset={() => {}} hideReset>
                <div className="viewport-dimensions">
                  <input
                    type="number"
                    className="viewport-dimensions__input"
                    min={0.5}
                    max={6}
                    step={0.05}
                    value={scaleDraft}
                    onChange={(e) => setScaleDraft(e.target.value)}
                    onBlur={(e) => commitScale(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                    }}
                    aria-label="Fixed layout scale multiplier"
                  />
                  <span className="viewport-dimensions__sep" aria-hidden="true">
                    ×
                  </span>
                  <span className="viewport-dimensions__suffix">{`${scaled.width} × ${scaled.height} px`}</span>
                </div>
              </SettingRow>
            )}
            <div className="settings-hint">
              The fixed client is {FIXED_W} × {FIXED_H} and keeps those proportions, so it is sized by a multiple rather than by a resolution. Choose Fit Window to resize it with the window.
            </div>
          </>
        ) : (
          <>
            <SettingRow isModified={resModified} onReset={() => setRes({ ...defRes })}>
              <select id="viewport-preset" value={res.presetId} onChange={(e) => choosePreset(e.target.value)} className="select-input" aria-label="Viewport resolution">
                <option value="fit">Fit Window</option>
                {VIEWPORT_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
                <option value="custom">Custom…</option>
              </select>
            </SettingRow>
            {res.presetId === 'custom' && (
              <SettingRow isModified={false} onReset={() => {}} hideReset>
                <div className="viewport-dimensions">
                  <input
                    type="number"
                    className="viewport-dimensions__input"
                    min={320}
                    max={MAX_VIEWPORT}
                    step={1}
                    value={w}
                    onChange={(e) => setW(e.target.value)}
                    onBlur={(e) => commitW(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                    }}
                    aria-label="Width in pixels"
                  />
                  <span className="viewport-dimensions__sep" aria-hidden="true">
                    ×
                  </span>
                  <input
                    type="number"
                    className="viewport-dimensions__input"
                    min={320}
                    max={MAX_VIEWPORT}
                    step={1}
                    value={h}
                    onChange={(e) => setH(e.target.value)}
                    onBlur={(e) => commitH(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                    }}
                    aria-label="Height in pixels"
                  />
                  <span className="viewport-dimensions__suffix" aria-hidden="true">
                    px
                  </span>
                </div>
              </SettingRow>
            )}
          </>
        )}
        {viewportSizeWarning && (
          <div className="viewport-warning" role="status">
            <div className="viewport-warning__title">
              Window too small for {viewportSizeWarning.width}×{viewportSizeWarning.height}
            </div>
            <p className="viewport-warning__detail">
              {viewportSizeWarning.replay
                ? 'The replay keeps its recorded size. Enlarge the window or choose Fit Window.'
                : 'The viewport keeps its selected size. Enlarge the window, pick a smaller size, or choose Fit Window.'}
            </p>
          </div>
        )}
      </div>
    </>
  )
}

function InterfaceSection({
  isMobile,
  viewportSizeWarning,
  onOpenPopout,
  isPopoutWindow,
}: {
  isMobile: boolean
  viewportSizeWarning: { width: number; height: number; replay?: boolean } | null
  onOpenPopout: (() => void) | undefined
  isPopoutWindow: boolean
}) {
  const layout = useSetting('clientLayoutMode')
  const pack = useSetting('activeResourcePack')
  const pin = useSetting('infoboxPinTarget')
  const outline = useSetting('infoboxTextOutlineEnabled')
  const outlineColor = useSetting('infoboxTextOutlineColor')
  const hints = useSetting('showShortcutHints')
  const effectivePin = pinUnavailable(pin, layout) ? 'hud' : pin
  const unavailable = PIN_TARGETS.map(([t]) => pinUnavailable(t, layout)).filter((x): x is string => x !== null)
  const packInfo = RESOURCE_PACKS.find((p) => p.id === pack) ?? RESOURCE_PACKS[0]!
  return (
    <>
      {!isMobile && <ViewportControls viewportSizeWarning={viewportSizeWarning} />}
      <div className="control-group">
        <div className="group-title">Resource Pack</div>
        <SettingRow isModified={pack !== DEF.activeResourcePack} onReset={() => set('activeResourcePack', DEF.activeResourcePack)}>
          <select
            className="select-input"
            value={pack}
            onChange={(e) => {
              const v = e.target.value
              set('activeResourcePack', RESOURCE_PACKS.some((p) => p.id === v) ? (v as ResourcePackId) : 'pack-vanilla')
            }}
          >
            {RESOURCE_PACKS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </SettingRow>
        <div className="settings-hint">{packInfo.description}</div>
        {packInfo.author && (
          <div style={{ fontSize: '11px', color: 'var(--color-text-muted)', marginTop: 2 }}>
            In RuneLite Resource Packs /{' '}
            {packInfo.authorUrl ? (
              <a
                href={packInfo.authorUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--color-secondary)', textDecoration: 'none' }}
                title={`Find this pack in RuneLite Resource Packs. More from ${packInfo.author}.`}
              >
                More by {packInfo.author}
              </a>
            ) : (
              <>By {packInfo.author}</>
            )}
          </div>
        )}
      </div>
      <div className="control-group">
        <div className="group-title">Infoboxes</div>
        <div className="infobox-field">
          <div className="settings-field-label">Position</div>
          <SettingRow isModified={pin !== DEF.infoboxPinTarget} onReset={() => set('infoboxPinTarget', DEF.infoboxPinTarget)}>
            <div className="infobox-pin-segmented" role="radiogroup" aria-label="Infobox position">
              {PIN_TARGETS.map(([t, label]) => {
                const why = pinUnavailable(t, layout)
                return (
                  <button
                    key={t}
                    type="button"
                    role="radio"
                    aria-checked={effectivePin === t}
                    disabled={why !== null}
                    title={why ?? undefined}
                    className={`infobox-pin-segment${effectivePin === t ? ' is-active' : ''}`}
                    onClick={() => set('infoboxPinTarget', t)}
                  >
                    <PinIcon target={t} />
                    <span className="infobox-pin-segment__label">{label}</span>
                  </button>
                )
              })}
            </div>
          </SettingRow>
          <div className="settings-hint">
            {effectivePin === 'hud'
              ? 'Infoboxes stack above the HUD, matched to its width.'
              : effectivePin === 'inventory'
                ? 'Infoboxes sit above the inventory panel (bottom-right).'
                : 'Infoboxes float free: drag them anywhere with Alt.'}
          </div>
          {unavailable.map((u) => (
            <div key={u} className="settings-hint settings-hint--unavailable">
              {u}
            </div>
          ))}
        </div>
        <div className="infobox-field">
          <SettingRow
            isModified={outline !== DEF.infoboxTextOutlineEnabled || (outline && outlineColor !== DEF.infoboxTextOutlineColor)}
            onReset={() => settingsStore.patch({ infoboxTextOutlineEnabled: DEF.infoboxTextOutlineEnabled, infoboxTextOutlineColor: DEF.infoboxTextOutlineColor })}
          >
            <div className="settings-inline-row">
              <Checkbox checked={outline} label="Text outline" onChange={(v) => set('infoboxTextOutlineEnabled', v)} />
              {outline && (
                <span className="infobox-outline-colour">
                  <span className="infobox-outline-colour__label">Color</span>
                  <ColorSwatch color={outlineColor} onCommit={(c) => set('infoboxTextOutlineColor', c)} />
                </span>
              )}
            </div>
          </SettingRow>
          <div className="settings-hint">Outlines infobox values so they stay legible over bright item icons.</div>
        </div>
      </div>
      {!isMobile && (
        <div className="control-group viewport-popout">
          <button
            type="button"
            className="control-button viewport-popout__button"
            onClick={onOpenPopout}
            disabled={!onOpenPopout || isPopoutWindow}
            title={isPopoutWindow ? 'Already in popout window' : 'Open the game in a separate window'}
          >
            <span>{isPopoutWindow ? 'Popout Active' : 'Pop Out Game'}</span>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M4.5 1.5H1.5V10.5H10.5V7.5M7 1.5H10.5V5M10.5 1.5L5.5 6.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <p className="viewport-popout__hint">{isPopoutWindow ? 'Close this window to return to the main view.' : 'Opens in a new window sized to the current resolution.'}</p>
        </div>
      )}
      <div className="control-group">
        <SettingRow isModified={hints !== DEF.showShortcutHints} onReset={() => set('showShortcutHints', DEF.showShortcutHints)}>
          <Checkbox
            checked={hints}
            onChange={(v) => settingsStore.patch(v ? { showShortcutHints: true, disabledShortcutHints: [] } : { showShortcutHints: false })}
            label="Show Shortcut Hints"
          />
        </SettingRow>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export interface SettingsPanelProps {
  /** Ctrl+R restart (runtime.restart). */
  onRestart?: () => void
  /** True while the intro plays (scim disables the button). */
  restartDisabled?: boolean
  /** Which render-scale key the slider edits (scim picks by GPU status). */
  gpuStatus?: 'hardware' | 'software'
  viewportSizeWarning?: { width: number; height: number; replay?: boolean } | null
  onOpenPopout?: () => void
  isPopoutWindow?: boolean
  /** Title button (scim opens Credits). */
  onOpenCredits?: () => void
}

export function SettingsPanel({ onRestart, restartDisabled = false, gpuStatus = 'hardware', viewportSizeWarning = null, onOpenPopout, isPopoutWindow = false, onOpenCredits }: SettingsPanelProps) {
  const visible = useMenuState((s) => s.settings)
  const isMobile = useIsMobile()
  const close = () => menuController.close('settings')
  useEscapeLayer(ESC_PRIORITY.SETTINGS, visible, close)
  return (
    <>
      <div className={`controls-overlay-shadow ${visible ? 'open' : ''}`} aria-hidden="true" />
      <aside className={`controls-overlay ${visible ? 'open' : ''}`} inert={!visible || undefined}>
        <div className="panel-header">
          <div className="panel-header-left">
            <div className="panel-title-stack">
              <h2 className="panel-title">
                <button type="button" className="panel-title--clickable" onClick={onOpenCredits} title="Credits">
                  {APP_TITLE}
                </button>
              </h2>
              {isMobile && (
                <span className="panel-mode-badge" title="Settings on this device are stored separately from your desktop preferences. Changes here only affect mobile.">
                  Mobile preferences
                </span>
              )}
            </div>
            <div className="panel-header-icons">
              <button type="button" className="panel-header-action" onClick={() => menuController.open('shortcuts')} title="Keyboard Shortcuts" aria-label="Keyboard Shortcuts">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
                  <rect x="1" y="4" width="14" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M4 7h.01M7 7h.01M10 7h.01M5.5 9.5h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>
          <button type="button" className="panel-close-button" onClick={close} title="Close Settings">
            <CloseIcon />
          </button>
        </div>
        <div className="controls-content">
          <div className="settings-zone-divider" aria-hidden="true">
            <span className="settings-zone-label">Game</span>
          </div>
          <div className="settings-zone">
            <Collapsible title="Simulation">
              <SimulationSection onRestart={onRestart} restartDisabled={restartDisabled} />
            </Collapsible>
            <Collapsible title="Display">
              <DisplaySection gpuStatus={gpuStatus} />
            </Collapsible>
            <div data-tutorial="interface-section">
              <Collapsible title="Interface">
                <InterfaceSection isMobile={isMobile} viewportSizeWarning={viewportSizeWarning} onOpenPopout={onOpenPopout} isPopoutWindow={isPopoutWindow} />
              </Collapsible>
            </div>
          </div>
          <div className="settings-zone-divider" aria-hidden="true">
            <span className="settings-zone-label">Privacy</span>
          </div>
          <div className="settings-zone">
            <Collapsible title="Crash Reports">
              <div className="control-group control-group--no-border">
                <Checkbox checked={false} label="Send crash reports" onChange={() => {}} disabled />
                <div className="settings-hint">This offline build never sends crash reports or any other data.</div>
              </div>
            </Collapsible>
          </div>
          <div className="settings-zone-divider settings-zone-divider--footer" aria-hidden="true">
            <span className="settings-zone-label">Legal</span>
          </div>
          <footer className="settings-legal">
            <p className="settings-legal__lede">Not affiliated with Jagex</p>
            <p className="settings-legal__body">This simulator is an unofficial, fan-made project. It is not endorsed by or affiliated with Jagex Limited.</p>
            <p className="settings-legal__fine">
              Jagex, RuneScape, and Old School RuneScape are registered and/or unregistered trademarks of Jagex Limited. All game assets remain its property, all rights reserved.
            </p>
          </footer>
        </div>
      </aside>
    </>
  )
}
