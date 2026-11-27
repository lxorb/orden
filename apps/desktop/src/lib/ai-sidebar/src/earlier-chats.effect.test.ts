import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const panel = vi.hoisted(() => ({
  text: '',
  chips: [] as unknown[],
  popover: null as string | null,
  host: 'side',
  head: null as Record<string, unknown> | null,
  heads: [] as unknown[],
  turns: [] as unknown[],
  unread: new Set<string>(),
  states: new Map<string, string>(),
  listQuery: '',
  listing: false,
  busy: false,
  canSteer: false,
  changing: false,
  thread: null,
  provider: { id: 'p', kind: 'compatible', model: 'm', name: 'Fake' },
  model: null,
  models: {},
  root: null,
  queue: [] as unknown[],
  focusAsked: 0,
  trouble: null,
  taken: vi.fn(),
  submit: vi.fn(),
  focus: vi.fn(),
  openThread: vi.fn(),
  newThread: vi.fn(),
  loadModels: vi.fn(() => Promise.resolve()),
}))
vi.mock('../../ai-chat/src/store/chat.svelte', () => ({ chat: panel }))
vi.mock('../../gates/src/api', async (actual) => ({
  ...(await actual<typeof import('../../gates/src/api')>()),
  opencodeOn: () => true,
}))
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  },
)
Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    finished: Promise.resolve(),
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
  }) as unknown as Animation
localStorage.setItem('orden:opencode-since', '1000')
const { openCodeSessions } = await import('../../ai-chat/src/opencode/sessions.svelte')
const Threads = (await import('./Threads.svelte')).default
const Composer = (await import('./Composer.svelte')).default
const listed = (id: string, updated: number) => ({
  id,
  title: id,
  updated,
  state: 'done',
  provider: 'p',
  model: 'm',
  words: id,
})
const head = (id: string) => ({ id, title: id, mode: 'approve', model: 'm', effort: 'auto', kept: true, usage: {} })
let close: (() => void) | undefined
beforeEach(() => {
  openCodeSessions.set('Herons', 'ses_1')
  panel.heads = [listed('Herons', 2000), listed('Kestrels', 500)]
})
afterEach(() => {
  close?.()
  close = undefined
})
function placed(): HTMLElement {
  const target = document.createElement('div')
  document.body.append(target)
  return target
}
function shownBy(target: HTMLElement, shown: ReturnType<typeof mount>): HTMLElement {
  flushSync()
  close = () => void unmount(shown).then(() => target.remove())
  return target
}
function threads(): HTMLElement {
  const target = placed()
  return shownBy(target, mount(Threads, { target, props: { rail: true } }))
}
function composer(): HTMLElement {
  const target = placed()
  return shownBy(target, mount(Composer, { target }))
}
describe('earlier chats with the OpenCode engine (#2470)', () => {
  test('wait under Earlier chats, apart from the chats OpenCode answers', () => {
    const target = threads()
    const titles = () => [...target.querySelectorAll('.row .title')].map((one) => one.textContent.trim())
    expect(titles()).toEqual(['Herons'])
    const row = [...target.querySelectorAll<HTMLButtonElement>('.shown-archived')].find((one) =>
      one.textContent.includes('Earlier chats'),
    )
    expect(row?.textContent).toContain('1')
    row?.click()
    flushSync()
    expect(titles()).toEqual(['Herons', 'Kestrels'])
  })
  test('open to be read, with a New chat in place of the message box', () => {
    panel.head = head('Kestrels')
    const target = composer()
    expect(target.querySelector('textarea')).toBeNull()
    expect(target.querySelector('.earlier')?.textContent).toContain('can be read, not continued')
    target.querySelector<HTMLButtonElement>('.earlier button')?.click()
    expect(panel.newThread).toHaveBeenCalled()
  })
  test('a chat OpenCode answers keeps its message box', () => {
    panel.head = head('Herons')
    const target = composer()
    expect(target.querySelector('textarea')).not.toBeNull()
    expect(target.querySelector('.earlier')).toBeNull()
  })
})
