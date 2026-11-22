import { providePort, registerCommand } from '@orden/contracts'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import NewHere from '../../src/lib/new-here/src/NewHere.svelte'
import { EXPERIMENTAL_WORD, hiddenKinds, PASS_WORD } from '../../src/lib/gates/src/api'
import { viewport } from '../../src/lib/ui-kit/src/viewport.svelte'
import { tabOverview, workspace } from '../../src/lib/workspace/src/api'
import { idle, settle } from './settle'

const nothing = () => Promise.resolve()
providePort('terminal.making', {
  open: nothing,
  shells: () => Promise.resolve([]),
  warm: nothing,
  pickHost: nothing,
  online: nothing,
})
const asked: string[] = []
registerCommand('ai.tab', () => Promise.resolve(() => void asked.push('ai')))
await import('../../src/lib/web-tab/src/api')
Element.prototype.scrollIntoView = () => undefined
const SOON = { timeout: 3000 }
let target: HTMLElement
let close: (() => void) | undefined
let was: 'phone' | 'tablet' | 'desktop'
beforeEach(() => {
  was = viewport.device
  viewport.device = 'desktop'
  hiddenKinds.hidden = [EXPERIMENTAL_WORD, PASS_WORD]
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
const hub = () => target.querySelector<HTMLButtonElement>('.hub')
const quarters = () =>
  [...target.querySelectorAll<SVGElement>('[data-slot]')].map((one) => [
    Number(one.dataset.slot),
    one.dataset.line,
    [...one.querySelectorAll<SVGElement>('[data-kind]')].map((option) => option.dataset.kind),
  ])
const option = (kind: string) => target.querySelector<SVGElement>(`[data-kind="${kind}"]`)
const quarter = (line: string) => target.querySelector<SVGElement>(`[data-quarter="${line}"]`)
const opened = () => target.querySelector<SVGElement>('.quarter.open')?.dataset.quarter ?? null
const picked = () => target.querySelector<SVGElement>('.option.picked')?.dataset.kind ?? null
function press(key: string, held: KeyboardEventInit = {}) {
  const at = document.activeElement ?? document.body
  at.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...held }))
  flushSync()
}
function click(on: Element | null, held: MouseEventInit = {}) {
  on?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...held }))
  flushSync()
}

