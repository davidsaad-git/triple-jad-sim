/**
 * What's New, Training and Replays modals from the top-left nav. Simple
 * placeholders in scim's shells ( / empty state
 *); Esc priority 1300, click outside closes.
 */
import './styles/tokens.css'
import './styles/controls.css'
import './styles/modals.css'
import { useState } from 'react'
import { CloseIcon } from './controls'
import { ESC_PRIORITY, useEscapeLayer } from './escape'
import { menuController, useMenuState, type MenuSurface } from './menuState'

function useModal(surface: MenuSurface): { open: boolean; close: () => void } {
  const open = useMenuState((s) => s[surface])
  const close = () => menuController.close(surface)
  useEscapeLayer(ESC_PRIORITY.MODAL, open, close)
  return { open, close }
}

const X = () => <CloseIcon size={14} viewBox="0 0 14 14" d="M2 2l10 10M12 2L2 12" />

const CATEGORIES = ['All', 'Encounters', 'Combat', 'Training', 'Plugins', 'Interface'] as const

interface WhatsNewEntry {
  date: string
  category: (typeof CATEGORIES)[number]
  title: string
  impact: string
}

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    date: '2026-09-26',
    category: 'Encounters',
    title: 'Triple Jads',
    impact: 'Practice Inferno wave 68: three JalTok-Jads with staggered attacks and their Yt-HurKot healers.',
  },
]

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1] ?? m
  return `${Number(d)} ${month} ${y}`
}

export function WhatsNewModal() {
  const { open, close } = useModal('whatsNew')
  const [filter, setFilter] = useState<(typeof CATEGORIES)[number]>('All')
  if (!open) return null
  const list = WHATS_NEW.filter((e) => filter === 'All' || e.category === filter)
  return (
    <div
      className="whats-new-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="whats-new-title"
      aria-describedby="whats-new-desc"
    >
      <div className="whats-new-card">
        <div className="whats-new-header">
          <div className="whats-new-heading">
            <h2 id="whats-new-title" className="whats-new-title">
              What&apos;s New
            </h2>
            <p id="whats-new-desc" className="whats-new-intro">
              The big updates to the simulator, newest first. Filter by what matters to you.
            </p>
          </div>
          <button type="button" className="whats-new-close" onClick={close} aria-label="Close" title="Close">
            <X />
          </button>
        </div>
        <fieldset className="whats-new-filters">
          <legend className="whats-new-filters-legend">Filter updates by category</legend>
          {CATEGORIES.map((c) => (
            <button key={c} type="button" className="whats-new-filter" aria-pressed={filter === c} onClick={() => setFilter(c)}>
              {c}
            </button>
          ))}
        </fieldset>
        <ol className="whats-new-list">
          {list.map((e) => (
            <li key={`${e.date}-${e.title}`} className="whats-new-entry">
              <div className="whats-new-entry-meta">
                <time className="whats-new-entry-date" dateTime={e.date}>
                  {formatDate(e.date)}
                </time>
                <span className="whats-new-entry-tag">{e.category}</span>
              </div>
              <h3 className="whats-new-entry-title">{e.title}</h3>
              <p className="whats-new-entry-impact">{e.impact}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

export function TrainingModal() {
  const { open, close } = useModal('training')
  if (!open) return null
  return (
    <div
      className="tutorial-picker-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Training"
    >
      <div className="tp-shell">
        <div className="tp-header">
          <h2 className="tp-heading">Training</h2>
          <button type="button" className="tp-close" onClick={close} aria-label="Close" title="Close">
            <X />
          </button>
        </div>
        <div className="tp-body">
          <div className="tp-empty">
            <h2 className="tp-detail-title">No tutorials available</h2>
            <p className="tp-detail-desc">Tutorials will appear here as encounters are added to the simulator.</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ReplaysModal() {
  const { open, close } = useModal('replays')
  if (!open) return null
  return (
    <div
      className="replay-library-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) close()
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="replay-library-title"
      aria-describedby="replay-library-intro"
    >
      <div className="replay-library-card">
        <div className="replay-library-header">
          <div className="replay-library-heading">
            <h2 id="replay-library-title" className="replay-library-title">
              Replays
            </h2>
            <p id="replay-library-intro" className="replay-library-intro">
              Runs you shared or opened, newest first. Watch one back, or send the link on.
            </p>
          </div>
          <button type="button" className="replay-library-close" onClick={close} aria-label="Close" title="Close">
            <X />
          </button>
        </div>
        <div className="replay-library-body">
          <div className="replay-library-empty">
            <p className="replay-library-empty-title">No replays yet</p>
            <p className="replay-library-empty-body">Replays are not available in this build yet.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
