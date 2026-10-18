import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { overlays } from './overlays'

/** One overlay: whether it is open, and how it is closed. */
function sheet() {
  const it = { open: true, closed: 0 }
  const off = overlays.show(() => {
    it.open = false
    it.closed++
  })

  return { ...it, off, state: it }
}

/** An Escape, as much of one as `escape` reads: whether it was answered, and
 *  whether it goes on to the listeners after this one. */
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
  test('closes nothing when nothing is open', () => {
    expect(overlays.escape()).toBe(false)
  })

  test('closes the one that is open', () => {
    const one = sheet()

    expect(overlays.escape()).toBe(true)
    expect(one.state.open).toBe(false)

    one.off()
  })

  test('closes the newest first, and leaves the one underneath standing', () => {
    const settings = sheet()
    const dropdown = sheet()

    expect(overlays.escape()).toBe(true)
    expect(dropdown.state.open).toBe(false)
    expect(settings.state.open).toBe(true)

    expect(overlays.escape()).toBe(true)
    expect(settings.state.open).toBe(false)
    expect(overlays.escape()).toBe(false)

    settings.off()
    dropdown.off()
  })

  test('closes each overlay once, however fast the key is pressed twice', () => {
    const settings = sheet()
    const dropdown = sheet()

    // Two presses in the same moment: closing is a change to a component's own
    // state, which reaches this list a moment later.
    overlays.escape()
    overlays.escape()

    expect(dropdown.state.closed).toBe(1)
    expect(settings.state.closed).toBe(1)

    settings.off()
    dropdown.off()
  })

  /** A press that closed an overlay is spent. Other things on the page read
   *  Escape off the same window - the find bar over a note being read, the one
   *  over a PDF - and a key that closed the palette must not also shut the bar
   *  underneath it. */
  test('takes the keystroke with it, so nothing else acts on the same press', () => {
    const one = sheet()
    const press = keystroke()

    expect(overlays.escape(press)).toBe(true)
    expect(press.defaultPrevented).toBe(true)
    expect(press.stopped).toBe(true)

    one.off()
  })

  test('leaves a press nothing was open for alone', () => {
    const press = keystroke()

    expect(overlays.escape(press)).toBe(false)
    expect(press.defaultPrevented).toBe(false)
    expect(press.stopped).toBe(false)
  })

  /** Four deep: a full-screen deck, a sheet, the settings and a dropdown inside
   *  them. One press closes one, newest first, and the fourth press has nothing
   *  left to close - the deck goes last, which is what puts the caret back on
   *  the slide somebody stopped at. */
  test('unwinds a deep stack one press at a time, newest first', () => {
    const closed: string[] = []
    const offs = ['deck', 'sheet', 'settings', 'dropdown'].map((name) =>
      overlays.show(() => closed.push(name)),
    )

    while (overlays.escape()) {
      // Each press closes exactly one, so the order is the whole answer.
    }

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

    // The pane behind the dropdown was closed by something other than Escape.
    settings.off()

    expect(overlays.escape()).toBe(true)
    expect(dropdown.state.open).toBe(false)
    expect(overlays.depth).toBe(0)

    dropdown.off()
  })
})

/** A popup closes when it is pressed past, and when the window loses the focus - which
 *  is also how a press into a web page is heard (#382). */
describe('a press past a popup', () => {
  /** Enough of a DOM for `contains`: a node, and the nodes inside it. */
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

  /** A popup on the stack: itself, the button that opened it, and whether it is open. */
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
    while (overlays.escape()) {
      // Whatever a test left open.
    }
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

  /** The press that opens one is read on its way down, before anything under it has
   *  opened anything; the popup is on the stack only after. */
  test('is not closed by the press that opened it', () => {
    const opener = new Box()
    overlays.pressed(press(opener))
    const { it, off } = popup(opener)

    expect(it.open).toBe(true)
    off()
  })

  /** A press that waited behind a long task carries a time from before the popup
   *  opened, and is still a press past it. */
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

    // On the parent, past the submenu: the submenu goes and the parent stays.
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

  test('the window losing the focus closes every popup on top, and no sheet', () => {
    const offSheet = overlays.show(() => undefined)
    const one = popup()
    const two = popup(new Box(one.it.box))

    overlays.away()
    expect([one.it.open, two.it.open]).toEqual([false, false])
    expect(overlays.depth).toBe(1)
    offSheet()
  })
})

