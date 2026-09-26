import { type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode, useState } from 'react'
import type { Spellbook } from '../../../sim/api'
import { autocastSpell, weaponCategory, type WeaponStyle } from '../../../sim/combat/weaponCategories'
import { spellsOfBook, spellIcon } from '../../../sim/combat/spells'
import { bindTooltip } from '../../../input/tooltip'
import { packAsset, uiAsset } from '../../packs'
import { clientColors } from '../../theme/palettes'
import { selectAttackStyle, selectSpell, toggleSpecialAttack } from '../actions'
import { usePresentation, useClient, useSimState } from '../context'
import { hasSpecialAttack, itemDisplayName, itemLookup } from '../items'
import { combatLevel, CONTENT_BOX } from '../layout'
import { NineSlice } from '../sprites/NineSlice'
import { PixelSprite } from '../sprites/PixelSprite'
import { spellIconUrl } from './spellIcons'

/**
 * Combat Options tab.
 * Style buttons and the special attack bar act on mouse down; Auto Retaliate
 * is drawn but inert (always "(Off)").
 */

const SHADOW = '1px 1px 0 #000'
const SPEC = { yellow: '#FFD700', white: '#ffffff', bg: '#730606', fill: '#397d3b', border: '#2c2a23', text: '#000010' }

const G = {
  weaponName: { x: 17, y: 7, w: 169, h: 30 },
  combatLevel: { x: 17, y: 33, w: 169, h: 12 },
  category: { x: 7, y: 238, w: 190, h: 28 },
  normalSlots: [
    { x: 27, y: 52, w: 71, h: 47 },
    { x: 106, y: 52, w: 71, h: 47 },
    { x: 27, y: 106, w: 71, h: 47 },
    { x: 106, y: 106, w: 71, h: 47 },
  ],
  thinSlots: [
    { x: 27, y: 52, w: 71, h: 32 },
    { x: 27, y: 88, w: 71, h: 32 },
    { x: 27, y: 124, w: 71, h: 32 },
  ],
  autocastDef: { x: 106, y: 52, w: 71, h: 47 },
  autocastNormal: { x: 106, y: 106, w: 71, h: 47 },
  retaliate: { x: 27, y: 160, w: 150, h: 44 },
  retaliateIcon: { x: 31, y: 162, w: 26, h: 39 },
  retaliateText: { x: 61, y: 160, w: 112, h: 44 },
  specBar: { x: 27, y: 211, w: 150, h: 26 },
  specInner: { x: 29, y: 218, w: 146, h: 12 },
  specBorder: { x: 29, y: 217, w: 146, h: 14 },
} as const

function StoneButton({ active, style, children, onMouseDown, ...rest }: { active: boolean; style: CSSProperties; children: ReactNode; onMouseDown?: (e: ReactMouseEvent) => void } & Record<string, unknown>) {
  return (
    <button
      type="button"
      onMouseDown={onMouseDown}
      style={{ position: 'absolute', border: 'none', padding: 0, margin: 0, cursor: 'default', outline: 'none', backgroundColor: 'transparent', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: active ? SPEC.white : clientColors.primary, textShadow: SHADOW, fontFamily: '"RuneScape Plain 11", sans-serif', fontSize: '16px', imageRendering: 'pixelated', ...style }}
      {...rest}
    >
      <NineSlice selected={active} />
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>{children}</div>
    </button>
  )
}

const isCasting = (s: WeaponStyle): boolean => s.combatStyle === 'Casting' || s.combatStyle === 'Defensive Casting'

