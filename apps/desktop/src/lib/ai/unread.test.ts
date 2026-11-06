import { beforeEach, expect, test, vi } from 'vitest'

const heads = vi.hoisted(() => new Map<string, unknown[]>())

vi.mock('../tauri', () => ({
  isNative: true,
  isDesktop: true,
  invoke: (command: string, args: Record<string, unknown>) =>
    Promise.resolve(command === 'ai_threads_list' ? (heads.get(String(args.space)) ?? []) : null),
}))

const head = (id: string, more: object) => ({
  id,
  title: id,
  provider: 'p',
  model: 'm',
  updated: 1,
  words: '',
  ...more,
})

beforeEach(() => {
  heads.clear()
  vi.resetModules()
})

test('after a restart, a chat answered since it was seen puts the dot up, panel unopened', async () => {
  heads.set('work', [head('read', { answered: 1, seen: 2 })])
  heads.set('home', [
    head('parent', { answered: 1, seen: 2 }),
    head('helper', { parent: 'parent', answered: 3 }),
  ])
  const { chatsUnread, lookAtLaunch } = await import('./unread.svelte')
  await lookAtLaunch(['work', 'home'])
  expect(chatsUnread.any).toBe(true)
})

test('and nothing unread leaves it down', async () => {
  heads.set('work', [head('read', { answered: 1, seen: 2 }), head('quiet', {})])
  const { chatsUnread, lookAtLaunch } = await import('./unread.svelte')
  await lookAtLaunch(['work'])
  expect(chatsUnread.any).toBe(false)
})

test('once the panel keeps the dot, the launch’s look leaves it alone', async () => {
  heads.set('work', [head('new', { answered: 3 })])
  const { chatsUnread, lookAtLaunch, panelKeepsUnread } = await import('./unread.svelte')
  panelKeepsUnread()
  await lookAtLaunch(['work'])
  expect(chatsUnread.any).toBe(false)
})
