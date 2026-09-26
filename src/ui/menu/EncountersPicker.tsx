/**
 * Encounters picker. One boss,
 * "Triple Jads", with the synthesised "Standard Fight" contract. No hero art
 * or thumbnail (the empty-pic letter tile is used), no lobby link.
 */
import './styles/tokens.css'
import './styles/controls.css'
import './styles/picker.css'
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { TRIPLE_JAD_ENCOUNTER } from './encounter'
import { ESC_PRIORITY, useEscapeLayer } from './escape'
import { menuController, useMenuState } from './menuState'

interface BossEntry {
  kind: string
  title: string
  description: string
  tagline: string
  blurb: string
}

interface Contract {
  id: string
  name: string
  subtitle: string
}

const BOSSES: BossEntry[] = [
  {
    kind: TRIPLE_JAD_ENCOUNTER.kind,
    title: TRIPLE_JAD_ENCOUNTER.displayName,
    description: TRIPLE_JAD_ENCOUNTER.description,
    tagline: TRIPLE_JAD_ENCOUNTER.tagline,
    blurb: TRIPLE_JAD_ENCOUNTER.blurb,
  },
]

/** scim: the contract star icon. */
function StarIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" focusable="false">
      <path d="M10 2l2 5 5 .4-3.8 3.3 1.2 4.9L10 13.2 5.4 15.6l1.2-4.9L2.8 7.4 7.8 7z" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  )
}

export interface EncountersPickerProps {
  /** "Enter": start immediately with the current loadout and default mechanics. */
  onEnter: (kind: string) => void
  /** "Configure": open the Configure dialog (the picker closes itself). */
  onConfigure?: (kind: string) => void
}

export function EncountersPicker({ onEnter, onConfigure }: EncountersPickerProps) {
  const open = useMenuState((s) => s.encounters)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [highlight, setHighlight] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)
  const close = () => menuController.close('encounters')
  useEscapeLayer(ESC_PRIORITY.ENCOUNTER_PICKER, open, close)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setHighlight(0)
    setSelected(BOSSES[0]?.kind ?? null)
    const t = setTimeout(() => searchRef.current?.focus(), 50)
    return () => clearTimeout(t)
  }, [open])

  if (!open) return null

  const q = query.trim().toLowerCase()
  const nameMatch = (b: BossEntry) => !q || `${b.title} ${b.description} ${b.tagline}`.toLowerCase().includes(q)
  const contractsFor = (b: BossEntry): Contract[] => [{ id: b.kind, name: 'Standard Fight', subtitle: b.description }]
  const visibleContracts = (b: BossEntry) => (nameMatch(b) ? contractsFor(b) : contractsFor(b).filter((c) => c.name.toLowerCase().includes(q) || c.subtitle.toLowerCase().includes(q)))
  const bosses = BOSSES.filter((b) => nameMatch(b) || visibleContracts(b).length > 0)
  const active = bosses.find((b) => b.kind === selected) ?? bosses[0] ?? null
  const contracts = active ? visibleContracts(active) : []

  const enter = (kind: string) => {
    onEnter(kind)
    close()
  }
  const configure = (c: Contract) => {
    close()
    if (onConfigure) onConfigure(c.id)
    else menuController.open('configure')
  }
  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (contracts.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => (h + 1) % contracts.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => (h - 1 + contracts.length) % contracts.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const c = contracts[highlight]
      if (c) configure(c)
    }
  }

  return (
    <div className="picker-overlay" onMouseDown={close}>
      <div className="picker-backdrop" />
      <div className="picker" onMouseDown={(e) => e.stopPropagation()}>
        <aside className="picker-rail">
          <div className="picker-rail-head">
            <h2>Encounters</h2>
            <div className="picker-search">
              <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M11 11l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <input
                ref={searchRef}
                type="text"
                placeholder="Search encounters..."
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setHighlight(0)
                }}
                onKeyDown={onSearchKey}
              />
            </div>
          </div>
          <div className="picker-rail-scroll">
            {bosses.length > 0 && <div className="picker-rail-section">Bosses</div>}
            {bosses.map((b) => (
              <button
                key={b.kind}
                type="button"
                className={`picker-boss${b.kind === active?.kind ? ' active' : ''}`}
                onClick={() => {
                  setSelected(b.kind)
                  setHighlight(0)
                }}
              >
                <span className="picker-boss-pic picker-boss-pic--empty">{b.title.charAt(0)}</span>
                <span className="picker-boss-meta">
                  <span className="picker-boss-heading">
                    <span className="picker-boss-name">{b.title}</span>
                  </span>
                  <span className="picker-boss-sub">{b.tagline}</span>
                </span>
              </button>
            ))}
          </div>
        </aside>
        <section className="picker-detail">
          <button type="button" className="picker-close" onClick={close} aria-label="Close">
            ×
          </button>
          {active ? (
            <>
              <div className="picker-hero">
                <div className="picker-hero-text">
                  <div className="picker-hero-title">
                    <h1>{active.title}</h1>
                  </div>
                  <span className="picker-hero-tag">{active.tagline}</span>
                  <p>{active.blurb}</p>
                </div>
              </div>
              <div className="picker-contracts">
                {contracts.length > 0 ? (
                  <div className="picker-contract-group">
                    {contracts.map((c, i) => (
                      <div
                        key={c.id}
                        className={`picker-contract${i === highlight ? ' selected' : ''}`}
                        role="button"
                        tabIndex={0}
                        onMouseEnter={() => setHighlight(i)}
                        onClick={() => configure(c)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            configure(c)
                          }
                        }}
                      >
                        <span className="picker-contract-icon">
                          <StarIcon />
                        </span>
                        <span className="picker-contract-body">
                          <span className="picker-contract-heading">
                            <span className="picker-contract-name">{c.name}</span>
                          </span>
                          <span className="picker-contract-effect">{c.subtitle}</span>
                        </span>
                        <span className="picker-contract-actions">
                          <button
                            type="button"
                            className="picker-btn picker-btn--primary"
                            onClick={(e) => {
                              e.stopPropagation()
                              configure(c)
                            }}
                          >
                            Configure
                          </button>
                          <button
                            type="button"
                            className="picker-btn picker-btn--ghost"
                            onClick={(e) => {
                              e.stopPropagation()
                              enter(c.id)
                            }}
                          >
                            Enter
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="picker-empty">No contracts found.</div>
                )}
              </div>
            </>
          ) : (
            <div className="picker-empty">No encounters found.</div>
          )}
        </section>
      </div>
    </div>
  )
}
