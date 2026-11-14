import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../../src/lib/sharing/src/api', async (original) => ({
  ...(await original<typeof import('../../src/lib/sharing/src/sharing.svelte')>()),
  roleOf: (root: string) => (root === '/spaces/Lab' ? 'read' : 'owner'),
  isShared: (root: string) => root === '/spaces/Lab',
}))

const { default: SpacePicker } = await import('../../src/lib/SpacePicker.svelte')
const { spacePicker } = await import('../../src/lib/space-picker.svelte')
const { viewport } = await import('../../src/lib/ui-kit/src/viewport.svelte')
const { workspace } = await import('../../src/lib/workspace.svelte')
const { overlays } = await import('../../src/lib/ui-kit/src/overlays')
const { shortcuts } = await import('../../src/lib/shortcuts.svelte')

Element.prototype.scrollIntoView = () => undefined

const FOUR = ['VIS', 'Journal', 'ETH', 'Lab']

function spaces(names: readonly string[]) {
  workspace.spaces = names.map((name) => ({
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    root: `/spaces/${name}`,
  }))
  workspace.activeSpaceId = workspace.spaces[0]?.id ?? null
}

let target: HTMLElement
let close: (() => void) | undefined
let was: typeof viewport.device
let shown: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  was = viewport.device
  viewport.device = 'desktop'
  spaces(FOUR)
  shown = vi.spyOn(workspace, 'showSpace').mockResolvedValue(undefined)
  target = document.createElement('div')
  document.body.append(target)
  const made = mount(SpacePicker, { target })
  close = () => void unmount(made, { outro: false })
})

afterEach(() => {
  spacePicker.dismiss()
  flushSync()
  close?.()
  target.remove()
  viewport.device = was
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const dialog = () => target.querySelector<HTMLElement>('[data-spaces-open]')
const rows = () => [...(dialog()?.querySelectorAll<HTMLButtonElement>('.orden-row') ?? [])]
const names = () => rows().map((one) => one.querySelector('.orden-row-label')?.textContent)

async function opened() {
  spacePicker.toggle()
  flushSync()
  await tick()
}

async function press(key: string, code = '', held: KeyboardEventInit = {}) {
  const at = dialog()?.contains(document.activeElement) ? document.activeElement : dialog()
  at?.dispatchEvent(
    new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true, ...held }),
  )
  flushSync()
  await tick()
  flushSync()
}

const numbers = () => rows().map((one) => one.querySelector('.place')?.textContent ?? null)

async function type(text: string) {
  for (const character of text) await press(character)
}

test('it has no field and no numbers: every space is a row, and nothing can be typed into', async () => {
  await opened()

  expect(dialog()).not.toBe(null)
  expect(dialog()?.classList.contains('is-centred')).toBe(true)
  expect(dialog()?.querySelector('input, textarea, [contenteditable]')).toBe(null)
  expect(names()).toEqual(FOUR)
  expect(numbers()).toEqual([null, null, null, null])
  expect(dialog()?.querySelector('.more')).toBe(null)
  expect(dialog()?.textContent).not.toContain('New space')
  expect(document.activeElement).toBe(rows()[0])
})

test('Alt held shows the numbers, its release takes them away, and Alt and a digit goes', async () => {
  await opened()

  await press('Alt', 'AltLeft', { altKey: true })
  expect(numbers()).toEqual(['1', '2', '3', '4'])

  dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt', code: 'AltLeft' }))
  flushSync()
  await vi.waitFor(() => expect(numbers()).toEqual([null, null, null, null]))

  await press('Alt', 'AltLeft', { altKey: true })
  dispatchEvent(new Event('blur'))
  flushSync()
  await vi.waitFor(() => expect(numbers()).toEqual([null, null, null, null]))

  await press('Alt', 'AltRight', { altKey: true, ctrlKey: true })
  expect(numbers()).toEqual([null, null, null, null])

  await press('Alt', 'AltLeft', { altKey: true })
  await press('2', 'Digit2', { altKey: true })
  expect(shown).toHaveBeenCalledWith('journal')
  expect(spacePicker.open).toBe(false)
})

