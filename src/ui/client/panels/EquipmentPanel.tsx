import { useStore } from '../../../app/GameStore'
import { hudStore, type UiActions } from '../../../app/HudState'
import { ItemIcon } from './InventoryPanel'
import './panels.css'

/** Positions of the paper-doll slots inside the 190x261 panel (OSRS layout). */
const SLOTS: { key: string; x: number; y: number; label: string }[] = [
  { key: 'head', x: 76, y: 10, label: 'Head' },
  { key: 'cape', x: 35, y: 49, label: 'Cape' },
  { key: 'neck', x: 76, y: 49, label: 'Amulet' },
  { key: 'ammo', x: 117, y: 49, label: 'Ammunition' },
  { key: 'weapon', x: 20, y: 88, label: 'Weapon' },
  { key: 'body', x: 76, y: 88, label: 'Body' },
  { key: 'shield', x: 132, y: 88, label: 'Shield' },
  { key: 'legs', x: 76, y: 128, label: 'Legs' },
  { key: 'hands', x: 20, y: 168, label: 'Hands' },
  { key: 'feet', x: 76, y: 168, label: 'Feet' },
  { key: 'ring', x: 132, y: 168, label: 'Ring' },
]

export function EquipmentPanel({ actions }: { actions: UiActions }) {
  const equipment = useStore(hudStore, (s) => s.equipment)
  return (
    <div className="equipment">
      {SLOTS.map((s) => {
        const item = equipment[s.key] ?? null
        return (
          <button
            key={s.key}
            type="button"
            className="equipment__slot"
            style={{ left: s.x, top: s.y }}
            title={item ? item.name : s.label}
            onClick={() => actions.clickEquipment(s.key)}
          >
            {item && <ItemIcon id={item.id} name={item.name} quantity={item.quantity} />}
          </button>
        )
      })}
    </div>
  )
}
