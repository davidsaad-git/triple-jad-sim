/**
 * Per-frame DOM overlays anchored to actors (scim 3D viewport `kfe`: tick
 * counters, timer bars):
 * overhead Tick Counter, attack cooldown number, the Attack Timer Metronome
 * bar under the player's health bar and the NPC Attack Timer Metronome bars.
 * Positions come from RENDER's `OverlayProjection` every rendered frame.
 */
import { useEffect, useRef } from 'react'
import type { SimRuntime } from '../../app/runtime/types'
import { settingsStore } from '../../app/settings/settings'
import type { ActorScreenAnchor, OverlayProjection } from '../../render/api'
import { attackCooldownRatio, HEALTHBAR_HEIGHT, HEALTHBAR_WIDTH, overheadNumbers } from './overhead'
import { uiAsset } from '../packs'

/** Layer z-order: timer bars 2, tick counters 9. */
const Z_TIMER_BARS = 2
const Z_TICK_COUNTERS = 9
/** Timer bar centre = health bar centre + 7 + 2. */
const BAR_BELOW_HEALTHBAR = HEALTHBAR_HEIGHT + 2
export const PLAYER_ACTOR_ID = 'player'

interface TimerBar {
  key: string
  x: number
  y: number
  width: number
  ratio: number
}

function syncNumbers(layer: HTMLDivElement, items: ReturnType<typeof overheadNumbers>): void {
  while (layer.children.length > items.length) layer.lastChild?.remove()
  items.forEach((it, i) => {
    let el = layer.children[i] as HTMLSpanElement | undefined
    if (!el) {
      el = document.createElement('span')
      el.style.position = 'absolute'
      el.style.pointerEvents = 'none'
      el.style.fontFamily = "'RuneScape Small', monospace"
      el.style.fontWeight = 'normal'
      el.style.lineHeight = '1'
      el.style.transform = 'translate(-50%, -50%)'
      el.style.whiteSpace = 'nowrap'
      el.style.textShadow = '1px 1px 0 #000'
      layer.appendChild(el)
    }
    if (el.textContent !== it.text) el.textContent = it.text
    el.style.left = `${it.x}px`
    el.style.top = `${it.y}px`
    el.style.color = it.color
    el.style.fontSize = `${it.fontSize}px`
  })
}

function syncBars(layer: HTMLDivElement, bars: TimerBar[]): void {
  while (layer.children.length > bars.length) layer.lastChild?.remove()
  bars.forEach((b, i) => {
    let el = layer.children[i] as HTMLDivElement | undefined
    if (!el) {
      el = document.createElement('div')
      el.style.position = 'absolute'
      el.style.pointerEvents = 'none'
      el.style.imageRendering = 'pixelated'
      const bg = document.createElement('img')
      bg.dataset.role = 'bg'
      Object.assign(bg.style, { position: 'absolute', top: '0', left: '0', width: '100%', height: '100%', display: 'block', imageRendering: 'pixelated', pointerEvents: 'none' })
      const clip = document.createElement('div')
      clip.dataset.role = 'fg-clip'
      Object.assign(clip.style, { position: 'absolute', top: '0', left: '0', height: '100%', overflow: 'hidden' })
      const fg = document.createElement('img')
      fg.dataset.role = 'fg'
      Object.assign(fg.style, { display: 'block', width: '0', height: '100%', imageRendering: 'pixelated', pointerEvents: 'none' })
      clip.appendChild(fg)
      el.append(bg, clip)
      layer.appendChild(el)
    }
    const w = b.width
    el.style.width = `${w}px`
    el.style.height = `${HEALTHBAR_HEIGHT}px`
    el.style.left = `${b.x - w / 2}px`
    el.style.top = `${b.y - HEALTHBAR_HEIGHT / 2}px`
    const bg = el.querySelector<HTMLImageElement>('[data-role="bg"]')
    const clip = el.querySelector<HTMLDivElement>('[data-role="fg-clip"]')
    const fg = el.querySelector<HTMLImageElement>('[data-role="fg"]')
    const bgSrc = uiAsset(`healthbar/dark_back_${w}px.png`)
    const fgSrc = uiAsset(`healthbar/yellow_front_${w}px.png`)
    if (bg && bg.getAttribute('src') !== bgSrc) bg.src = bgSrc
    if (fg && fg.getAttribute('src') !== fgSrc) fg.src = fgSrc
    if (clip) clip.style.width = `${Math.max(0, b.ratio * w)}px`
    if (fg) fg.style.width = `${w}px`
  })
}

export function OverheadOverlays({ runtime, overlay }: { runtime: SimRuntime; overlay: OverlayProjection | null }) {
  const numbersRef = useRef<HTMLDivElement>(null)
  const barsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!overlay) return
    const draw = (anchors: ReadonlyMap<string, ActorScreenAnchor>) => {
      const numbers = numbersRef.current
      const barsLayer = barsRef.current
      if (!numbers || !barsLayer) return
      const s = settingsStore.get()
      const state = runtime.getSnapshot().state
      const tick = state.currentTick
      const player = anchors.get(PLAYER_ACTOR_ID)
      const metronome = s.attackTimerMetronomeEnabled
      const items =
        player && state.isAlive
          ? overheadNumbers({ x: player.x, y: player.y }, player.hasPrayerIcon, tick, {
              tickCounter:
                s.showTickCounter && s.showTickCounterOverhead
                  ? {
                      max: s.tickCounterMax,
                      colors: s.tickCounterColors,
                      fontSize: s.tickCounterFontSize,
                      abovePrayerIcon: s.tickCounterAbovePrayerIcon,
                      offsetX: s.tickCounterOffsetX,
                      offsetY: s.tickCounterOffsetY,
                    }
                  : undefined,
              attackCooldown:
                metronome && s.attackTimerMetronomeShowTicks
                  ? {
                      nextAttackTick: state.playerNextAttackTick,
                      fontSize: s.attackTimerMetronomeFontSize,
                      abovePrayerIcon: s.attackTimerMetronomeAbovePrayerIcon,
                      offsetX: s.attackTimerMetronomeOffsetX,
                      offsetY: s.attackTimerMetronomeOffsetY,
                    }
                  : undefined,
            })
          : []
      syncNumbers(numbers, items)
      const bars: TimerBar[] = []
      if (player && metronome && s.attackTimerMetronomeShowBar) {
        const ratio = attackCooldownRatio(state.playerNextAttackTick, state.playerAttackSpeed, tick)
        if (ratio !== null) bars.push({ key: 'player-attack-timer-metronome', x: player.x, y: player.healthBarY + BAR_BELOW_HEALTHBAR, width: HEALTHBAR_WIDTH, ratio })
      }
      if (s.npcAttackTimerMetronomeEnabled) {
        for (const npc of state.npcs) {
          if (!npc.alive || !npc.attackTimer) continue
          const ratio = attackCooldownRatio(npc.attackTimer.nextAttackTick, npc.attackTimer.attackSpeed, tick)
          const a = anchors.get(npc.id)
          if (ratio === null || !a) continue
          bars.push({ key: `npc-attack-timer-${npc.id}`, x: a.x, y: a.healthBarY + BAR_BELOW_HEALTHBAR, width: a.healthBarWidth, ratio })
        }
      }
      syncBars(barsLayer, bars)
    }
    draw(overlay.getAnchors())
    return overlay.onFrame(draw)
  }, [runtime, overlay])
  return (
    <>
      <div ref={barsRef} data-timerbars="true" style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: Z_TIMER_BARS }} />
      <div ref={numbersRef} data-tick-counters="true" style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: Z_TICK_COUNTERS }} />
    </>
  )
}
