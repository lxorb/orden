import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import SpaceSwitcher from '../../src/lib/sidebar/src/SpaceSwitcher.svelte'
import { Titlebar } from '../../src/lib/titlebar/src/api'
import { spacesMenu } from '../../src/lib/surfaces/src/api'
import { viewport } from '../../src/lib/ui-kit/src/viewport.svelte'
import { workspace } from '../../src/lib/workspace/src/api'
import { settle } from './settle'

Element.prototype.scrollIntoView = () => undefined
const SPACES = [
  { id: 'vis', name: 'VIS', root: '/spaces/VIS' },
  { id: 'journal', name: 'Journal', root: '/spaces/Journal' },
]
let target: HTMLElement
let close: (() => void) | undefined
let was: 'phone' | 'tablet' | 'desktop'
beforeEach(() => {
  was = viewport.device
  viewport.device = 'desktop'
  workspace.spaces = SPACES.map((one) => ({ ...one }))
  workspace.activeSpaceId = 'vis'
  workspace.panel = null
  target = document.createElement('div')
  document.body.append(target)
})
afterEach(() => {
  close?.()
  close = undefined
  target.remove()
  viewport.device = was
  vi.restoreAllMocks()
})
function head() {
  const made = mount(SpaceSwitcher, { target })
  flushSync()
  close = () => void unmount(made, { outro: false })
}
function bar() {
  const made = mount(Titlebar, {
    target,
    props: { onpalette: () => undefined, onhistory: () => undefined },
  })
  flushSync()
  close = () => void unmount(made, { outro: false })
}
const mark = () => target.querySelector<HTMLButtonElement>('[data-space-drop="switcher"]')
const list = () => target.querySelector('[role="menu"]')
async function dropped() {
  mark()?.click()
  flushSync()
  await spacesMenu()
  await settle()
  expect(list()).not.toBe(null)
}
test('the shut panel leaves no space in the title bar', () => {
  bar()
  expect(target.querySelector('header [data-space-drop]')).toBe(null)
  expect(target.querySelector('header .orden-badge')).toBe(null)
  expect(target.querySelector('header')?.textContent).not.toContain('VIS')
})
test('a press on the header opens the switcher, and a row in it changes space', async () => {
  const shown = vi.spyOn(workspace, 'showSpace').mockResolvedValue(undefined)
  head()
  expect(list()).toBe(null)
  await dropped()
  expect(list()?.getAttribute('aria-label')).toBe('Spaces')
  expect(mark()?.getAttribute('aria-expanded')).toBe('true')
  const rows = [...(list()?.querySelectorAll<HTMLButtonElement>('.orden-row') ?? [])]
  expect(rows.map((one) => one.querySelector('.orden-row-label')?.textContent)).toEqual(['VIS', 'Journal', 'New space'])
  expect(rows[0]?.classList.contains('is-on')).toBe(true)
  rows[1]?.click()
  await settle()
  expect(shown).toHaveBeenCalledWith('journal')
  expect(list()).toBe(null)
})
test('the list wears no numbers, and a digit typed into it still goes there', async () => {
  const shown = vi.spyOn(workspace, 'showSpace').mockResolvedValue(undefined)
  head()
  await dropped()
  expect(list()?.querySelector('.place')).toBe(null)
  document.activeElement?.dispatchEvent(
    new KeyboardEvent('keydown', { key: '2', code: 'Digit2', bubbles: true, cancelable: true }),
  )
  await settle()
  expect(shown).toHaveBeenCalledWith('journal')
  expect(list()).toBe(null)
})
test('a second press puts the list away again', async () => {
  head()
  await dropped()
  expect(list()).not.toBe(null)
  mark()?.click()
  await settle()
  expect(list()).toBe(null)
  expect(mark()?.getAttribute('aria-expanded')).toBe('false')
})
