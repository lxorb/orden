import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

vi.mock('../../collab/src/api', () => ({ rooms: { present: {}, seen: {}, following: null } }))
const { workspace } = await import('../../workspace/src/api')
const picking = await import('./picking.svelte')
const { picks } = await import('./drag.svelte')
const Tabs = (await import('./Tabs.svelte')).default
let shown: ReturnType<typeof mount> | undefined
let host: HTMLElement | undefined
afterEach(() => {
  if (shown) void unmount(shown)
  shown = undefined
  host?.remove()
})
const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
afterEach(() => {
  if (width) Object.defineProperty(HTMLElement.prototype, 'clientWidth', width)
})
test('picked tabs side by side join into one band through the picked look, and a picked tab alone keeps both its ends', () => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('tabs') ? 1400 : 0
    },
  })
  workspace.tabs = []
  workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
  workspace.activeSpaceId = 's'
  for (let at = 0; at < 6; at++) workspace.openBlank(`Note ${at}`, '# note')
  const paneId = workspace.tabs[0]?.paneId ?? ''
  for (const tab of workspace.tabs) tab.paneId = paneId
  const ids = workspace.tabsIn(paneId).map((one) => one.id)
  workspace.activate(ids[1] ?? '')
  picks.loaded = picking
  for (const at of [2, 3, 5]) picking.pick(paneId, ids[at] ?? '', 'toggle')
  const strip = document.createElement('div')
  host = strip
  document.body.append(strip)
  shown = mount(Tabs, { target: strip, props: { paneId } })
  flushSync()
  expect(strip.querySelectorAll('.tab.chosen').length).toBe(4)
  const look = readFileSync(join(import.meta.dirname, 'chosen.css'), 'utf8')
  const joins = [...look.matchAll(/^(\[data-box\]\.chosen.*(?:\+|:has).*) \.fill \{$/gm)].map((one) =>
    (one[1] ?? '').replace(':not(.active)', ''),
  )
  expect(joins).toHaveLength(2)
  const joined = (selector: string) =>
    [...strip.querySelectorAll<HTMLElement>(selector)].map((one) => ids.indexOf(one.dataset.box ?? ''))
  expect(joined(joins[0] ?? '')).toEqual([2, 3])
  expect(joined(joins[1] ?? '')).toEqual([1, 2])
})
