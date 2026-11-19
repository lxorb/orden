import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test } from 'vitest'
import { registerSidebarPart } from '@orden/contracts'

const { workspace } = await import('../../workspace/src/api')
const SpaceSwitcher = (await import('./SpaceSwitcher.svelte')).default
const gone: (() => void)[] = []
afterEach(() => {
  for (const one of gone.splice(0)) one()
})
function drawn(): HTMLElement {
  workspace.spaces = [
    { id: 'a', name: 'Home', root: '/a' },
    { id: 'b', name: 'Work', root: '/b' },
    { id: 'c', name: 'Club', root: '/c' },
  ]
  workspace.activeSpaceId = 'a'
  const into = document.createElement('div')
  document.body.append(into)
  const shown = mount(SpaceSwitcher, { target: into, props: {} })
  gone.push(() => {
    void unmount(shown)
    into.remove()
  })
  flushSync()
  return into
}
const badge = (into: HTMLElement) => into.querySelector('.count')?.textContent ?? null
test('the current space wears the unread chats of the other spaces, once the chats arrive', () => {
  const into = drawn()
  expect(badge(into)).toBeNull()
  const counts: Record<string, number> = { '/a': 50, '/b': 3, '/c': 4 }
  gone.push(registerSidebarPart({ id: 'chats', unreadIn: (root) => counts[root] ?? 0 }))
  flushSync()
  expect(badge(into)).toBe('7')
})
test('and no badge when the others have nothing unread, and 99+ past 99', () => {
  const into = drawn()
  const counts: Record<string, number> = { '/a': 9 }
  const drop = registerSidebarPart({ id: 'chats', unreadIn: (root) => counts[root] ?? 0 })
  flushSync()
  expect(badge(into)).toBeNull()
  drop()
  counts['/b'] = 60
  counts['/c'] = 40
  gone.push(registerSidebarPart({ id: 'chats', unreadIn: (root) => counts[root] ?? 0 }))
  flushSync()
  expect(badge(into)).toBe('99+')
})
