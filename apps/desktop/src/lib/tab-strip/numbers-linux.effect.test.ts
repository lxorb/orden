import { expect, test, vi } from 'vitest'

/** The keyboard going into a web page on Linux (#1053), where Orden's own Chromium tells
 *  the window of Alt in the page once the crate says it can (`web_keys_take` in
 *  web_keys.rs): the Essentials' letters are said to the crate to be taken from a page,
 *  and the document's own blur, which says nothing of Alt, leaves the numbers up. */

const opened = vi.hoisted(() => [] as string[])
const asked = vi.hoisted(() => [] as { command: string; args: unknown }[])

vi.mock('../tauri', () => ({
  isDesktop: true,
  invoke: (command: string, args: unknown) => {
    asked.push({ command, args })
    return Promise.resolve(true)
  },
}))
/** The window's own word of losing the keyboard, which the test says. */
const focus = vi.hoisted(() => ({ changed: (_payload: boolean): void => undefined }))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onFocusChanged: (then: (event: { payload: boolean }) => void) => {
      focus.changed = (payload) => then({ payload })
      return Promise.resolve(() => undefined)
    },
  }),
}))
vi.mock('../surfaces.svelte', () => ({ tabOverview: { open: false } }))
vi.mock('../viewport.svelte', () => ({ viewport: { touch: false } }))
vi.mock('../i18n.svelte', () => ({ i18n: { factor: 1 } }))
vi.mock('../shortcuts.svelte', () => ({
  shortcuts: {
    // The panes' four ways, bound as they ship (#1033), and Alt+K rebound to Ctrl+Alt+K.
    keyFor: (id: string) =>
      ({ 'pane.focus-left': 'Alt-h', 'pane.focus-up': 'Mod-Alt-k', 'pane.focus-right': 'Alt-l' })[
        id
      ] ?? null,
    platform: 'linux',
  },
}))
vi.mock('../workspace.svelte', () => ({
  workspace: { panes: { focusedId: 'pane' }, activeTabId: null, tabs: [], tabsIn: () => [] },
}))
vi.mock('./letters.svelte', () => ({
  essentialLetters: {
    given: { '/space/Notes.md': 'N' },
    pathOf: (letter: string) => (letter === 'N' ? '/space/Notes.md' : null),
  },
}))
vi.mock('../essentials.svelte', () => ({
  openEssential: (path: string) => void opened.push(path),
}))

vi.stubGlobal('CSS', { escape: (text: string) => text })
vi.stubGlobal('requestAnimationFrame', (then: FrameRequestCallback) => {
  then(0)
  return 1
})

const { numbers } = await import('./numbers.svelte')

const key = (init: KeyboardEventInit) =>
  dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }))

function tile(letter: string) {
  const button = document.createElement('button')
  button.dataset.essentialLetter = letter
  button.getBoundingClientRect = () =>
    ({ left: 10, right: 40, top: 10, bottom: 40, width: 30 }) as DOMRect
  document.body.append(button)
}

test("the letters and the panes' keys are said to the crate, and a page that tells Alt keeps the numbers up", async () => {
  expect(asked).toEqual([
    {
      command: 'web_keys_take',
      args: {
        chords: [
          { code: 'KeyN', ctrl: false, shift: false, alt: true },
          { code: 'KeyH', ctrl: false, shift: false, alt: true },
          // A key rebound with Ctrl and Alt is AltGr's on half of Europe's keyboards, and
          // the page's: never asked for.
          { code: 'KeyL', ctrl: false, shift: false, alt: true },
        ],
      },
    },
  ])
  // The answer lands after the import: until then, the blur still puts them away.
  await Promise.resolve()
  tile('N')
  key({ key: 'Alt', altKey: true })
  dispatchEvent(new FocusEvent('blur'))
  expect(numbers.worn).toHaveLength(1)

  // Alt and the letter, played from the page as the crate says it, opens the Essential.
  key({ key: 'n', code: 'KeyN', altKey: true })
  await vi.waitFor(() => expect(opened).toEqual(['/space/Notes.md']))

  await vi.waitFor(() => {
    focus.changed(false)
    expect(numbers.worn).toEqual([])
  })
})
