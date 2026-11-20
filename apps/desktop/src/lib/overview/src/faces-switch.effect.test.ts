import 'fake-indexeddb/auto'
import { flushSync } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

const { workspace } = await import('../../workspace/src/api')
const { faces } = await import('./faces.svelte')
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})
test('a tab switched away from is copied without reading layout, and sized once the switch is over', () => {
  vi.useFakeTimers()
  workspace.panes.collapse()
  workspace.tabs = []
  workspace.openGraph()
  flushSync()
  const graph = workspace.tabs.at(-1)
  const paneId = workspace.panes.all[0]?.id ?? ''
  const pane = document.createElement('div')
  pane.dataset.pane = paneId
  pane.innerHTML = '<div class="head"></div><div class="list"><p>the graph as it stood</p></div>'
  document.body.append(pane)
  const list = pane.querySelector<HTMLElement>('.list')
  if (!list || !graph) throw new Error('no pane')
  Object.defineProperty(list, 'scrollTop', { configurable: true, value: 120 })
  list.dispatchEvent(new Event('scroll'))
  const reads: string[] = []
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    reads.push('box')
    if (this === pane) return new DOMRect(0, 0, 800, 600)
    if (this.classList.contains('head')) return new DOMRect(0, 0, 800, 40)
    return new DOMRect()
  })
  Object.defineProperty(list, 'scrollTop', {
    configurable: true,
    get: () => {
      reads.push('scroll')
      return 120
    },
  })
  workspace.openBlank('Next')
  flushSync()
  expect(reads).toEqual([])
  pane.innerHTML = '<div class="head"></div><p>the next tab</p>'
  vi.advanceTimersByTime(1000)
  const face = faces.of(graph.id)
  expect(face?.html).toContain('the graph as it stood')
  expect(face?.html).toContain('data-overview-scrolled="120 0"')
  expect([face?.w, face?.h]).toEqual([800, 560])
  pane.remove()
})
