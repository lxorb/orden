import { beforeEach, describe, expect, test, vi } from 'vitest'

const opened = vi.hoisted(() => [] as string[])

vi.mock('../platform/src/tauri', () => ({ isDesktop: false }))
vi.mock('../surfaces.svelte', () => ({ tabOverview: { open: false } }))
vi.mock('../viewport.svelte', () => ({ viewport: { touch: false } }))
vi.mock('../shortcuts.svelte', () => ({
  shortcuts: { keyFor: () => null, platform: 'win' },
}))
vi.mock('../workspace.svelte', () => ({
  workspace: { panes: { focusedId: 'pane' }, activeTabId: null, tabs: [], tabsIn: () => [] },
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
  key({ key: 'a', code: 'KeyA' })
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

  test('no Essential wears is left alone, and the hold goes on (#1053)', () => {
    tile('N')
    key({ key: 'Alt', altKey: true })
    const pressed = key({ key: 'f', code: 'KeyF', altKey: true })
    expect(pressed.defaultPrevented).toBe(false)
    expect(opened).toEqual([])
    expect(numbers.worn).toHaveLength(1)
  })

  test("is worn and taken in a terminal too, and another letter is the shell's", async () => {
    tile('N')
    const screen = document.createElement('div')
    screen.className = 'xterm'
    const field = document.createElement('textarea')
    screen.append(field)
    document.body.append(screen)
    field.focus()
    key({ key: 'Alt', altKey: true }, field)
    expect(numbers.worn).toEqual([{ id: 'essential:N', label: 'N', x: 40, y: 40 }])
    const other = key({ key: 'f', code: 'KeyF', altKey: true }, field)
    expect(other.defaultPrevented).toBe(false)
    const pressed = key({ key: 'n', code: 'KeyN', altKey: true }, field)
    expect(pressed.defaultPrevented).toBe(true)
    await vi.waitFor(() => expect(opened).toEqual(['/space/Notes.md']))
  })
})

describe('Alt held', () => {
  const pointer = (name: string, altKey: boolean) =>
    dispatchEvent(new PointerEvent(name, { altKey, bubbles: true }))

  test('stays through other keys and the pointer, and goes as Alt is let go of', () => {
    tile('N')
    key({ key: 'Alt', altKey: true })
    key({ key: 'ArrowLeft', code: 'ArrowLeft', altKey: true })
    pointer('pointerdown', true)
    dispatchEvent(new WheelEvent('wheel', { altKey: true }))
    expect(numbers.worn).toHaveLength(1)

    up()
    expect(numbers.worn).toEqual([])
  })

  test('goes at the first press or move that says Alt is up, a release nobody heard', () => {
    tile('N')
    key({ key: 'Alt', altKey: true })
    pointer('pointermove', false)
    expect(numbers.worn).toEqual([])
  })

  test('comes at the first move that says Alt is down, where its press was not heard', () => {
    tile('N')
    pointer('pointermove', true)
    expect(numbers.worn).toHaveLength(1)
  })
})
