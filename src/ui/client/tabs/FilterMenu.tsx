import { type ReactNode, useEffect, useRef, useState } from 'react'
import { packAsset, useActivePack } from '../../packs'
import { PixelSprite } from '../sprites/PixelSprite'

/**
 * Prayer / spellbook filter view: 25 px rows,
 * 180 wide at (12,21); round checkbox at x 5; hover wash 30/255 white, press
 * flash 45/255 for 800 ms.
 */

export interface FilterRow {
  key: string
  label: ReactNode
  checked: boolean
  disabled?: boolean
  height?: number
  onToggle: () => void
}

const HOVER = 30 / 255
const PRESS = 45 / 255
const PRESS_MS = 800

export function FilterMenu({ rows }: { rows: readonly FilterRow[] }) {
  const pack = useActivePack()
  const [hover, setHover] = useState<string | null>(null)
  const [pressed, setPressed] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )
  const flash = (key: string): void => {
    if (timer.current !== null) clearTimeout(timer.current)
    setPressed(key)
    timer.current = setTimeout(() => {
      timer.current = null
      setPressed(null)
    }, PRESS_MS)
  }
  return (
    <div style={{ position: 'absolute', left: 12, top: 21, width: 180, zIndex: 3 }}>
      {rows.map((r) => {
        const h = r.height ?? 25
        const wash = r.disabled ? 0 : pressed === r.key ? PRESS : hover === r.key ? HOVER : 0
        const icon = r.disabled ? 'options/round_check_box_checked.png' : r.checked ? 'options/round_check_box_checked_green.png' : 'options/round_check_box_crossed2.png'
        return (
          <button
            key={r.key}
            type="button"
            data-filter-menu-row={r.key}
            aria-pressed={r.checked}
            disabled={r.disabled}
            onMouseEnter={() => setHover(r.key)}
            onMouseLeave={() => setHover(null)}
            onMouseDown={() => flash(r.key)}
            onClick={r.onToggle}
            style={{ position: 'relative', display: 'block', width: '100%', height: h, paddingTop: 2, paddingBottom: 1, paddingLeft: 0, paddingRight: 0, margin: 0, border: 'none', borderRadius: 0, background: 'transparent', boxSizing: 'border-box', cursor: 'default', outline: 'none', textAlign: 'left' }}
          >
            {wash > 0 && <div style={{ position: 'absolute', inset: 0, background: `rgba(255, 255, 255, ${wash})`, pointerEvents: 'none' }} />}
            <PixelSprite src={packAsset(icon, pack)} alt="" style={{ position: 'absolute', left: 5, top: Math.trunc(h / 2) - 8, width: 17, height: 17, imageRendering: 'pixelated', pointerEvents: 'none' }} />
            <span style={{ display: 'block', marginLeft: 25, width: 150, fontFamily: '"RuneScape Plain 11", sans-serif', fontSize: '16px', lineHeight: '11px', color: r.disabled ? '#9f9f9f' : '#ff981f', textShadow: '1px 1px 0 #000' }}>{r.label}</span>
          </button>
        )
      })}
    </div>
  )
}
