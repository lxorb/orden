import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

vi.mock('../../src/lib/Pane.svelte', () => ({ default: () => undefined }))

HTMLElement.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 800)

const { workspace } = await import('../../src/lib/workspace.svelte')
const PaneTree = (await import('../../src/lib/PaneTree.svelte')).default

let shown: ReturnType<typeof mount> | null = null

afterEach(() => {
  if (shown) void unmount(shown)
  shown = null
  workspace.panes.collapse()
  document.body.replaceChildren()
})

test('the divider is a separator the arrows, Home, End and Enter move', () => {
  workspace.panes.split('row')
  const target = document.createElement('div')
  document.body.append(target)
  shown = mount(PaneTree, { target, props: { frame: workspace.panes.frame } })
  flushSync()

  const divider = target.querySelector<HTMLElement>('[role="separator"]')
  expect(divider?.tabIndex).toBe(0)
  expect(divider?.getAttribute('aria-orientation')).toBe('vertical')
  expect(divider?.getAttribute('aria-valuenow')).toBe('50')
  expect(divider?.getAttribute('aria-label')).toBe('Pane size')
  expect(divider?.getAttribute('aria-valuemin')).toBe('0')
  expect(divider?.getAttribute('aria-valuemax')).toBe('100')

  const press = (key: string) => {
    divider?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    flushSync()
    return divider?.getAttribute('aria-valuenow')
  }

  expect(press('ArrowRight')).toBe('55')
  expect(press('ArrowLeft')).toBe('50')
  expect(press('End')).toBe('78')
  expect(press('Home')).toBe('22')
  expect(press('Enter')).toBe('50')
})
