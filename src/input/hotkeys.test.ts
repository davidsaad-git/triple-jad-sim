import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_KEYBINDS, type Keybinds } from '../app/keybinds'
import { getArmedSpell, setArmedSpell } from './armedSpell'
import { ESC_PRIORITY, escapeStackSize, handleEscapeKeydown, registerEscapeHandler } from './escape'
import { createHotkeyHandlers, formatKeyLabel, getShortcutCategories, type HotkeyKeyEvent, keysEqual, onPanelTabSelect } from './hotkeys'
import { InputTracker } from './modifiers'

function key(k: string, mods: Partial<Pick<HotkeyKeyEvent, 'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey' | 'code'>> = {}) {
  const e = {
    key: k,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    metaKey: false,
    target: null,
    defaultPrevented: false,
    preventDefault() {
      e.defaultPrevented = true
    },
    ...mods,
  }
  return e
}

describe('Escape priority stack', () => {
  const releases: (() => void)[] = []
  afterEach(() => {
    while (releases.length) releases.pop()!()
    setArmedSpell(null)
  })

  it('runs only the highest-priority handler', () => {
    const calls: string[] = []
    releases.push(registerEscapeHandler(ESC_PRIORITY.SIDE_PANEL, () => calls.push('side')))
    releases.push(registerEscapeHandler(ESC_PRIORITY.ENCOUNTER_PICKER, () => calls.push('picker')))
    releases.push(registerEscapeHandler(ESC_PRIORITY.SETTINGS, () => calls.push('settings')))
    expect(handleEscapeKeydown(key('Escape'))).toBe(true)
    expect(calls).toEqual(['picker'])
  })

  it('first registered wins a tie; unregistering exposes the next one', () => {
    const calls: string[] = []
    const a = registerEscapeHandler(40, () => calls.push('a'))
    releases.push(registerEscapeHandler(40, () => calls.push('b')))
    handleEscapeKeydown(key('Escape'))
    a()
    handleEscapeKeydown(key('Escape'))
    expect(calls).toEqual(['a', 'b'])
  })

  it('ignores other keys, prevented events and an empty stack', () => {
    const fn = vi.fn()
    expect(handleEscapeKeydown(key('Escape'))).toBe(false)
    releases.push(registerEscapeHandler(10, fn))
    handleEscapeKeydown(key('Enter'))
    handleEscapeKeydown({ key: 'Escape', defaultPrevented: true })
    expect(fn).not.toHaveBeenCalled()
  })

  it('an armed spell sits at priority 15: below settings, above side panels', () => {
    const calls: string[] = []
    releases.push(registerEscapeHandler(ESC_PRIORITY.SIDE_PANEL, () => calls.push('side')))
    setArmedSpell('Ice Barrage')
    expect(escapeStackSize()).toBe(2)
    handleEscapeKeydown(key('Escape'))
    expect(getArmedSpell()).toBeNull()
    expect(escapeStackSize()).toBe(1)
    handleEscapeKeydown(key('Escape'))
    expect(calls).toEqual(['side'])
    const settings = registerEscapeHandler(ESC_PRIORITY.SETTINGS, () => calls.push('settings'))
    setArmedSpell('Ice Barrage')
    handleEscapeKeydown(key('Escape'))
    expect(calls).toEqual(['side', 'settings'])
    expect(getArmedSpell()).toBe('Ice Barrage')
    settings()
  })
})

