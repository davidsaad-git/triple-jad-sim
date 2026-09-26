import { describe, expect, it } from 'vitest'
import {
  arcOrbCentres,
  avoidExclusions,
  CHAT_REPORT_X,
  clampModernPanelPosition,
  combatLevel,
  COMPACT_ORB_LAYOUTS,
  computeFrameBox,
  defaultInfoboxPosition,
  FIXED,
  FIXED_MINIMAP,
  fixedClientSize,
  fixedOrbCentres,
  flickSweep,
  formatStackQuantity,
  infoboxAbovePanel,
  infoboxContentScale,
  infoboxDockSize,
  infoboxStripSize,
  inventorySlotAt,
  inventorySlotOrigin,
  minimapDotOffset,
  minimapTransform,
  normalizeCompactLayout,
  normalizeOrbOrder,
  orbEmptyHeight,
  orbValueColor,
  panelMetrics,
  prayerCellOrigin,
  rescaleOnResize,
  selectedStone,
  skillCellOrigin,
  snapRect,
  spellGridLayout,
  statusBarFill,
  statusBarsGeometry,
  stepScale,
  tooltipScaleFor,
  UI_SCALE_STEPS,
} from './layout'

const round2 = (n: number): number => Math.round(n * 100) / 100

describe('fixed layout rects', () => {
  it('matches the 765x503 table', () => {
    expect(FIXED.viewport).toEqual({ x: 4, y: 4, width: 512, height: 334 })
    expect(FIXED.viewportCollapsed).toEqual({ x: 4, y: 4, width: 512, height: 476 })
    expect(FIXED.minimapBlock).toEqual({ x: 516, y: 0, width: 249, height: 167 })
    expect(FIXED.sidePanelBlock).toEqual({ x: 516, y: 167, width: 249, height: 336 })
    expect(FIXED.chatbox).toEqual({ x: 0, y: 338, width: 519, height: 165 })
    expect(FIXED.chatButtons).toEqual({ x: 0, y: 480, width: 519, height: 23 })
    expect(FIXED.chatInner).toEqual({ x: 7, y: 344, width: 505, height: 130 })
    expect(FIXED.chatScrollbar).toEqual({ x: 496, y: 344, width: 16, height: 114 })
    expect(FIXED.chatInput).toEqual({ x: 7, y: 458, width: 505, height: 16 })
    expect(CHAT_REPORT_X).toBe(437)
    // Viewport collapsed height ends at the chat buttons row.
    expect(FIXED.viewportCollapsed.y + FIXED.viewportCollapsed.height).toBe(FIXED.chatButtons.y)
  })

  it('snaps rects edge-to-edge', () => {
    expect(snapRect({ x: 516, y: 0, width: 249, height: 167 }, 1.5)).toEqual({ x: 774, y: 0, width: 374, height: 251 })
    const a = snapRect({ x: 0, y: 0, width: 516, height: 10 }, 1.37)
    const b = snapRect({ x: 516, y: 0, width: 249, height: 10 }, 1.37)
    expect(a.x + a.width).toBe(b.x)
  })

  it('sizes the fixed client for a window and a scale choice', () => {
    expect(fixedClientSize(1530, 1006, 'fit')).toEqual({ scale: 2, width: 1530, height: 1006 })
    expect(fixedClientSize(1000, 2000, 'fit').width).toBe(1000)
    expect(fixedClientSize(100, 100, 'fit').width).toBe(Math.round(765 * 0.5))
    expect(fixedClientSize(4000, 4000, 1.5)).toEqual({ scale: 1148 / 765, width: 1148, height: 755 })
    expect(fixedClientSize(4000, 4000, 99).width).toBe(765 * 6)
  })

  it('computes the viewport frame box', () => {
    const fit = computeFrameBox('modern', { mode: 'fit', width: 765, height: 503, presetId: 'fit' }, 'fit', 1280, 720)
    expect(fit).toMatchObject({ kind: 'fit', left: 0, top: 0, width: 1280, height: 720 })
    const fixedRes = computeFrameBox('classic', { mode: 'fixed', width: 765, height: 503, presetId: 'osrs-fixed' }, 'fit', 1280, 720)
    expect(fixedRes).toMatchObject({ kind: 'fixed-resolution', left: 258, top: 109, width: 765, height: 503 })
    const fixedLayout = computeFrameBox('fixed', { mode: 'fit', width: 765, height: 503, presetId: 'fit' }, 1, 1000, 700)
    expect(fixedLayout).toMatchObject({ kind: 'fixed-layout', left: 118, top: 99, width: 765, height: 503, fixedScale: 1 })
  })
})

