/**
 * Plugins panel (scim, row, placement block
 * `E6`, tick colour chips `lye`/`sye`/`cye`). Bound to
 * `settingsStore` and the plugin stores. The Zuk-only Set Timer row is
 * omitted; tile/line marker presets are hidden (none for this encounter).
 */
import './styles/tokens.css'
import './styles/controls.css'
import './styles/settings.css'
import './styles/plugins-panel.css'
import { useState, type ReactNode } from 'react'
import {
  antiDragStore,
  bossHealthBarStore,
  DEFAULT_TILE_INDICATORS,
  inventoryTagsStore,
  lineMarkersStore,
  npcHighlightsStore,
  tileIndicatorsStore,
  tileMarkersStore,
  usePluginStore,
  xpDropsStore,
  type TileIndicatorsSettings,
  type TileIndicatorStyle,
} from '../../app/plugins/stores'
import { DEFAULT_SETTINGS, settingsStore, useSettings, type Settings } from '../../app/settings/settings'
import { exportGroundMarkers, importGroundMarkers, mergeMarkers } from '../plugins/groundMarkers'
import { defaultTickColor, resetTickColor, setAllTickColors, setTickColor, tickColor, tickRange, uniformTickColor, type TickColorOverrides } from '../plugins/tickCounter'
import { Caret, Checkbox, CloseIcon, ColorSwatch, NumInput, OsrsButton, SettingRow, Toggle, stopNonLeft, useColorDraft } from './controls'
import { ENCOUNTER_KEY } from './encounter'
import { ESC_PRIORITY, useEscapeLayer } from './escape'
import { copyToClipboard, readClipboard } from './inventorySetups'
import { menuController, useMenuState } from './menuState'
import { PACK_PATHS, PackImg } from './packAssets'
import { DEFAULT_ORB_ORDER, groupNpcHighlights, isDefaultOrbOrder, NPC_MODE_LABELS, ORB_LABELS, ORB_LAYOUT_LABELS, ORB_LAYOUTS, orbSlotClick, UI_SCALES, type OrbLayout } from './pluginLogic'

const D = DEFAULT_SETTINGS

function set<K extends keyof Settings>(key: K, value: Settings[K]): void {
  settingsStore.patch({ [key]: value } as Partial<Settings>)
}

