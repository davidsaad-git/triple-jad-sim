/**
 * In-game client chrome. Mount `<ClientFrame runtime viewport />`
 * inside the viewport stage; the rest is for other layers that plug into it.
 */
export { ClientFrame, drawerExclusions, viewportRectFor, type ClientFrameProps } from './ClientFrame'
export { ClientProvider, presentationFor, useClient, useSimState, useTick } from './context'
export { DraggablePanel, PANEL_DRAG_END_EVENT, PANEL_DRAG_START_EVENT, PANEL_MOVED_EVENT, isAnyPanelDragging, type DraggablePanelProps } from './DraggablePanel'
export {
  collectInfoboxes,
  effectivePinTarget,
  formatTicks,
  formatTimer,
  InfoboxDock,
  InfoboxStripView,
  registerInfoboxProvider,
  useInfoboxes,
  type Infobox,
  type InfoboxProvider,
} from './Infoboxes'
export {
  closeQuickPrayerSetup,
  gamePanelTabStore,
  openQuickPrayerSetup,
  selectGamePanelTab,
  setPrayerOrbOverlay,
  TAB_CHANGED_EVENT,
  useGamePanelTab,
} from './clientState'
export { AltHintBar } from './AltHintBar'
export { Minimap } from './Minimap'
export { GamePanel } from './GamePanel'
export { Orbs } from './Orbs'
export { FixedChatbox, FixedFrameStrips } from './FixedChatbox'
export { minimapImageFor } from './minimapData'
export { PixelSprite } from './sprites/PixelSprite'
export { computeFrameBox, fixedClientSize, snapRect, UI_SCALE_STEPS, type FrameBox } from './layout'