export function CombatTab() {
  const { runtime } = useClient()
  const presentation = usePresentation()
  const state = useSimState()
  const [pickerStyle, setPickerStyle] = useState<number | null>(null)
  const weaponId = state.playerEquipment.weapon
  const lookup = itemLookup(runtime.cache)
  const category = weaponCategory(weaponId)
  const weaponName = weaponId !== undefined ? itemDisplayName(lookup.item(weaponId), category.name) : category.name
  const styles = category.styles
  const normal = styles.filter((s) => !isCasting(s))
  const casting = styles
    .filter(isCasting)
    .slice()
    .sort((a, b) => (a.combatStyle === 'Defensive Casting' ? -1 : b.combatStyle === 'Defensive Casting' ? 1 : 0))
  const hasCasting = casting.length > 0
  const selectedIndex = presentation.attackStyle.get() ?? state.selectedAttackStyleIndex
  const selectedSpell = presentation.selectedSpell.get() !== undefined ? (presentation.selectedSpell.get() ?? null) : state.playerCombatSupplies.selectedSpell
  const spellbook = state.playerCombatSupplies.spellbook
  const specAvailable = hasSpecialAttack(runtime.cache, weaponId)
  const specArmed = presentation.specialActive(state)
  const specPercent = state.specialAttack.energy
  const level = combatLevel(state.stats)

  const onStyle = (index: number) => (e: ReactMouseEvent) => {
    if (e.button !== 0) return
    selectAttackStyle(runtime, presentation, index)
  }

  if (pickerStyle !== null) {
    const style = styles[pickerStyle]
    return (
      <div style={{ width: CONTENT_BOX.width, height: CONTENT_BOX.height, position: 'relative' }}>
        <AutocastPicker
          spellbook={spellbook}
          selectedSpell={selectedSpell}
          defensive={style?.combatStyle === 'Defensive Casting'}
          onSelect={(spell) => {
            selectSpell(runtime, presentation, spell)
            selectAttackStyle(runtime, presentation, pickerStyle)
            setPickerStyle(null)
          }}
          onCancel={() => setPickerStyle(null)}
        />
      </div>
    )
  }

  const styleButton = (st: WeaponStyle, slot: { x: number; y: number; w: number; h: number }, thin: boolean) => {
    const index = styles.indexOf(st)
    return (
      <StoneButton key={st.icon + index} active={selectedIndex === index} onMouseDown={onStyle(index)} style={{ left: slot.x, top: slot.y, width: slot.w, height: slot.h }}>
        <PixelSprite src={uiAsset(`combat-styles/${st.icon}`)} alt={st.name} style={thin ? { maxHeight: 18, maxWidth: 30, objectFit: 'contain', marginBottom: 1 } : { maxHeight: 20, maxWidth: 34, objectFit: 'contain', marginBottom: 2 }} />
        <div style={thin ? { fontSize: '14px', lineHeight: '12px' } : { fontSize: '16px', lineHeight: '13px' }}>{st.name}</div>
      </StoneButton>
    )
  }

  const autocastButton = (st: WeaponStyle) => {
    const index = styles.indexOf(st)
    const slot = st.combatStyle === 'Defensive Casting' ? G.autocastDef : G.autocastNormal
    const spell = autocastSpell({ weaponId, selectedStyleIndex: index, selectedSpell, spellbook })
    return (
      <StoneButton
        key={st.icon + index}
        active={selectedIndex === index}
        onMouseDown={(e: ReactMouseEvent) => {
          if (e.button !== 0) return
          setPickerStyle(index)
        }}
        style={{ left: slot.x, top: slot.y, width: slot.w, height: slot.h }}
      >
        {spell ? (
          <PixelSprite src={spellIconUrl(spell.spellbook, spell.icon, 24, true)} alt={spell.name} style={{ maxHeight: 22, maxWidth: 30, objectFit: 'contain', marginBottom: 1, imageRendering: 'pixelated' }} />
        ) : (
          <PixelSprite src={uiAsset(`combat-styles/${st.icon}`)} alt={st.name} style={{ maxHeight: 20, maxWidth: 30, objectFit: 'contain', marginBottom: 1 }} />
        )}
        <div style={{ fontSize: '14px', lineHeight: '12px' }}>{st.combatStyle === 'Defensive Casting' ? 'Def. Autocast' : 'Autocast'}</div>
      </StoneButton>
    )
  }

  const text = (g: { x: number; y: number; w: number; h: number }, font: string, children: ReactNode, extra?: CSSProperties) => (
    <div style={{ position: 'absolute', left: g.x, top: g.y, width: g.w, height: g.h, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: font, fontSize: '16px', color: clientColors.primary, textShadow: SHADOW, ...extra }}>{children}</div>
  )

  return (
    <div style={{ width: CONTENT_BOX.width, height: CONTENT_BOX.height, position: 'relative' }} data-testid="combat-panel">
      {text(G.weaponName, '"RuneScape Quill 8", sans-serif', weaponName, { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' })}
      {text(G.combatLevel, '"RuneScape Plain 11", sans-serif', <>Combat Lvl: {level}</>)}
      {!hasCasting && normal.map((st, i) => styleButton(st, G.normalSlots[i] ?? G.normalSlots[0], false))}
      {hasCasting && normal.map((st, i) => styleButton(st, G.thinSlots[i] ?? G.thinSlots[0], true))}
      {hasCasting && casting.map(autocastButton)}
      <button type="button" style={{ position: 'absolute', left: G.retaliate.x, top: G.retaliate.y, width: G.retaliate.w, height: G.retaliate.h, border: 'none', background: 'transparent', cursor: 'default', outline: 'none', padding: 0, margin: 0, boxSizing: 'border-box' }}>
        <NineSlice selected={false} />
        <PixelSprite
          src={packAsset('combat/auto_retaliate.png')}
          alt="Auto Retaliate"
          style={{ position: 'absolute', left: G.retaliateIcon.x - G.retaliate.x, top: G.retaliateIcon.y - G.retaliate.y, width: G.retaliateIcon.w, height: G.retaliateIcon.h, imageRendering: 'pixelated' }}
        />
        <div style={{ position: 'absolute', left: G.retaliateText.x - G.retaliate.x, top: G.retaliateText.y - G.retaliate.y, width: G.retaliateText.w, height: G.retaliateText.h, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: '"RuneScape Plain 11", sans-serif', fontSize: '16px', color: clientColors.primary, textShadow: SHADOW }}>
          <div>Auto Retaliate</div>
          <div>(Off)</div>
        </div>
      </button>
      {specAvailable && (
        <button
          type="button"
          onMouseDown={(e) => {
            if (e.button === 0) toggleSpecialAttack(runtime, presentation)
          }}
          style={{ position: 'absolute', left: G.specBar.x, top: G.specBar.y, width: G.specBar.w, height: G.specBar.h, border: 'none', background: 'transparent', cursor: 'default', outline: 'none', padding: 0, margin: 0, boxSizing: 'border-box' }}
        >
          <NineSlice selected={specArmed} />
          <div style={{ position: 'absolute', left: G.specBorder.x - G.specBar.x, top: G.specBorder.y - G.specBar.y, width: G.specBorder.w, height: G.specBorder.h, border: `1px solid ${SPEC.border}`, boxSizing: 'border-box' }} />
          <div style={{ position: 'absolute', left: G.specInner.x - G.specBar.x, top: G.specInner.y - G.specBar.y, width: G.specInner.w, height: G.specInner.h, backgroundColor: SPEC.bg }} />
          <div style={{ position: 'absolute', left: G.specInner.x - G.specBar.x, top: G.specInner.y - G.specBar.y, width: G.specInner.w * Math.max(0, Math.min(1, specPercent / 100)), height: G.specInner.h, backgroundColor: SPEC.fill }} />
          <div style={{ position: 'absolute', left: 0, top: 0, width: G.specBar.w, height: G.specBar.h, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"RuneScape Plain 11", sans-serif', fontSize: '16px', color: specArmed ? SPEC.yellow : SPEC.text, textShadow: specArmed ? SHADOW : 'none' }}>
            Special Attack: {Math.floor(specPercent)}%
          </div>
        </button>
      )}
      {text(G.category, '"RuneScape Plain 11", sans-serif', <>Category: {category.name}</>)}
    </div>
  )
}

/** "Select an autocast spell" picker. */
function AutocastPicker({ spellbook, selectedSpell, defensive, onSelect, onCancel }: { spellbook: Spellbook; selectedSpell: string | null; defensive: boolean; onSelect: (spell: string) => void; onCancel: () => void }) {
  const spells = spellsOfBook(spellbook)
  const perRow = Math.max(1, Math.min(4, spells.length))
  const gap = perRow > 1 ? Math.floor((190 - perRow * 40) / (perRow - 1)) : 0
  const rowWidth = perRow * 40 + (perRow - 1) * gap
  const startX = 7 + Math.floor((190 - rowWidth) / 2)
  const bookName: Record<Spellbook, string> = { standard: 'Standard', ancient: 'Ancient', lunar: 'Lunar', arceuus: 'Arceuus' }
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 3 }}>
      <div style={{ position: 'absolute', left: 7, top: 7, width: 190, height: 26, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: '"RuneScape Bold 12", sans-serif', fontSize: '16px', color: clientColors.primary, textShadow: SHADOW, textAlign: 'center' }}>
        <div>Select an autocast spell</div>
      </div>
      {spells.length === 0 ? (
        <div style={{ position: 'absolute', left: 7, top: 33, width: 190, fontFamily: '"RuneScape Plain 11", sans-serif', fontSize: '16px', color: clientColors.primary, textShadow: SHADOW, textAlign: 'center' }}>No autocast spells on the {bookName[spellbook]} spellbook.</div>
      ) : (
        spells.map((sp, i) => {
          const col = i % perRow
          const row = Math.floor(i / perRow)
          const selected = sp.name === selectedSpell
          return (
            <button
              key={sp.name}
              type="button"
              {...bindTooltip(() => ({ lines: [{ spans: [{ text: defensive ? 'Defensive autocast ' : 'Autocast ', color: '#00ff00' }, { text: sp.name, color: clientColors.info }] }] }))}
              onMouseDown={(e) => {
                if (e.button === 0) onSelect(sp.name)
              }}
              style={{ position: 'absolute', left: startX + col * (40 + gap), top: 33 + row * 46, width: 40, height: 40, padding: 0, margin: 0, border: selected ? `1px solid ${clientColors.primary}` : '1px solid transparent', background: 'transparent', cursor: 'default', outline: 'none', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <PixelSprite src={spellIconUrl(sp.spellbook, spellIcon(sp.name), 40, true)} alt={sp.name} style={{ width: 38, height: 38, pointerEvents: 'none', imageRendering: 'pixelated' }} />
            </button>
          )
        })
      )}
      <button
        type="button"
        onMouseDown={(e) => {
          if (e.button === 0) onCancel()
        }}
        style={{ position: 'absolute', left: 7 + 67, top: 242, width: 56, height: 18, border: 'none', background: 'transparent', padding: '1px 0', margin: 0, cursor: 'default', outline: 'none', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: '"RuneScape Bold 12", sans-serif', fontSize: '14px', color: clientColors.primary, textShadow: SHADOW }}
      >
        <NineSlice />
        <span style={{ position: 'relative', zIndex: 1 }}>Cancel</span>
      </button>
    </div>
  )
}