test('a digit switches at once, without Enter', async () => {
  await opened()
  await press('3', 'Digit3')

  expect(shown).toHaveBeenCalledWith('eth')
  expect(spacePicker.open).toBe(false)
})

test('a name is found, shown as hits, and waits for Enter', async () => {
  await opened()
  await type('jo')

  expect(names()).toEqual(['Journal'])
  expect(rows()[0]?.querySelector('.orden-row-label b')?.textContent).toBe('Jo')
  expect(shown).not.toHaveBeenCalled()
  expect(spacePicker.open).toBe(true)
  expect(dialog()?.querySelector('input, textarea, [contenteditable]')).toBe(null)

  await press('Enter')
  expect(shown).toHaveBeenCalledWith('journal')
  expect(spacePicker.open).toBe(false)
})

test('Backspace takes a letter back, and a letter nothing holds is refused', async () => {
  await opened()
  await type('e')
  expect(names()).toEqual(['ETH'])

  await press('z')
  expect(names()).toEqual(['ETH'])
  expect(rows()[0]?.querySelector('.orden-row-label b')?.textContent).toBe('E')

  await press('Backspace')
  expect(names()).toEqual(FOUR)
  expect(dialog()?.querySelector('b')).toBe(null)
})

test('with ten or more, a digit another could extend waits, and a second one goes at once', async () => {
  spaces(Array.from({ length: 12 }, (_, at) => `Space ${String(at + 1)}`))
  workspace.activeSpaceId = 'space-5'
  await opened()

  vi.useFakeTimers()
  await press('1', 'Digit1')
  expect(shown).not.toHaveBeenCalled()
  expect(numbers()).toEqual(['1', '10', '11', '12'])
  expect(rows().map((one) => one.querySelector('.place b')?.textContent)).toEqual([
    '1',
    '1',
    '1',
    '1',
  ])
  await press('2', 'Digit2')
  expect(shown).toHaveBeenCalledWith('space-12')

  await opened()
  await press('1', 'Digit1')
  vi.advanceTimersByTime(700)
  expect(shown).toHaveBeenLastCalledWith('space-1')
})

test.each([
  ['Ctrl+Space', false],
  ['Ctrl+Shift+Space', true],
])('%s again puts it away, as Escape does', async (_, shiftKey) => {
  await opened()
  expect(overlays.depth).toBe(1)

  const chord = new KeyboardEvent('keydown', {
    key: ' ',
    code: 'Space',
    ctrlKey: true,
    shiftKey,
    bubbles: true,
    cancelable: true,
  })
  document.activeElement?.dispatchEvent(chord)
  expect(chord.defaultPrevented).toBe(false)
  expect(shortcuts.handle(chord, {} as never)).toBe(true)
  await vi.waitFor(() => expect(spacePicker.open).toBe(false))
  flushSync()
  expect(overlays.depth).toBe(0)

  await opened()
  overlays.escape()
  flushSync()
  expect(spacePicker.open).toBe(false)
  expect(shown).not.toHaveBeenCalled()
})

test("Escape is the layer's: the list does not send the keyboard to the note", async () => {
  await opened()
  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
  document.activeElement?.dispatchEvent(escape)
  expect(escape.defaultPrevented).toBe(false)
  expect(overlays.escape()).toBe(true)
  flushSync()
  expect(spacePicker.open).toBe(false)
})

test('a space shared only to be read is there, and marked', async () => {
  await opened()

  const lab = rows()[3]
  expect(lab?.querySelector('.orden-row-label')?.textContent).toBe('Lab')
  expect(lab?.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Read-only')
  expect(rows()[0]?.querySelector('[role="img"]')).toBe(null)
})

describe('on a phone', () => {
  test('the key opens the drawer’s own list rather than a dialog', async () => {
    viewport.device = 'phone'
    spacePicker.toggle()
    flushSync()
    await tick()

    expect(spacePicker.open).toBe(false)
    expect(dialog()).toBe(null)
  })
})