describe('global hotkeys', () => {
  function setup(kb: Keybinds = DEFAULT_KEYBINDS) {
    let t = 0
    const actions = { onRestart: vi.fn(), onToggleEncounterPicker: vi.fn(), onToggleShowFps: vi.fn(), onHint: vi.fn() }
    const blur = vi.fn()
    const h = createHotkeyHandlers(actions, { keybinds: () => kb, now: () => t, blurActive: blur })
    return {
      actions,
      blur,
      h,
      at(ms: number) {
        t = ms
      },
    }
  }

  it('Ctrl/Cmd+R restarts; a second press within 1.5 s shows the reload tip; Ctrl+Shift+R passes through', () => {
    const s = setup()
    s.at(10_000)
    const e1 = key('r', { ctrlKey: true })
    s.h.keydown(e1)
    expect(e1.defaultPrevented).toBe(true)
    s.at(11_000)
    s.h.keydown(key('R', { metaKey: true }))
    expect(s.actions.onRestart).toHaveBeenCalledTimes(2)
    expect(s.actions.onHint).toHaveBeenCalledWith('reload')
    const reload = key('R', { ctrlKey: true, shiftKey: true })
    s.h.keydown(reload)
    expect(reload.defaultPrevented).toBe(false)
    expect(s.actions.onRestart).toHaveBeenCalledTimes(2)
    s.at(20_000)
    s.actions.onHint.mockClear()
    s.h.keydown(key('r', { ctrlKey: true }))
    expect(s.actions.onHint).not.toHaveBeenCalled()
  })

  it('Ctrl+K toggles the encounter picker, Ctrl+Shift+F the FPS readout', () => {
    const s = setup()
    s.h.keydown(key('k', { ctrlKey: true }))
    s.h.keydown(key('F', { ctrlKey: true, shiftKey: true }))
    expect(s.actions.onToggleEncounterPicker).toHaveBeenCalledOnce()
    expect(s.actions.onToggleShowFps).toHaveBeenCalledOnce()
  })

  it('prevents other Ctrl combos except C/V/X/A, and Ctrl +/-/0 with the resize tip', () => {
    const s = setup()
    for (const k of ['c', 'v', 'x', 'a']) {
      const e = key(k, { ctrlKey: true })
      s.h.keydown(e)
      expect(e.defaultPrevented).toBe(false)
    }
    const save = key('s', { ctrlKey: true })
    s.h.keydown(save)
    expect(save.defaultPrevented).toBe(true)
    const zoom = key('=', { ctrlKey: true, code: 'Equal' })
    s.h.keydown(zoom)
    expect(zoom.defaultPrevented).toBe(true)
    expect(s.actions.onHint).toHaveBeenCalledWith('resize')
    const wheel = { ctrlKey: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }
    s.h.wheel(wheel)
    expect(wheel.defaultPrevented).toBe(true)
  })

  it('F-keys are always prevented; Tab is prevented and blurs; Alt keyup prevented', () => {
    const s = setup()
    const f3 = key('F3')
    s.h.keydown(f3)
    expect(f3.defaultPrevented).toBe(true)
    const tab = key('Tab')
    s.h.keydown(tab)
    expect(tab.defaultPrevented).toBe(true)
    expect(s.blur).toHaveBeenCalledOnce()
    const alt = key('Alt')
    s.h.keyup(alt)
    expect(alt.defaultPrevented).toBe(true)
  })

  it('side-panel tab keys select (not toggle) and do not prevent Escape', () => {
    const s = setup()
    const tabs: string[] = []
    const off = onPanelTabSelect((t) => tabs.push(t))
    const f5 = key('F5')
    s.h.keydown(f5)
    const esc = key('Escape')
    s.h.keydown(esc)
    s.h.keydown(key('F5'))
    s.h.keydown(key('F3'))
    off()
    expect(tabs).toEqual(['prayer', 'inventory', 'prayer'])
    expect(esc.defaultPrevented).toBe(false)
    expect(f5.defaultPrevented).toBe(true)
  })

  it('rebound tab keys follow the keybinds; unbound digits show the keybind tip', () => {
    const kb: Keybinds = { ...DEFAULT_KEYBINDS, gamePanel: { ...DEFAULT_KEYBINDS.gamePanel, prayer: '1' } }
    const s = setup(kb)
    const tabs: string[] = []
    const off = onPanelTabSelect((t) => tabs.push(t))
    s.h.keydown(key('1'))
    s.h.keydown(key('2'))
    off()
    expect(tabs).toEqual(['prayer'])
    expect(s.actions.onHint).toHaveBeenCalledTimes(1)
    expect(s.actions.onHint).toHaveBeenCalledWith('keybind')
  })

  it('key normalisation and labels', () => {
    expect(keysEqual('r', 'R')).toBe(true)
    expect(keysEqual(' ', 'Spacebar')).toBe(true)
    expect(formatKeyLabel('Escape')).toBe('Esc')
    expect(formatKeyLabel('a')).toBe('A')
    expect(formatKeyLabel('F11')).toBe('F11')
  })
})

