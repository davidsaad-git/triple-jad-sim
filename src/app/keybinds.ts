import { Store, useStore } from './GameStore'

/**
 * Key bindings, mirroring scim.gg's localStorage
 * object (also mirrored to `osrs-keybinds` / `osrs-camera-keybinds`).
 * Values are KeyboardEvent.key strings.
 */

export type GamePanelKeybinds = {
  inventory: string
  combat: string
  skills: string
  equipment: string
  prayer: string
  spellbook: string
  settings: string
}

export type CameraKeybinds = {
  orbitRotateLeft: string
  orbitRotateRight: string
  orbitTiltUp: string
  orbitTiltDown: string
  freeformForward: string
  freeformBackward: string
  freeformLeft: string
  freeformRight: string
  freeformUp: string
  freeformDown: string
  toggleFreeform: string
}

export interface Keybinds {
  gamePanel: GamePanelKeybinds
  camera: CameraKeybinds
  [group: string]: Record<string, string>
}

export const DEFAULT_KEYBINDS: Keybinds = {
  gamePanel: {
    inventory: 'Escape',
    combat: 'F1',
    skills: 'F2',
    equipment: 'F4',
    prayer: 'F5',
    spellbook: 'F6',
    settings: 'F11',
  },
  camera: {
    orbitRotateLeft: 'a',
    orbitRotateRight: 'd',
    orbitTiltUp: 'w',
    orbitTiltDown: 's',
    freeformForward: 'w',
    freeformBackward: 's',
    freeformLeft: 'a',
    freeformRight: 'd',
    freeformUp: ' ',
    freeformDown: 'Shift',
    toggleFreeform: 'F10',
  },
}

const KEY = 'osrs-unified-keybinds'

function load(): Keybinds {
  try {
    const raw = globalThis.localStorage?.getItem(KEY)
    if (raw) {
      const stored = JSON.parse(raw) as Partial<Keybinds>
      return {
        ...DEFAULT_KEYBINDS,
        ...stored,
        gamePanel: { ...DEFAULT_KEYBINDS.gamePanel, ...(stored.gamePanel ?? {}) },
        camera: { ...DEFAULT_KEYBINDS.camera, ...(stored.camera ?? {}) },
      }
    }
  } catch {
    // fall through to defaults
  }
  return DEFAULT_KEYBINDS
}

class KeybindStore extends Store<Keybinds> {
  patchGroup(group: string, patch: Record<string, string>): void {
    const cur = this.get()
    const next = { ...cur, [group]: { ...(cur[group] ?? {}), ...patch } } as Keybinds
    this.set(next)
    try {
      globalThis.localStorage?.setItem(KEY, JSON.stringify(next))
      globalThis.localStorage?.setItem('osrs-keybinds', JSON.stringify(next.gamePanel))
      globalThis.localStorage?.setItem('osrs-camera-keybinds', JSON.stringify(next.camera))
    } catch {
      // storage unavailable
    }
  }
}

export const keybindStore = new KeybindStore(load())

export function useKeybinds<S>(selector: (k: Keybinds) => S): S {
  return useStore(keybindStore, selector)
}
