/** A task quick add could not put anywhere stays in the field.
 *
 *  The field used to empty itself before the task was written, and the global window
 *  to put itself away before the app had answered, so a task the app refused - every
 *  space shared to be read, or a `>` naming a note in one - was gone without a word.
 *  Now the field empties only once the task is in, and the window waits for the app
 *  to say so. In the jsdom project because it mounts the field and presses real keys. */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Entry } from '../../src/lib/quick-add/entry'

const invoked: string[] = []
vi.mock('../../src/lib/tauri', async (original) => ({
  ...(await original<typeof import('../../src/lib/tauri')>()),
  invoke: vi.fn((command: string) => {
    invoked.push(command)
    return Promise.resolve(undefined)
  }),
}))

const { default: QuickAdd } = await import('../../src/lib/quick-add/QuickAdd.svelte')
const { default: Window } = await import('../../src/lib/quick-add/Window.svelte')
const { CHANNEL } = await import('../../src/lib/quick-add/channel')

let shown: ReturnType<typeof mount> | undefined

afterEach(() => {
  vi.useRealTimers()
  if (shown) void unmount(shown)
  shown = undefined
  document.body.replaceChildren()
  invoked.length = 0
})

const settled = async () => {
  for (let turn = 0; turn < 5; turn++) {
    flushSync()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/** The field quick add types into. */
function fieldOf(): HTMLInputElement {
  const field = document.querySelector<HTMLInputElement>('input.field')
  if (!field) throw new Error('no field')
  return field
}

/** Types the words into the field, as a reader would. */
function type(words: string): HTMLInputElement {
  const field = fieldOf()
  field.value = words
  field.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
  return field
}

const enter = () =>
  fieldOf().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

/** Types the words into the field and presses Enter; answers the field. */
async function typeAndAdd(words: string): Promise<HTMLInputElement> {
  const field = type(words)
  enter()
  await settled()
  return field
}

/** A caller that holds every task until `let go` answers it, as the global window
 *  does while the app writes; counts what it was handed. */
function slowCaller() {
  const handed: Entry[] = []
  let answer: ((ok: boolean) => void) | null = null
  return {
    handed,
    onsubmit: (entry: Entry) => {
      handed.push(entry)
      return new Promise<boolean>((resolve) => (answer = resolve))
    },
    letGo: (ok: boolean) => answer?.(ok),
  }
}

describe('the field', () => {
  test('keeps the words of a task that was refused', async () => {
    shown = mount(QuickAdd, {
      target: document.body,
      props: { langs: ['en'], smart: false, onsubmit: () => false, onclose: () => undefined },
    })
    flushSync()

    expect((await typeAndAdd('Call Ada')).value).toBe('Call Ada')
  })

  test('empties once the task is in', async () => {
    shown = mount(QuickAdd, {
      target: document.body,
      props: { langs: ['en'], smart: false, onsubmit: () => true, onclose: () => undefined },
    })
    flushSync()

    expect((await typeAndAdd('Call Ada')).value).toBe('')
  })
})

describe('the field, while a task is on its way', () => {
  test('hands it over once however often Enter is pressed', async () => {
    const caller = slowCaller()
    shown = mount(QuickAdd, {
      target: document.body,
      props: { langs: ['en'], smart: false, onsubmit: caller.onsubmit, onclose: () => undefined },
    })
    flushSync()

    type('Call Ada')
    enter()
    enter()
    await settled()
    caller.letGo(true)
    await settled()

    expect(caller.handed).toHaveLength(1)
  })

  test('keeps what was typed after it', async () => {
    const caller = slowCaller()
    shown = mount(QuickAdd, {
      target: document.body,
      props: { langs: ['en'], smart: false, onsubmit: caller.onsubmit, onclose: () => undefined },
    })
    flushSync()

    type('Call Ada')
    enter()
    await settled()
    type('Buy milk')
    caller.letGo(true)
    await settled()

    expect(fieldOf().value).toBe('Buy milk')
  })
})

describe('the global window', () => {
  /** The app's side of the channel: answers every task with `ok`. */
  function app(ok: boolean): BroadcastChannel {
    const channel = new BroadcastChannel(CHANNEL)
    channel.onmessage = (event: MessageEvent) => {
      const said = event.data as { kind: string; id?: number }
      if (said.kind === 'task') channel.postMessage({ kind: 'added', id: said.id, ok })
    }
    return channel
  }

  test('stays, with the words, where the app put the task nowhere', async () => {
    const other = app(false)
    shown = mount(Window, { target: document.body })
    await settled()

    const field = await typeAndAdd('Call Ada')
    await settled()
    other.close()

    expect(invoked).not.toContain('quick_add_hide')
    expect(field.value).toBe('Call Ada')
  })

  test('goes once the app has the task', async () => {
    const other = app(true)
    shown = mount(Window, { target: document.body })
    await settled()

    await typeAndAdd('Call Ada')
    await settled()
    other.close()

    expect(invoked).toContain('quick_add_hide')
  })

  test('stays, with the words, where no window of the app answers', async () => {
    vi.useFakeTimers()
    shown = mount(Window, { target: document.body })
    flushSync()

    type('Call Ada')
    enter()
    await vi.advanceTimersByTimeAsync(60_000)
    flushSync()

    expect(invoked).not.toContain('quick_add_hide')
    expect(fieldOf().value).toBe('Call Ada')

    // And Enter takes it again once the wait is over, rather than doing nothing.
    const sent: unknown[] = []
    const app = new BroadcastChannel(CHANNEL)
    app.onmessage = (event: MessageEvent) => sent.push(event.data)
    enter()
    await vi.advanceTimersByTimeAsync(100)
    app.close()
    expect(sent).toContainEqual(expect.objectContaining({ kind: 'task' }))
  })
})
