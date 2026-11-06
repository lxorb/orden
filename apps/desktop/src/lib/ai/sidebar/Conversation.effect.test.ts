import { flushSync, mount, unmount } from 'svelte'
import { expect, test, vi } from 'vitest'

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
vi.mock('./chat.svelte', () => ({ chat: panel }))

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  },
)

const Conversation = (await import('./Conversation.svelte')).default

function draw() {
  const target = document.createElement('div')
  document.body.append(target)
  const shown = mount(Conversation, { target, props: { ready: true } })
  flushSync()
  return { target, close: () => unmount(shown) }
}

test('two pasted screenshots both called image.png are drawn, both', () => {
  panel.turns = [
    {
      id: 'u1',
      role: 'you',
      at: 1,
      parts: [],
      draft: {
        text: 'compare these',
        attachments: [
          { label: 'image.png', image: { mime: 'image/png', data: 'AA' } },
          { label: 'image.png', image: { mime: 'image/png', data: 'BB' } },
        ],
      },
    },
  ]
  let drawn: { target: HTMLElement; close: () => void } | undefined
  expect(() => (drawn = draw())).not.toThrow()
  expect(drawn?.target.textContent).toContain('compare these')
  expect(drawn?.target.querySelectorAll('.went span')).toHaveLength(2)
  drawn?.close()
})

test('the note in front, also @-mentioned, is drawn', () => {
  panel.turns = [
    {
      id: 'u2',
      role: 'you',
      at: 1,
      parts: [],
      draft: {
        text: 'sum up',
        attachments: [
          { label: 'Plan.md', text: 'front' },
          { label: 'Plan.md', text: 'chip' },
        ],
      },
    },
  ]
  let drawn: { target: HTMLElement; close: () => void } | undefined
  expect(() => (drawn = draw())).not.toThrow()
  drawn?.close()
})

test('an unread chat open in the window in focus is read; with the window away, not', () => {
  panel.turns = []
  ;(panel as { head: unknown }).head = { id: 'c1', parent: null, kept: true }
  panel.unread = new Set(['c1'])
  const focus = vi.spyOn(document, 'hasFocus').mockReturnValue(false)
  const away = draw()
  expect(panel.saw).not.toHaveBeenCalled()
  focus.mockReturnValue(true)
  window.dispatchEvent(new Event('focus'))
  flushSync()
  expect(panel.saw).toHaveBeenCalledWith('c1')
  void away.close()
  focus.mockRestore()
  ;(panel as { head: unknown }).head = null
  panel.unread = new Set()
})

test('the home’s rows say unread and their state to a screen reader', () => {
  panel.turns = []
  panel.heads = [
    { id: 'a', title: 'Serie 6', updated: 1, state: 'done', provider: 'p', model: 'm' },
    { id: 'b', title: 'Garden', updated: 1, state: 'running', provider: 'p', model: 'm' },
  ]
  panel.unread = new Set(['a'])
  panel.running = ['b']
  const shown = draw()
  const names = [...shown.target.querySelectorAll('.recent .row')].map((one) =>
    one.getAttribute('aria-label'),
  )
  expect(names).toEqual(['Serie 6, unread, done', 'Garden, working'])
  expect(shown.target.querySelectorAll('.recent .unread')).toHaveLength(1)
  void shown.close()
  panel.heads = []
  panel.unread = new Set()
  panel.running = []
})

test('Show all shows the rest in place, and no archived chat', () => {
  panel.turns = []
  panel.heads = [
    ...['one', 'two', 'three', 'four', 'five'].map((title, at) => ({
      id: title,
      title,
      updated: 10 - at,
      state: 'done',
      provider: 'p',
      model: 'm',
    })),
    {
      id: 'gone',
      title: 'gone',
      updated: 99,
      state: 'done',
      archived: true,
      provider: 'p',
      model: 'm',
    },
  ]
  const shown = draw()
  const titles = () =>
    [...shown.target.querySelectorAll('.recent .title')].map((one) => one.textContent)
  expect(titles()).toEqual(['one', 'two', 'three'])
  const all = shown.target.querySelector<HTMLButtonElement>('.recent .all')
  expect(all?.textContent).toContain('5')
  all?.click()
  flushSync()
  expect(titles()).toEqual(['one', 'two', 'three', 'four', 'five'])
  expect(shown.target.querySelector('.recent .all')).toBeNull()
  void shown.close()
  panel.heads = []
})
