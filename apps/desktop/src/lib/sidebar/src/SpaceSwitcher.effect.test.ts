import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { registerSidebarPart } from '@orden/contracts'

const { workspace } = await import('../../workspace/src/api')
const { viewport } = await import('../../ui-kit/src/api')
const SpaceSwitcher = (await import('./SpaceSwitcher.svelte')).default
const { account } = await import('../../accounts/src/api')
const { CHATS_WORD, EXPERIMENTAL_WORD, hiddenKinds } = await import('../../gates/src/api')
hiddenKinds.hidden = [EXPERIMENTAL_WORD, CHATS_WORD]
account.token = 'session'
account.user = { id: 'u1', email: 'one@example.com', name: 'One', syncVersion: 2 }
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
test('the current space wears the unread chats of the other spaces, once the chats arrive', async () => {
  const into = drawn()
  expect(badge(into)).toBeNull()
  const counts: Record<string, number> = { '/a': 50, '/b': 3, '/c': 4 }
  gone.push(registerSidebarPart({ id: 'chats', unreadIn: (root) => counts[root] ?? 0, holdsIn: () => true }))
  await vi.waitFor(() => expect(badge(into)).toBe('7'))
})
test('and no badge when the others have nothing unread, 9+ past 9 on a desktop and 99+ past 99 on a phone', async () => {
  const into = drawn()
  const counts: Record<string, number> = { '/a': 9 }
  const drop = registerSidebarPart({ id: 'chats', unreadIn: (root) => counts[root] ?? 0, holdsIn: () => true })
  flushSync()
  expect(badge(into)).toBeNull()
  drop()
  counts['/b'] = 60
  counts['/c'] = 40
  gone.push(registerSidebarPart({ id: 'chats', unreadIn: (root) => counts[root] ?? 0, holdsIn: () => true }))
  await vi.waitFor(() => expect(badge(into)).toBe('9+'))
  viewport.device = 'phone'
  flushSync()
  expect(badge(into)).toBe('99+')
  viewport.device = 'desktop'
})
test('picking a space in the menu shows that space and shuts the menu', async () => {
  const into = drawn()
  const shown = vi.spyOn(workspace, 'showSpace').mockResolvedValue(undefined)
  gone.push(() => shown.mockRestore())
  into.querySelector<HTMLButtonElement>('button.name')?.click()
  await vi.waitFor(() => expect(into.querySelector('[data-spaces-open]')).not.toBeNull(), { timeout: 10_000 })
  flushSync()
  const row = [...into.querySelectorAll<HTMLButtonElement>('[data-spaces-open] .orden-row')].find((one) =>
    one.textContent.includes('Work'),
  )
  expect(row).toBeDefined()
  row?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
  row?.click()
  flushSync()
  expect(shown).toHaveBeenCalledWith('b')
  await vi.waitFor(() => expect(into.querySelector('button.name')?.getAttribute('aria-expanded')).toBe('false'))
})
