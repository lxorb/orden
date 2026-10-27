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
  heads: [],
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
