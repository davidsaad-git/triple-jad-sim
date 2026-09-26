import { useSyncExternalStore } from 'react'
import { ESC_PRIORITY, registerEscapeHandler } from './escape'

/**
 * The armed ("selected to cast") spell (scim,
 * used by). The spellbook arms a spell; the next
 * NPC click casts it (`manualCastSpell`), and any viewport click disarms it.
 * Escape disarms it at priority 15.
 */

let armed: string | null = null
let releaseEscape: (() => void) | null = null
const listeners = new Set<() => void>()

export function getArmedSpell(): string | null {
  return armed
}

export function setArmedSpell(spell: string | null): void {
  if (armed === spell) return
  armed = spell
  if (spell !== null && !releaseEscape) {
    releaseEscape = registerEscapeHandler(ESC_PRIORITY.ARMED_SPELL, () => setArmedSpell(null))
  } else if (spell === null && releaseEscape) {
    releaseEscape()
    releaseEscape = null
  }
  for (const l of [...listeners]) l()
}

export function subscribeArmedSpell(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useArmedSpell(): string | null {
  return useSyncExternalStore(subscribeArmedSpell, getArmedSpell, getArmedSpell)
}
