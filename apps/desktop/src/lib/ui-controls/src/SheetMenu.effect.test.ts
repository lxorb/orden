import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { DIVIDER, menu } from '../../ui-kit/src/api'

const SheetMenu = (await import('./SheetMenu.svelte')).default
let shown: ReturnType<typeof mount> | undefined
afterEach(() => {
  menu.hide()
  if (shown) void unmount(shown)
  shown = undefined
  document.body.replaceChildren()
})
const rows = () => [...document.querySelectorAll<HTMLButtonElement>('[data-sheet-menu] button')]
function opened(items: Parameters<typeof menu.show>[1], title = 'Reading') {
  shown = mount(SheetMenu, { target: document.body })
  menu.show(new MouseEvent('contextmenu', { clientX: 10, clientY: 10 }), items, { title })
  flushSync()
}
test('a menu asked for by a part of the app opens as a sheet under its title, one button a row', () => {
  opened([
    { label: 'Daily goal', checked: true, run: () => undefined },
    { label: 'Weekly goal', checked: false, run: () => undefined },
    DIVIDER,
    { label: 'Archive', disabled: true, run: () => undefined },
    { label: 'Delete', danger: true, run: () => undefined },
  ])
  expect(document.querySelector('[role=dialog]')?.getAttribute('aria-label')).toBe('Reading')
  expect(
    rows().map((one) => [one.textContent.trim().replace(/\s+/g, ' '), one.getAttribute('role'), one.disabled]),
  ).toEqual([
    ['Daily goal ✓', 'menuitemcheckbox', false],
    ['Weekly goal', 'menuitemcheckbox', false],
    ['Archive', 'menuitem', true],
    ['Delete', 'menuitem', false],
  ])
  expect(document.querySelectorAll('[data-sheet-menu] hr')).toHaveLength(1)
  expect(rows()[3]?.classList.contains('is-danger')).toBe(true)
})
test('a row runs and the sheet closes, a row that keeps the menu leaves it open', async () => {
  const ran: string[] = []
  opened([
    { label: 'Pin', keep: true, run: () => ran.push('pin') },
    { label: 'Archive', run: () => ran.push('archive') },
  ])
  rows()[0]?.click()
  flushSync()
  expect([ran, menu.open]).toEqual([['pin'], true])
  rows()[1]?.click()
  flushSync()
  expect([ran, menu.open]).toEqual([['pin', 'archive'], false])
  await vi.waitFor(() => expect(document.querySelector('[role=dialog]')).toBeNull())
})
test('a row with more rows behind it shows them in the same sheet', async () => {
  const ran: string[] = []
  opened([
    {
      label: 'Priority',
      run: () => ran.push('never'),
      more: () => Promise.resolve([{ label: 'High', run: () => ran.push('high') }]),
    },
  ])
  rows()[0]?.click()
  await Promise.resolve()
  flushSync()
  expect(rows().map((one) => one.textContent.trim())).toEqual(['High'])
  rows()[0]?.click()
  expect(ran).toEqual(['high'])
})
test('Escape closes it and runs nothing', () => {
  const ran: string[] = []
  opened([{ label: 'Archive', run: () => ran.push('archive') }])
  document.querySelector('[role=dialog]')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  flushSync()
  expect([ran, menu.open]).toEqual([[], false])
})
