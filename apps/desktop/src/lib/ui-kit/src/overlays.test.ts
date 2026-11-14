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

    overlays.escape()
    overlays.escape()

    expect(dropdown.state.closed).toBe(1)
    expect(settings.state.closed).toBe(1)

    settings.off()
    dropdown.off()
  })

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

  const LAYERS: Record<string, string> = {
    'App.svelte': 'a panel slid over the note as a drawer',
    'lib/CanvasBar.svelte': 'dropdown',
    'lib/CanvasPicked.svelte': "the colours of what is picked, over the plane's own bar",
    'lib/ContextMenu.svelte': 'menu',
    'lib/crash-reports/src/CrashAsk.svelte': 'dialog',
    'lib/GraphControls.svelte': 'dropdown',
    'lib/FeedbackSheet.svelte': 'dialog',
    'lib/GuestCorner.svelte': "a guest's name and Sign in, under their corner",
    'lib/History.svelte': 'sheet',
    'lib/JoinSheet.svelte': 'sheet',
    'lib/IconPicker.svelte': 'sheet',
    'lib/Palette.svelte': 'dialog',
    'lib/PromptSheet.svelte': 'dialog',
    'lib/ai-sidebar/src/QuickQuestion.svelte': 'dialog',
    'lib/ui-controls/src/Select.svelte': 'dropdown',
    'lib/Sidebar.svelte': 'the shut file list, out over the note while the pointer is on it',
    'lib/ui-controls/src/Sheet.svelte': 'sheet',
    'lib/accounts-ui/src/SignIn.svelte': 'sheet',
    'lib/SpacePicker.svelte': 'dialog',
    'lib/SpaceSwitcher.svelte': 'menu',
    'lib/overview/src/Overview.svelte': 'dialog',
    'lib/pass-ui/src/PassFill.svelte':
      "Pass's offer to fill, save or sign in, under a web tab's bar",
    'lib/ThemeStore.svelte': 'sheet',
    'lib/agents/src/ui/PairingBubble.svelte': 'a program asking to become an agent, under the bar',
    'lib/ai-sidebar/src/Composer.svelte': "the AI's model or context, over its composer",
    'lib/ai-providers/src/vault/VaultApprove.svelte':
      'another of your devices asking for your AI accounts',
    'lib/dictation/src/EngineChooser.svelte': "where dictation's voice may go, over its microphone",
    'lib/chat-kit/src/Float.svelte': "a chat's small layer: the emoji picker, the pins, the search",
    'lib/chats-client/src/view/Lightbox.svelte':
      "a message's pictures, one at a time, over everything",
    'lib/chats-client/src/view/MembersPanel.svelte':
      "a chat's members as a sheet over the chat, on a narrow window",
    'lib/accounts-ui/src/ProfileCard.svelte': "a person's card, beside the face that was pressed",
    'lib/quick-add/src/QuickAddSheet.svelte': 'dialog',
    'lib/quitting/src/QuitSheet.svelte': 'dialog',
    'lib/terminal/src/remote/HostPicker.svelte': 'dialog',
    'lib/tab-strip/hover-card.svelte.ts': 'the card under a tab the pointer rests on',
    'lib/save-place/src/SavePlace.svelte': 'where a tab with no file is saved, under the tab',
    'lib/settings/FontPicker.svelte': 'dropdown',
    'lib/theme-looks/src/picker/ThemePicker.svelte':
      'the theme picker, over the themes button or the note',
    'lib/views/src/Popover.svelte': 'the filter, sort or group of a view, under its button',
    'lib/views/src/ToneDot.svelte': "a tone's colours, beside its dot",
    'lib/web-tab/src/AddressField.svelte': 'the suggestions under the address',
    'lib/web-tab/src/WebAsk.svelte': "a site's question, under the bar",
    'lib/web-tab/src/WebDialog.svelte': "a page's own dialog, at the top of the page",
    'lib/web-tab/src/WebDownloads.svelte': 'bubble',
    'lib/web-tab/src/WebExtensionPopup.svelte': "an extension's popup, under its button",
    'lib/web-tab/src/WebExtensions.svelte': 'bubble',
    'lib/web-tab/src/WebSite.svelte': 'bubble',
  }

  const FURNITURE = [
    'lib/UpdateNotice.svelte',
    'lib/RenameNotice.svelte',
    'lib/StorageWarning.svelte',
    'lib/dictation/src/recorder/RecordingPill.svelte',
    'lib/JoinPending.svelte',
  ]

  function sources(): string[] {
    return readdirSync(src, { recursive: true, encoding: 'utf8' })
      .filter((path) => /\.(svelte|ts)$/.test(path) && !path.endsWith('.test.ts'))
      .map((path) => path.replaceAll('\\', '/'))
  }

  test('every layer on the stack is one somebody opened over the note', () => {
    const callers = sources().filter((path) => /overlays\.(show|peek)\(/.test(read(path)))
    expect(callers.sort()).toEqual(Object.keys(LAYERS).sort())
  })

  test('what comes out under a resting pointer is a peek, and nothing opened by a press is', () => {
    const peeks = sources().filter((path) => read(path).includes('overlays.peek('))
    expect(peeks.sort()).toEqual(['lib/Sidebar.svelte', 'lib/tab-strip/hover-card.svelte.ts'])
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
