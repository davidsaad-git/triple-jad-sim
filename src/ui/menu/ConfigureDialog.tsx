/**
 * Encounter Configure dialog (scim, mounted). Opening it wipes the encounter's stored mechanics
 * overrides; loadout, stats and
 * mechanics save immediately; "Start Encounter" hands the integrator an
 * `EncounterStartConfig`.
 */
import './styles/tokens.css'
import './styles/controls.css'
import './styles/configure.css'
import { useEffect, useId, useLayoutEffect, useMemo, useState } from 'react'
import type { CacheSystem } from '../../cache/CacheSystem'
import type { Loadout, MechanicsConfig } from '../../sim/api'
import { useSettings } from '../../app/settings/settings'
import { OsrsButton } from './controls'
import {
  AUTO_PREPOT_TOGGLE,
  allMechanicsToggles,
  loadCurrentLoadout,
  loadPlayerStats,
  mergedMechanicsConfig,
  PLAYER_TOGGLES,
  resetEncounterMechanics,
  saveCurrentLoadout,
  saveMechanicsConfig,
  savePlayerStats,
  TRIPLE_JAD_ENCOUNTER,
  type EncounterStartConfig,
} from './encounter'
import { ESC_PRIORITY, useEscapeLayer } from './escape'
import { getItemCatalog, type ItemCatalog } from './itemCatalog'
import { LoadoutEditor } from './LoadoutEditor'
import type { BaseLevels } from './loadoutModel'
import { MechanicsEditor, partitionToggles } from './MechanicsEditor'
import { menuController, useMenuState } from './menuState'

/** scim: "OSRS Wiki" link next to the title. */
function WikiLink({ href, subject }: { href: string; subject: string }) {
  return (
    <a className="wiki-link" href={href} target="_blank" rel="noopener noreferrer" aria-label={`${subject} on the OSRS Wiki`}>
      <svg className="wiki-link-mark" viewBox="0 0 24 16" aria-hidden="true" focusable="false">
        <path d="M2 2.5h7.5a2.5 2.5 0 0 1 2.5 2.5v10a2 2 0 0 0-2-2H2zM22 2.5h-7.5A2.5 2.5 0 0 0 12 5v10a2 2 0 0 1 2-2h8z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
      <span className="wiki-link-label">OSRS Wiki</span>
    </a>
  )
}

/** Build the item catalog after the dialog has painted (it decodes every obj once). */
function useItemCatalog(cache: CacheSystem | null, active: boolean): ItemCatalog | null {
  const [catalog, setCatalog] = useState<ItemCatalog | null>(null)
  useEffect(() => {
    if (!active || !cache || catalog) return
    const t = window.setTimeout(() => {
      try {
        setCatalog(getItemCatalog(cache))
      } catch {
        setCatalog(null)
      }
    }, 0)
    return () => window.clearTimeout(t)
  }, [active, cache, catalog])
  return catalog
}

export interface ConfigureDialogProps {
  /** The cache, for the item pickers' catalogs (null while loading). */
  cache: CacheSystem | null
  onStart: (config: EncounterStartConfig) => void
}

export function ConfigureDialog({ cache, onStart }: ConfigureDialogProps) {
  const open = useMenuState((s) => s.configure)
  if (!open) return null
  return <ConfigureDialogBody cache={cache} onStart={onStart} />
}

