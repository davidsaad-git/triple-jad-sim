import { useMemo, useState } from 'react'
import { packAsset, useActivePack } from '../packs'
import {
  CHAT_BUTTON_SIZE,
  CHAT_BUTTON_X,
  CHAT_REPORT_SIZE,
  CHAT_REPORT_X,
  CHAT_TABS,
  FIXED,
  FIXED_CLIENT,
  snapRect,
} from './layout'
import { ComposedSprite } from './sprites/ComposedSprite'
import { tileImage } from './sprites/imageStore'

/**
 * Fixed-layout chatbox and
 * the fixed frame strips. No messages are ever printed; the
 * channel buttons only change their sprite and the report button collapses the
 * chatbox (`fixedChatboxVisible`).
 */

const TAB_ON_COLOR = '#0dc10d' // `eme`
const FONT_PX = 16 
const TAB_LINE_PX = 10 // `nme`
const INPUT_X = FIXED.chatInner.x + 3 // `ome` = MB.x + 3

const CHAT_SPRITES = {
  background: 'chatbox/chat_background.png',
  stones: 'chatbox/chatbox_buttons_background_stones.png',
  button: 'chatbox/chatbox_button.png',
  buttonHovered: 'chatbox/chatbox_button_hovered.png',
  buttonSelected: 'chatbox/chatbox_button_selected.png',
  buttonSelectedHovered: 'chatbox/chatbox_button_selected_hovered.png',
  report: 'chatbox/chatbox_report_button.png',
  reportHovered: 'chatbox/chatbox_report_button_hovered.png',
  arrowUp: 'scrollbar/arrow_up.png',
  arrowDown: 'scrollbar/arrow_down.png',
  track: 'scrollbar/thumb_middle_dark.png',
  thumbTop: 'scrollbar/thumb_top.png',
  thumbMiddle: 'scrollbar/thumb_middle.png',
  thumbBottom: 'scrollbar/thumb_bottom.png',
} as const

type ChatSprite = keyof typeof CHAT_SPRITES

/** Chatbox rects relative to the chatbox's own top-left (expanded or collapsed). */
export function chatboxGeometry(visible: boolean): {
  box: { x: number; y: number; width: number; height: number }
  buttonsY: number
  buttonY: number
  textY: number
  scrollbarY: number
  inputY: number
} {
  const box = visible ? FIXED.chatbox : FIXED.chatButtons
  const buttonsY = FIXED.chatButtons.y - box.y
  return {
    box,
    buttonsY,
    buttonY: buttonsY + 1,
    textY: FIXED.chatText.y - box.y,
    scrollbarY: FIXED.chatScrollbar.y - box.y,
    inputY: FIXED.chatInput.y - box.y,
  }
}

/** Scrollbar composition: arrows, dark track, a full-length thumb. */
function drawScrollbar(ctx: CanvasRenderingContext2D, get: (k: ChatSprite) => HTMLImageElement | undefined, top: number): void {
  const { x, width, height } = FIXED.chatScrollbar
  const trackY = top + 16
  const trackH = height - 32
  const track = get('track')
  if (track) tileImage(ctx, track, x, trackY, width, trackH)
  const tTop = get('thumbTop')
  const tMid = get('thumbMiddle')
  const tBot = get('thumbBottom')
  if (tTop && tMid && tBot) {
    const capH = tTop.naturalHeight
    const midH = trackH - capH * 2
    ctx.drawImage(tTop, x, trackY, width, capH)
    if (midH > 0) tileImage(ctx, tMid, x, trackY + capH, width, midH)
    ctx.drawImage(tBot, x, trackY + trackH - capH, width, capH)
  }
  const up = get('arrowUp')
  if (up) ctx.drawImage(up, x, top, width, 16)
  const down = get('arrowDown')
  if (down) ctx.drawImage(down, x, top + height - 16, width, 16)
}

export interface FixedChatboxProps {
  /** Fixed client scale (frame width / 765). */
  scale: number
  visible: boolean
  onToggle: () => void
}

