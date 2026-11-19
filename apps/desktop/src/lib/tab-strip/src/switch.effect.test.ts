import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

vi.mock('../../collab/src/api', () => ({ rooms: { present: {}, seen: {}, following: null } }))
const { workspace } = await import('../../workspace/src/api')
const Tabs = (await import('./Tabs.svelte')).default
const reads: string[] = []
const scrolledTo: number[] = []
const undo: (() => void)[] = []
function spy(on: object, name: string, value: () => unknown, set: (value: unknown) => void = () => undefined) {
  const was = Object.getOwnPropertyDescriptor(on, name)
  Object.defineProperty(on, name, { configurable: true, get: value, set })
  undo.push(() => (was ? Object.defineProperty(on, name, was) : Reflect.deleteProperty(on, name)))
}
function watchReads() {
  for (const name of ['scrollLeft', 'scrollWidth', 'clientWidth', 'clientLeft']) {
    spy(Element.prototype, name, function (this: Element) {
      reads.push(name)
      return this.classList.contains('tabs') && name === 'clientWidth' ? 200 : 0
    })
  }
  for (const name of ['offsetWidth', 'offsetLeft', 'offsetHeight']) {
    spy(HTMLElement.prototype, name, () => {
      reads.push(name)
      return 0
    })
  }
  for (const one of [
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(() => {
      reads.push('getBoundingClientRect')
      return new DOMRect()
    }),
    vi.spyOn(window, 'getComputedStyle').mockImplementation(() => {
      reads.push('getComputedStyle')
      return {} as CSSStyleDeclaration
    }),
  ])
    undo.push(() => one.mockRestore())
  Element.prototype.scrollTo = function (this: Element, to?: ScrollToOptions | number) {
    if (typeof to === 'object') scrolledTo.push(to.left ?? 0)
  }
  undo.push(() => Reflect.deleteProperty(Element.prototype, 'scrollTo'))
}
let shown: ReturnType<typeof mount> | undefined
afterEach(() => {
  if (shown) void unmount(shown)
  shown = undefined
  for (const one of undo.splice(0).reverse()) one()
})
test('switching tabs reads no layout, and still scrolls the tab it brings to the front into view', () => {
  workspace.tabs = []
  workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
  workspace.activeSpaceId = 's'
  for (let at = 0; at < 30; at++) workspace.openBlank(`Note ${at}`, '# note')
  const paneId = workspace.tabs[0]?.paneId ?? ''
  for (const tab of workspace.tabs) tab.paneId = paneId
  const ids = workspace.tabsIn(paneId).map((one) => one.id)
  workspace.activate(ids[0] ?? '')
  watchReads()
  const host = document.createElement('div')
  document.body.append(host)
  shown = mount(Tabs, { target: host, props: { paneId } })
  flushSync()
  reads.length = 0
  scrolledTo.length = 0
  workspace.activate(ids.at(-1) ?? '')
  flushSync()
  workspace.activate(ids[1] ?? '')
  flushSync()
  expect(reads).toEqual([])
  expect(scrolledTo).toHaveLength(2)
  expect(scrolledTo[0]).toBeGreaterThan(0)
  expect(scrolledTo[1]).toBeLessThan(scrolledTo[0] ?? 0)
  host.remove()
})
test("a tab's label says its direction once, not again on every switch", () => {
  workspace.tabs = []
  workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
  workspace.activeSpaceId = 's'
  for (let at = 0; at < 3; at++) workspace.openBlank(`Note ${at}`, '# note')
  const paneId = workspace.tabs[0]?.paneId ?? ''
  for (const tab of workspace.tabs) tab.paneId = paneId
  const ids = workspace.tabsIn(paneId).map((one) => one.id)
  const host = document.createElement('div')
  document.body.append(host)
  shown = mount(Tabs, { target: host, props: { paneId } })
  flushSync()
  const said: string[] = []
  spy(
    HTMLElement.prototype,
    'dir',
    () => 'auto',
    (value) => said.push(String(value)),
  )
  for (const id of [ids[1], ids[2], ids[0]]) {
    workspace.activate(id ?? '')
    flushSync()
  }
  expect(said).toEqual([])
  expect(host.querySelector('.label')?.getAttribute('dir')).toBe('auto')
  host.remove()
})
