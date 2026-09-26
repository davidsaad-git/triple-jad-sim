/**
 * Player stats block of the Configure dialog: "Set all to 99", "Import from Hiscores" (offline:
 * always ends in scim's "Could not reach the stats service" error), seven
 * level tiles with "Needs N", and the player-wide toggles below.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { SkillName } from '../../sim/api'
import { NumInput, OsrsButton } from './controls'
import { loadHiscoresUsername, saveHiscoresUsername } from './encounter'
import { allNinetyNine, clampLevel, SKILL_BOUNDS, SKILL_LABELS, SKILLS, type BaseLevels, type Requirements } from './loadoutModel'
import { uiAsset } from '../packs'


export const STATS_SERVICE_UNREACHABLE = 'Could not reach the stats service. Check your connection and try again.'

type ImportStatus = { kind: 'idle' } | { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'success'; message: string }

export function skillIconUrl(skill: SkillName): string {
  return uiAsset(`skill-${skill}.png`)
}

export function CombatStatsPanel({
  levels,
  onChange,
  requirements = {},
  accountUnlocks,
}: {
  levels: BaseLevels
  onChange: (next: BaseLevels) => void
  requirements?: Requirements
  accountUnlocks?: ReactNode
}) {
  const [username, setUsername] = useState(loadHiscoresUsername)
  const [formOpen, setFormOpen] = useState(false)
  const [status, setStatus] = useState<ImportStatus>({ kind: 'idle' })
  const [drafts, setDrafts] = useState<Partial<Record<SkillName, string>>>({})
  const headingId = useId()
  const formId = useId()
  const toggleRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const timer = useRef<number | null>(null)
  useEffect(() => {
    if (formOpen) inputRef.current?.focus()
  }, [formOpen])
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    [],
  )
  const setLevel = (skill: SkillName, text: string) => {
    setDrafts((d) => ({ ...d, [skill]: text }))
    const n = Number.parseInt(text, 10)
    if (Number.isInteger(n)) onChange({ ...levels, [skill]: clampLevel(skill, n) })
  }
  const importLevels = () => {
    if (status.kind === 'loading') return
    if (username.trim().length === 0) {
      setStatus({ kind: 'error', message: 'Enter an OSRS username to import.' })
      return
    }
    // Offline build: there is no stats service, so the request always fails like scim's network error path.
    setStatus({ kind: 'loading' })
    timer.current = window.setTimeout(() => setStatus({ kind: 'error', message: STATS_SERVICE_UNREACHABLE }), 350)
  }
  const statusText = status.kind === 'loading' ? 'Fetching levels from the Hiscores...' : status.kind === 'idle' ? '' : status.message
  return (
    <section className="combat-stats" aria-labelledby={headingId}>
      <div className="combat-stats__header">
        <h3 id={headingId}>Player</h3>
        <div className="combat-stats__actions">
          <button
            type="button"
            className="combat-stats__action"
            onClick={() => {
              setDrafts({})
              onChange(allNinetyNine())
              setStatus({ kind: 'idle' })
            }}
          >
            Set all to 99
          </button>
          <button ref={toggleRef} type="button" className="combat-stats__action" aria-expanded={formOpen} aria-controls={formId} onClick={() => setFormOpen((o) => !o)}>
            Import from Hiscores
          </button>
        </div>
      </div>
      {formOpen && (
        <div id={formId}>
          <form
            className="combat-stats__import"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                setFormOpen(false)
                toggleRef.current?.focus()
              }
            }}
            onSubmit={(e) => {
              e.preventDefault()
              importLevels()
            }}
          >
            <input
              ref={inputRef}
              className="combat-stats__username"
              type="text"
              aria-label="Username"
              autoComplete="off"
              data-lpignore="true"
              data-1p-ignore=""
              data-bwignore="true"
              data-form-type="other"
              spellCheck={false}
              maxLength={12}
              value={username}
              placeholder="OSRS username"
              onChange={(e) => {
                setUsername(e.target.value)
                saveHiscoresUsername(e.target.value)
              }}
            />
            <OsrsButton type="submit" variant="primary" disabled={status.kind === 'loading'}>
              {status.kind === 'loading' ? 'Importing...' : 'Import levels'}
            </OsrsButton>
          </form>
        </div>
      )}
      <p className={`combat-stats__status combat-stats__status--${status.kind}`} role="status" aria-live="polite">
        {statusText}
      </p>
      <div className="combat-stats__grid">
        {SKILLS.map((skill) => {
          const need = requirements[skill]
          const inputId = `combat-stat-${skill}`
          const reqId = `combat-stat-${skill}-req`
          return (
            <div key={skill} className={`combat-stats__tile${need === undefined ? '' : ' combat-stats__tile--unmet'}`}>
              <label className="combat-stats__tile-name" htmlFor={inputId}>
                {SKILL_LABELS[skill]}
              </label>
              <div className="combat-stats__tile-body">
                <img crossOrigin="anonymous" className="combat-stats__tile-icon" src={skillIconUrl(skill)} alt="" aria-hidden="true" />
                <NumInput
                  id={inputId}
                  className="combat-stats__input"
                  describedBy={need === undefined ? undefined : reqId}
                  value={drafts[skill] ?? String(levels[skill])}
                  min={SKILL_BOUNDS[skill].min}
                  max={SKILL_BOUNDS[skill].max}
                  onChange={(e) => setLevel(skill, e.target.value)}
                  onBlur={() =>
                    setDrafts((d) => {
                      const n = { ...d }
                      delete n[skill]
                      return n
                    })
                  }
                />
              </div>
              {need !== undefined && (
                <span className="combat-stats__req" id={reqId}>
                  Needs {need}
                </span>
              )}
            </div>
          )
        })}
      </div>
      {accountUnlocks && <div className="combat-stats__unlocks">{accountUnlocks}</div>}
    </section>
  )
}
