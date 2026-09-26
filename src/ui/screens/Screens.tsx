/**
 * "Now Entering" title card, victory modal and defeat modal.
 */
import '../menu/styles/tokens.css'
import '../menu/styles/controls.css'
import './screens.css'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { SimState } from '../../sim/api'
import { OsrsButton } from '../menu/controls'
import { TRIPLE_JAD_ENCOUNTER } from '../menu/encounter'
import { deathReason, deathRows, fightRecord, selectOutcome, splitTitle } from './outcome'

const TITLE_CARD_MS = 3600
const SIDE_PADDING = 16
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'

/** scim: focus the dialog, trap Tab inside it, restore focus on close. */
function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return
    const el = ref.current
    if (!el) return
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const items = () => Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE))
    ;(el.getAttribute('tabindex') === '-1' ? el : items()[0])?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      e.preventDefault()
      e.stopPropagation()
      const list = items()
      if (list.length === 0) return
      const i = document.activeElement instanceof HTMLElement ? list.indexOf(document.activeElement) : -1
      list[i === -1 ? (e.shiftKey ? list.length - 1 : 0) : (i + (e.shiftKey ? -1 : 1) + list.length) % list.length]?.focus()
    }
    el.addEventListener('keydown', onKey)
    return () => {
      el.removeEventListener('keydown', onKey)
      prev?.focus()
    }
  }, [ref, active])
}

// ---------------------------------------------------------------------------
// Title card
// ---------------------------------------------------------------------------

