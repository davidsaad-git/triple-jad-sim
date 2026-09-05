import type { UiActions, SideTab } from '../../app/HudState'
import type { ClientLayout } from './ClientFrame'
import { CombatPanel } from './panels/CombatPanel'
import { EquipmentPanel } from './panels/EquipmentPanel'
import { InventoryPanel } from './panels/InventoryPanel'
import { MagicPanel } from './panels/MagicPanel'
import { PrayerPanel } from './panels/PrayerPanel'
import { SettingsPanel } from './panels/SettingsPanel'
import { StatsPanel } from './panels/StatsPanel'
import './SidePanel.css'

const TOP_TABS: { key: SideTab; label: string; hotkey: string }[] = [
  { key: 'combat', label: 'Combat Options', hotkey: 'F1' },
  { key: 'stats', label: 'Skills', hotkey: 'F2' },
  { key: 'inventory', label: 'Inventory', hotkey: 'Esc' },
  { key: 'equipment', label: 'Worn Equipment', hotkey: 'F4' },
  { key: 'prayer', label: 'Prayer', hotkey: 'F5' },
  { key: 'magic', label: 'Magic', hotkey: 'F6' },
  { key: 'settings', label: 'Settings', hotkey: 'F10' },
]

export function SidePanel({ layout, activeTab, actions }: { layout: ClientLayout; activeTab: SideTab; actions: UiActions }) {
  return (
    <div className={`side-panel side-panel--${layout}`}>
      <div className="side-panel__tabs side-panel__tabs--top">
        {TOP_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`side-tab side-tab--${t.key}${activeTab === t.key ? ' side-tab--active' : ''}`}
            title={`${t.label} (${t.hotkey})`}
            onClick={() => actions.setTab(t.key)}
          >
            <span className="side-tab__icon" aria-hidden="true" />
          </button>
        ))}
      </div>
      <div className="side-panel__content">
        {activeTab === 'combat' && <CombatPanel />}
        {activeTab === 'stats' && <StatsPanel />}
        {activeTab === 'inventory' && <InventoryPanel actions={actions} />}
        {activeTab === 'equipment' && <EquipmentPanel actions={actions} />}
        {activeTab === 'prayer' && <PrayerPanel actions={actions} />}
        {activeTab === 'magic' && <MagicPanel />}
        {activeTab === 'settings' && <SettingsPanel />}
      </div>
      <div className="side-panel__tabs side-panel__tabs--bottom">
        {['clan', 'friends', 'account', 'logout', 'options', 'emotes', 'music'].map((k) => (
          <button key={k} type="button" className={`side-tab side-tab--${k} side-tab--disabled`} title={k} disabled>
            <span className="side-tab__icon" aria-hidden="true" />
          </button>
        ))}
      </div>
    </div>
  )
}
