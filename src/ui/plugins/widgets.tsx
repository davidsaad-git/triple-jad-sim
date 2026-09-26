/**
 * Floating plugin widgets: Boss Health Bar, DPS Overlay
 *, Prayer Flick Helper, XP Drops (`dve`
 *). All live in `FloatingWidget` (Alt-drag, persisted positions).
 */
import './widgets.css'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { SimRuntime } from '../../app/runtime/types'
import { useTickSnapshot } from '../../app/runtime/RuntimeContext'
import { bossHealthBarStore, usePluginStore, xpDropsStore } from '../../app/plugins/stores'
import { settingsStore, useSetting } from '../../app/settings/settings'
import { useStore } from '../../app/GameStore'
import type { DpsProjection, NpcState, SimState } from '../../sim/api'
import { FloatingWidget, type WidgetPosition } from './FloatingWidget'
import { buildFlickBars, markGeometry, prayerFlickRecorder, type FlickMark } from './prayerFlick'
import { SKILL_ICON, XpDropSampler, xpDropOpacity, xpDropText, xpDropY } from './xpDrops'

interface ViewportSize {
  viewportWidth: number
  viewportHeight: number
}

// ---------------------------------------------------------------------------
// Boss Health Bar
// ---------------------------------------------------------------------------

export const BOSS_HP_DEFAULT: WidgetPosition = { x: 279, y: 24, anchorX: 'left', anchorY: 'top' }

/** scim: `_`/`-` -> space, camelCase split, every word title-cased. */
export function bossBarName(archetypeId: string): string {
  return archetypeId
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
}

/** scim: attack target (alive), else last attack target (alive), else the boss. */
export function bossBarTarget(s: SimState): NpcState | undefined {
  return (
    s.npcs.find((n) => n.id === s.attackTarget && n.hp > 0) ??
    s.npcs.find((n) => n.id === s.lastAttackTarget && n.hp > 0) ??
    s.npcs.find((n) => n.role === 'boss')
  )
}

export function BossHealthBar({ viewportWidth, viewportHeight }: ViewportSize) {
  const snap = useTickSnapshot()
  const cfg = usePluginStore(bossHealthBarStore, (s) => s)
  const target = bossBarTarget(snap.state)
  if (!cfg.enabled || !target) return null
  const hp = Math.max(0, target.hp)
  const max = Math.max(1, target.maxHp)
  const pct = Math.max(0, Math.min(1, hp / max)) * 100
  const readout = cfg.showValues || cfg.showPercentage
  return (
    <FloatingWidget
      defaultPosition={BOSS_HP_DEFAULT}
      position={cfg.position}
      onPositionChange={(p) => bossHealthBarStore.patch({ position: p })}
      width={208}
      height={42}
      viewportWidth={viewportWidth}
      viewportHeight={viewportHeight}
      altHintLabel="Boss HP"
      dataTutorial="boss-health-bar-panel"
    >
      <div className="boss-hp" role="presentation">
        {(cfg.showName || readout) && (
          <div className="boss-hp__info">
            {cfg.showName && <span className="boss-hp__name">{bossBarName(target.archetypeId)}</span>}
            {readout && (
              <span className="boss-hp__readout">
                {cfg.showValues && (
                  <span className="boss-hp__values">
                    {hp}
                    <span className="boss-hp__sep">/</span>
                    {max}
                  </span>
                )}
                {cfg.showPercentage && <span className="boss-hp__pct">{pct.toFixed(1)}%</span>}
              </span>
            )}
          </div>
        )}
        <div className="boss-hp__track">
          <div className="boss-hp__fill" style={{ width: `${pct}%`, minWidth: hp > 0 ? '2px' : '0' }} />
        </div>
      </div>
    </FloatingWidget>
  )
}

// ---------------------------------------------------------------------------
// DPS Overlay
// ---------------------------------------------------------------------------

export const DPS_DEFAULT: WidgetPosition = { x: 24, y: 248, anchorX: 'left', anchorY: 'top' }

const STYLE_LABELS: Record<DpsProjection['style'], string> = {
  melee_slash: 'Melee slash',
  melee_stab: 'Melee stab',
  melee_crush: 'Melee crush',
  ranged: 'Ranged',
  magic: 'Magic',
}

