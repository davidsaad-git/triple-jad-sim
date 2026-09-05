import { useStore } from '../../../app/GameStore'
import { hudStore, type UiActions } from '../../../app/HudState'
import './panels.css'

export function InventoryPanel({ actions }: { actions: UiActions }) {
  const inventory = useStore(hudStore, (s) => s.inventory)
  return (
    <div className="inventory">
      {inventory.map((item, i) => (
        <button
          key={i}
          type="button"
          className={`inventory__slot${item ? ' inventory__slot--filled' : ''}`}
          title={item ? item.name : ''}
          onClick={() => item && actions.clickInventory(i)}
        >
          {item && <ItemIcon id={item.id} name={item.name} quantity={item.quantity} />}
        </button>
      ))}
    </div>
  )
}

export function ItemIcon({ id, name, quantity }: { id: number; name: string; quantity: number }) {
  return (
    <span className="item-icon" data-item-id={id}>
      <img src={`/items/${id}.png`} alt={name} draggable={false} onError={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')} />
      {quantity > 1 && <span className={`item-icon__qty${quantity >= 100000 ? ' item-icon__qty--k' : ''}`}>{formatQty(quantity)}</span>}
    </span>
  )
}

function formatQty(q: number): string {
  if (q >= 10_000_000) return `${Math.floor(q / 1_000_000)}M`
  if (q >= 100_000) return `${Math.floor(q / 1000)}K`
  return String(q)
}