export function TitleCard({ encounterName, subtitle = null, leftInset = 0, rightInset = 0 }: { encounterName: string | null; subtitle?: string | null; leftInset?: number; rightInset?: number }) {
  const [card, setCard] = useState<{ name: string; subtitle: string | null; key: number } | null>(null)
  useEffect(() => {
    if (!encounterName) {
      setCard(null)
      return
    }
    setCard((prev) => ({ name: encounterName, subtitle, key: prev ? prev.key + 1 : 0 }))
    const t = window.setTimeout(() => setCard(null), TITLE_CARD_MS)
    return () => window.clearTimeout(t)
  }, [encounterName, subtitle])
  if (!card) return null
  const { heroName, subtitle: sub } = splitTitle(card.name, card.subtitle)
  return (
    <div className="encounter-title-card-overlay" style={leftInset || rightInset ? { paddingLeft: leftInset, paddingRight: rightInset } : undefined}>
      <div key={`${card.key}-vignette`} className="encounter-title-card-vignette" aria-hidden="true" />
      <div key={card.key} className="encounter-title-card">
        <div className="encounter-title-card-eyebrow">Now Entering</div>
        <div className="encounter-title-card-text">
          <span className="encounter-title-card-text-shadow" aria-hidden="true">
            {heroName}
          </span>
          <span className="encounter-title-card-text-fill">{heroName}</span>
        </div>
        <div className="encounter-title-card-emblem" aria-hidden="true">
          <span className="encounter-title-card-emblem-line encounter-title-card-emblem-line--l" />
          <span className="encounter-title-card-emblem-diamond" />
          <span className="encounter-title-card-emblem-line encounter-title-card-emblem-line--r" />
        </div>
        {sub && <div className="encounter-title-card-sub">{sub}</div>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Victory
// ---------------------------------------------------------------------------

export interface VictoryDescriptor {
  eyebrow: string
  title: string
  narrative: string
  accent: 'gold' | 'blood'
}

export interface OutcomeModalProps {
  state: SimState
  visible: boolean
  onRestart: () => void
  onEnterReplay?: (() => void) | undefined
  onReturnToLobby?: (() => void) | undefined
  isReplaying?: boolean
  hasRecording?: boolean
  leftInset?: number
  rightInset?: number
}

export function VictoryModal({
  state,
  visible,
  onRestart,
  onEnterReplay,
  onReturnToLobby,
  isReplaying = false,
  hasRecording = false,
  leftInset = 0,
  rightInset = 0,
  victory = TRIPLE_JAD_ENCOUNTER.victory,
}: OutcomeModalProps & { victory?: VictoryDescriptor }) {
  const ref = useRef<HTMLDivElement>(null)
  const show = visible && !isReplaying
  const record = show ? fightRecord(state) : null
  useFocusTrap(ref, show && record !== null)
  if (!show || !record) return null
  return createPortal(
    <div
      ref={ref}
      className={`victory-modal-overlay victory-modal-overlay--${victory.accent}`}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="victory-modal-title"
      aria-describedby="victory-modal-narrative"
      style={{ paddingLeft: SIDE_PADDING + leftInset, paddingRight: SIDE_PADDING + rightInset }}
    >
      <div className="victory-modal-content-wrapper">
        <p className="victory-modal-eyebrow">{victory.eyebrow}</p>
        <h1 id="victory-modal-title" className="victory-modal-heading">
          {victory.title}
        </h1>
        <div className="victory-modal-emblem" aria-hidden="true">
          <span className="victory-modal-emblem-line victory-modal-emblem-line--left" />
          <span className="victory-modal-emblem-diamond" />
          <span className="victory-modal-emblem-line victory-modal-emblem-line--right" />
        </div>
        <p id="victory-modal-narrative" className="victory-modal-narrative">
          {victory.narrative}
        </p>
        <section className="victory-modal-record" aria-labelledby="victory-modal-record-heading">
          <h2 id="victory-modal-record-heading" className="victory-modal-record-heading">
            Fight record
          </h2>
          <dl className="victory-modal-record-list">
            {(
              [
                ['Kill time', record.killTime],
                ['Damage dealt', record.damageDealt],
                ['Damage taken', record.damageTaken],
                ['HP remaining', record.hpRemaining],
                ['Prayer remaining', record.prayerRemaining],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="victory-modal-record-row">
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
        <div className="victory-modal-actions">
          <div className="victory-modal-button-row">
            <OsrsButton variant="default" className="victory-modal-action" onClick={onRestart}>
              Fight Again
            </OsrsButton>
            {hasRecording && onEnterReplay && (
              <OsrsButton variant="ghost" className="victory-modal-action" onClick={onEnterReplay}>
                Watch Replay
              </OsrsButton>
            )}
          </div>
          <p className="victory-modal-hint">
            or press <kbd>Ctrl+R</kbd> to fight again
          </p>
        </div>
        {onReturnToLobby && (
          <div className="victory-modal-lobby-footer">
            <OsrsButton variant="ghost" className="victory-modal-lobby" onClick={onReturnToLobby}>
              Return to Lobby
            </OsrsButton>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

// ---------------------------------------------------------------------------
// Defeat
// ---------------------------------------------------------------------------

export function DefeatModal({ state, visible, onRestart, onEnterReplay, onReturnToLobby, isReplaying = false, leftInset = 0, rightInset = 0, npcName }: OutcomeModalProps & { npcName?: (id: number) => string | undefined }) {
  const ref = useRef<HTMLDivElement>(null)
  const show = visible && !isReplaying
  useFocusTrap(ref, show)
  if (!show) return null
  const rows = deathRows(state.damageHistory, npcName)
  return (
    <div
      ref={ref}
      className="death-modal-overlay"
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Death Screen"
      style={{ paddingLeft: SIDE_PADDING + leftInset, paddingRight: SIDE_PADDING + rightInset }}
    >
      <div className="death-modal-content-wrapper">
        <div className="death-modal-eyebrow">Defeated</div>
        <h2 className="death-modal-heading">YOU DIED</h2>
        <div className="death-modal-emblem" aria-hidden="true">
          <span className="death-modal-emblem-line death-modal-emblem-line--l" />
          <span className="death-modal-emblem-diamond" />
          <span className="death-modal-emblem-line death-modal-emblem-line--r" />
        </div>
        <p className="death-modal-reason">{deathReason(state.failedCondition)}</p>
        {rows.length > 0 && (
          <div className="death-modal-damage-section">
            <h2 className="death-modal-damage-header">Damage taken</h2>
            <div className="death-modal-table">
              <div className="death-modal-table-headers">
                <span>Tick</span>
                <span>Source</span>
                <span>Hit</span>
                <span>Prayer</span>
              </div>
              {rows.map((r) => (
                <div key={r.key} className={`death-modal-row ${r.wrong ? 'is-wrong' : ''}`.trim()}>
                  <span className="death-modal-tick">{r.tick}</span>
                  <span className="death-modal-source">
                    {r.source}
                    {r.style && <span className="death-modal-attack-style">{r.style}</span>}
                  </span>
                  <span className={`death-modal-amount ${r.amount > 0 ? 'is-damage' : 'is-zero'}`}>{r.amount}</span>
                  <span className={r.wrong ? 'death-modal-prayer is-wrong' : r.unprayed ? 'death-modal-prayer is-none' : 'death-modal-prayer'}>{r.prayer}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="death-modal-actions">
          <div className="death-modal-button-row">
            <OsrsButton className="death-modal-restart" onClick={onRestart}>
              Try Again
            </OsrsButton>
            {onEnterReplay && (
              <OsrsButton variant="ghost" className="death-modal-replay" onClick={onEnterReplay}>
                Watch Replay
              </OsrsButton>
            )}
          </div>
          <p className="death-modal-hint">
            or press <kbd>Ctrl+R</kbd> to restart
          </p>
        </div>
        {onReturnToLobby && (
          <div className="death-modal-lobby-footer">
            <OsrsButton variant="ghost" className="death-modal-lobby" onClick={onReturnToLobby}>
              Return to Lobby
            </OsrsButton>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Both outcome screens driven by the sim state (scim root): death when
 * the player failed, victory when the outcome phase is `victory`.
 */
export function OutcomeScreens(props: Omit<OutcomeModalProps, 'visible'> & { npcName?: (id: number) => string | undefined }) {
  const s = props.state
  const which = selectOutcome({
    playerFailed: s.failedCondition !== null,
    outcomePhase: s.encounterOutcome.phase,
    isReplaying: props.isReplaying ?? false,
    hasVictoryDescriptor: true,
  })
  return (
    <>
      <DefeatModal {...props} visible={which === 'death'} />
      <VictoryModal {...props} visible={which === 'victory'} />
    </>
  )
}
