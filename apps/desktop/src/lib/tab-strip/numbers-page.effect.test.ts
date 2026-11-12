import { expect, test, vi } from 'vitest'

const opened = vi.hoisted(() => [] as string[])

vi.mock('../tauri', () => ({ isDesktop: true, invoke: () => Promise.resolve(true) }))
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
  shortcuts: { keyFor: () => null, platform: 'win' },
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

test('stay as the keyboard goes into a page, and go as the window loses it', async () => {
  tile('N')
  key({ key: 'Alt', altKey: true })
  dispatchEvent(new FocusEvent('blur'))
  expect(numbers.worn).toHaveLength(1)

  await vi.waitFor(() => {
    focus.changed(false)
    expect(numbers.worn).toEqual([])
  })
})
