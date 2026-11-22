import { flushSync, mount, unmount } from 'svelte'
import { expect, test, vi } from 'vitest'

vi.mock('../../collab/src/api', () => ({ rooms: { present: {}, following: null } }))
vi.mock('../../surfaces/src/api', () => ({
  askPanel: () => new Promise(() => undefined),
  linksPanel: () => new Promise(() => undefined),
  pagesNavigator: () => new Promise(() => undefined),
  searchPanel: () => new Promise(() => undefined),
  tasksPanel: () => new Promise(() => undefined),
  phoneTabsBar: () => new Promise(() => undefined),
  phoneYou: () => new Promise(() => undefined),
  showFeedback: () => undefined,
  scratchpadCard: () => new Promise(() => undefined),
}))
const { workspace } = await import('../../workspace/src/api')
const { viewport } = await import('../../ui-kit/src/viewport.svelte')
const Sidebar = (await import('./Sidebar.svelte')).default
await (await import('../../../../test/sidebar-parts')).registerSidebarParts()
HTMLElement.prototype.scrollIntoView = () => undefined
const heads = (title: string) => `# ${title}\n\n## One\n\n## Two\n\n## Three\n`
test('a note switched to rewrites the direction of no outline row it shares with the last one', async () => {
  viewport.device = 'desktop'
  workspace.tabs = []
  workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
  workspace.activeSpaceId = 's'
  workspace.openBlank('A', heads('Kestrel'))
  workspace.rightPanel = 'outline'
  const into = document.createElement('div')
  document.body.append(into)
  const shown = mount(Sidebar, { target: into, props: { side: 'right' as const } })
  const labels = () => [...into.querySelectorAll('.orden-row-label')].map((one) => one.textContent)
  await vi.waitFor(() => expect(labels()).toEqual(['Kestrel', 'One', 'Two', 'Three']))
  const rewritten: (string | null)[] = []
  const watch = new MutationObserver((list) => rewritten.push(...list.map((one) => one.target.textContent)))
  watch.observe(into, { subtree: true, attributes: true, attributeFilter: ['dir'] })
  workspace.openBlank('B', heads('Merlin'))
  await vi.waitFor(() => expect(labels()).toEqual(['Merlin', 'One', 'Two', 'Three']))
  flushSync()
  await Promise.resolve()
  watch.disconnect()
  void unmount(shown)
  into.remove()
  workspace.rightPanel = null
  expect(rewritten.filter((one) => one !== 'Merlin')).toEqual([])
})
test('a heading written with a link, marks, code or escapes is named by its words', async () => {
  viewport.device = 'desktop'
  workspace.tabs = []
  workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
  workspace.activeSpaceId = 's'
  workspace.openBlank(
    'Gym',
    '# 3a. [Lateral Raise Machine](https://example.com/raise)\n\n## A **bold** `code` \\*star\\*\n',
  )
  workspace.rightPanel = 'outline'
  const into = document.createElement('div')
  document.body.append(into)
  const shown = mount(Sidebar, { target: into, props: { side: 'right' as const } })
  const labels = () => [...into.querySelectorAll('.heading .orden-row-label')].map((one) => one.textContent)
  await vi.waitFor(() => expect(labels()).toEqual(['3a. Lateral Raise Machine', 'A bold code *star*']), {
    timeout: 10_000,
  })
  void unmount(shown)
  into.remove()
  workspace.rightPanel = null
})
test('a space switched to moves a panel of the space, and never the scratchpad beside it', async () => {
  const { shown: pad } = await import('../../scratchpad/src/api')
  viewport.device = 'desktop'
  workspace.tabs = []
  workspace.spaces = [
    { id: 's', name: 'Space', root: '/space' },
    { id: 't', name: 'Two', root: '/two' },
  ]
  workspace.activeSpaceId = 's'
  workspace.panel = 'tree'
  pad.on = true
  const right = document.createElement('div')
  const left = document.createElement('div')
  document.body.append(right, left)
  const drawn = [
    mount(Sidebar, { target: right, props: { side: 'right' as const } }),
    mount(Sidebar, { target: left, props: { side: 'left' as const } }),
  ]
  flushSync()
  const moved = vi.spyOn(Element.prototype, 'animate')
  const body = right.querySelector('.stack > .body')
  workspace.activeSpaceId = 't'
  flushSync()
  const stacks = moved.mock.contexts
  expect(stacks).not.toContain(right.querySelector('.stack'))
  expect(stacks.filter((one) => one === left.querySelector('.stack'))).toHaveLength(1)
  expect(right.querySelector('.stack > .body')).toBe(body)
  moved.mockRestore()
  for (const one of drawn) void unmount(one)
  right.remove()
  left.remove()
  pad.on = false
  workspace.panel = null
})
test('a side keeps each view it opened, hidden, so switching back finds the same view where it was left (#2505)', async () => {
  viewport.device = 'desktop'
  workspace.tabs = []
  workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
  workspace.activeSpaceId = 's'
  workspace.openBlank('Kept', heads('Kestrel'))
  workspace.rightPanel = 'outline'
  const into = document.createElement('div')
  document.body.append(into)
  const shown = mount(Sidebar, { target: into, props: { side: 'right' as const } })
  const body = (panel: string) => into.querySelector<HTMLElement>(`.body[data-panel="${panel}"]`)
  await vi.waitFor(() => expect(body('outline')?.hidden).toBe(false))
  const outline = body('outline')
  if (!outline) throw new Error('no outline')
  outline.scrollTop = 120
  outline.dispatchEvent(new Event('scroll'))
  workspace.rightPanel = 'links'
  flushSync()
  await vi.waitFor(() => expect(body('links')?.hidden).toBe(false))
  expect(outline.isConnected).toBe(true)
  expect(outline.hidden).toBe(true)
  expect(outline.inert).toBe(true)
  outline.scrollTop = 0
  workspace.rightPanel = 'outline'
  flushSync()
  expect(body('outline')).toBe(outline)
  expect(outline.hidden).toBe(false)
  expect(outline.scrollTop).toBe(120)
  expect(body('links')?.hidden).toBe(true)
  void unmount(shown)
  into.remove()
  workspace.rightPanel = null
})
