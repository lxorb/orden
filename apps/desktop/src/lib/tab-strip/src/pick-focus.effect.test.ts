import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

vi.mock('../../collab/src/api', () => ({ rooms: { present: {}, seen: {}, following: null } }))
const { workspace } = await import('../../workspace/src/api')
const Tabs = (await import('./Tabs.svelte')).default
let shown: ReturnType<typeof mount> | undefined
let host: HTMLElement | undefined
afterEach(() => {
  if (shown) void unmount(shown)
  shown = undefined
  host?.remove()
})
function strip(): string[] {
  workspace.tabs = []
  workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
  workspace.activeSpaceId = 's'
  for (let at = 0; at < 3; at++) workspace.openBlank(`Note ${at}`, '# note')
  const paneId = workspace.tabs[0]?.paneId ?? ''
  for (const tab of workspace.tabs) tab.paneId = paneId
  host = document.createElement('div')
  document.body.append(host)
  shown = mount(Tabs, { target: host, props: { paneId } })
  flushSync()
  return workspace.tabsIn(paneId).map((one) => one.id)
}
const pickOf = (id: string) => host?.querySelector<HTMLButtonElement>(`.pick[data-tab="${id}"]`) ?? null
test('a press of the mouse on a tab leaves the keyboard where it was', () => {
  const ids = strip()
  const pick = pickOf(ids[0] ?? '')
  const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })
  pick?.dispatchEvent(press)
  expect(press.defaultPrevented).toBe(true)
})
test('the keyboard still reaches a tab', () => {
  const ids = strip()
  const pick = pickOf(ids[1] ?? '')
  pick?.focus()
  expect(document.activeElement).toBe(pick)
})