describe('shortcut list', () => {
  it('shows the current binds', () => {
    const cats = getShortcutCategories(DEFAULT_KEYBINDS)
    expect(cats.map((c) => c.title)).toEqual(['General', 'Game Panel Tabs', 'Camera', 'Replay', 'Mouse Shortcuts'])
    expect(cats[1]!.shortcuts.map((s) => s.keys)).toEqual(['Esc', 'F1', 'F2', 'F4', 'F5', 'F6', 'F11'])
    expect(cats[2]!.shortcuts.map((s) => s.keys)).toEqual(['A / D', 'W / S'])
    expect(cats[4]!.shortcuts[0]).toEqual({ keys: 'Ctrl+Click', description: 'Invert walk/run' })
  })
})

describe('InputTracker', () => {
  const ev = (type: string, k: string, code: string, mods: Partial<{ shiftKey: boolean; ctrlKey: boolean; repeat: boolean }> = {}) => ({
    type,
    key: k,
    code,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    ...mods,
  })

  it('tracks modifiers from key and pointer events and notifies changes', () => {
    const t = new InputTracker(() => 0)
    const seen: boolean[] = []
    t.onModifiersChange((m) => seen.push(m.shift))
    t.handleKeyEvent(ev('keydown', 'Shift', 'ShiftLeft', { shiftKey: true }))
    expect(t.getModifiers().shift).toBe(true)
    expect(t.isKeyHeld('Shift')).toBe(true)
    t.handleKeyEvent(ev('keyup', 'Shift', 'ShiftLeft'))
    expect(t.getModifiers().shift).toBe(false)
    t.handlePointerEvent({ shiftKey: false, ctrlKey: true, altKey: false, metaKey: false, buttons: 4 })
    expect(t.getModifiers().ctrl).toBe(true)
    expect(t.getMouseButtons().middle).toBe(true)
    // Every modifier change notifies (the last one is the Ctrl press).
    expect(seen).toEqual([true, false, false])
  })

  it('holds keys by code until keyup; reset releases everything', () => {
    const t = new InputTracker(() => 0)
    t.handleKeyEvent(ev('keydown', 'a', 'KeyA'))
    t.handleKeyEvent(ev('keydown', 'A', 'KeyA', { shiftKey: true }))
    expect(t.isKeyHeld('a')).toBe(true)
    t.handleKeyEvent(ev('keyup', 'a', 'KeyA'))
    expect(t.isKeyHeld('a')).toBe(false)
    t.handleKeyEvent(ev('keydown', 'w', 'KeyW'))
    t.reset()
    expect(t.isKeyHeld('w')).toBe(false)
    expect(t.getModifiers()).toEqual({ shift: false, ctrl: false, alt: false, meta: false })
  })

  it('purges auto-repeated keys not seen for 1.5 s', () => {
    let now = 0
    const t = new InputTracker(() => now)
    t.handleKeyEvent(ev('keydown', 'd', 'KeyD'))
    now = 100
    t.handleKeyEvent(ev('keydown', 'd', 'KeyD', { repeat: true }))
    now = 1500
    t.purgeStale()
    expect(t.isKeyHeld('d')).toBe(true)
    now = 1700
    t.purgeStale()
    expect(t.isKeyHeld('d')).toBe(false)
    t.reset()
  })

  it('a key capture hides held keys and ignores keydowns', () => {
    const t = new InputTracker(() => 0)
    const release = t.beginKeyCapture(() => true, undefined)
    t.handleKeyEvent(ev('keydown', 'a', 'KeyA'))
    expect(t.isKeyHeld('a')).toBe(false)
    release()
    t.handleKeyEvent(ev('keydown', 'a', 'KeyA'))
    expect(t.isKeyHeld('a')).toBe(true)
    t.reset()
  })
})
