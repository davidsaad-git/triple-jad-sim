import type { CSSProperties } from 'react'
import type { SkillName } from '../../../sim/api'
import { usePackAsset, useActivePack, packAsset } from '../../packs'
import { useSimState } from '../context'
import { CONTENT_BOX, skillCellOrigin } from '../layout'
import { ComposedSprite } from '../sprites/ComposedSprite'

/**
 * Skills tab: 23 skills
 * in OSRS order on one composed canvas, levels in RuneScape Plain 11 yellow.
 * Combat skills show current/max from the engine, the rest 99/99.
 */

export const SKILLS: readonly { name: string; label: string; stat: SkillName | null }[] = [
  { name: 'attack', label: 'Attack', stat: 'attack' },
  { name: 'hitpoints', label: 'Hitpoints', stat: 'hitpoints' },
  { name: 'mining', label: 'Mining', stat: null },
  { name: 'strength', label: 'Strength', stat: 'strength' },
  { name: 'agility', label: 'Agility', stat: null },
  { name: 'smithing', label: 'Smithing', stat: null },
  { name: 'defence', label: 'Defence', stat: 'defence' },
  { name: 'herblore', label: 'Herblore', stat: null },
  { name: 'fishing', label: 'Fishing', stat: null },
  { name: 'ranged', label: 'Ranged', stat: 'ranged' },
  { name: 'thieving', label: 'Thieving', stat: null },
  { name: 'cooking', label: 'Cooking', stat: null },
  { name: 'prayer', label: 'Prayer', stat: 'prayer' },
  { name: 'crafting', label: 'Crafting', stat: null },
  { name: 'firemaking', label: 'Firemaking', stat: null },
  { name: 'magic', label: 'Magic', stat: 'magic' },
  { name: 'fletching', label: 'Fletching', stat: null },
  { name: 'woodcutting', label: 'Woodcutting', stat: null },
  { name: 'runecraft', label: 'Runecraft', stat: null },
  { name: 'slayer', label: 'Slayer', stat: null },
  { name: 'farming', label: 'Farming', stat: null },
  { name: 'construction', label: 'Construction', stat: null },
  { name: 'hunter', label: 'Hunter', stat: null },
]

const levelStyle = (x: number, y: number): CSSProperties => ({
  position: 'absolute',
  left: x,
  top: y,
  width: 15,
  textAlign: 'center',
  whiteSpace: 'nowrap',
  fontFamily: '"RuneScape Plain 11", sans-serif',
  fontSize: '16px',
  lineHeight: '12px',
  color: '#FFFF00',
  textShadow: '1px 1px 0 #000',
})

export function SkillsTab() {
  const state = useSimState()
  const pack = useActivePack()
  const tileLeft = usePackAsset('stats/new_tile_left.png')
  const tileRight = usePackAsset('stats/new_tile_right_with_slash.png')
  const icons = SKILLS.map((s) => packAsset(`skill/${s.name}.png`, pack))
  const sources = [tileLeft, tileRight, ...icons]
  return (
    <div style={{ width: CONTENT_BOX.width, height: CONTENT_BOX.height, position: 'relative' }} data-testid="skills-panel">
      <ComposedSprite
        cacheKey={`skills|${sources.join(',')}`}
        width={CONTENT_BOX.width}
        height={CONTENT_BOX.height}
        sources={sources}
        style={{ zIndex: 0, imageRendering: 'pixelated' }}
        draw={(ctx, images) => {
          const l = images.get(tileLeft)
          const r = images.get(tileRight)
          if (!l || !r) return
          SKILLS.forEach((_, i) => {
            const o = skillCellOrigin(i)
            ctx.drawImage(l, o.x, o.y, 36, 36)
            ctx.drawImage(r, o.x + 31, o.y, 36, 36)
            const icon = images.get(icons[i]!)
            if (icon) ctx.drawImage(icon, o.x + 3, o.y + 4, 25, 25)
          })
        }}
      />
      {SKILLS.map((s, i) => {
        const o = skillCellOrigin(i)
        const lv = s.stat === null ? { current: 99, base: 99 } : { current: state.stats[s.stat].current, base: state.stats[s.stat].max }
        return (
          <fieldset
            key={s.name}
            data-testid={`skill-cell-${s.name}`}
            aria-label={`${s.label}: level ${lv.current}, base ${lv.base}`}
            style={{ position: 'absolute', left: o.x, top: o.y, width: 67, height: 36, minInlineSize: 0, margin: 0, padding: 0, border: 0, pointerEvents: 'none', zIndex: 1 }}
          >
            <div data-testid={`skill-current-${s.name}`} style={levelStyle(32, 4)}>
              {lv.current}
            </div>
            <div data-testid={`skill-base-${s.name}`} style={levelStyle(44, 16)}>
              {lv.base}
            </div>
          </fieldset>
        )
      })}
    </div>
  )
}