function ConfigureDialogBody({ cache, onStart }: ConfigureDialogProps) {
  const close = () => menuController.close('configure')
  useEscapeLayer(ESC_PRIORITY.CONFIGURE, true, close)
  const catalog = useItemCatalog(cache, true)
  const [loadout, setLoadout] = useState<Loadout>(loadCurrentLoadout)
  const [levels, setLevels] = useState<BaseLevels>(loadPlayerStats)
  const [drafting, setDrafting] = useState(false)
  const [nudge, setNudge] = useState(0)
  const blockId = useId()
  // Opening Configure starts from the defaults.
  useLayoutEffect(() => {
    resetEncounterMechanics()
  }, [])
  const perEncounter = useSettings((s) => s.mechanicsConfigPerEncounter)
  const config = useMemo(() => mergedMechanicsConfig(perEncounter), [perEncounter])
  const setConfig = (c: MechanicsConfig) => saveMechanicsConfig(c)

  const toggles = useMemo(() => allMechanicsToggles(), [])
  const preparation = toggles.filter((t) => t.setup === true && t.group !== 'player')
  const { mechanics, aids } = partitionToggles(toggles.filter((t) => t.setup !== true && t.group !== 'player'))
  const player = toggles.filter((t) => t.group === 'player')

  const changeLoadout = (l: Loadout) => {
    setLoadout(l)
    saveCurrentLoadout(l)
  }
  const changeLevels = (l: BaseLevels) => {
    setLevels(l)
    savePlayerStats(l)
  }
  const start = () => {
    if (drafting) {
      setNudge((n) => n + 1)
      return
    }
    onStart({ loadout, baseLevels: levels, mechanics: config })
    close()
  }
  const enc = TRIPLE_JAD_ENCOUNTER
  return (
    <div className="encounter-panel-overlay" role="dialog" aria-modal="true" aria-label={enc.displayName}>
      <button type="button" className="encounter-panel-backdrop" aria-label="Close encounter panel" onClick={close} />
      <section className="encounter-panel-card">
        <header className="encounter-panel-header">
          <div className="encounter-panel-header-info">
            <div className="encounter-panel-title-row">
              <h2>{enc.displayName}</h2>
              <WikiLink href={enc.wikiUrl} subject="Inferno" />
            </div>
            <div className="encounter-panel-header-badges">
              <span className="encounter-badge encounter-badge--difficulty">Boss</span>
              <span className="encounter-badge encounter-badge--available">Available</span>
            </div>
          </div>
          <button type="button" className="encounter-panel-close" onClick={close} aria-label="Close">
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M2 2l10 10M12 2L2 12" />
            </svg>
          </button>
        </header>
        <div className="encounter-panel-body">
          <div className="encounter-panel-main">
            <LoadoutEditor
              loadout={loadout}
              onLoadoutChange={changeLoadout}
              levels={levels}
              onLevelsChange={changeLevels}
              catalog={catalog}
              onDraftChange={(d) => {
                setDrafting(d)
                if (!d) setNudge(0)
              }}
              saveNudge={nudge}
              accountUnlocks={player.length > 0 ? <MechanicsEditor config={config} onConfigChange={setConfig} toggles={player} /> : undefined}
            />
          </div>
          <aside className="encounter-panel-rail">
            <section className="rail-section">
              <h3 className="section-label">ENCOUNTER</h3>
              <p className="encounter-description">{enc.description}</p>
            </section>
            <section className="rail-section">
              <h3 className="section-label">PREPARATION</h3>
              <MechanicsEditor config={config} onConfigChange={setConfig} toggles={preparation.length > 0 ? preparation : [AUTO_PREPOT_TOGGLE]} />
              {mechanics.length > 0 && (
                <div className="encounter-fight-controls">
                  <h3 className="section-label">MECHANICS</h3>
                  <MechanicsEditor config={config} onConfigChange={setConfig} toggles={mechanics} />
                </div>
              )}
              {aids.length > 0 && (
                <fieldset className="encounter-practice-aids">
                  <legend className="section-label">Practice Aids</legend>
                  <MechanicsEditor config={config} onConfigChange={setConfig} toggles={aids} />
                </fieldset>
              )}
            </section>
          </aside>
        </div>
        <footer className="encounter-panel-footer">
          {drafting && (
            <p className="encounter-start-block" role="status" id={blockId}>
              Save this loadout or pick one from the list to start.
            </p>
          )}
          <OsrsButton onClick={close}>Cancel</OsrsButton>
          <OsrsButton variant="primary" className="encounter-start-btn" onClick={start} ariaDisabled={drafting} {...(drafting ? { describedBy: blockId } : {})}>
            Start Encounter
          </OsrsButton>
        </footer>
      </section>
    </div>
  )
}

export { PLAYER_TOGGLES }
