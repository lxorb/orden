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
const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
test('a switch rewrites the classes of the tab it leaves and the tab it opens, and no other', () => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return this.classList.contains('tabs') ? 1400 : 0
    },
  })
  try {
    workspace.tabs = []
    workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
    workspace.activeSpaceId = 's'
    for (let at = 0; at < 10; at++) workspace.openBlank(`Note ${at}`, '# note')
    const paneId = workspace.tabs[0]?.paneId ?? ''
    for (const tab of workspace.tabs) tab.paneId = paneId
    const ids = workspace.tabsIn(paneId).map((one) => one.id)
    workspace.activate(ids[2] ?? '')
    host = document.createElement('div')
    document.body.append(host)
    shown = mount(Tabs, { target: host, props: { paneId } })
    flushSync()
    const watch = new MutationObserver(() => undefined)
    watch.observe(host, { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true })
    workspace.activate(ids[6] ?? '')
    flushSync()
    const changed = watch
      .takeRecords()
      .filter((one) => (one.target as Element).className !== one.oldValue)
      .map((one) => {
        const tab = (one.target as Element).closest('[data-box]')?.getAttribute('data-box') ?? 'strip'
        return `${tab} ${(one.target as Element).className} was ${one.oldValue}`
      })
    watch.disconnect()
    const touched = new Set(changed.map((one) => one.split(' ')[0]))
    expect([...touched].sort(), changed.join('\n')).toEqual([ids[2], ids[6]].sort())
  } finally {
    if (width) Object.defineProperty(HTMLElement.prototype, 'clientWidth', width)
  }
})
