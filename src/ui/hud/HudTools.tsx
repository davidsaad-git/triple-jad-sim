/**
 * Bottom-left tool stack: HUD / Practice / Replay pills, the HUD panel and
 * Practice Controls (scim in the `tools` surface, placement
 *). Practice actions and aids go through
 * `runtime.dispatchImmediate` (never lagged).
 */
import '../menu/styles/tokens.css'
import '../menu/styles/controls.css'
import '../menu/styles/configure.css'
import './hud.css'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { SimRuntime } from '../../app/runtime/types'
import { useTickSnapshot } from '../../app/runtime/RuntimeContext'
import { useSetting, useSettings } from '../../app/settings/settings'
import type { EncounterCommand, MechanicsConfig, NpcState, SimState } from '../../sim/api'
import { mergedMechanicsConfig, saveMechanicsConfig } from '../menu/encounter'
import { ESC_PRIORITY, useEscapeLayer } from '../menu/escape'
import { BossHealthWidget, MechanicsEditor } from '../menu/MechanicsEditor'
import { TRIPLE_JAD_CONTROLS } from '../menu/simBridge'
import { dpsLuckClass, hpBarColor, hudCompactMode, hudDps, hudTarget, hudToolsLayout, targetLabel } from './dps'

/** HUD margin in the resizable layouts. */
export const HUD_MARGIN = 8

/** The Jad the Fight Setup health slider edits: targeted Jad, else the first alive one. */
export function practiceHealthTarget(state: SimState): NpcState | undefined {
  const boss = state.npcs.find((n) => n.role === 'boss' && n.alive)
  if (boss) return boss
  const isJad = (n: NpcState) => n.alive && (n.npcTypeId === 7700 || (/jad/i.test(n.archetypeId) && !/heal|hurkot/i.test(n.archetypeId)))
  const target = state.attackTarget ? state.npcs.find((n) => n.id === state.attackTarget) : undefined
  if (target && isJad(target)) return target
  return state.npcs.find(isJad)
}

export interface HudToolsProps {
  runtime: SimRuntime
  /** Size of the area the stack lives in (viewport / presentation surface). */
  viewportWidth: number
  viewportHeight: number
  /** Width reserved on the right for the game panel (modern layout: 204 x uiScale when wide enough). */
  rightReserved?: number
  leftInset?: number
  /** Distance from the bottom edge (margin + bottom inset). */
  bottomOffset?: number
  /** Fixed layout / short viewports switch to the side-by-side layout (scim: height <= 768 or fixed). */
  horizontal?: boolean
  /** Pinned infobox strip when Settings > Infoboxes = HUD. */
  status?: ReactNode
  /** Replay pill; omitted = no pill (no recording). */
  replay?: { isReplaying: boolean; warning?: string; onToggle: () => void }
}

