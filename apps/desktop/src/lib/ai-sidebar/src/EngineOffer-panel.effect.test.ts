import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => {
  const known = (): { bytes: number; usable: boolean } | null => ({ bytes: 79_000_000, usable: false })
  const status = known()
  return {
    engine: {
      status,
      get usable() {
        return world.engine.status?.usable === true
      },
      received: null,
      trouble: null,
      going: false,
      looked: 0,
      look() {
        world.engine.looked++
        return Promise.resolve()
      },
      download: () => Promise.resolve(),
      cancel: () => Promise.resolve(),
    },
    on: true,
  }
})
vi.mock('../../ai-chat/src/store/chat.svelte', () => ({
  chat: { head: null, host: 'side', listing: false, turns: [], busy: false, pending: {}, unread: new Set(), heads: [] },
}))
vi.mock('../../opencode-client/src/api', async (actual) => ({
  ...(await actual<typeof import('../../opencode-client/src/api')>()),
  engine: world.engine,
}))
vi.mock('../../gates/src/api', async (actual) => ({
  ...(await actual<typeof import('../../gates/src/api')>()),
  opencodeOn: () => world.on,
}))
vi.mock('./Conversation.svelte', () => ({ default: () => undefined }))
vi.mock('./Composer.svelte', () => ({ default: () => undefined }))
const ChatPanel = (await import('./ChatPanel.svelte')).default
let close: (() => void) | undefined
afterEach(() => {
  close?.()
  close = undefined
})
function panel(): HTMLElement {
  const target = document.createElement('div')
  document.body.append(target)
  const shown = mount(ChatPanel, { target, props: {} })
  flushSync()
  close = () => void unmount(shown).then(() => target.remove())
  return target
}
test('with the OpenCode engine on and OpenCode not downloaded, the AI panel offers the download in place of the chat (#2470)', () => {
  const target = panel()
  expect(target.querySelector('.offer .words')?.textContent).toContain('OpenCode (79 MB) must be downloaded')
  expect(target.querySelector('.offer .orden-button')?.textContent.trim()).toBe('Download')
})
test('once OpenCode is there, or with the old engine, the panel is the chat again (#2470)', () => {
  world.engine.status = { bytes: 79_000_000, usable: true }
  expect(panel().querySelector('.offer')).toBeNull()
  close?.()
  world.engine.status = { bytes: 79_000_000, usable: false }
  world.on = false
  expect(panel().querySelector('.offer')).toBeNull()
  world.on = true
})
test('the panel asks once for OpenCode’s status when it does not know it yet (#2470)', () => {
  world.engine.status = null
  world.engine.looked = 0
  panel()
  expect(world.engine.looked).toBe(1)
})
