import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The Essentials' letters by the tabs' numbers (#1051): shown by the same hold, and Alt
 *  and a letter taken from whatever is focused to show its Essential. In the jsdom
 *  project, because the keys and the badges are the DOM's own; what a letter is, and the
 *  hold, are letters.test.ts and numbers.test.ts. */

const opened = vi.hoisted(() => [] as string[])

vi.mock('../tauri', () => ({ isDesktop: false }))
vi.mock('../surfaces.svelte', () => ({ tabOverview: { open: false } }))
vi.mock('../viewport.svelte', () => ({ viewport: { touch: false } }))
vi.mock('../i18n.svelte', () => ({ i18n: { factor: 1 } }))
vi.mock('../shortcuts.svelte', () => ({
  shortcuts: { keyFor: () => null, platform: 'win' },
}))
vi.mock('../workspace.svelte', () => ({
  workspace: { panes: { focusedId: 'pane' }, tabsIn: () => [] },
}))
vi.mock('./letters.svelte', () => ({
  essentialLetters: { pathOf: (letter: string) => (letter === 'N' ? '/space/Notes.md' : null) },
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

const key = (init: KeyboardEventInit, target: EventTarget = document.body) => {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}
const up = () => dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt' }))

function tile(letter: string, box = { left: 10, right: 40, top: 10, bottom: 40 }) {
  const button = document.createElement('button')
  button.dataset.essentialLetter = letter
  button.getBoundingClientRect = () => ({ ...box, width: box.right - box.left }) as DOMRect
  document.body.append(button)
  return button
}

beforeEach(() => {
  up()
  document.body.replaceChildren()
  opened.length = 0
})

describe("an Essential's letter", () => {
  test('is worn at its tile while Alt is held, and gone as Alt is let go of', () => {
    tile('N')
    key({ key: 'Alt', altKey: true })
    expect(numbers.worn).toEqual([{ id: 'essential:N', label: 'N', x: 40, y: 40 }])
    up()
    expect(numbers.worn).toEqual([])
  })

  test('is not worn by a tile out of sight, as in a folded sidebar', () => {
    tile('N', { left: -300, right: -270, top: 10, bottom: 40 })
    key({ key: 'Alt', altKey: true })
    expect(numbers.worn).toEqual([])
  })

  test('with Alt goes to its Essential, taken from what is focused, and keeps the hold', async () => {
    tile('N')
    key({ key: 'Alt', altKey: true })
    const pressed = key({ key: 'n', code: 'KeyN', altKey: true })
    expect(pressed.defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(opened).toEqual(['/space/Notes.md']))
    expect(numbers.worn).toHaveLength(1)
  })

  test('no Essential wears is left alone, and ends the hold', () => {
    tile('N')
    key({ key: 'Alt', altKey: true })
    const pressed = key({ key: 'f', code: 'KeyF', altKey: true })
    expect(pressed.defaultPrevented).toBe(false)
    expect(opened).toEqual([])
    expect(numbers.worn).toEqual([])
  })

  test("is the shell's in a terminal", () => {
    const screen = document.createElement('div')
    screen.className = 'xterm'
    const field = document.createElement('textarea')
    screen.append(field)
    document.body.append(screen)
    const pressed = key({ key: 'n', code: 'KeyN', altKey: true }, field)
    expect(pressed.defaultPrevented).toBe(false)
    expect(opened).toEqual([])
  })
})