export function HudTools({ runtime, viewportWidth, viewportHeight, rightReserved, leftInset = 0, bottomOffset = HUD_MARGIN, horizontal, status, replay }: HudToolsProps) {
  const snap = useTickSnapshot()
  const state = snap.state
  const uiScale = useSetting('uiScale')
  const layoutMode = useSetting('clientLayoutMode')
  const showCoordinates = useSetting('showCoordinates')
  const perEncounter = useSettings((s) => s.mechanicsConfigPerEncounter)
  const config = useMemo(() => mergedMechanicsConfig(perEncounter), [perEncounter])
  const [hudHidden, setHudHidden] = useState(false)
  const [practiceOpen, setPracticeOpen] = useState(false)
  const [paused, setPaused] = useState(() => runtime.isPaused())
  useEffect(() => runtime.onPauseChange(setPaused), [runtime])
  const practicePillRef = useRef<HTMLButtonElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const hudPillRef = useRef<HTMLButtonElement>(null)
  const isReplaying = replay?.isReplaying ?? false

  const reserved = rightReserved ?? (viewportWidth >= 600 ? (layoutMode === 'classic' ? 241 : layoutMode === 'modern' ? 204 : 0) * uiScale : 0)
  const availableWidth = Math.max(0, viewportWidth - reserved - HUD_MARGIN - (leftInset + HUD_MARGIN))
  const availableHeight = Math.max(0, viewportHeight - bottomOffset - HUD_MARGIN)
  const layout = hudToolsLayout({ width: availableWidth, height: availableHeight, horizontal: horizontal ?? (layoutMode === 'fixed' || viewportHeight <= 768) })
  const sideBySide = layout.horizontal
  const maxWidth = layout.width
  const practiceWidth = layout.practiceWidth

  const toggles = useMemo(() => TRIPLE_JAD_CONTROLS.mechanicsToggles.filter((t) => t.group !== 'player'), [])
  const boss = state.npcs.find((n) => n.role === 'boss')
  const practiceAvailable = toggles.length > 0 || boss !== undefined
  const practiceShown = !isReplaying && practiceAvailable && practiceOpen
  const panelsOpen = practiceShown || !hudHidden

  // The tip-toast stack sits just above this stack.
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el || typeof document === 'undefined') return
    const root = document.documentElement
    const publish = () => {
      root.style.setProperty('--bottom-left-stack-height', `${el.offsetHeight}px`)
      root.style.setProperty('--bottom-left-stack-bottom', `${bottomOffset}px`)
    }
    publish()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(publish)
    ro.observe(el)
    return () => ro.disconnect()
  }, [bottomOffset])

  const closePractice = useCallback(() => {
    setPracticeOpen(false)
    practicePillRef.current?.focus()
  }, [])
  useEscapeLayer(ESC_PRIORITY.SIDE_PANEL, practiceShown, closePractice)

  const onConfigChange = (next: MechanicsConfig) => {
    saveMechanicsConfig(next)
    runtime.dispatchImmediate((e) => e.setMechanicsConfig(next), 'practice:mechanics')
  }
  const execute = (command: EncounterCommand) => runtime.dispatchImmediate((e) => void e.executeEncounterCommand(command), 'practice:command')

  // HUD values
  const target = hudTarget(state)
  const dps = useMemo(() => hudDps(state.damageHistory, target?.id, state.currentTick), [state.damageHistory, target?.id, state.currentTick])
  const projection = useMemo(() => {
    try {
      return runtime.engine.getAdjustedTheoreticalDps()
    } catch {
      return null
    }
  }, [runtime, snap])
  const playerPct = Math.max(0, Math.min(100, (state.playerHP / Math.max(1, state.maxHP)) * 100))
  const targetPct = target ? Math.max(0, Math.min(100, (target.hp / Math.max(1, target.maxHp)) * 100)) : 0
  const hudWidthPx = Math.min(216, maxWidth)
  const hudWidth = sideBySide ? Math.min(332, maxWidth - practiceWidth - 4) : hudWidthPx
  const mode = hudCompactMode(sideBySide, hudWidth)
  const compact = mode !== 'column'
  const maxColumns = Math.max(1, Math.floor((practiceWidth - 18 + 12) / 132))

  const healthTarget = practiceHealthTarget(state)
  const healthWidget = healthTarget ? (
    <BossHealthWidget
      target={healthTarget}
      onSetHp={(hp) => execute({ type: 'set-jad-hp', jadId: healthTarget.id, hp })}
      presets={TRIPLE_JAD_CONTROLS.bossHpPresets}
    />
  ) : null

  const practicePanel = practiceShown ? (
    <div
      key="practice"
      className={`practice-panel${sideBySide ? ' practice-panel--wide' : ''}`}
      style={sideBySide ? { width: 'max-content', maxWidth: practiceWidth, left: hudWidth + 4 } : { width: hudWidthPx }}
      role="dialog"
      aria-label="Practice Controls"
      data-tutorial-input-surface="gameplay"
      onMouseDown={(e) => {
        if (e.target instanceof Element && e.target.closest('button')) e.preventDefault()
      }}
    >
      <div className="practice-panel-head">
        <h2 className="practice-panel-title">Practice Controls</h2>
        <button type="button" className="practice-panel-close" onClick={() => setPracticeOpen(false)} aria-label="Close practice controls">
          ✕
        </button>
      </div>
      <div className={`practice-panel-body${sideBySide ? '' : ' practice-scroll-body'}`}>
        <MechanicsEditor
          variant="practice"
          config={config}
          onConfigChange={onConfigChange}
          toggles={toggles}
          debugActions={TRIPLE_JAD_CONTROLS.debugActions}
          onExecuteCommand={execute}
          healthWidget={healthWidget}
          independentScroll={sideBySide}
          maxColumns={maxColumns}
        />
      </div>
    </div>
  ) : null

  const hudPanel = hudHidden ? null : (
    <div
      key="hud"
      className={`hud${isReplaying ? ' hud--replay-snap' : ''}${compact ? ' hud--compact' : ''}${mode === 'row-tight' ? ' hud--compact-tight' : mode === 'narrow' ? ' hud--narrow' : ''}`}
      data-tutorial="hud"
      style={{ width: hudWidth }}
    >
      <button
        type="button"
        className="hud-close"
        aria-label="Close HUD"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          setHudHidden(true)
          if (e.detail === 0) hudPillRef.current?.focus()
        }}
      >
        ✕
      </button>
      <div className="hud-head">
        <span className="hud-header-title">HUD</span>
        {!compact && (
          <>
            <span className="hud-header-sep" aria-hidden="true">
              |
            </span>
            <span className="hud-header-tick">{state.currentTick}</span>
          </>
        )}
      </div>
      <div className="hud-bars">
        <div className="hud-bar-group">
          <div className="hud-bar-info">
            <span className="hud-bar-label">Player</span>
            <span className="hud-bar-num">
              {state.playerHP}
              <span className="hud-bar-sep">/</span>
              {state.maxHP}
            </span>
          </div>
          <div className="hud-bar-track">
            <div className="hud-bar-fill" style={{ width: `${playerPct}%`, minWidth: state.playerHP > 0 ? '1px' : '0', backgroundColor: hpBarColor(playerPct) }} />
          </div>
        </div>
        <div className={`hud-bar-group${target ? '' : ' is-dim'}`}>
          <div className="hud-bar-info">
            <span className="hud-bar-label">{targetLabel(target)}</span>
            <span className="hud-bar-num">
              {target ? (
                <>
                  {target.hp}
                  <span className="hud-bar-sep">/</span>
                  {target.maxHp}
                </>
              ) : (
                '—'
              )}
            </span>
          </div>
          <div className="hud-bar-track">
            <div className="hud-bar-fill" style={{ width: `${targetPct}%`, minWidth: target && target.hp > 0 ? '1px' : '0', backgroundColor: hpBarColor(targetPct) }} />
          </div>
        </div>
      </div>
      <div className="hud-stats">
        {compact && (
          <div className="hud-stat-row">
            <span className="hud-stat-label">Tick</span>
            <span className="hud-stat-value hud-header-tick">{state.currentTick}</span>
          </div>
        )}
        <div className="hud-stat-row">
          <span className="hud-stat-label">DPS</span>
          <span className="hud-stat-value hud-dps-inline">
            <span className={`hud-dps-actual ${dpsLuckClass(dps)}`}>{dps ? dps.actual.toFixed(2) : '—'}</span>
            <span className="hud-dps-sep">/</span>
            <span className="hud-dps-expected">{dps ? dps.expected.toFixed(2) : '—'}</span>
          </span>
        </div>
        <div className="hud-stat-row">
          <span className="hud-stat-label">Max Hit</span>
          <span className="hud-stat-value">{projection ? `${projection.maxHit}` : '—'}</span>
        </div>
      </div>
    </div>
  )

  const pills = (
    <div key="tools" className="hud-tool-row">
      <button
        ref={hudPillRef}
        type="button"
        className={`hud-pill${hudHidden ? '' : ' is-on'}`}
        aria-expanded={!hudHidden}
        onClick={() => {
          setHudHidden(!hudHidden)
          if (hudHidden) window.dispatchEvent(new CustomEvent('tutorial:hud-opened'))
        }}
        onMouseDown={(e) => e.preventDefault()}
      >
        <span className="hud-pill-label">HUD</span>
      </button>
      {practiceAvailable && (
        <button
          ref={practicePillRef}
          type="button"
          className={`hud-pill hud-practice-button${practiceShown ? ' is-on' : ''}`}
          aria-expanded={practiceShown}
          disabled={isReplaying}
          title={isReplaying ? 'Practice controls are unavailable during replay' : undefined}
          onClick={() => setPracticeOpen((o) => !o)}
          onMouseDown={(e) => e.preventDefault()}
        >
          <span className="hud-pill-label">Practice</span>
        </button>
      )}
      {/* Pause is our addition (scim has none): freezes the sim clock; P toggles it. */}
      <button
        type="button"
        className={`hud-pill hud-pause-button${paused ? ' is-on' : ''}`}
        aria-pressed={paused}
        title={paused ? 'Resume (P)' : 'Pause (P)'}
        onClick={() => runtime.togglePause()}
        onMouseDown={(e) => e.preventDefault()}
      >
        <span className="hud-pill-label">{paused ? 'Resume' : 'Pause'}</span>
      </button>
      {replay && (
        <button
          type="button"
          className={`hud-pill hud-replay-button${replay.isReplaying ? ' is-on' : ''}`}
          aria-expanded={replay.isReplaying}
          title={replay.isReplaying ? 'Exit Replay' : replay.warning ? `Enter Replay. ${replay.warning}` : 'Enter Replay'}
          aria-label={!replay.isReplaying && replay.warning ? `Enter Replay. ${replay.warning}` : undefined}
          style={{ pointerEvents: 'auto' }}
          onClick={replay.onToggle}
        >
          <span className="hud-pill-label">Replay</span>
          {replay.warning && <span aria-hidden="true">!</span>}
        </button>
      )}
    </div>
  )
  const statusSlot = status ? (
    <div key="status" className="hud-status">
      {status}
    </div>
  ) : null

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        bottom: bottomOffset,
        left: leftInset + HUD_MARGIN,
        // scim: side-by-side height, else the space above the bottom minus 208 px.
        maxHeight: sideBySide ? layout.height : Math.max(0, viewportHeight - bottomOffset - 208),
        width: layout.width,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        alignItems: 'flex-start',
        gap: 5,
        pointerEvents: 'none',
        zIndex: 20,
      }}
    >
      {showCoordinates && (
        <div
          style={{
            padding: '3px 8px',
            background: 'rgba(0, 0, 0, 0.78)',
            border: '1px solid var(--hud-border)',
            borderRadius: 2,
            color: '#ffe066',
            font: '700 14px "RuneScape Bold 12", monospace, sans-serif',
            letterSpacing: '0.3px',
            textShadow: '1px 1px 0 #000',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          {`(${state.playerPosition[0]}, ${state.playerPosition[1]})`}
        </div>
      )}
      <div
        className="hud-tools-stack"
        data-anchor="left"
        data-narrow={hudWidth < 288}
        data-side-by-side={sideBySide}
        data-panels-open={panelsOpen}
        style={{ maxWidth, maxHeight: 'inherit', width: sideBySide ? maxWidth : undefined, position: 'relative' }}
      >
        {sideBySide ? [statusSlot, pills, hudPanel, practicePanel] : [statusSlot, practicePanel, hudPanel, pills]}
      </div>
    </div>
  )
}
