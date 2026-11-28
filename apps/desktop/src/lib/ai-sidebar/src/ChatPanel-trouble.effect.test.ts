import { flushSync, mount, unmount } from 'svelte'
import { expect, test, vi } from 'vitest'

const world = vi.hoisted(() => ({ broken: true }))
vi.mock('../../ai-chat/src/store/chat.svelte', () => ({
  chat: { head: null, host: 'side', listing: false, turns: [], busy: false, pending: {}, unread: new Set(), heads: [] },
}))
vi.mock('./Conversation.svelte', () => ({
  default: () => {
    if (world.broken) throw new Error('a part of the panel broke')
  },
}))
vi.mock('./Composer.svelte', () => ({ default: () => undefined }))
const ChatPanel = (await import('./ChatPanel.svelte')).default
test('an AI panel that breaks while drawing says so with the face and offers to try again, instead of going blank (#2591)', () => {
  const target = document.createElement('div')
  document.body.append(target)
  const shown = mount(ChatPanel, { target, props: {} })
  flushSync()
  expect(target.querySelector('.trouble p')?.textContent.trim()).toBe('The AI panel could not open.')
  expect(target.querySelector('.trouble .mascot')).not.toBeNull()
  world.broken = false
  target.querySelector<HTMLButtonElement>('.trouble button')?.click()
  flushSync()
  expect(target.querySelector('.trouble')).toBeNull()
  void unmount(shown)
  target.remove()
})
test('the AI panel that cannot load at all opens as the same face and line (#2591)', async () => {
  vi.doMock('./ChatPanel.svelte', () => Promise.reject(new Error('the panel did not load')))
  vi.resetModules()
  const { loadChatPanel } = await import('./api')
  const svelte = await import('svelte')
  const loaded = await loadChatPanel()
  const target = document.createElement('div')
  document.body.append(target)
  const shown = svelte.mount(loaded.default as never, { target, props: {} })
  svelte.flushSync()
  expect(target.querySelector('.trouble p')?.textContent.trim()).toBe('The AI panel could not open.')
  void svelte.unmount(shown)
  target.remove()
  vi.doUnmock('./ChatPanel.svelte')
})
