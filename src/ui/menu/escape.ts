/**
 * Escape priority stack adapter (scim `Gp(priority, open, onClose)`, `zp`
 *). The registry is INPUT's (src/input/escape.ts);
 * the menus only use this thin hook so every surface closes in scim's order.
 */
import { ESC_PRIORITY as INPUT_ESC_PRIORITY, useEscapeHandler } from '../../input/hotkeys'

export const ESC_PRIORITY = {
  MODAL: INPUT_ESC_PRIORITY.MODAL,
  ENCOUNTER_PICKER: INPUT_ESC_PRIORITY.ENCOUNTER_PICKER,
  CONFIGURE: INPUT_ESC_PRIORITY.CONFIGURE_DIALOG,
  COLOR_PICKER: INPUT_ESC_PRIORITY.COLOR_PICKER,
  PLUGINS: INPUT_ESC_PRIORITY.PLUGINS,
  SETTINGS: INPUT_ESC_PRIORITY.SETTINGS,
  SIDE_PANEL: INPUT_ESC_PRIORITY.SIDE_PANEL,
} as const

/** Register `onClose` as an Esc layer while `active`. */
export function useEscapeLayer(priority: number, active: boolean, onClose: () => void): void {
  useEscapeHandler(priority, active, onClose)
}