function flip(key: keyof Settings): void {
  settingsStore.patch({ [key]: !settingsStore.get()[key] } as Partial<Settings>)
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

function PluginRow({
  label,
  isOn,
  onToggle,
  hasSettings = false,
  expanded,
  onToggleExpand,
  toggleDisabled,
  dimSettingsWhenOff = true,
  children,
}: {
  label: string
  isOn?: boolean
  onToggle?: () => void
  hasSettings?: boolean
  expanded?: boolean
  onToggleExpand?: () => void
  toggleDisabled?: boolean
  dimSettingsWhenOff?: boolean
  children?: ReactNode
}) {
  return (
    <div className={`plugin-row ${expanded ? 'expanded' : ''}`}>
      <div className="plugin-header">
        <button type="button" className="plugin-title-btn" onClick={hasSettings ? onToggleExpand : toggleDisabled ? undefined : onToggle}>
          {hasSettings ? <Caret className="plugin-caret" /> : <span className="plugin-caret" style={{ visibility: 'hidden' }} />}
          <span className="plugin-name">{label}</span>
        </button>
        {onToggle && <Toggle checked={!!isOn} onChange={() => onToggle()} disabled={toggleDisabled} size="default" accessibleLabel={label} />}
      </div>
      {hasSettings && expanded && (
        <div className="plugin-body" style={{ opacity: dimSettingsWhenOff && isOn === false ? 0.4 : 1, transition: 'opacity 0.15s ease' }}>
          {children}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Overhead placement block
// ---------------------------------------------------------------------------

interface Placement {
  fontSize: number
  abovePrayerIcon: boolean
  offsetX: number
  offsetY: number
}

function PlacementBlock({
  placement,
  defaults,
  disabled,
  onAbove,
  onOffset,
  onFontSize,
}: {
  placement: Placement
  defaults: Placement
  disabled: boolean
  onAbove: () => void
  onOffset: (axis: 'x' | 'y', v: number) => void
  onFontSize: (v: number) => void
}) {
  return (
    <>
      <SettingRow isModified={placement.abovePrayerIcon !== defaults.abovePrayerIcon} onReset={() => placement.abovePrayerIcon !== defaults.abovePrayerIcon && onAbove()}>
        <Checkbox label="Show Above Prayer Icon" checked={placement.abovePrayerIcon} onChange={() => onAbove()} disabled={disabled} />
      </SettingRow>
      <SettingRow
        isModified={placement.offsetX !== defaults.offsetX || placement.offsetY !== defaults.offsetY}
        onReset={() => {
          onOffset('x', defaults.offsetX)
          onOffset('y', defaults.offsetY)
        }}
      >
        <div className="plugin-setting-row">
          <span className="plugin-setting-label">Offset:</span>
          <div className={`tick-offset-fields${disabled ? ' is-disabled' : ''}`}>
            {(
              [
                ['x', placement.offsetX],
                ['y', placement.offsetY],
              ] as const
            ).map(([axis, v]) => (
              <span key={axis} className="tick-offset-field">
                <span className="tick-offset-axis" aria-hidden="true">
                  {axis}
                </span>
                <NumInput
                  min={-200}
                  max={200}
                  fieldWidth={34}
                  value={v}
                  disabled={disabled}
                  onChange={(e) => {
                    const n = Number.parseInt(e.target.value, 10)
                    if (!Number.isNaN(n) && Math.abs(n) <= 200) onOffset(axis, n)
                  }}
                />
              </span>
            ))}
          </div>
        </div>
      </SettingRow>
      <SettingRow isModified={placement.fontSize !== defaults.fontSize} onReset={() => onFontSize(defaults.fontSize)}>
        <div className="plugin-setting-row">
          <span className="plugin-setting-label">Font Size:</span>
          <NumInput
            min={8}
            max={72}
            value={placement.fontSize}
            disabled={disabled}
            onChange={(e) => {
              const n = Number.parseInt(e.target.value, 10)
              if (!Number.isNaN(n) && n >= 8 && n <= 72) onFontSize(n)
            }}
          />
        </div>
      </SettingRow>
    </>
  )
}

// ---------------------------------------------------------------------------
// Tick colour chips
// ---------------------------------------------------------------------------

function TickChip({ tick, max, overrides, markCustom, onCommit, onReset }: { tick: number; max: number; overrides: TickColorOverrides; markCustom: boolean; onCommit: (t: number, c: string) => void; onReset: (t: number) => void }) {
  const color = tickColor(tick, max, overrides)
  const custom = markCustom && overrides[String(tick)] !== undefined
  const { draft, setDraft, inputRef } = useColorDraft(color, (c) => onCommit(tick, c))
  return (
    <label
      className={`tick-color-chip${custom ? ' is-custom' : ''}`}
      title={`Tick ${tick} of ${max}. Click to set a color, right-click to restore ${defaultTickColor(tick, max)}.`}
      onContextMenu={(e) => {
        e.preventDefault()
        onReset(tick)
      }}
    >
      <span className="tick-color-chip__glyph" style={{ color: draft }}>
        {tick}
      </span>
      <input ref={inputRef} type="color" value={draft} aria-label={`Color for tick ${tick}`} onInput={(e) => setDraft(e.currentTarget.value)} onMouseDown={stopNonLeft} />
    </label>
  )
}

function TickAllChip({ max, uniform, onCommit }: { max: number; uniform: string | null; onCommit: (c: string) => void }) {
  const { draft, setDraft, inputRef } = useColorDraft(uniform ?? defaultTickColor(1, max), onCommit)
  return (
    <label className="tick-color-all" title={`Set all ${max} ticks to one color.`}>
      <span className="tick-color-all__label" style={uniform !== null ? { color: draft } : undefined}>
        All
      </span>
      <input ref={inputRef} type="color" value={draft} aria-label="Color for every tick" onInput={(e) => setDraft(e.currentTarget.value)} onMouseDown={stopNonLeft} />
    </label>
  )
}

function TickColorControls({ max, colors, onChange }: { max: number; colors: TickColorOverrides; onChange: (c: TickColorOverrides) => void }) {
  const ticks = tickRange(max)
  const allSet = ticks.length > 0 && ticks.every((t) => colors[String(t)] !== undefined)
  return (
    <div className="tick-color-controls">
      <TickAllChip max={max} uniform={uniformTickColor(max, colors)} onCommit={(c) => onChange(setAllTickColors(max, c))} />
      <div className="tick-color-chips">
        {ticks.map((t) => (
          <TickChip
            key={t}
            tick={t}
            max={max}
            overrides={colors}
            markCustom={!allSet}
            onCommit={(tick, c) => onChange(setTickColor(colors, tick, c))}
            onReset={(tick) => {
              const next = resetTickColor(colors, tick)
              if (next !== colors) onChange(next)
            }}
          />
        ))}
      </div>
    </div>
  )
}

function OrbLayoutIcon({ layout }: { layout: OrbLayout }) {
  const pts =
    layout === 'vertical'
      ? [
          [9, 2.8],
          [9, 7.2],
          [9, 11.6],
          [9, 16],
        ]
      : layout === 'horizontal'
        ? [
            [6.2, 6.2],
            [6.2, 11.8],
            [11.8, 6.2],
            [11.8, 11.8],
          ]
        : [
            [2.8, 9],
            [7.2, 9],
            [11.6, 9],
            [16, 9],
          ]
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true" focusable="false">
      {pts.map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="1.7" fill="currentColor" />
      ))}
    </svg>
  )
}

const EMPTY_HINT = (what: string) => (
  <div className="tile-marker-panel-empty">
    <kbd className="kbd">Shift + Right-click</kbd> {what}
  </div>
)

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export interface PluginsPanelProps {
  /** Markers are read-only while a replay draws its own. */
  markersReadOnly?: boolean
}

export function PluginsPanel({ markersReadOnly = false }: PluginsPanelProps) {
  const visible = useMenuState((s) => s.plugins)
  const close = () => menuController.close('plugins')
  useEscapeLayer(ESC_PRIORITY.PLUGINS, visible, close)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [widthDrafts, setWidthDrafts] = useState<Record<string, string>>({})
  const [lineWidthDraft, setLineWidthDraft] = useState<string | null>(null)
  const [markerWidthDraft, setMarkerWidthDraft] = useState<string | null>(null)
  const [orbSelected, setOrbSelected] = useState<string | null>(null)
  const [ioStatus, setIoStatus] = useState<string | null>(null)
  const ex = (k: string) => ({ expanded: expanded[k] ?? false, onToggleExpand: () => setExpanded((e) => ({ ...e, [k]: !e[k] })) })

  const s = useSettings((x) => x)
  const fixedLayout = s.clientLayoutMode === 'fixed'
  const antiDrag = usePluginStore(antiDragStore, (x) => x)
  const boss = usePluginStore(bossHealthBarStore, (x) => x)
  const xp = usePluginStore(xpDropsStore, (x) => x)
  const tags = usePluginStore(inventoryTagsStore, (x) => x)
  const lines = usePluginStore(lineMarkersStore, (x) => x)
  const markers = usePluginStore(tileMarkersStore, (x) => x)
  const npc = usePluginStore(npcHighlightsStore, (x) => x)
  const ti = usePluginStore(tileIndicatorsStore, (x) => x)
  const myLines = lines.linesByEncounter[ENCOUNTER_KEY] ?? []
  const myMarkers = markers.markersByEncounter[ENCOUNTER_KEY] ?? []
  const npcGroups = groupNpcHighlights(npc.highlights)
  const tagCount = Object.keys(tags.tags).length

  const setMarkers = (list: typeof myMarkers) => tileMarkersStore.patch({ markersByEncounter: { ...markers.markersByEncounter, [ENCOUNTER_KEY]: list } })
  const setLines = (list: typeof myLines) => lineMarkersStore.patch({ linesByEncounter: { ...lines.linesByEncounter, [ENCOUNTER_KEY]: list } })
  const flashStatus = (msg: string) => {
    setIoStatus(msg)
    window.setTimeout(() => setIoStatus((cur) => (cur === msg ? null : cur)), 3000)
  }
  const updateTi = (key: keyof TileIndicatorsSettings['config'], field: keyof TileIndicatorStyle, value: TileIndicatorStyle[keyof TileIndicatorStyle]) => {
    const cur = tileIndicatorsStore.get()
    tileIndicatorsStore.patch({ config: { ...cur.config, [key]: { ...cur.config[key], [field]: value } } })
  }

  return (
    <>
      <div className={`plugins-overlay-shadow ${visible ? 'open' : ''}`} aria-hidden="true" />
      <aside
        className={`plugins-overlay ${visible ? 'open' : ''}`}
        inert={!visible || undefined}
        onTransitionEnd={(e) => {
          if (e.target === e.currentTarget && e.propertyName === 'transform') window.dispatchEvent(new CustomEvent(visible ? 'tutorial:plugins-opened' : 'tutorial:plugins-closed'))
        }}
      >
        <div className="panel-header">
          <h2 className="panel-title">Plugins</h2>
          <button type="button" className="panel-close-button" onClick={close} aria-label="Close plugins">
            <CloseIcon />
          </button>
        </div>
        <div className="plugins-content">
          {/* Anti Drag */}
          <PluginRow label="Anti Drag" isOn={antiDrag.enabled} onToggle={() => antiDragStore.patch({ enabled: !antiDrag.enabled })} hasSettings {...ex('antiDrag')}>
            <SettingRow isModified={antiDrag.requireShift} onReset={() => antiDragStore.patch({ requireShift: false })}>
              <Checkbox label="Require Shift to drag" checked={antiDrag.requireShift} onChange={(v) => antiDragStore.patch({ requireShift: v })} />
            </SettingRow>
            <SettingRow isModified={!antiDrag.ctrlDragImmediately} onReset={() => antiDragStore.patch({ ctrlDragImmediately: true })}>
              <Checkbox label="Ctrl to drag immediately" checked={antiDrag.ctrlDragImmediately} onChange={(v) => antiDragStore.patch({ ctrlDragImmediately: v })} />
            </SettingRow>
            <SettingRow isModified={antiDrag.dragDelay !== 300} onReset={() => antiDragStore.patch({ dragDelay: 300 })}>
              <div className="plugin-setting-row" style={{ opacity: antiDrag.requireShift ? 0.4 : 1 }}>
                <span className="plugin-setting-label">Drag delay:</span>
                <NumInput
                  min={0}
                  max={2000}
                  value={antiDrag.dragDelay}
                  fieldWidth={40}
                  disabled={antiDrag.requireShift}
                  onChange={(e) => {
                    const n = Number.parseInt(e.target.value, 10)
                    if (!Number.isNaN(n) && n >= 0 && n <= 2000) antiDragStore.patch({ dragDelay: n })
                  }}
                />
                <span className="plugin-setting-label" style={{ marginLeft: 2 }}>
                  ms
                </span>
              </div>
            </SettingRow>
          </PluginRow>

          {/* Attack Timer Metronome */}
          <PluginRow label="Attack Timer Metronome" isOn={s.attackTimerMetronomeEnabled} onToggle={() => flip('attackTimerMetronomeEnabled')} hasSettings {...ex('attackTimerMetronome')}>
            <SettingRow isModified={s.attackTimerMetronomeShowBar !== D.attackTimerMetronomeShowBar} onReset={() => set('attackTimerMetronomeShowBar', D.attackTimerMetronomeShowBar)}>
              <Checkbox label="Show Attack Bar" checked={s.attackTimerMetronomeShowBar} onChange={() => flip('attackTimerMetronomeShowBar')} />
            </SettingRow>
            <SettingRow isModified={s.attackTimerMetronomeShowTicks !== D.attackTimerMetronomeShowTicks} onReset={() => set('attackTimerMetronomeShowTicks', D.attackTimerMetronomeShowTicks)}>
              <Checkbox label="Show Attack Cooldown Ticks" checked={s.attackTimerMetronomeShowTicks} onChange={() => flip('attackTimerMetronomeShowTicks')} />
            </SettingRow>
            <PlacementBlock
              placement={{ fontSize: s.attackTimerMetronomeFontSize, abovePrayerIcon: s.attackTimerMetronomeAbovePrayerIcon, offsetX: s.attackTimerMetronomeOffsetX, offsetY: s.attackTimerMetronomeOffsetY }}
              defaults={{ fontSize: D.attackTimerMetronomeFontSize, abovePrayerIcon: D.attackTimerMetronomeAbovePrayerIcon, offsetX: D.attackTimerMetronomeOffsetX, offsetY: D.attackTimerMetronomeOffsetY }}
              disabled={!s.attackTimerMetronomeShowTicks}
              onAbove={() => flip('attackTimerMetronomeAbovePrayerIcon')}
              onOffset={(axis, v) => set(axis === 'x' ? 'attackTimerMetronomeOffsetX' : 'attackTimerMetronomeOffsetY', v)}
              onFontSize={(v) => set('attackTimerMetronomeFontSize', v)}
            />
          </PluginRow>

          {/* Boss Health Bar */}
          <PluginRow label="Boss Health Bar" isOn={boss.enabled} onToggle={() => bossHealthBarStore.patch({ enabled: !boss.enabled })} hasSettings {...ex('bossHealthBar')}>
            <SettingRow isModified={!boss.showName} onReset={() => bossHealthBarStore.patch({ showName: true })}>
              <Checkbox label="Show boss name" checked={boss.showName} onChange={(v) => bossHealthBarStore.patch({ showName: v })} />
            </SettingRow>
            <SettingRow isModified={!boss.showValues} onReset={() => bossHealthBarStore.patch({ showValues: true })}>
              <Checkbox label="Show hitpoints" checked={boss.showValues} onChange={(v) => bossHealthBarStore.patch({ showValues: v })} />
            </SettingRow>
            <SettingRow isModified={!boss.showPercentage} onReset={() => bossHealthBarStore.patch({ showPercentage: true })}>
              <Checkbox label="Show percentage" checked={boss.showPercentage} onChange={(v) => bossHealthBarStore.patch({ showPercentage: v })} />
            </SettingRow>
          </PluginRow>

          {/* Camera */}
          <PluginRow label="Camera" isOn={s.cameraPluginEnabled} onToggle={() => flip('cameraPluginEnabled')} hasSettings {...ex('camera')}>
            <div className="plugin-group">
              <div className="plugin-group-label">Rotate</div>
              <SettingRow isModified={s.cameraVerticalCamera !== D.cameraVerticalCamera} onReset={() => set('cameraVerticalCamera', D.cameraVerticalCamera)}>
                <Checkbox label="Expand pitch limit" checked={s.cameraVerticalCamera} onChange={() => flip('cameraVerticalCamera')} />
              </SettingRow>
              <SettingRow isModified={s.cameraInvertYaw !== D.cameraInvertYaw} onReset={() => set('cameraInvertYaw', D.cameraInvertYaw)}>
                <Checkbox label="Invert yaw" checked={s.cameraInvertYaw} onChange={() => flip('cameraInvertYaw')} />
              </SettingRow>
              <SettingRow isModified={s.cameraInvertPitch !== D.cameraInvertPitch} onReset={() => set('cameraInvertPitch', D.cameraInvertPitch)}>
                <Checkbox label="Invert pitch" checked={s.cameraInvertPitch} onChange={() => flip('cameraInvertPitch')} />
              </SettingRow>
              <SettingRow isModified={s.cameraRightClickMovesCamera !== D.cameraRightClickMovesCamera} onReset={() => set('cameraRightClickMovesCamera', D.cameraRightClickMovesCamera)}>
                <Checkbox label="Right-click moves camera" checked={s.cameraRightClickMovesCamera} onChange={() => flip('cameraRightClickMovesCamera')} />
              </SettingRow>
              <SettingRow isModified={s.cameraSpeed !== D.cameraSpeed} onReset={() => set('cameraSpeed', D.cameraSpeed)}>
                <div className="plugin-setting-row">
                  <span className="plugin-setting-label">Keyboard speed:</span>
                  <NumInput
                    min={0.1}
                    step={0.1}
                    value={s.cameraSpeed}
                    onChange={(e) => {
                      const n = Number.parseFloat(e.target.value)
                      if (Number.isFinite(n) && n > 0) set('cameraSpeed', n)
                    }}
                  />
                </div>
              </SettingRow>
              <SettingRow isModified={s.cameraDragSpeed !== D.cameraDragSpeed} onReset={() => set('cameraDragSpeed', D.cameraDragSpeed)}>
                <div className="plugin-setting-row">
                  <span className="plugin-setting-label">Mouse speed:</span>
                  <NumInput
                    min={0.1}
                    step={0.1}
                    value={s.cameraDragSpeed}
                    onChange={(e) => {
                      const n = Number.parseFloat(e.target.value)
                      if (Number.isFinite(n) && n > 0) set('cameraDragSpeed', n)
                    }}
                  />
                </div>
              </SettingRow>
            </div>
            <div className="plugin-group">
              <div className="plugin-group-label">Zoom</div>
              <SettingRow isModified={s.cameraInnerZoomLevel !== D.cameraInnerZoomLevel} onReset={() => set('cameraInnerZoomLevel', D.cameraInnerZoomLevel)}>
                <div className="plugin-setting-row">
                  <span className="plugin-setting-label">Inner limit:</span>
                  <NumInput
                    min={0}
                    max={8}
                    value={s.cameraInnerZoomLevel}
                    onChange={(e) => {
                      const n = Number.parseInt(e.target.value, 10)
                      if (!Number.isNaN(n) && n >= 0 && n <= 8) set('cameraInnerZoomLevel', n)
                    }}
                  />
                </div>
              </SettingRow>
              <SettingRow isModified={s.cameraOuterZoomLimit !== D.cameraOuterZoomLimit} onReset={() => set('cameraOuterZoomLimit', D.cameraOuterZoomLimit)}>
                <div className="plugin-setting-row">
                  <span className="plugin-setting-label">Outer limit:</span>
                  <NumInput
                    min={-400}
                    max={400}
                    value={s.cameraOuterZoomLimit}
                    onChange={(e) => {
                      const n = Number.parseInt(e.target.value, 10)
                      if (!Number.isNaN(n) && n >= -400 && n <= 400) set('cameraOuterZoomLimit', n)
                    }}
                  />
                </div>
              </SettingRow>
              <SettingRow isModified={s.cameraZoomIncrement !== D.cameraZoomIncrement} onReset={() => set('cameraZoomIncrement', D.cameraZoomIncrement)}>
                <div className="plugin-setting-row">
                  <span className="plugin-setting-label">Speed:</span>
                  <NumInput
                    min={1}
                    value={s.cameraZoomIncrement}
                    onChange={(e) => {
                      const n = Number.parseInt(e.target.value, 10)
                      if (Number.isFinite(n) && n > 0) set('cameraZoomIncrement', n)
                    }}
                  />
                </div>
              </SettingRow>
            </div>
          </PluginRow>

          {/* Compact Orbs */}
          <PluginRow label="Compact Orbs" isOn={s.compactOrbsEnabled} onToggle={() => flip('compactOrbsEnabled')} hasSettings {...ex('compactOrbs')} toggleDisabled={fixedLayout}>
            {fixedLayout && <div className="plugin-unavailable-note">Fixed mode keeps the client&apos;s own orb arrangement.</div>}
            <SettingRow isModified={s.compactOrbsLayout !== 'vertical'} onReset={() => set('compactOrbsLayout', 'vertical')} hideReset={fixedLayout}>
              <div className="compact-orbs-field">
                <div className="compact-orbs-field-label">Layout</div>
                <div className="compact-orbs-segmented" role="radiogroup" aria-label="Compact orbs layout">
                  {ORB_LAYOUTS.map((l) => (
                    <button
                      key={l}
                      type="button"
                      role="radio"
                      aria-checked={s.compactOrbsLayout === l}
                      className={`compact-orbs-segment${s.compactOrbsLayout === l ? ' is-active' : ''}`}
                      onClick={() => set('compactOrbsLayout', l)}
                      disabled={fixedLayout}
                    >
                      <OrbLayoutIcon layout={l} />
                      <span className="compact-orbs-segment__label">{ORB_LAYOUT_LABELS[l]}</span>
                    </button>
                  ))}
                </div>
              </div>
            </SettingRow>
            <SettingRow
              isModified={!isDefaultOrbOrder(s.compactOrbsOrder)}
              onReset={() => {
                setOrbSelected(null)
                set('compactOrbsOrder', [...DEFAULT_ORB_ORDER])
              }}
              hideReset={fixedLayout}
            >
              <div className="compact-orbs-field">
                <div className="compact-orbs-field-label">Orb order</div>
                <div className={`compact-orbs-slots compact-orbs-slots--${s.compactOrbsLayout}`}>
                  {s.compactOrbsOrder.map((orb, i) => (
                    <button
                      key={orb}
                      type="button"
                      className={`compact-orbs-slot${orbSelected === orb ? ' is-selected' : ''}`}
                      aria-pressed={orbSelected === orb}
                      aria-label={`${ORB_LABELS[orb] ?? orb}, position ${i + 1}`}
                      title={ORB_LABELS[orb] ?? orb}
                      disabled={fixedLayout}
                      onClick={() => {
                        const r = orbSlotClick(s.compactOrbsOrder, orbSelected, orb)
                        if (r.selected === null && orbSelected !== null && orbSelected !== orb) set('compactOrbsOrder', r.order)
                        setOrbSelected(r.selected)
                      }}
                    >
                      <PackImg path={PACK_PATHS.orb[orb] ?? ''} style={{ width: 22, height: 22 }} />
                    </button>
                  ))}
                </div>
                {!fixedLayout && (
                  <div className="compact-orbs-hint">{orbSelected === null ? 'Click two orbs to swap their positions.' : `Click another orb to swap it with ${ORB_LABELS[orbSelected] ?? orbSelected}.`}</div>
                )}
              </div>
            </SettingRow>
          </PluginRow>

          {/* Custom Menu Swaps */}
          <PluginRow label="Custom Menu Swaps" isOn={s.customMenuSwapsEnabled} onToggle={() => flip('customMenuSwapsEnabled')} hasSettings {...ex('customMenuSwaps')} dimSettingsWhenOff={false}>
            <div className="menu-swaps-field">
              <span className="menu-swaps-field-label">Rules</span>
              <textarea
                className="menu-swaps-input"
                rows={4}
                spellCheck={false}
                aria-label="Left-click swaps"
                aria-describedby="custom-menu-swaps-format"
                value={s.customMenuSwaps}
                placeholder="Enter one rule per line"
                onChange={(e) => set('customMenuSwaps', e.target.value)}
              />
              <div id="custom-menu-swaps-format" className="menu-swaps-format">
                <p className="menu-swaps-format-line">
                  <span className="menu-swaps-format-literal">option,target</span>
                  <span>
                    e.g. <span className="menu-swaps-format-literal">attack,jaltok-jad</span>
                  </span>
                </p>
                <p className="menu-swaps-format-line">* matches any name. Later lines win.</p>
              </div>
            </div>
          </PluginRow>

          {/* DPS Overlay */}
          <PluginRow label="DPS Overlay" isOn={s.showDetailedDps} onToggle={() => flip('showDetailedDps')} hasSettings {...ex('dpsOverlay')}>
            <SettingRow isModified={s.dpsOverlayShowDetails !== D.dpsOverlayShowDetails} onReset={() => set('dpsOverlayShowDetails', D.dpsOverlayShowDetails)}>
              <Checkbox label="Detailed DPS" checked={s.dpsOverlayShowDetails} onChange={() => flip('dpsOverlayShowDetails')} />
            </SettingRow>
          </PluginRow>

          {/* Instant Inventory */}
          <PluginRow label="Instant Inventory" isOn={s.instantInventoryEnabled} onToggle={() => flip('instantInventoryEnabled')} hasSettings {...ex('instantInventory')}>
            <SettingRow isModified={s.instantPrayerEnabled !== D.instantPrayerEnabled} onReset={() => set('instantPrayerEnabled', D.instantPrayerEnabled)}>
              <Checkbox label="Instant prayer" checked={s.instantPrayerEnabled} onChange={() => flip('instantPrayerEnabled')} />
            </SettingRow>
          </PluginRow>

          {/* Inventory Tags */}
          <PluginRow label="Inventory Tags" isOn={tags.showTags} onToggle={() => inventoryTagsStore.patch({ showTags: !tags.showTags })} hasSettings {...ex('inventoryTags')}>
            <div className="tile-marker-panel">
              <div className="tile-marker-section">
                <div className="tile-marker-header">
                  <span className="tile-marker-title">Tagged Items</span>
                  <div className="tile-marker-count-badge">{tagCount}</div>
                </div>
                {EMPTY_HINT('an item to tag')}
                <div className="tile-marker-panel-actions">
                  <button type="button" className="tile-marker-panel-clear-btn" onClick={() => inventoryTagsStore.patch({ tags: {} })} disabled={tagCount === 0}>
                    Clear All
                  </button>
                </div>
              </div>
            </div>
          </PluginRow>

          {/* Line Markers */}
          <PluginRow label="Line Markers" isOn={lines.showLines} onToggle={() => lineMarkersStore.patch({ showLines: !lines.showLines })} hasSettings {...ex('lineMarkers')} toggleDisabled={markersReadOnly}>
            <div className="tile-marker-panel">
              {markersReadOnly && <div className="tile-marker-io-status">This replay is drawing its own markers.</div>}
              <div className="tile-marker-section">
                <div className="tile-marker-header">
                  <span className="tile-marker-title">Your Lines</span>
                  <div className="tile-marker-count-badge">{myLines.length}</div>
                </div>
                <div className="tile-marker-panel-list">
                  {myLines.length === 0
                    ? EMPTY_HINT('a tile edge to mark')
                    : myLines.map((l) => {
                        const o = l.orientation === 'horizontal' ? 'H' : 'V'
                        const text = `${o} [${l.x}, ${l.y}]${l.label ? ` "${l.label}"` : ''}`
                        return (
                          <div key={`${l.orientation}:${l.x},${l.y}`} className="tile-marker-panel-item">
                            <span className="tile-marker-panel-item-info">
                              <span className="tile-marker-panel-item-swatch" style={{ background: l.color, opacity: l.opacity, flexShrink: 0 }} />
                              <span className="tile-marker-panel-item-text" title={text}>
                                {text}
                              </span>
                            </span>
                            <button
                              type="button"
                              className="tile-marker-panel-remove-btn"
                              disabled={markersReadOnly}
                              onClick={() => setLines(myLines.filter((x) => !(x.x === l.x && x.y === l.y && x.orientation === l.orientation)))}
                              title="Remove line"
                            >
                              <span>×</span>
                            </button>
                          </div>
                        )
                      })}
                </div>
                <div className="tile-marker-panel-actions">
                  <div className="tile-marker-io-actions">
                    <OsrsButton className="tile-marker-panel-clear-btn" onClick={() => setLines([])} disabled={markersReadOnly || myLines.length === 0}>
                      Clear All
                    </OsrsButton>
                  </div>
                </div>
              </div>
              <div className="plugin-section-divider">
                <span className="plugin-section-title">Options</span>
              </div>
              <div className="plugin-options-stack">
                <SettingRow isModified={!lines.showLabels} onReset={() => lineMarkersStore.patch({ showLabels: true })}>
                  <Checkbox label="Show Labels" checked={lines.showLabels} onChange={(v) => lineMarkersStore.patch({ showLabels: v })} disabled={markersReadOnly} />
                </SettingRow>
                <SettingRow
                  isModified={Math.abs(lines.lineWidth - 1) > 0.01}
                  onReset={() => {
                    lineMarkersStore.patch({ lineWidth: 1 })
                    setLineWidthDraft(null)
                  }}
                >
                  <div className="plugin-setting-row">
                    <span className="plugin-setting-label">Line width:</span>
                    <NumInput
                      min={0.5}
                      max={10}
                      step={0.5}
                      value={lineWidthDraft ?? String(lines.lineWidth)}
                      disabled={markersReadOnly}
                      onChange={(e) => {
                        setLineWidthDraft(e.target.value)
                        const n = Number.parseFloat(e.target.value)
                        if (Number.isFinite(n) && n >= 0.5 && n <= 10) lineMarkersStore.patch({ lineWidth: n })
                      }}
                      onBlur={() => setLineWidthDraft(null)}
                    />
                  </div>
                </SettingRow>
              </div>
            </div>
          </PluginRow>

          {/* NPC Highlights */}
          <PluginRow label="NPC Highlights" isOn={npc.showHighlights} onToggle={() => npcHighlightsStore.patch({ showHighlights: !npc.showHighlights })} hasSettings {...ex('npcHighlights')}>
            <div className="tile-marker-panel">
              <div className="tile-marker-section">
                <div className="tile-marker-header">
                  <span className="tile-marker-title">Highlighted NPCs</span>
                  <div className="tile-marker-count-badge">{npcGroups.length}</div>
                </div>
                <div className="tile-marker-panel-list">
                  {npcGroups.length === 0
                    ? EMPTY_HINT('an NPC to highlight')
                    : npcGroups.map((g) => (
                        <div key={g.npcTypeId} className="tile-marker-panel-item">
                          <span className="tile-marker-panel-item-info">
                            <span className="tile-marker-panel-item-swatch" style={{ background: g.entries[0]?.color, flexShrink: 0 }} />
                            <span className="tile-marker-panel-item-text" title={g.npcName}>
                              {g.npcName}
                            </span>
                            <span className="npc-highlight-modes">
                              {g.entries.map((h) => (
                                <OsrsButton
                                  key={`${h.npcTypeId}-${h.mode}`}
                                  variant="small"
                                  className="npc-highlight-chip"
                                  onClick={() => npcHighlightsStore.patch({ highlights: npc.highlights.filter((x) => !(x.npcTypeId === h.npcTypeId && x.mode === h.mode)) })}
                                >
                                  {NPC_MODE_LABELS[h.mode] ?? h.mode} ×
                                </OsrsButton>
                              ))}
                            </span>
                          </span>
                          <button
                            type="button"
                            className="tile-marker-panel-remove-btn"
                            onClick={() => npcHighlightsStore.patch({ highlights: npc.highlights.filter((x) => x.npcTypeId !== g.npcTypeId) })}
                            title="Remove all highlight modes for this NPC"
                          >
                            <span>×</span>
                          </button>
                        </div>
                      ))}
                </div>
                <div className="tile-marker-panel-actions">
                  <OsrsButton className="tile-marker-panel-clear-btn" onClick={() => npcHighlightsStore.patch({ highlights: [] })} disabled={npcGroups.length === 0}>
                    Clear All
                  </OsrsButton>
                </div>
              </div>
              <div className="npc-highlight-options">
                <SettingRow isModified={npc.colorMenuEntries} onReset={() => npcHighlightsStore.patch({ colorMenuEntries: false })}>
                  <Checkbox label="Color menu and hover text" checked={npc.colorMenuEntries} onChange={(v) => npcHighlightsStore.patch({ colorMenuEntries: v })} />
                </SettingRow>
              </div>
            </div>
          </PluginRow>

          {/* Prayer */}
          <PluginRow label="Prayer" isOn={s.prayerEnabled} onToggle={() => flip('prayerEnabled')} hasSettings {...ex('prayer')}>
            <SettingRow isModified={s.prayerFlickOrbEnabled !== D.prayerFlickOrbEnabled} onReset={() => set('prayerFlickOrbEnabled', D.prayerFlickOrbEnabled)}>
              <Checkbox label="Pray flick on prayer orb" checked={s.prayerFlickOrbEnabled} onChange={() => flip('prayerFlickOrbEnabled')} />
            </SettingRow>
            <SettingRow isModified={s.prayerFlickAlwaysOn !== D.prayerFlickAlwaysOn} onReset={() => set('prayerFlickAlwaysOn', D.prayerFlickAlwaysOn)}>
              <Checkbox label="Never hide pray flick" checked={s.prayerFlickAlwaysOn} onChange={() => flip('prayerFlickAlwaysOn')} />
            </SettingRow>
          </PluginRow>

          {/* Prayer Flick Helper */}
          <PluginRow label="Prayer Flick Helper" isOn={s.prayerFlickEnabled} onToggle={() => flip('prayerFlickEnabled')} />

          {/* Status Bars */}
          <PluginRow label="Status Bars" isOn={s.statusBarsEnabled} onToggle={() => flip('statusBarsEnabled')} hasSettings {...ex('statusBars')}>
            <SettingRow isModified={s.statusBarsShowValues !== D.statusBarsShowValues} onReset={() => set('statusBarsShowValues', D.statusBarsShowValues)}>
              <Checkbox label="Show values" checked={s.statusBarsShowValues} onChange={() => flip('statusBarsShowValues')} />
            </SettingRow>
          </PluginRow>

          {/* Stretched Mode */}
          <PluginRow label="Stretched Mode" hasSettings {...ex('stretchedMode')}>
            {fixedLayout && <div className="plugin-unavailable-note">Fixed mode stretches the whole client to the window.</div>}
            <div className="stretched-mode-field">
              <div className="plugin-group-label">UI scale (%)</div>
              <div className="stretched-mode-segmented" role="radiogroup" aria-label="Interface scaling">
                {UI_SCALES.map((v) => (
                  <button key={v} type="button" role="radio" aria-checked={s.uiScale === v} className={`stretched-mode-segment${s.uiScale === v ? ' is-active' : ''}`} onClick={() => set('uiScale', v)} disabled={fixedLayout}>
                    {Math.round(v * 100)}
                  </button>
                ))}
              </div>
              <div className="stretched-mode-custom">
                <label className="plugin-setting-label" htmlFor="stretched-mode-custom-scale">
                  Custom UI scale
                </label>
                <NumInput
                  id="stretched-mode-custom-scale"
                  value={Math.round(s.uiScale * 100)}
                  min={100}
                  max={300}
                  step={1}
                  fieldWidth={38}
                  suffix="%"
                  disabled={fixedLayout}
                  onChange={(e) => {
                    const n = Number.parseFloat(e.target.value)
                    if (Number.isFinite(n) && n >= 100 && n <= 300) set('uiScale', n / 100)
                  }}
                />
              </div>
              <div className="plugin-setting-note">
                <span>Or use</span>
                <kbd className="kbd">Alt + Scroll</kbd>
                <span>over a movable panel.</span>
              </div>
            </div>
          </PluginRow>

          {/* Tick Counter */}
          <PluginRow label="Tick Counter" isOn={s.showTickCounter} onToggle={() => flip('showTickCounter')} hasSettings {...ex('tickCounter')}>
            <SettingRow isModified={s.showTickCounterInfobox !== D.showTickCounterInfobox} onReset={() => set('showTickCounterInfobox', D.showTickCounterInfobox)}>
              <Checkbox label="Show Infobox" checked={s.showTickCounterInfobox} onChange={() => flip('showTickCounterInfobox')} />
            </SettingRow>
            <SettingRow isModified={s.showTickCounterOverhead !== D.showTickCounterOverhead} onReset={() => set('showTickCounterOverhead', D.showTickCounterOverhead)}>
              <Checkbox label="Show Above Head" checked={s.showTickCounterOverhead} onChange={() => flip('showTickCounterOverhead')} />
            </SettingRow>
            <PlacementBlock
              placement={{ fontSize: s.tickCounterFontSize, abovePrayerIcon: s.tickCounterAbovePrayerIcon, offsetX: s.tickCounterOffsetX, offsetY: s.tickCounterOffsetY }}
              defaults={{ fontSize: D.tickCounterFontSize, abovePrayerIcon: D.tickCounterAbovePrayerIcon, offsetX: D.tickCounterOffsetX, offsetY: D.tickCounterOffsetY }}
              disabled={!s.showTickCounterOverhead}
              onAbove={() => flip('tickCounterAbovePrayerIcon')}
              onOffset={(axis, v) => set(axis === 'x' ? 'tickCounterOffsetX' : 'tickCounterOffsetY', v)}
              onFontSize={(v) => set('tickCounterFontSize', v)}
            />
            <SettingRow isModified={s.tickCounterMax !== D.tickCounterMax} onReset={() => set('tickCounterMax', D.tickCounterMax)}>
              <div className="plugin-setting-row">
                <span className="plugin-setting-label">Cycle Length:</span>
                <NumInput
                  min={2}
                  max={20}
                  value={s.tickCounterMax}
                  onChange={(e) => {
                    const n = Number.parseInt(e.target.value, 10)
                    if (!Number.isNaN(n) && n >= 2 && n <= 20) set('tickCounterMax', n)
                  }}
                />
              </div>
            </SettingRow>
            <SettingRow isModified={Object.keys(s.tickCounterColors).length > 0} onReset={() => set('tickCounterColors', D.tickCounterColors)}>
              <div className="plugin-setting-row">
                <span className="plugin-setting-label">Colors:</span>
                <TickColorControls max={s.tickCounterMax} colors={s.tickCounterColors} onChange={(c) => set('tickCounterColors', c)} />
              </div>
            </SettingRow>
          </PluginRow>

          {/* Tile Indicators */}
          <PluginRow label="Tile Indicators" isOn={ti.enabled} onToggle={() => tileIndicatorsStore.patch({ enabled: !ti.enabled })} hasSettings {...ex('tileIndicators')}>
            <div className="ti-group">
              {(['trueTile', 'hoverTile', 'destinationTile'] as const).map((key) => {
                const cur = ti.config[key]
                const def = DEFAULT_TILE_INDICATORS.config[key]
                const label = key === 'trueTile' ? 'True Tile' : key === 'hoverTile' ? 'Hover Tile' : 'Destination Tile'
                const draft = widthDrafts[key]
                const w = draft == null ? cur.width : Number.parseFloat(draft)
                const widthModified = !Number.isNaN(w) && Math.abs(w - def.width) > 0.01
                const modified = cur.color !== def.color || widthModified || cur.cornerOnly !== def.cornerOnly || cur.enabled !== def.enabled
                const dropDraft = () =>
                  setWidthDrafts((d) => {
                    const n = { ...d }
                    delete n[key]
                    return n
                  })
                return (
                  <SettingRow
                    key={key}
                    isModified={modified}
                    onReset={() => {
                      const c = tileIndicatorsStore.get()
                      tileIndicatorsStore.patch({ config: { ...c.config, [key]: { ...c.config[key], color: def.color, width: def.width, cornerOnly: def.cornerOnly, enabled: def.enabled } } })
                      dropDraft()
                    }}
                  >
                    <div className="ti-item">
                      <div className="ti-header">
                        <ColorSwatch color={cur.color} onCommit={(c) => updateTi(key, 'color', c)} />
                        <span className="ti-label">{label}</span>
                        <Toggle checked={cur.enabled} onChange={() => updateTi(key, 'enabled', !cur.enabled)} size="small" />
                      </div>
                      <div className="ti-controls" style={{ opacity: cur.enabled ? 1 : 0.4 }}>
                        <div className="ti-control-group">
                          <span className="ti-control-label">Width:</span>
                          <NumInput
                            min={0.5}
                            max={10}
                            step={0.5}
                            value={draft ?? String(cur.width)}
                            onChange={(e) => setWidthDrafts((d) => ({ ...d, [key]: e.target.value }))}
                            onBlur={(e) => {
                              const n = Number.parseFloat(e.target.value)
                              if (!Number.isNaN(n) && n >= 0.5 && n <= 10) updateTi(key, 'width', n)
                              dropDraft()
                            }}
                          />
                        </div>
                        <Checkbox label="Corners only" checked={cur.cornerOnly} onChange={() => updateTi(key, 'cornerOnly', !cur.cornerOnly)} />
                      </div>
                    </div>
                  </SettingRow>
                )
              })}
            </div>
          </PluginRow>

          {/* Tile Markers */}
          <PluginRow label="Tile Markers" isOn={markers.showMarkers} onToggle={() => tileMarkersStore.patch({ showMarkers: !markers.showMarkers })} hasSettings {...ex('tileMarkers')} toggleDisabled={markersReadOnly}>
            <div className="tile-marker-panel">
              {markersReadOnly && <div className="tile-marker-io-status">This replay is drawing its own markers.</div>}
              <div className="tile-marker-section">
                <div className="tile-marker-header">
                  <span className="tile-marker-title">Your Markers</span>
                  <div className="tile-marker-count-badge">{myMarkers.length}</div>
                </div>
                <div className="tile-marker-panel-list">
                  {myMarkers.length === 0
                    ? EMPTY_HINT('a tile to mark')
                    : myMarkers.map((m) => {
                        const text = `[${m.x}, ${m.y}]${m.label ? ` "${m.label}"` : ''}`
                        return (
                          <div key={`${m.x},${m.y}`} className="tile-marker-panel-item">
                            <span className="tile-marker-panel-item-info">
                              <span className="tile-marker-panel-item-swatch" style={{ background: m.color, opacity: m.opacity, flexShrink: 0 }} />
                              <span className="tile-marker-panel-item-text" title={text}>
                                {text}
                              </span>
                            </span>
                            <button
                              type="button"
                              className="tile-marker-panel-remove-btn"
                              disabled={markersReadOnly}
                              onClick={() => setMarkers(myMarkers.filter((x) => x.x !== m.x || x.y !== m.y))}
                              title="Remove marker"
                            >
                              <span>×</span>
                            </button>
                          </div>
                        )
                      })}
                </div>
                <div className="tile-marker-panel-actions">
                  <div className="tile-marker-io-actions">
                    <OsrsButton className="tile-marker-panel-clear-btn" onClick={() => setMarkers([])} disabled={markersReadOnly || myMarkers.length === 0}>
                      Clear All
                    </OsrsButton>
                    <OsrsButton
                      variant="small"
                      className="tile-marker-io-btn"
                      disabled={myMarkers.length === 0}
                      onClick={() => void copyToClipboard(exportGroundMarkers(myMarkers)).then((ok) => flashStatus(ok ? `Copied ${myMarkers.length} markers to clipboard` : 'Failed to copy'))}
                    >
                      Export
                    </OsrsButton>
                    <OsrsButton
                      variant="small"
                      className="tile-marker-io-btn"
                      disabled={markersReadOnly}
                      onClick={() =>
                        void readClipboard().then((text) => {
                          if (!text) return flashStatus('Clipboard empty or access denied')
                          const list = importGroundMarkers(text)
                          if (!list || list.length === 0) return flashStatus('No valid markers found for this encounter')
                          setMarkers(mergeMarkers(tileMarkersStore.get().markersByEncounter[ENCOUNTER_KEY] ?? [], list))
                          flashStatus(`Imported ${list.length} markers`)
                        })
                      }
                    >
                      Import
                    </OsrsButton>
                  </div>
                  {ioStatus && <div className="tile-marker-io-status">{ioStatus}</div>}
                </div>
              </div>
              <div className="plugin-section-divider">
                <span className="plugin-section-title">Options</span>
              </div>
              <div className="plugin-options-stack">
                <SettingRow isModified={!markers.showLabels} onReset={() => tileMarkersStore.patch({ showLabels: true })}>
                  <Checkbox label="Show Labels" checked={markers.showLabels} onChange={(v) => tileMarkersStore.patch({ showLabels: v })} disabled={markersReadOnly} />
                </SettingRow>
                <SettingRow
                  isModified={Math.abs(markers.markerWidth - 2) > 0.01}
                  onReset={() => {
                    tileMarkersStore.patch({ markerWidth: 2 })
                    setMarkerWidthDraft(null)
                  }}
                >
                  <div className="plugin-setting-row">
                    <span className="plugin-setting-label">Border width:</span>
                    <NumInput
                      min={0.5}
                      max={10}
                      step={0.5}
                      value={markerWidthDraft ?? String(markers.markerWidth)}
                      disabled={markersReadOnly}
                      onChange={(e) => {
                        setMarkerWidthDraft(e.target.value)
                        const n = Number.parseFloat(e.target.value)
                        if (Number.isFinite(n) && n >= 0.5 && n <= 10) tileMarkersStore.patch({ markerWidth: n })
                      }}
                      onBlur={() => setMarkerWidthDraft(null)}
                    />
                  </div>
                </SettingRow>
              </div>
            </div>
          </PluginRow>

          {/* XP Drops */}
          <PluginRow label="XP Drops" isOn={xp.enabled} onToggle={() => xpDropsStore.patch({ enabled: !xp.enabled })} hasSettings {...ex('xpDrops')}>
            <SettingRow isModified={!xp.showPredictedHit} onReset={() => xpDropsStore.patch({ showPredictedHit: true })}>
              <Checkbox label="Show predicted hit" checked={xp.showPredictedHit} onChange={(v) => xpDropsStore.patch({ showPredictedHit: v })} />
            </SettingRow>
            <SettingRow isModified={!xp.grouped} onReset={() => xpDropsStore.patch({ grouped: true })}>
              <Checkbox label="Group XP drops" checked={xp.grouped} onChange={(v) => xpDropsStore.patch({ grouped: v })} />
            </SettingRow>
            <SettingRow isModified={!xp.showIcons} onReset={() => xpDropsStore.patch({ showIcons: true })}>
              <Checkbox label="Show skill icons" checked={xp.showIcons} onChange={(v) => xpDropsStore.patch({ showIcons: v })} />
            </SettingRow>
            <SettingRow isModified={xp.speed !== 44} onReset={() => xpDropsStore.patch({ speed: 44 })}>
              <div className="plugin-setting-row">
                <span className="plugin-setting-label">Speed:</span>
                <NumInput
                  min={10}
                  max={200}
                  value={xp.speed}
                  fieldWidth={40}
                  onChange={(e) => {
                    const n = Number.parseInt(e.target.value, 10)
                    if (!Number.isNaN(n)) xpDropsStore.patch({ speed: n })
                  }}
                />
                <span className="plugin-setting-label" style={{ marginLeft: 2 }}>
                  px/s
                </span>
              </div>
            </SettingRow>
          </PluginRow>

          {/* Debug Overlays */}
          <PluginRow label="Debug Overlays" hasSettings {...ex('debugOverlays')}>
            {(
              [
                ['showCoordinates', 'Coordinate Overlay'],
                ['showDebugGrid', 'Grid Overlay'],
                ['showNpcClickbox', 'NPC Clickbox'],
                ['npcAttackTimerMetronomeEnabled', 'NPC Attack Timer Metronome'],
                ['showTickTiming', 'Tick Timing'],
                ['showSoundDebug', 'Sound Debug'],
                ['showModifierKeys', 'Input Display'],
                ['hideHardwareAccelWarning', 'Hide HW Accel Warning'],
              ] as const
            ).map(([key, label]) => (
              <SettingRow key={key} isModified={s[key] !== D[key]} onReset={() => set(key, D[key])}>
                <Checkbox label={label} checked={s[key]} onChange={() => flip(key)} />
              </SettingRow>
            ))}
          </PluginRow>
        </div>
      </aside>
    </>
  )
}
