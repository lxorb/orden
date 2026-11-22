import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

const panel = vi.hoisted(() => ({
  turns: [] as unknown[],
  head: null,
  thread: null,
  heads: [] as unknown[],
  every: [] as unknown[],
  unread: new Set<string>(),
  states: new Map<string, string>(),
  pin: vi.fn(),
  archive: vi.fn(),
  openThread: vi.fn(),
  saw: vi.fn((_id: string) => Promise.resolve()),
  threadOf: (_id: string) => null,
  running: [] as string[],
  pending: {},
  steering: {},
  trouble: null,
  unfolded: false,
  resets: {},
  models: {},
  root: '/n/Work',
  provider: null,
}))
vi.mock('../../ai-chat/src/store/chat.svelte', () => ({ chat: panel }))
const sizing = vi.hoisted(() => [] as (() => void)[])
vi.stubGlobal(
  'ResizeObserver',
  class {
    constructor(heard: () => void) {
      sizing.push(heard)
    }
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  },
)
const Conversation = (await import('./Conversation.svelte')).default
const you = (id: string, text: string) => ({ id, role: 'you', at: 1, parts: [], draft: { text, attachments: [] } })
function drawn() {
  panel.turns = [you('u1', 'one'), you('u2', 'two')]
  ;(panel as { head: unknown }).head = { id: 'c1', parent: null, kept: true }
  const target = document.createElement('div')
  document.body.append(target)
  const shown = mount(Conversation, { target, props: { ready: true } })
  flushSync()
  const talk = target.querySelector<HTMLElement>('.talk')
  if (!talk) throw new Error('no talk')
  let tall = 300
  Object.defineProperty(talk, 'clientHeight', { configurable: true, get: () => tall })
  Object.defineProperty(talk, 'scrollHeight', { configurable: true, get: () => (tall ? 2000 : 0) })
  const resized = (height: number) => {
    tall = height
    for (const heard of sizing) heard()
  }
  return { talk, resized, close: () => void unmount(shown).then(() => target.remove()) }
}
afterEach(() => {
  sizing.length = 0
  ;(panel as { head: unknown }).head = null
  panel.turns = []
})
test('a chat that followed its end is at its end again when its side panel comes back (#2505)', () => {
  const { talk, resized, close } = drawn()
  resized(300)
  resized(0)
  talk.scrollTop = 300
  talk.dispatchEvent(new Event('scroll'))
  flushSync()
  resized(300)
  expect(talk.scrollTop).toBe(2000)
  close()
})
test('a chat scrolled up keeps its place when its side panel comes back (#2505)', () => {
  const { talk, resized, close } = drawn()
  resized(300)
  talk.scrollTop = 400
  talk.dispatchEvent(new Event('scroll'))
  flushSync()
  resized(0)
  resized(300)
  expect(talk.scrollTop).toBe(400)
  close()
})
