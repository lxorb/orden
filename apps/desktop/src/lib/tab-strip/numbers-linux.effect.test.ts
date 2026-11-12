import { expect, test, vi } from 'vitest'

const opened = vi.hoisted(() => [] as string[])
const asked = vi.hoisted(() => [] as { command: string; args: unknown }[])

vi.mock('../tauri', () => ({
  isDesktop: true,
  invoke: (command: string, args: unknown) => {
    asked.push({ command, args })
    return Promise.resolve(true)
  },
}))
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
vi.mock('../shortcuts.svelte', () => ({
  shortcuts: {
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
          { code: 'KeyL', ctrl: false, shift: false, alt: true },
        ],
      },
    },
  ])
  await Promise.resolve()
  tile('N')
  key({ key: 'Alt', altKey: true })
  dispatchEvent(new FocusEvent('blur'))
  expect(numbers.worn).toHaveLength(1)

  key({ key: 'n', code: 'KeyN', altKey: true })
  await vi.waitFor(() => expect(opened).toEqual(['/space/Notes.md']))

  await vi.waitFor(() => {
    focus.changed(false)
    expect(numbers.worn).toEqual([])
  })
})
