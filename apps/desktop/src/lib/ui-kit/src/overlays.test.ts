import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { overlays } from './overlays'

function sheet() {
  const it = { open: true, closed: 0 }
  const off = overlays.show(() => {
    it.open = false
    it.closed++
  })
  return { ...it, off, state: it }
}
function keystroke() {
  const press = {
    defaultPrevented: false,
    stopped: false,
    preventDefault: () => (press.defaultPrevented = true),
    stopImmediatePropagation: () => (press.stopped = true),
  }
  return press
}
describe('escape', () => {
  test('closes nothing when nothing is open, and leaves that press alone', () => {
    const press = keystroke()
    expect(overlays.escape(press)).toBe(false)
    expect(press.defaultPrevented).toBe(false)
    expect(press.stopped).toBe(false)
  })
  test('closes the one that is open, taking the keystroke with it', () => {
    const one = sheet()
    const press = keystroke()
    expect(overlays.escape(press)).toBe(true)
    expect(one.state.open).toBe(false)
    expect(press.defaultPrevented).toBe(true)
    expect(press.stopped).toBe(true)
    one.off()
  })
  test('closes the newest first, each once, leaving the one underneath standing', () => {
    const settings = sheet()
    const dropdown = sheet()
    expect(overlays.escape()).toBe(true)
    expect(dropdown.state.open).toBe(false)
    expect(settings.state.open).toBe(true)
    expect(overlays.escape()).toBe(true)
    expect(settings.state.open).toBe(false)
    expect(overlays.escape()).toBe(false)
    expect(dropdown.state.closed).toBe(1)
    expect(settings.state.closed).toBe(1)
    settings.off()
    dropdown.off()
  })
  test('unwinds a deep stack one press at a time, newest first', () => {
    const closed: string[] = []
    const offs = ['deck', 'sheet', 'settings', 'dropdown'].map((name) => overlays.show(() => closed.push(name)))
    while (overlays.escape());
    expect(closed).toEqual(['dropdown', 'settings', 'sheet', 'deck'])
    for (const off of offs) off()
  })
  test('an overlay that closes itself is no longer on the stack', () => {
    const one = sheet()
    one.off()
    expect(overlays.depth).toBe(0)
    expect(overlays.escape()).toBe(false)
    expect(one.state.closed).toBe(0)
  })
  test('one taken off from under another leaves the order it was in', () => {
    const settings = sheet()
    const dropdown = sheet()
    settings.off()
    expect(overlays.escape()).toBe(true)
    expect(dropdown.state.open).toBe(false)
    expect(overlays.depth).toBe(0)
    dropdown.off()
  })
})
describe('a press past a popup', () => {
  class Box {
    readonly inside: Box[] = []
    constructor(readonly parent: Box | null = null) {
      parent?.inside.push(this)
    }
    contains(other: unknown): boolean {
      for (let at = other; at instanceof Box; at = at.parent) if (at === this) return true
      return false
    }
  }
  vi.stubGlobal('Node', Box)
  function popup(opener = new Box()) {
    const box = new Box()
    const it = { open: true, box, opener }
    const off = overlays.show(
      () => (it.open = false),
      () => [box, opener],
    )
    return { it, off }
  }
  const press = (target: unknown) => ({ target: target as EventTarget })
  afterEach(() => {
    while (overlays.escape());
  })
  test('closes on a press anywhere else', () => {
    const { it } = popup()
    overlays.pressed(press(new Box()))
    expect(it.open).toBe(false)
    expect(overlays.depth).toBe(0)
  })
  test('stays open for a press inside it, and on the button that opened it', () => {
    const { it, off } = popup()
    overlays.pressed(press(new Box(it.box)))
    overlays.pressed(press(it.opener))
    expect(it.open).toBe(true)
    off()
  })
  test('is not closed by the press that opened it', () => {
    const opener = new Box()
    overlays.pressed(press(opener))
    const { it, off } = popup(opener)
    expect(it.open).toBe(true)
    off()
  })
  test('is closed by a press however long it waited to be read', () => {
    const { it } = popup()
    const queued = { target: new Box() as unknown as EventTarget, timeStamp: 0 }
    overlays.pressed(queued)
    expect(it.open).toBe(false)
  })
  test('a press in a submenu leaves both open, and one past both closes both', () => {
    const parent = popup()
    const child = popup(new Box(parent.it.box))
    overlays.pressed(press(new Box(child.it.box)))
    expect([parent.it.open, child.it.open]).toEqual([true, true])
    overlays.pressed(press(new Box(parent.it.box)))
    expect([parent.it.open, child.it.open]).toEqual([true, false])
    overlays.pressed(press(new Box()))
    expect(parent.it.open).toBe(false)
  })
  test('a sheet is closed by its own scrim, and keeps what is under it', () => {
    const under = popup()
    const off = overlays.show(() => undefined)
    overlays.pressed(press(new Box()))
    expect(under.it.open).toBe(true)
    expect(overlays.depth).toBe(2)
    off()
  })
  describe('and the click of the press that closed it', () => {
    const click = (target: unknown) => {
      const said = { target: target as EventTarget, spent: false }
      return {
        ...said,
        get spent() {
          return said.spent
        },
        preventDefault: () => (said.spent = true),
        stopImmediatePropagation: () => (said.spent = true),
      }
    }
    test('is spent on the button that opened it, so it does not open it again', () => {
      const { it } = popup()
      overlays.pressed(press(new Box()))
      const landed = click(it.opener)
      overlays.clicked(landed)
      expect(it.open).toBe(false)
      expect(landed.spent).toBe(true)
    })
    test('is left alone anywhere else, and so is the next press s click', () => {
      const { it } = popup()
      overlays.pressed(press(new Box()))
      const elsewhere = click(new Box())
      overlays.clicked(elsewhere)
      expect(elsewhere.spent).toBe(false)
      overlays.pressed(press(it.opener))
      const again = click(it.opener)
      overlays.clicked(again)
      expect(again.spent).toBe(false)
    })
    test('a press on the button itself closes nothing and spends nothing', () => {
      const { it, off } = popup()
      overlays.pressed(press(it.opener))
      const own = click(it.opener)
      overlays.clicked(own)
      expect(it.open).toBe(true)
      expect(own.spent).toBe(false)
      off()
    })
  })
  test('the window losing the focus closes every popup on top, and no sheet', () => {
    const offSheet = overlays.show(() => undefined)
    const one = popup()
    const two = popup(new Box(one.it.box))
    overlays.away()
    expect([one.it.open, two.it.open]).toEqual([false, false])
    expect(overlays.depth).toBe(1)
    offSheet()
  })
  test('the window losing the focus leaves a popup that keeps the focus, and what is under it', () => {
    const under = popup()
    let open = true
    const off = overlays.show(
      () => (open = false),
      () => [new Box()],
      null,
      true,
    )
    overlays.away()
    expect([under.it.open, open]).toEqual([true, true])
    overlays.pressed(press(new Box()))
    expect([under.it.open, open]).toEqual([false, false])
    off()
  })
})
describe('what hides a web page', () => {
  const src = fileURLToPath(new URL('../../..', import.meta.url))
  const read = (path: string) => readFileSync(join(src, path), 'utf8')
  const LAYERS = [
    'App.svelte',
    'lib/canvas/src/CanvasBar.svelte',
    'lib/canvas/src/CanvasPicked.svelte',
    'lib/context-menu/src/ContextMenu.svelte',
    'lib/crash-reports/src/CrashAsk.svelte',
    'lib/graph-view/src/GraphControls.svelte',
    'lib/surfaces/src/FeedbackSheet.svelte',
    'lib/collab/src/GuestCorner.svelte',
    'lib/history/src/History.svelte',
    'lib/sharing/src/JoinSheet.svelte',
    'lib/icon-picker/src/IconPicker.svelte',
    'lib/palette/src/Palette.svelte',
    'lib/surfaces/src/PromptSheet.svelte',
    'lib/ai-sidebar/src/QuickQuestion.svelte',
    'lib/ui-controls/src/DateField.svelte',
    'lib/ui-controls/src/Select.svelte',
    'lib/sidebar/src/Sidebar.svelte',
    'lib/ui-controls/src/Sheet.svelte',
    'lib/accounts-ui/src/SignIn.svelte',
    'lib/spaces/src/SpacePicker.svelte',
    'lib/sidebar/src/SpaceSwitcher.svelte',
    'lib/overview/src/Overview.svelte',
    'lib/pass-ui/src/PassFill.svelte',
    'lib/settings/src/ThemeStore.svelte',
    'lib/agents/src/ui/PairingBubble.svelte',
    'lib/ai-sidebar/src/Composer.svelte',
    'lib/ai-providers/src/vault/VaultApprove.svelte',
    'lib/dictation/src/EngineChooser.svelte',
    'lib/chat-kit/src/Float.svelte',
    'lib/chats-client/src/view/Lightbox.svelte',
    'lib/chats-client/src/view/MembersPanel.svelte',
    'lib/accounts-ui/src/ProfileCard.svelte',
    'lib/quick-add/src/QuickAddSheet.svelte',
    'lib/tasks-views/src/ChipPick.svelte',
    'lib/time/src/ActivityLayer.svelte',
    'lib/time/src/Summary.svelte',
    'lib/time/src/TimeTab.svelte',
    'lib/time/src/Timeline.svelte',
    'lib/quitting/src/QuitSheet.svelte',
    'lib/terminal/src/remote/HostPicker.svelte',
    'lib/tab-strip/src/hover-card.svelte.ts',
    'lib/save-place/src/SavePlace.svelte',
    'lib/settings/src/FontPicker.svelte',
    'lib/theme-looks/src/picker/ThemePicker.svelte',
    'lib/views/src/Popover.svelte',
    'lib/views/src/ToneDot.svelte',
    'lib/web-tab/src/AddressField.svelte',
    'lib/web-tab/src/WebAsks.svelte',
    'lib/web-tab/src/WebDownloads.svelte',
    'lib/web-tab/src/WebExtensionPopup.svelte',
    'lib/web-tab/src/WebExtensions.svelte',
    'lib/web-tab/src/WebSite.svelte',
  ]
  const FURNITURE = [
    'lib/updates/src/UpdateNotice.svelte',
    'lib/surfaces/src/RenameNotice.svelte',
    'lib/frame/src/StorageWarning.svelte',
    'lib/dictation/src/recorder/RecordingPill.svelte',
    'lib/sharing/src/JoinPending.svelte',
  ]
  function sources(): string[] {
    return readdirSync(src, { recursive: true, encoding: 'utf8' })
      .filter((path) => /\.(svelte|ts)$/.test(path) && !path.endsWith('.test.ts'))
      .map((path) => path.replaceAll('\\', '/'))
  }
  test('every layer on the stack is one somebody opened over the note', () => {
    const callers = sources().filter((path) => /overlays\.(show|peek)\(/.test(read(path)))
    expect(callers.sort()).toEqual(LAYERS.sort())
  })
  test('what comes out under a resting pointer is a peek, and nothing opened by a press is', () => {
    const peeks = sources().filter((path) => read(path).includes('overlays.peek('))
    expect(peeks.sort()).toEqual(['lib/sidebar/src/Sidebar.svelte', 'lib/tab-strip/src/hover-card.svelte.ts'])
    for (const path of peeks) expect(read(path), path).not.toContain('overlays.show(')
  })
  test('full screen is a mode and not a layer, so a page fills it', () => {
    expect(read('App.svelte')).not.toMatch(/fullscreen\.on \? overlays\.show/)
  })
  test("the app's own furniture is on no stack and places itself nowhere", () => {
    for (const path of FURNITURE) {
      const text = read(path)
      expect(text, path).not.toContain('overlays')
      expect(text, path).not.toMatch(/position:\s*(fixed|absolute)/)
    }
  })
  test('it is in one row, written once', () => {
    const app = read('App.svelte')
    const row = app.slice(app.indexOf('class="notices"'))
    const end = row.indexOf('{/snippet}')
    expect(end).toBeGreaterThan(0)
    for (const name of ['StorageWarning', 'RecordingPill', 'UpdateNotice', 'RenameNotice', 'UndoToast']) {
      expect(row.slice(0, end), name).toContain(`<${name}`)
      expect(app.split(`<${name}`).length - 1, name).toBe(1)
    }
  })
  test('the row floats over the panes rather than taking room from them', () => {
    const app = read('App.svelte')
    const panes = app.slice(app.indexOf('class="panes"'))
    const inPanes = panes.slice(0, panes.indexOf('\n        </div>'))
    expect(inPanes).toContain('{#if !noticesOver}\n            {@render notices()}')
    const style = app.slice(app.indexOf('<style>'))
    const row = style.slice(style.indexOf('  .notices {'))
    const rule = row.slice(0, row.indexOf('}'))
    expect(rule).toMatch(/position:\s*absolute/)
    expect(rule).toMatch(/pointer-events:\s*none/)
  })
  test('where the panels are a drawer, or the note too narrow for it, it is over the list and the note, not in the note', () => {
    const app = read('App.svelte')
    expect(app).toMatch(
      /const noticesOver = \$derived\(viewport\.drawer \|\| \(panesWide > 0 && panesWide < NOTICE_ROOM\)\)/,
    )
    const main = app.slice(app.indexOf('<div class="middle"'), app.indexOf('</main>'))
    const after = main.slice(main.lastIndexOf('\n  </div>'))
    expect(after).toContain('{#if noticesOver}')
    expect(after).toContain('{@render notices()}')
    const style = app.slice(app.indexOf('<style>'))
    expect(style).toMatch(/\.notices\.over \{\s*position: fixed;/)
  })
})