const pct1 = (p: number) => `${(p * 100).toFixed(1)}%`
const num = (n: number | null) => (n === null ? '—' : n.toLocaleString('en-US'))

/** scim: only the first letter capitalised, underscores kept. */
export function dpsTargetName(npc: NpcState | undefined): string {
  return npc ? npc.archetypeId.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase()) : ''
}

export function DpsOverlay({ runtime, viewportWidth, viewportHeight }: ViewportSize & { runtime: SimRuntime }) {
  const snap = useTickSnapshot()
  const visible = useSetting('showDetailedDps')
  const details = useSetting('dpsOverlayShowDetails')
  const position = useSetting('detailedDpsPosition')
  const ref = useRef<HTMLElement>(null)
  const [height, setHeight] = useState(200)
  useLayoutEffect(() => {
    const el = ref.current
    if (!visible || !el) return
    const measure = () => setHeight(el.offsetHeight)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [visible])
  const projection = useMemo(() => {
    try {
      return runtime.engine.getAdjustedTheoreticalDps()
    } catch {
      return null
    }
  }, [runtime, snap])
  if (!visible) return null
  const s = snap.state
  const target = s.npcs.find((n) => n.id === s.attackTarget) ?? s.npcs.find((n) => n.role === 'boss')
  let body
  if (projection === null) body = <p className="detailed-dps__empty">{target ? 'No supported attack.' : 'No target selected.'}</p>
  else {
    const p = projection
    const rows: { label: string; value: ReactNode }[] = [
      { label: 'Style', value: STYLE_LABELS[p.style] },
      { label: 'Accuracy', value: pct1(p.accuracy) },
      { label: 'Max hit', value: String(p.maxHit) },
    ]
    if (p.baseMaxHit !== null && p.profileMaxHit !== null && p.baseMaxHit !== p.profileMaxHit) rows.push({ label: 'Base max hit', value: num(p.baseMaxHit) })
    rows.push({ label: 'Attack roll', value: num(p.baseAttackRoll) }, { label: 'Defence roll', value: num(p.baseDefenceRoll) })
    if (p.outgoingDamageMultiplier !== 1 || p.specialAttackDamageMultiplier !== 1)
      rows.push({
        label: 'Multipliers',
        value: (
          <>
            ×{p.outgoingDamageMultiplier.toFixed(3)}
            <span className="detailed-dps__sep">·</span>×{p.specialAttackDamageMultiplier.toFixed(3)}
          </>
        ),
      })
    const multi = p.hits.length > 1 || p.hits.some((h) => h.procChance > 0 || h.gateProbability < 1)
    const proc = p.hits.some((h) => h.procChance > 0)
    const cols = `20px repeat(${proc ? 4 : 3}, 1fr)`
    body = (
      <>
        <div className="detailed-dps__hero">
          <div className="detailed-dps__headline">
            <span className="detailed-dps__value">{p.dps.toFixed(3)}</span>
            <span className="detailed-dps__unit">dps</span>
          </div>
          <p className="detailed-dps__formula">
            {p.expectedAppliedDamagePerAttack.toFixed(2)} damage ÷ {p.attackSpeedTicks} ticks ({p.attackIntervalSeconds.toFixed(2)}s)
          </p>
        </div>
        {details && (
          <dl className="detailed-dps__rows">
            {rows.map((r) => (
              <div key={r.label}>
                <dt>{r.label}</dt>
                <dd>{r.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {details && multi && (
          <section className="detailed-dps__breakdown">
            <h3>Hit breakdown</h3>
            <div className="detailed-dps__hit detailed-dps__hit--head" style={{ gridTemplateColumns: cols }}>
              <span>Hit</span>
              <span>Acc</span>
              <span>Avg</span>
              <span>Max</span>
              {proc && <span>Proc</span>}
            </div>
            {p.hits.map((h, i) => (
              <div key={h.planIndex} className="detailed-dps__hit" style={{ gridTemplateColumns: cols }}>
                <span>{i + 1}</span>
                <span>{pct1(h.accuracyProbability)}</span>
                <span>{h.expectedAppliedDamage.toFixed(2)}</span>
                <span>{h.maximumAppliedDamage}</span>
                {proc && <span>{h.procChance > 0 ? pct1(h.procChance) : '—'}</span>}
              </div>
            ))}
          </section>
        )}
      </>
    )
  }
  return (
    <FloatingWidget
      defaultPosition={DPS_DEFAULT}
      position={position}
      onPositionChange={(p) => settingsStore.patch({ detailedDpsPosition: p })}
      width={208}
      height={height}
      viewportWidth={viewportWidth}
      viewportHeight={viewportHeight}
      altHintLabel="DPS Overlay"
      dataTutorial="detailed-dps-panel"
    >
      <section ref={ref} className="detailed-dps" aria-label="DPS Overlay">
        <div className="detailed-dps__caption">
          <span className="detailed-dps__title">DPS</span>
          <span className="detailed-dps__target">{dpsTargetName(target)}</span>
        </div>
        {body}
      </section>
    </FloatingWidget>
  )
}

// ---------------------------------------------------------------------------
// Prayer Flick Helper
// ---------------------------------------------------------------------------

export const PRAYER_FLICK_DEFAULT: WidgetPosition = { x: 24, y: 88, anchorX: 'left', anchorY: 'top' }
const EXAMPLE_ON = 0.22
const EXAMPLE_OFF = 0.55
const pc = (v: number) => `${v * 100}%`

function FlickEvent({ mark }: { mark: FlickMark }) {
  const g = markGeometry(mark)
  let cls = `prayer-flick__event prayer-flick__event--${mark.kind}`
  if (mark.slipped) cls += ' is-carried'
  if (mark.clickFraction === null) cls += ' is-inbound'
  if (mark.arrivalFraction === null) cls += ' is-outbound'
  if (g.instant) cls += ' is-instant'
  return <span className={cls} style={{ left: pc(g.left), width: pc(g.width) }} />
}

/** Prayer Flick Helper aria label. */
export function flickAriaLabel(clickCount: number, slippedCount: number): string {
  if (clickCount === 0) return 'Prayer Flick Helper. No prayer clicks in the last 3 ticks.'
  return `Prayer Flick Helper. ${clickCount} prayer click${clickCount === 1 ? '' : 's'} in the last 3 ticks${slippedCount > 0 ? `, ${slippedCount} arrived on a later tick` : ''}.`
}

export function PrayerFlickHelper({ viewportWidth, viewportHeight }: ViewportSize) {
  const enabled = useSetting('prayerFlickEnabled')
  const position = useSetting('prayerFlickPosition')
  const snapshot = useStore(prayerFlickRecorder, (s) => s)
  const data = useMemo(() => buildFlickBars(snapshot.clicks, snapshot.window), [snapshot])
  if (!enabled) return null
  const empty = data.clickCount === 0
  return (
    <FloatingWidget
      defaultPosition={PRAYER_FLICK_DEFAULT}
      position={position}
      onPositionChange={(p) => settingsStore.patch({ prayerFlickPosition: p })}
      width={208}
      height={144}
      viewportWidth={viewportWidth}
      viewportHeight={viewportHeight}
      altHintLabel="Prayer Flick Helper"
      dataTutorial="prayer-flick-overlay"
    >
      <div className="prayer-flick" role="img" aria-label={flickAriaLabel(data.clickCount, data.slippedCount)}>
        <div className="prayer-flick__caption">
          <span className="prayer-flick__title">Prayer Flick Helper</span>
        </div>
        <div className="prayer-flick__bars" aria-hidden="true">
          {data.bars.map((bar, i) => (
            <div key={bar.tick} className={`prayer-flick__bar${bar.current ? ' is-current' : ''}`} style={{ '--prayer-flick-age': i } as CSSProperties}>
              {bar.current && data.durationMs > 0 && <span key={bar.tick} className="prayer-flick__elapsed" style={{ animationDuration: `${data.durationMs}ms` }} />}
              {empty && i === 0 && (
                <>
                  <span className="prayer-flick__event prayer-flick__event--on is-instant is-example" style={{ left: pc(EXAMPLE_ON) }} />
                  <span className="prayer-flick__legend prayer-flick__legend--on" style={{ left: pc(EXAMPLE_ON) }}>
                    on
                  </span>
                  <span className="prayer-flick__event prayer-flick__event--off is-instant is-example" style={{ left: pc(EXAMPLE_OFF) }} />
                  <span className="prayer-flick__legend prayer-flick__legend--off" style={{ left: pc(EXAMPLE_OFF) }}>
                    off
                  </span>
                </>
              )}
              {empty && i === 1 && <span className="prayer-flick__legend prayer-flick__legend--axis">each bar is one game tick</span>}
              {bar.marks.map((m) => (
                <FlickEvent key={`${m.id}-${m.clickFraction === null ? 'in' : 'out'}`} mark={m} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </FloatingWidget>
  )
}

// ---------------------------------------------------------------------------
// XP Drops
// ---------------------------------------------------------------------------

export const XP_DROPS_DEFAULT: WidgetPosition = { x: 235, y: 96, anchorX: 'right', anchorY: 'top' }
const XP_PANEL_W = 170
const XP_PANEL_H = 130
const XP_ORIGIN_TOP = 106

export function XpDrops({ runtime, viewportWidth, viewportHeight }: ViewportSize & { runtime: SimRuntime }) {
  const cfg = usePluginStore(xpDropsStore, (s) => s)
  const overlayRef = useRef<HTMLDivElement>(null)
  const { enabled, grouped, speed, showIcons, showPredictedHit } = cfg
  useEffect(() => {
    if (!enabled) return
    const root = overlayRef.current
    if (!root) return
    const sampler = new XpDropSampler({ grouped, speed })
    sampler.ingest(runtime.getSnapshot().events)
    const nodes = new Map<string, HTMLDivElement>()
    const make = (key: string) => {
      const el = document.createElement('div')
      el.className = 'xp-drop'
      el.dataset.key = key
      return el
    }
    const offTick = runtime.onTick((s) => sampler.ingest(s.events))
    const offRestart = runtime.onRestart(() => {
      sampler.reset()
      for (const n of nodes.values()) n.remove()
      nodes.clear()
    })
    let handle = 0
    const frame = () => {
      const nowMs = runtime.clock.interpolatedTick() * 600
      const live = new Set<string>()
      for (const d of sampler.sample(nowMs)) {
        live.add(d.key)
        let el = nodes.get(d.key)
        if (!el) {
          el = make(d.key)
          if (showIcons)
            for (const s of d.skills) {
              const img = document.createElement('img')
              img.className = 'xp-drop__icon'
              img.src = SKILL_ICON[s.skill]
              img.alt = s.skill
              el.appendChild(img)
            }
          const text = document.createElement('span')
          text.className = 'xp-drop__text'
          text.textContent = xpDropText(d, showPredictedHit)
          el.appendChild(text)
          root.appendChild(el)
          nodes.set(d.key, el)
        }
        const age = nowMs - d.bornAtMs
        el.style.transform = `translate(-50%, ${xpDropY(d, age, speed).toFixed(2)}px)`
        el.style.opacity = String(xpDropOpacity(age))
      }
      for (const [k, el] of nodes)
        if (!live.has(k)) {
          el.remove()
          nodes.delete(k)
        }
      handle = runtime.scheduler.request(frame)
    }
    handle = runtime.scheduler.request(frame)
    return () => {
      runtime.scheduler.cancel(handle)
      offTick()
      offRestart()
      for (const n of nodes.values()) n.remove()
      nodes.clear()
    }
  }, [runtime, enabled, grouped, speed, showIcons, showPredictedHit])
  if (!enabled) return null
  return (
    <FloatingWidget
      defaultPosition={XP_DROPS_DEFAULT}
      position={cfg.position}
      onPositionChange={(p) => xpDropsStore.patch({ position: p })}
      width={XP_PANEL_W}
      height={XP_PANEL_H}
      viewportWidth={viewportWidth}
      viewportHeight={viewportHeight}
      altHintLabel="XP drops"
      dataTutorial="xp-drops-panel"
    >
      <div className="xp-drop-panel">
        <div ref={overlayRef} className="xp-drop-overlay" style={{ top: XP_ORIGIN_TOP }} aria-hidden="true" />
      </div>
    </FloatingWidget>
  )
}