describe('side panel geometry', () => {
  it('uses the per-layout content box', () => {
    expect(panelMetrics('modern')).toEqual({ width: 204, height: 275 })
    expect(panelMetrics('classic')).toEqual({ width: 241, height: 335 })
    expect(panelMetrics('fixed')).toEqual({ width: 249, height: 336 })
  })

  it('keeps the modern panel above the tab bar', () => {
    expect(clampModernPanelPosition({ x: 0, y: 0, anchorX: 'right', anchorY: 'bottom' }, 1).y).toBe(38)
    expect(clampModernPanelPosition({ x: 0, y: 0, anchorX: 'right', anchorY: 'bottom' }, 2).y).toBe(74)
    expect(clampModernPanelPosition({ x: 5, y: 100, anchorX: 'left', anchorY: 'top' }, 1).y).toBe(100)
  })

  it('picks corner stones for the end slots of a tab row', () => {
    expect(selectedStone('top', 0).stone).toBe('topLeft')
    expect(selectedStone('top', 6).stone).toBe('topRight')
    expect(selectedStone('bottom', 0).stone).toBe('bottomLeft')
    expect(selectedStone('top', 3).stone).toBe('middle')
  })

  it('lays out inventory, prayer and skill grids', () => {
    expect(inventorySlotOrigin(0)).toEqual({ x: 23, y: 15 })
    expect(inventorySlotOrigin(5)).toEqual({ x: 65, y: 51 })
    expect(inventorySlotOrigin(27)).toEqual({ x: 149, y: 231 })
    expect(inventorySlotAt(20, 13)).toBe(0)
    expect(inventorySlotAt(19, 13)).toBeNull()
    expect(inventorySlotAt(20 + 42 * 3 + 41, 13 + 36 * 6 + 35)).toBe(27)
    expect(inventorySlotAt(20 + 42 * 4, 13)).toBeNull()
    expect(prayerCellOrigin(0)).toEqual({ x: 11, y: 16 })
    expect(prayerCellOrigin(6)).toEqual({ x: 48, y: 53 })
    expect(skillCellOrigin(4)).toEqual({ x: 71, y: 38 })
  })

  it('places spellbook grids', () => {
    const ancient = spellGridLayout(false, 27, 'ancient')
    expect([ancient.startX, ancient.startY, ancient.cols]).toEqual([26, 15, 4])
    const arceuus = spellGridLayout(false, 45, 'arceuus')
    expect([arceuus.startX, arceuus.startY, arceuus.cols]).toEqual([7, 7, 6])
    const filtered = spellGridLayout(true, 6, 'ancient')
    expect(filtered.slotSize).toBe(40)
    expect(filtered.cols).toBe(3)
  })

  it('formats stack quantities', () => {
    expect(formatStackQuantity(4000)).toEqual({ text: '4000', color: '#ffff00' })
    expect(formatStackQuantity(99_999)).toEqual({ text: '99999', color: '#ffff00' })
    expect(formatStackQuantity(100_000)).toEqual({ text: '100K', color: '#ffffff' })
    expect(formatStackQuantity(10_000_000)).toEqual({ text: '10M', color: '#00ff00' })
  })

  it('computes combat level', () => {
    const lv = (n: number) => ({ max: n })
    expect(combatLevel({ attack: lv(99), strength: lv(99), defence: lv(99), ranged: lv(99), magic: lv(99), prayer: lv(99), hitpoints: lv(99) })).toBe(126)
    expect(combatLevel({ attack: lv(1), strength: lv(1), defence: lv(1), ranged: lv(1), magic: lv(1), prayer: lv(1), hitpoints: lv(10) })).toBe(3)
  })
})

