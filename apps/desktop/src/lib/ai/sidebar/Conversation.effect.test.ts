import { flushSync, mount, unmount } from 'svelte'
import { expect, test, vi } from 'vitest'

/** A message says by name what went with it, and two of one name are two (B505): two
 *  pasted screenshots both called image.png, or the note in front also @-mentioned.
 *  The message is kept with its thread, so a thread that has one draws it each time it
 *  opens, at launch too.
 *
 *  In the jsdom project because a conversation is drawn. */

const panel = vi.hoisted(() => ({
  turns: [] as unknown[],
  head: null,
  thread: null,
  heads: [] as unknown[],
  every: [] as unknown[],
  unread: new Set<string>(),
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

/** jsdom has no ResizeObserver, and the conversation watches its own height. */
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

/** Read (#1064) once the chat is in front of the reader with its end in view, and not
 *  while the window is elsewhere. */
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

test('the home’s rows say unread and running to a screen reader', () => {
  panel.turns = []
  panel.heads = [
    { id: 'a', title: 'Serie 6', updated: 1 },
    { id: 'b', title: 'Garden', updated: 1 },
  ]
  panel.unread = new Set(['a'])
  panel.running = ['b']
  const shown = draw()
  const names = [...shown.target.querySelectorAll('.recent button')].map((one) =>
    one.getAttribute('aria-label'),
  )
  expect(names).toEqual(['Serie 6, unread', 'Garden, running'])
  expect(shown.target.querySelectorAll('.recent .unread')).toHaveLength(1)
  void shown.close()
  panel.heads = []
  panel.unread = new Set()
  panel.running = []
})
