/**
 * Convenience composition of every menu surface for the integrator: nav,
 * Settings, Plugins, Encounters picker, Configure, Shortcuts, the placeholder
 * modals and the tip toasts. Global Ctrl+K belongs to INPUT's hotkeys: wire
 * its `onToggleEncounterPicker` to `menuController.toggle('encounters')`.
 */
import type { CacheSystem } from '../../cache/CacheSystem'
import type { SimRuntime } from '../../app/runtime/types'
import { ConfigureDialog } from './ConfigureDialog'
import { loadStartConfig, resetEncounterMechanics, type EncounterStartConfig } from './encounter'
import { EncountersPicker } from './EncountersPicker'
import { menuController } from './menuState'
import { ReplaysModal, TrainingModal, WhatsNewModal } from './PlaceholderModals'
import { PluginsPanel } from './PluginsPanel'
import { SettingsPanel, type SettingsPanelProps } from './SettingsPanel'
import { ShortcutHintToasts } from './ShortcutHintToasts'
import { ShortcutsDialog } from './ShortcutsDialog'
import { TopNav } from './TopNav'

export interface AppMenusProps {
  runtime: SimRuntime | null
  cache: CacheSystem | null
  /** Encounters / Training / Replays / Plugins render once the world is ready. */
  worldReady?: boolean
  /** Start (or restart) the run with this configuration. */
  onStart: (config: EncounterStartConfig) => void
  /** True while the intro plays (disables Restart Simulation). */
  introActive?: boolean
  settings?: Omit<SettingsPanelProps, 'onRestart' | 'restartDisabled'>
  markersReadOnly?: boolean
}

export function AppMenus({ runtime, cache, worldReady = true, onStart, introActive = false, settings, markersReadOnly = false }: AppMenusProps) {
  return (
    <>
      <TopNav worldReady={worldReady} />
      <SettingsPanel {...settings} {...(runtime ? { onRestart: () => runtime.restart() } : {})} restartDisabled={introActive} />
      <PluginsPanel markersReadOnly={markersReadOnly} />
      <EncountersPicker
        onEnter={() => {
          // "Enter": current loadout, default mechanics (wipes the stored overrides).
          resetEncounterMechanics()
          onStart(loadStartConfig())
        }}
        onConfigure={() => menuController.open('configure')}
      />
      <ConfigureDialog cache={cache} onStart={onStart} />
      <ShortcutsDialog />
      <WhatsNewModal />
      <TrainingModal />
      <ReplaysModal />
      <ShortcutHintToasts />
    </>
  )
}
