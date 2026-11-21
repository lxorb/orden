import { type Component, flushSync, mount, unmount } from 'svelte'
import { afterAll, expect, test, vi } from 'vitest'
import { registerSidebarPart } from '@orden/contracts'

vi.mock('../../collab/src/api', () => ({ rooms: { present: {}, following: null } }))
vi.mock('../../surfaces/src/api', () => ({
  askPanel: () => new Promise(() => undefined),
  chatsPanel: () => new Promise(() => undefined),
  linksPanel: () => new Promise(() => undefined),
  pagesNavigator: () => new Promise(() => undefined),
  searchPanel: () => new Promise(() => undefined),
  tasksPanel: () => new Promise(() => undefined),
  phoneTabsBar: () => new Promise(() => undefined),
  phoneYou: () => new Promise(() => undefined),
  showFeedback: () => undefined,
  spacesMenu: () => import('../../spaces/src/SpaceMenu.svelte'),
}))
const { workspace } = await import('../../workspace/src/api')
const { viewport } = await import('../../ui-kit/src/viewport.svelte')
const { account } = await import('../../accounts/src/api')
const { CHATS_WORD, EXPERIMENTAL_WORD, hiddenKinds } = await import('../../gates/src/api')
const { spaceMenu } = await import('../../spaces/src/api')
const Sidebar = (await import('./Sidebar.svelte')).default
const SpaceSwitcher = (await import('./SpaceSwitcher.svelte')).default
await (await import('../../../../test/sidebar-parts')).registerSidebarParts()
HTMLElement.prototype.scrollIntoView = () => undefined
const unread: Record<string, number> = {}
const holding = new Set(['/held'])
const part = () =>
  registerSidebarPart({ id: 'chats', unreadIn: (root) => unread[root] ?? 0, holdsIn: (root) => holding.has(root) })
let drop = part()
function told(root: string, count: number) {
  unread[root] = count
  drop()
  drop = part()
}
afterAll(() => {
  drop()
  hiddenKinds.hidden = []
})
viewport.device = 'desktop'
hiddenKinds.hidden = [EXPERIMENTAL_WORD, CHATS_WORD]
account.token = 'session'
account.user = { id: 'u1', email: 'one@example.com', name: 'One', syncVersion: 2 }
workspace.tabs = []
workspace.spaces = [
  { id: 'new', name: 'New', root: '/new' },
  { id: 'held', name: 'Held', root: '/held' },
]
function drawn<Props extends Record<string, unknown>>(component: Component<Props>, props: Props) {
  const into = document.createElement('div')
  document.body.append(into)
  const shown = mount(component, { target: into, props })
  return {
    into,
    gone: () => {
      void unmount(shown)
      into.remove()
    },
  }
}
const tab = (into: HTMLElement) => into.querySelector('[data-tab="chats"]')
test('a new space has no chats icon, so no icon strip, until chats are turned on for it', async () => {
  workspace.activeSpaceId = 'new'
  workspace.panel = 'tree'
  const { into, gone } = drawn(Sidebar, { side: 'left' as const })
  await vi.waitFor(() =>
    expect(spaceMenu(workspace.spaces[0]!).map((one) => one && 'label' in one && one.label)).toContain('Turn chats on'),
  )
  flushSync()
  expect(tab(into)).toBeNull()
  expect(into.querySelector('.panels')).toBeNull()
  spaceMenu(workspace.spaces[0]!)
    .find((one) => one && 'label' in one && one.label === 'Turn chats on')
    ?.run()
  await vi.waitFor(() => expect(tab(into)).not.toBeNull())
  expect(into.querySelector('.panels')).not.toBeNull()
  expect(into.querySelector('[data-tab="chats"] .unread')).toBeNull()
  told('/new', 2)
  await vi.waitFor(() => expect(into.querySelector('[data-tab="chats"] .unread')).not.toBeNull())
  spaceMenu(workspace.spaces[0]!)
    .find((one) => one && 'label' in one && one.label === 'Turn chats off')
    ?.run()
  await vi.waitFor(() => expect(tab(into)).toBeNull())
  gone()
})
test('a space that already holds a chat shows chats, and a space with chats off shows no unread in the switcher', async () => {
  workspace.activeSpaceId = 'held'
  const { into, gone } = drawn(Sidebar, { side: 'left' as const })
  await vi.waitFor(() => expect(tab(into)).not.toBeNull())
  gone()
  told('/new', 3)
  told('/held', 0)
  const switcher = drawn(SpaceSwitcher, {})
  flushSync()
  expect(switcher.into.querySelector('.count')).toBeNull()
  told('/held', 1)
  workspace.activeSpaceId = 'new'
  await vi.waitFor(() => expect(switcher.into.querySelector('.count')?.textContent).toBe('1'))
  switcher.gone()
})
