import './menu.css'

export interface TopMenuProps {
  onOpen: (dialog: 'settings' | 'encounters') => void
  onRestart: () => void
}

/** scim.gg-style top-left menu buttons. */
export function TopMenu({ onOpen, onRestart }: TopMenuProps) {
  return (
    <div className="top-menu">
      <button type="button" className="top-menu__btn" onClick={() => onOpen('settings')}>
        Settings
      </button>
      <button type="button" className="top-menu__btn" onClick={() => onOpen('encounters')} title="Browse encounters (Ctrl+K)">
        Encounters
      </button>
      <button type="button" className="top-menu__btn" onClick={onRestart} title="Restart wave (Ctrl+R)">
        Restart
      </button>
    </div>
  )
}