export function FixedChatbox({ scale, visible, onToggle }: FixedChatboxProps) {
  const pack = useActivePack()
  const [selected, setSelected] = useState(0)
  const [hovered, setHovered] = useState<number | 'report' | null>(null)
  const g = chatboxGeometry(visible)
  const urls = useMemo(() => {
    const out = {} as Record<ChatSprite, string>
    for (const key of Object.keys(CHAT_SPRITES) as ChatSprite[]) out[key] = packAsset(CHAT_SPRITES[key], pack)
    return out
  }, [pack])
  const sources = Object.values(urls)
  const label = visible ? 'Collapse' : 'Uncollapse'
  const title = visible ? 'Collapse the chatbox' : 'Uncollapse the chatbox'

  return (
    <div
      className="fixed-chatbox panel-surface"
      data-tutorial="fixed-chatbox"
      style={{ left: g.box.x * scale, top: g.box.y * scale, width: g.box.width * scale, height: g.box.height * scale }}
    >
      <ComposedSprite
        cacheKey={`chatbox|${sources.join('|')}|${visible}|${selected}|${hovered ?? 'none'}`}
        width={g.box.width}
        height={g.box.height}
        cssSize={{ width: g.box.width * scale, height: g.box.height * scale }}
        sources={sources}
        draw={(ctx, images) => {
          const get = (k: ChatSprite): HTMLImageElement | undefined => images.get(urls[k])
          if (visible) {
            const bg = get('background')
            if (bg) ctx.drawImage(bg, 0, g.textY, FIXED.chatText.width, FIXED.chatText.height)
            drawScrollbar(ctx, get, g.scrollbarY)
          }
          const stones = get('stones')
          if (stones) ctx.drawImage(stones, 0, g.buttonsY, FIXED.chatButtons.width, FIXED.chatButtons.height)
          CHAT_BUTTON_X.forEach((x, i) => {
            const isSel = i === selected
            const isHov = hovered === i
            const img = get(isSel ? (isHov ? 'buttonSelectedHovered' : 'buttonSelected') : isHov ? 'buttonHovered' : 'button')
            if (img) ctx.drawImage(img, x, g.buttonY, CHAT_BUTTON_SIZE.width, CHAT_BUTTON_SIZE.height)
          })
          const report = get(hovered === 'report' ? 'reportHovered' : 'report')
          if (report) ctx.drawImage(report, CHAT_REPORT_X, g.buttonY, CHAT_REPORT_SIZE.width, CHAT_REPORT_SIZE.height)
        }}
      />
      {visible && (
        <div className="fixed-chatbox__input" style={{ left: INPUT_X * scale, top: g.inputY * scale, height: FIXED.chatInput.height * scale, fontSize: FONT_PX * scale, color: '#000000' }}>
          {'Player: '}
          <span style={{ color: '#0000ff' }}>*</span>
        </div>
      )}
      {CHAT_BUTTON_X.map((x, i) => (
        <button
          key={CHAT_TABS[i]}
          type="button"
          className="fixed-chatbox__tab"
          style={{ left: x * scale, top: g.buttonY * scale, width: CHAT_BUTTON_SIZE.width * scale, height: CHAT_BUTTON_SIZE.height * scale, fontSize: FONT_PX * scale, lineHeight: `${TAB_LINE_PX * scale}px`, color: '#ffffff' }}
          onMouseEnter={() => setHovered(i)}
          onMouseLeave={() => setHovered(null)}
          onClick={() => setSelected(i)}
          aria-pressed={i === selected}
        >
          <span>{CHAT_TABS[i]}</span>
          {i >= 1 && <span style={{ color: TAB_ON_COLOR }}>On</span>}
        </button>
      ))}
      <button
        type="button"
        className="fixed-chatbox__report"
        style={{ left: CHAT_REPORT_X * scale, top: g.buttonY * scale, width: CHAT_REPORT_SIZE.width * scale, height: CHAT_REPORT_SIZE.height * scale, fontSize: FONT_PX * scale, color: '#ffffff' }}
        onMouseEnter={() => setHovered('report')}
        onMouseLeave={() => setHovered(null)}
        onClick={onToggle}
        title={title}
        aria-label={title}
        aria-expanded={visible}
      >
        {label}
      </button>
    </div>
  )
}

const FRAME_Z = 5 // `$3`

/** Fixed-mode top edge + corner and tiled left edge. */
export function FixedFrameStrips({ scale, viewportHeight }: { scale: number; viewportHeight: number }) {
  const pack = useActivePack()
  const top = packAsset('panel/fixed_mode_window_frame_edge_top.png', pack)
  const corner = packAsset('panel/fixed_mode_top_right_corner.png', pack)
  const left = packAsset('other/window_frame_edge_left.png', pack)
  const topCss = snapRect({ x: 0, y: 0, width: FIXED_CLIENT.width, height: FIXED.topEdge.height }, scale)
  const leftCss = snapRect({ ...FIXED.leftEdge, height: viewportHeight }, scale)
  return (
    <>
      <ComposedSprite
        cacheKey={`fixed-frame-top|${top}|${corner}`}
        width={FIXED_CLIENT.width}
        height={FIXED.topEdge.height}
        cssSize={{ width: topCss.width, height: topCss.height }}
        sources={[top, corner]}
        draw={(ctx, images) => {
          const t = images.get(top)
          const c = images.get(corner)
          const e = FIXED.topEdge
          const k = FIXED.topRightCorner
          if (t) ctx.drawImage(t, e.x, e.y, e.width, e.height)
          if (c) ctx.drawImage(c, k.x, k.y, k.width, k.height)
        }}
        style={{ left: topCss.x, top: topCss.y, zIndex: FRAME_Z }}
      />
      <ComposedSprite
        cacheKey={`fixed-frame-left|${left}|${viewportHeight}`}
        width={FIXED.leftEdge.width}
        height={viewportHeight}
        cssSize={{ width: leftCss.width, height: leftCss.height }}
        sources={[left]}
        draw={(ctx, images) => {
          const l = images.get(left)
          if (l) tileImage(ctx, l, 0, 0, FIXED.leftEdge.width, viewportHeight)
        }}
        style={{ left: leftCss.x, top: leftCss.y, zIndex: FRAME_Z }}
      />
    </>
  )
}