describe('UI scale', () => {
  it('steps through scim y1 stops', () => {
    expect(UI_SCALE_STEPS).toHaveLength(13)
    expect(stepScale(1, 1)).toBeCloseTo(7 / 6)
    expect(stepScale(1, -1)).toBe(1)
    expect(stepScale(3, 1)).toBe(3)
    expect(stepScale(1.2, 1)).toBeCloseTo(4 / 3)
    expect(stepScale(1.2, -1)).toBeCloseTo(7 / 6)
  })

  it('derives tooltip and infobox scales', () => {
    expect(tooltipScaleFor(2)).toBeCloseTo(1.4)
    expect(infoboxContentScale(1)).toBe(1)
    expect(infoboxContentScale(2)).toBeCloseTo(1.35 / 2)
  })
})

describe('panel positioning', () => {
  it('pushes a panel out of an exclusion rect to the nearest side', () => {
    const bounds = { left: 0, top: 0, right: 1000, bottom: 800 }
    expect(avoidExclusions(10, 100, 200, 100, bounds, [{ left: 0, top: 0, right: 320, bottom: 800 }])).toEqual({ x: 320, y: 100 })
    expect(avoidExclusions(500, 100, 200, 100, bounds, [])).toEqual({ x: 500, y: 100 })
  })

  it('rescales left/top offsets with the free space on resize and keeps right/bottom ones', () => {
    expect(rescaleOnResize({ x: 100, y: 50, anchorX: 'left', anchorY: 'top' }, 200, 100, 1200, 700, 2200, 1300)).toEqual({ x: 200, y: 100, anchorX: 'left', anchorY: 'top' })
    expect(rescaleOnResize({ x: 10, y: 20, anchorX: 'right', anchorY: 'bottom' }, 200, 100, 1200, 700, 2200, 1300)).toEqual({ x: 10, y: 20, anchorX: 'right', anchorY: 'bottom' })
  })
})

describe('orbs', () => {
  it('places the arc orbs', () => {
    const origins = arcOrbCentres().map((p) => [round2(p.x - 40), round2(p.y - 17)])
    expect(origins).toEqual([
      [42.1, 48.55],
      [41.01, 79.83],
      [51.71, 109.23],
      [72.65, 132.49],
    ])
  })

  it('places the fixed orbs from scim XB', () => {
    expect(fixedOrbCentres()).toEqual([
      { x: 40, y: 54 },
      { x: 40, y: 88 },
      { x: 50, y: 120 },
      { x: 72, y: 145 },
    ])
  })

  it('builds the compact grids', () => {
    expect([COMPACT_ORB_LAYOUTS.vertical.width, COMPACT_ORB_LAYOUTS.vertical.height]).toEqual([57, 136])
    expect([COMPACT_ORB_LAYOUTS.horizontal.width, COMPACT_ORB_LAYOUTS.horizontal.height]).toEqual([114, 68])
    expect([COMPACT_ORB_LAYOUTS['horizontal-wide'].width, COMPACT_ORB_LAYOUTS['horizontal-wide'].height]).toEqual([228, 34])
    // filled column by column
    expect(COMPACT_ORB_LAYOUTS.horizontal.centres).toEqual([
      { x: 40, y: 17 },
      { x: 40, y: 51 },
      { x: 97, y: 17 },
      { x: 97, y: 51 },
    ])
    expect(normalizeCompactLayout('diagonal')).toBe('vertical')
    expect(normalizeOrbOrder(['run', 'prayer', 'hitpoints', 'special'])).toEqual(['run', 'prayer', 'hitpoints', 'special'])
    expect(normalizeOrbOrder(['run', 'run', 'hitpoints', 'special'])).toEqual(['hitpoints', 'prayer', 'run', 'special'])
  })

  it('ramps the value colour red -> yellow -> green', () => {
    expect(orbValueColor(0, 99)).toBe('rgb(255, 0, 0)')
    expect(orbValueColor(99, 99)).toBe('rgb(0, 255, 0)')
    expect(orbValueColor(49.5, 99)).toBe('rgb(255, 255, 0)')
    expect(orbValueColor(25, 100)).toBe('rgb(255, 128, 0)')
    expect(orbValueColor(75, 100)).toBe('rgb(128, 255, 0)')
    expect(orbValueColor(150, 100)).toBe('rgb(0, 255, 0)')
    expect(orbValueColor(5, 0)).toBe('rgb(255, 0, 0)')
  })

  it('covers the empty part of the orb from the top', () => {
    expect(orbEmptyHeight(99, 99)).toBe(0)
    expect(orbEmptyHeight(0, 99)).toBe(26)
    expect(orbEmptyHeight(50, 100)).toBe(13)
    expect(orbEmptyHeight(1, 99)).toBe(25)
  })

  it('sweeps the flick line along the disc', () => {
    expect(flickSweep(0)).toEqual({ x: 0, y: 13, height: 0 })
    expect(flickSweep(0.5)).toEqual({ x: 13, y: 0, height: 26 })
    expect(flickSweep(0.999).x).toBe(25)
  })
})

