import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import NewHere from '../../src/lib/NewHere.svelte'
import { hiddenKinds, PASS_WORD } from '../../src/lib/settings.svelte'
import { viewport } from '../../src/lib/viewport.svelte'
import { workspace } from '../../src/lib/workspace.svelte'

Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    pause: () => undefined,
    play: () => undefined,
    finished: Promise.resolve(),
    currentTime: 0,
    startTime: 0,
    playState: 'finished',
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  }) as unknown as Animation

Element.prototype.scrollIntoView = () => undefined

let target: HTMLElement
let close: (() => void) | undefined
let was: 'phone' | 'tablet' | 'desktop'

beforeEach(() => {
  was = viewport.device
  viewport.device = 'desktop'
  hiddenKinds.hidden = [PASS_WORD]
  target = document.createElement('div')
  target.dataset.pane = workspace.panes.focusedId
  document.body.append(target)
})

afterEach(() => {
  close?.()
  close = undefined
  target.remove()
  viewport.device = was
  vi.restoreAllMocks()
})

function makers(): string[] {
  const made: string[] = []

  vi.spyOn(workspace, 'openBlank').mockImplementation(() => void made.push('note'))
  vi.spyOn(workspace, 'newCanvas').mockImplementation(async () => void made.push('canvas'))
  vi.spyOn(workspace, 'openPage').mockImplementation(() => {
    made.push('web')
    return null
  })
  vi.spyOn(workspace, 'newPages').mockImplementation(async () => void made.push('pages'))
  vi.spyOn(workspace, 'focusPane').mockImplementation(() => undefined)

  return made
}

function here(chosenOn?: string) {
  const paneId = workspace.panes.focusedId
  const made = mount(NewHere, {
    target,
    props: chosenOn === undefined ? { paneId } : { paneId, chosenOn },
  })
  flushSync()
  close = () => void unmount(made, { outro: false })
}

const buttons = () => [...target.querySelectorAll<HTMLButtonElement>('button')]
const names = (within: ParentNode) =>
  [...within.querySelectorAll('.orden-row-label')].map((one) => one.textContent.trim())

function press(key: string, held: KeyboardEventInit = {}) {
  const at = document.activeElement ?? document.body
  at.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...held }))
  flushSync()
}

test('offers every kind a new tab can be, in the lines Emil gave them', () => {
  makers()
  here()

  expect(names(target)).toEqual([
    'New note',
    'New canvas',
    'New page note',
    'Online terminal',
    'New application',
    'Pass',
    'New web note',
  ])
  expect([...target.querySelectorAll('.line')].map(names)).toEqual([
    ['New note', 'New canvas', 'New page note'],
    ['Online terminal', 'New application', 'Pass'],
    ['New web note'],
  ])
})

test('each wearing its letter, which a screen reader is told as its key', () => {
  makers()
  here()

  expect(buttons().map((one) => one.querySelector('kbd')?.textContent)).toEqual([
    'N',
    'C',
    'P',
    'O',
    'A',
    'K',
    'W',
  ])
  expect(buttons().map((one) => one.getAttribute('aria-keyshortcuts'))).toEqual([
    'N',
    'C',
    'P',
    'O',
    'A',
    'K',
    'W',
  ])
})

test('lands the keyboard on the first of them', () => {
  makers()
  here()

  expect(document.activeElement).toBe(buttons()[0])
})

test('and the arrows walk the rest', () => {
  makers()
  here()

  const first = buttons()[0]
  first?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  flushSync()

  expect(document.activeElement).toBe(buttons()[1])
})

test('makes its own kind when one is pressed', async () => {
  const made = makers()
  here()

  for (const one of buttons()) one.click()
  flushSync()

  await vi.waitFor(() => expect(made).toEqual(['note', 'canvas', 'pages', 'web']))
})

test('makes a kind by its letter, with the keyboard on a card', () => {
  const made = makers()
  here()

  expect(document.activeElement).toBe(buttons()[0])
  press('c')

  expect(made).toEqual(['canvas'])
})

test('and with the keyboard on nothing at all', async () => {
  const made = makers()
  here()

  ;(document.activeElement as HTMLElement | null)?.blur()
  press('p')
  press('W', { shiftKey: true })

  await vi.waitFor(() => expect(made).toEqual(['pages', 'web']))
})

test('but never in a field, nor under a modifier', () => {
  const made = makers()
  here()

  const field = document.createElement('input')
  target.prepend(field)
  field.focus()
  press('n')
  field.remove()

  buttons()[0]?.focus()
  press('n', { ctrlKey: true })
  press('n', { altKey: true })

  expect(made).toEqual([])
})

test('in a new tab, leaves the keyboard where it was and says which tab the choice is on', () => {
  const made = makers()
  const chosen: string[] = []
  vi.spyOn(workspace, 'chosenOn').mockImplementation((id) => void chosen.push(id))
  vi.spyOn(workspace, 'showing').mockReturnValue({ id: 'new-tab' } as ReturnType<
    typeof workspace.showing
  >)
  here('new-tab')

  expect(target.contains(document.activeElement)).toBe(false)
  press('c')

  expect(made).toEqual(['canvas'])
  expect(chosen).toEqual(['new-tab'])
})

test('and hears no letter once that tab is not the one in front', () => {
  const made = makers()
  vi.spyOn(workspace, 'showing').mockReturnValue(null)
  here('new-tab')

  press('c')

  expect(made).toEqual([])
})

test('is one stop for Tab, whichever button the keyboard is on', () => {
  makers()
  here()

  expect(buttons().map((one) => one.tabIndex)).toEqual([0, -1, -1, -1, -1, -1, -1])
})