test('puts each group in the quarter its arrow points to, the apps joining the browser when none is free', () => {
  makers()
  here()
  expect(quarters()).toEqual([
    [0, 'notes', ['note', 'canvas', 'pages']],
    [1, 'chats', ['ai']],
    [2, 'terminals', ['online']],
    [3, 'browser', ['web', 'pass']],
  ])
})
test('leaves a quarter empty when its group is not here, the apps taking the first free one', () => {
  makers()
  viewport.device = 'phone'
  here()
  expect(quarters()).toEqual([
    [0, 'notes', ['note', 'canvas', 'pages']],
    [1, 'apps', ['pass']],
    [2, 'terminals', ['online']],
  ])
  expect(target.querySelectorAll('.empty')).toHaveLength(1)
})
test('starts with the middle picked and holding the keyboard', () => {
  makers()
  here()
  expect(hub()?.classList.contains('picked')).toBe(true)
  expect(document.activeElement).toBe(hub())
  expect(hub()?.getAttribute('aria-keyshortcuts')).toBe('Space')
})
test('is one stop for Tab, the middle', () => {
  makers()
  here()
  const stops = [...target.querySelectorAll<HTMLElement | SVGElement>('button, [tabindex]')].filter(
    (one) => one.tabIndex >= 0,
  )
  expect(stops).toEqual([hub()])
})
test('opens the quarter an arrow points at, walks its options, and makes the one picked with Enter', async () => {
  const made = makers()
  here()
  press('ArrowUp')
  expect(opened()).toBe('notes')
  expect(picked()).toBeNull()
  press('ArrowRight')
  expect(picked()).toBe('note')
  press('ArrowRight')
  expect(picked()).toBe('canvas')
  press('Enter')
  await vi.waitFor(() => expect(made).toEqual(['canvas']), SOON)
})
test('goes back to the middle with the arrow pointing home', () => {
  makers()
  here()
  press('ArrowLeft')
  expect(opened()).toBe('browser')
  press('ArrowRight')
  expect(opened()).toBeNull()
  expect(hub()?.classList.contains('picked')).toBe(true)
})
test('makes a lone kind straight from its quarter, with Enter or a click', async () => {
  makers()
  asked.length = 0
  here()
  press('ArrowRight')
  expect(opened()).toBe('chats')
  press('Enter')
  await vi.waitFor(() => expect(asked).toEqual(['ai']), SOON)
})
test('and a click on the quarter of a lone kind makes it too', async () => {
  makers()
  asked.length = 0
  here()
  click(quarter('chats'))
  await vi.waitFor(() => expect(asked).toEqual(['ai']), SOON)
})
test('lets go of everything with Escape, and Space picks the middle again', () => {
  makers()
  here()
  press('ArrowUp')
  press('ArrowUp')
  expect(picked()).toBe('canvas')
  press('Escape')
  expect(opened()).toBeNull()
  expect(picked()).toBeNull()
  expect(hub()?.classList.contains('picked')).toBe(false)
  press('ArrowUp')
  expect(opened()).toBeNull()
  press(' ')
  expect(hub()?.classList.contains('picked')).toBe(true)
  press('ArrowUp')
  expect(opened()).toBe('notes')
})
test('makes a kind by its letter, opening its quarter on the way', async () => {
  const made = makers()
  here()
  press('c')
  expect(opened()).toBe('notes')
  expect(picked()).toBe('canvas')
  await vi.waitFor(() => expect(made).toEqual(['canvas']), SOON)
})
test('and with the keyboard on nothing at all', async () => {
  const made = makers()
  here()
  hub()?.blur()
  press('p')
  await vi.waitFor(() => expect(made).toEqual(['pages']), SOON)
})
test('but never in a field, nor under a modifier', async () => {
  const made = makers()
  here()
  const field = document.createElement('input')
  target.prepend(field)
  field.focus()
  press('n')
  press('ArrowUp')
  field.remove()
  hub()?.focus()
  press('n', { ctrlKey: true })
  press('n', { altKey: true })
  press('ArrowUp', { metaKey: true })
  await settle()
  expect(made).toEqual([])
  expect(opened()).toBeNull()
})
test('makes the option clicked once its quarter is open', async () => {
  const made = makers()
  here()
  press('ArrowUp')
  click(option('pages'))
  await vi.waitFor(() => expect(made).toEqual(['pages']), SOON)
})
test('wears each letter, which a screen reader is told as its key', () => {
  makers()
  here()
  expect([...target.querySelectorAll('[data-kind]')].map((one) => one.getAttribute('aria-keyshortcuts'))).toEqual([
    'N',
    'C',
    'P',
    'Q',
    'O',
    'W',
    'K',
  ])
  expect(quarter('notes')?.getAttribute('aria-expanded')).toBe('false')
})
test('in a new tab, takes the keyboard for the middle and says which tab the choice is on', async () => {
  const made = makers()
  const chosen: string[] = []
  vi.spyOn(workspace, 'chosenOn').mockImplementation((id) => void chosen.push(id))
  vi.spyOn(workspace, 'showing').mockReturnValue({ id: 'new-tab' } as ReturnType<typeof workspace.showing>)
  here('new-tab')
  expect(document.activeElement).toBe(hub())
  expect(hub()?.classList.contains('picked')).toBe(true)
  press('c')
  await vi.waitFor(() => expect(made).toEqual(['canvas']), SOON)
  expect(chosen).toEqual(['new-tab'])
})
test('takes the keyboard from nothing that holds it, which leaves a new tab s keyboard to its address', async () => {
  makers()
  vi.spyOn(workspace, 'showing').mockReturnValue({ id: 'new-tab' } as ReturnType<typeof workspace.showing>)
  const address = document.createElement('input')
  document.body.append(address)
  address.focus()
  here('new-tab')
  await idle(1100)
  expect(document.activeElement).toBe(address)
  address.remove()
})
test('and hears no key once that tab is not the one in front', async () => {
  const made = makers()
  vi.spyOn(workspace, 'showing').mockReturnValue(null)
  here('new-tab')
  press('c')
  press('ArrowUp')
  await settle()
  expect(made).toEqual([])
  expect(opened()).toBeNull()
})
test('takes the keyboard once what held it in the tab just closed is gone', async () => {
  makers()
  const leaving = document.createElement('input')
  document.body.append(leaving)
  leaving.focus()
  here()
  expect(document.activeElement).toBe(leaving)
  leaving.remove()
  await vi.waitFor(() => expect(document.activeElement).toBe(hub()), SOON)
})
test('leaves the keyboard where the reader put it outside the pane', async () => {
  makers()
  const elsewhere = document.createElement('input')
  document.body.append(elsewhere)
  elsewhere.focus()
  here()
  await settle()
  expect(document.activeElement).toBe(elsewhere)
  elsewhere.remove()
})
test('makes nothing twice while one kind is on its way', async () => {
  const made = makers()
  here()
  press('n')
  press('c')
  await vi.waitFor(() => expect(made).toEqual(['note']), SOON)
  await settle()
  expect(made).toEqual(['note'])
})
const shape = (kind: string) => option(kind)?.querySelector('.shape')?.getAttribute('d') ?? ''
function pointer(type: string, on: Element | null) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } })
  on?.dispatchEvent(event)
  flushSync()
}
async function fannedOut(kind: string) {
  await vi.waitFor(async () => {
    const was = shape(kind)
    await idle(60)
    expect(was).not.toBe('')
    expect(shape(kind)).toBe(was)
  }, SOON)
}
test('opens a quarter once, never starting over when the kinds here are read again', async () => {
  makers()
  here()
  press('ArrowUp')
  await fannedOut('pages')
  const open = ['note', 'canvas', 'pages'].map(shape)
  hiddenKinds.hidden = [...hiddenKinds.hidden]
  flushSync()
  expect(['note', 'canvas', 'pages'].map(shape)).toEqual(open)
  await settle()
  expect(['note', 'canvas', 'pages'].map(shape)).toEqual(open)
})
test('and never while the pointer walks from option to option', async () => {
  makers()
  here()
  pointer('pointermove', quarter('notes'))
  expect(opened()).toBe('notes')
  await fannedOut('pages')
  const open = shape('note')
  for (const kind of ['note', 'canvas', 'pages', 'canvas', 'note']) {
    pointer('pointermove', option(kind))
    expect(picked()).toBe(kind)
    await settle()
  }
  pointer('pointermove', quarter('notes'))
  await fannedOut('note')
  expect(shape('note')).toBe(open)
})
test('opens the overview from the middle', () => {
  makers()
  here()
  tabOverview.open = false
  click(hub())
  expect(tabOverview.open).toBe(true)
  click(hub())
  expect(tabOverview.open).toBe(true)
  tabOverview.open = false
  press(' ')
  expect(tabOverview.open).toBe(false)
})