describe('minimap geometry', () => {
  it('centres the player point with the zoom scale', () => {
    const t = minimapTransform(128, 128, 0, 4, 154)
    expect(t.origin).toBe('50% 50%')
    expect(t.transform).toContain(`scale(${(4 * 256) / (4 * 154)})`)
    expect(t.transform).toContain('translate(0px, 0px)')
    expect(FIXED_MINIMAP.circle.diameter).toBe(148)
  })

  it('places NPC dots relative to the player and hides them outside the circle', () => {
    expect(minimapDotOffset(10.5, 10.5, 10, 10, 0, 4, 154)).toEqual({ x: 77, y: 77 })
    expect(minimapDotOffset(12.5, 10.5, 10, 10, 0, 4, 154)).toEqual({ x: 85, y: 77 })
    const north = minimapDotOffset(10.5, 12.5, 10, 10, 0, 4, 154)!
    expect(north.y).toBe(69)
    const rotated = minimapDotOffset(10.5, 12.5, 10, 10, 90, 4, 154)!
    expect(round2(rotated.x)).toBe(85)
    expect(round2(rotated.y)).toBe(77)
    expect(minimapDotOffset(40, 10.5, 10, 10, 0, 4, 154)).toBeNull()
  })
})

describe('status bars', () => {
  it('flanks the modern panel', () => {
    const g = statusBarsGeometry('modern')
    expect(g.left).toEqual({ x: -51, y: 0, width: 20, height: 272 })
    expect(g.right).toEqual({ x: -25, y: 0, width: 20, height: 272 })
  })

  it('fills from the bottom inside a 1 px border', () => {
    const bar = { x: 0, y: 0, width: 20, height: 252 }
    expect(statusBarFill(bar, 99, 99)).toEqual({ x: 1, y: 1, width: 18, height: 250 })
    expect(statusBarFill(bar, 99, 0)).toBeNull()
    const half = statusBarFill(bar, 100, 50)!
    expect(half.y + half.height).toBe(251)
    expect(half.height).toBe(124)
  })
})

describe('infobox strip', () => {
  it('sizes the strip with at most 6 per row', () => {
    expect(infoboxStripSize(1, 1)).toEqual({ width: 32, height: 32 })
    expect(infoboxStripSize(6, 1)).toEqual({ width: 202, height: 32 })
    expect(infoboxStripSize(7, 1)).toEqual({ width: 202, height: 66 })
    expect(infoboxDockSize(240, 1, 1, 10)).toEqual({ width: 240, height: 66 })
  })

  it('defaults above the game panel, left edges aligned', () => {
    const size = infoboxStripSize(3, 1)
    expect(defaultInfoboxPosition(size.width, size.height, 1, null)).toEqual({ x: 204 - 100, y: 38 + 275 + 5, anchorX: 'right', anchorY: 'bottom' })
    expect(defaultInfoboxPosition(size.width, size.height, 1, { x: 0, y: 38, anchorX: 'right', anchorY: 'bottom' })).toEqual({ x: 104, y: 318, anchorX: 'right', anchorY: 'bottom' })
    expect(infoboxAbovePanel(500, 400, 32)).toEqual({ x: 500, y: 363 })
    expect(infoboxAbovePanel(500, 10, 32)).toEqual({ x: 500, y: 0 })
  })
})