/** The second question the stack answers: whether a web page has to be out of sight.
 *
 *  A web tab's page is a native webview, which draws above every pixel of HTML in the
 *  window, so the pane hides it - and holds its still picture instead - while anything
 *  is on this stack. That is right for a layer somebody opened over the note and will
 *  close again, and wrong for anything that stays up without being asked for: the
 *  update notice was one, and the page went blank for as long as it stood. So every
 *  caller is named here with what it is, and a new one fails this until somebody has
 *  said which kind it is. See `covered` in lib/web-tab/WebTab.svelte. */
describe('what hides a web page', () => {
  const src = fileURLToPath(new URL('..', import.meta.url))
  const read = (path: string) => readFileSync(join(src, path), 'utf8')

  /** Every file that puts something on the stack, and what it puts there. Each is drawn
   *  over the note, opened by a press or by a site's question, and closed again. */
  const LAYERS: Record<string, string> = {
    'App.svelte': 'a panel slid over the note as a drawer',
    'lib/AppMenuPanel.svelte': 'menu',
    'lib/CanvasBar.svelte': 'dropdown',
    'lib/CanvasPicked.svelte': "the colours of what is picked, over the plane's own bar",
    'lib/ContextMenu.svelte': 'menu',
    'lib/GraphControls.svelte': 'dropdown',
    'lib/GuestCorner.svelte': "a guest's name and Sign in, under their corner",
    'lib/History.svelte': 'sheet',
    'lib/IconPicker.svelte': 'sheet',
    'lib/Palette.svelte': 'dialog',
    'lib/PromptSheet.svelte': 'dialog',
    'lib/QuickQuestion.svelte': 'dialog',
    'lib/Select.svelte': 'dropdown',
    'lib/SettingsPanel.svelte': 'sheet',
    'lib/Sheet.svelte': 'sheet',
    'lib/SignIn.svelte': 'sheet',
    'lib/Slides.svelte': 'a deck over the whole window',
    'lib/SpacePicker.svelte': 'dialog',
    'lib/SpaceSwitcher.svelte': 'menu',
    'lib/ThemeStore.svelte': 'sheet',
    'lib/agents/ui/PairingBubble.svelte': 'a program asking to become an agent, under the bar',
    'lib/ai/sidebar/Composer.svelte': "the AI's model or context, over its composer",
    'lib/ai/vault/VaultApprove.svelte': 'another of your devices asking for your AI accounts',
    'lib/chats/view/Float.svelte': "a chat's small layer: the emoji picker, the pins, the members",
    'lib/chats/view/Lightbox.svelte': "a message's pictures, one at a time, over everything",
    'lib/people/ProfileCard.svelte': "a person's card, beside the face that was pressed",
    'lib/quick-add/QuickAddSheet.svelte': 'dialog',
    'lib/quitting/QuitSheet.svelte': 'dialog',
    'lib/remote/HostPicker.svelte': 'dialog',
    // Only while it would hang over a page, and gone the moment the pointer leaves.
    'lib/tab-strip/hover-card.svelte.ts': 'the card under a tab the pointer rests on',
    'lib/save-place/SavePlace.svelte': 'where a tab with no file is saved, under the tab',
    'lib/settings/BrowserThemes.svelte': 'sheet',
    'lib/theme-picker/ThemePicker.svelte': 'the theme picker, over the switch or the note',
    'lib/views/Popover.svelte': 'the filter, sort or group of a view, under its button',
    'lib/views/ToneDot.svelte': "a tone's colours, beside its dot",
    'lib/views/schedule/SchedulePicker.svelte': "a task's scheduler, beside what asked for it",
    'lib/views/task-view/TaskSheet.svelte': "a task's own view, over the window",
    'lib/web-tab/AddressField.svelte': 'the suggestions under the address',
    'lib/web-tab/WebAsk.svelte': "a site's question, under the bar",
    'lib/web-tab/WebDialog.svelte': "a page's own dialog, at the top of the page",
    'lib/web-tab/WebDownloads.svelte': 'bubble',
    'lib/web-tab/WebExtensionPopup.svelte': "an extension's popup, under its button",
    'lib/web-tab/WebExtensions.svelte': 'bubble',
    'lib/web-tab/WebSite.svelte': 'bubble',
  }

  /** What stays up without being asked for, and so may never hide a page. */
  const FURNITURE = [
    'lib/UpdateNotice.svelte',
    'lib/RenameNotice.svelte',
    'lib/StorageWarning.svelte',
    'lib/RecordingPill.svelte',
  ]

  function sources(): string[] {
    return readdirSync(src, { recursive: true, encoding: 'utf8' })
      .filter((path) => /\.(svelte|ts)$/.test(path) && !path.endsWith('.test.ts'))
      .map((path) => path.replaceAll('\\', '/'))
  }

  test('every layer on the stack is one somebody opened over the note', () => {
    const callers = sources().filter((path) => read(path).includes('overlays.show('))
    expect(callers.sort()).toEqual(Object.keys(LAYERS).sort())
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
    // Written once, as a snippet: the row is drawn over the panes, or over the drawer
    // as well where the panels are one.
    const row = app.slice(app.indexOf('<div class="notices" data-notices'))
    const end = row.indexOf('{/snippet}')

    expect(end).toBeGreaterThan(0)
    for (const name of [
      'StorageWarning',
      'RecordingPill',
      'UpdateNotice',
      'RenameNotice',
      'UndoToast',
    ]) {
      expect(row.slice(0, end), name).toContain(`<${name}`)
      expect(app.split(`<${name}`).length - 1, name).toBe(1)
    }
  })

  /** A toast in a row of its own under the panes shoved every tab up by its height
   *  as it came and back down as it went (#218). So the row floats, over the foot of
   *  the panes, and a web page under it is cut round each card in it rather than
   *  hidden; see web-tab/covers.ts. */
  test('the row floats over the panes rather than taking room from them', () => {
    const app = read('App.svelte')
    const panes = app.slice(app.indexOf('<div class="panes" data-panes'))
    const inPanes = panes.slice(0, panes.indexOf('\n        </div>'))
    expect(inPanes).toContain('{#if !viewport.drawer}\n            {@render notices()}')

    const style = app.slice(app.indexOf('<style>'))
    const row = style.slice(style.indexOf('  .notices {'))
    const rule = row.slice(0, row.indexOf('}'))
    expect(rule).toMatch(/position:\s*absolute/)
    expect(rule).toMatch(/pointer-events:\s*none/)
  })

  /** Where the panels are a drawer, the note slides off the screen to show the list,
   *  and a row inside the note went with it: the Undo for a file deleted from the
   *  list was off the side of a phone, where nobody could see it or press it. */
  test('where the panels are a drawer it is over the list and the note, not in the note', () => {
    const app = read('App.svelte')
    const main = app.slice(app.indexOf('<div class="middle"'), app.indexOf('</main>'))
    const after = main.slice(main.lastIndexOf('\n  </div>'))

    expect(after).toContain('{#if viewport.drawer}')
    expect(after).toContain('{@render notices()}')
    const style = app.slice(app.indexOf('<style>'))
    expect(style).toMatch(/\.notices\.over \{\s*position: fixed;/)
  })
})
