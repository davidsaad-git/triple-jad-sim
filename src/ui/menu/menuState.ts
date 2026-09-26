/**
 * Which menu surfaces are open. A tiny external store so global hotkeys
 * (INPUT's Ctrl+K handler, Esc) and the UI share one source of truth:
 * `menuController.toggle('encounters')` is scim's Ctrl+K.
 */
import { Store, useStore } from '../../app/GameStore'

export interface MenuState {
  settings: boolean
  plugins: boolean
  encounters: boolean
  configure: boolean
  shortcuts: boolean
  whatsNew: boolean
  training: boolean
  replays: boolean
}

export type MenuSurface = keyof MenuState

const CLOSED: MenuState = {
  settings: false,
  plugins: false,
  encounters: false,
  configure: false,
  shortcuts: false,
  whatsNew: false,
  training: false,
  replays: false,
}

class MenuController extends Store<MenuState> {
  open(surface: MenuSurface): void {
    if (!this.get()[surface]) this.update({ [surface]: true })
  }
  close(surface: MenuSurface): void {
    if (this.get()[surface]) this.update({ [surface]: false })
  }
  toggle(surface: MenuSurface): void {
    this.update({ [surface]: !this.get()[surface] })
  }
  closeAll(): void {
    this.set(CLOSED)
  }
  /** True when any modal-like surface that should pause gameplay input is open. */
  anyModalOpen(): boolean {
    const s = this.get()
    return s.encounters || s.configure || s.shortcuts || s.whatsNew || s.training || s.replays
  }
}

export const menuController = new MenuController(CLOSED)

export function useMenuState<S>(selector: (s: MenuState) => S): S {
  return useStore(menuController, selector)
}
