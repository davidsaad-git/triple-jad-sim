import type { PresentationOverride } from '../app/runtime/presentation'
import type { SimRuntime } from '../app/runtime/types'
import type { Tile } from '../sim/api'
import { getArmedSpell, setArmedSpell } from './armedSpell'

/**
 * Gameplay handlers behind viewport clicks: scim /
 * `handleTakeGroundItem`.
 *
 * At click time: disarm the armed spell and show the destination preview (the
 * tile for walks, null for attacks). Inside the lagged apply: set the ctrl-run
 * override, set the target tile (null for attacks), retire the preview, queue
 * the attack-target op (manual cast when a spell was armed) and, with
 * Auto-Advance off, step one tick.
 */

/** The runtime's click-time destination preview, when the runtime provides one. */
function previewOf(runtime: SimRuntime): PresentationOverride<Tile | null> | null {
  const candidate = (runtime as SimRuntime & { targetTilePreview?: PresentationOverride<Tile | null> }).targetTilePreview
  return candidate ?? null
}

function showPreview(runtime: SimRuntime, tile: Tile | null): () => void {
  return previewOf(runtime)?.show(tile) ?? (() => {})
}

/**
 * Walk to `tile` (npcId null) or attack `npcId` (tile = its position).
 * `ctrl` inverts run until the next click (engine setCtrlClickOverride).
 */
export function handleTileClick(runtime: SimRuntime, tile: Tile, ctrl: boolean, npcId: string | null): void {
  const spell = getArmedSpell()
  if (spell) setArmedSpell(null)
  if (npcId) {
    const retire = showPreview(runtime, null)
    runtime.dispatch((engine) => {
      engine.setCtrlClickOverride(ctrl)
      runtime.setTargetTile(null)
      retire()
      engine.applyAction(spell ? { attackTarget: npcId, manualCastSpell: spell } : { attackTarget: npcId })
      runtime.stepOnce()
    }, spell ? 'manual-cast' : 'attack')
    return
  }
  const target: Tile = [tile[0], tile[1]]
  const retire = showPreview(runtime, target)
  runtime.dispatch((engine) => {
    engine.setCtrlClickOverride(ctrl)
    runtime.setTargetTile(target)
    retire()
    engine.applyAction({ attackTarget: null })
    runtime.stepOnce()
  }, 'walk')
}

/** Walk to the item (run override off), stop attacking, and pick it up. */
export function handleTakeGroundItem(runtime: SimRuntime, groundItemId: string): void {
  const item = runtime.getSnapshot().state.groundItems.find((g) => g.id === groundItemId)
  if (!item) return
  const tile: Tile = [item.position[0], item.position[1]]
  if (getArmedSpell()) setArmedSpell(null)
  const retire = showPreview(runtime, tile)
  runtime.dispatch((engine) => {
    engine.setCtrlClickOverride(false)
    runtime.setTargetTile(tile)
    retire()
    engine.applyAction({ attackTarget: null })
    engine.queuePickupGroundItem(groundItemId)
    runtime.stepOnce()
  }, 'take')
}
