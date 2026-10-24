/** A task quick add could not put anywhere stays in the field.
 *
 *  The field used to empty itself before the task was written, and the global window
 *  to put itself away before the app had answered, so a task the app refused - every
 *  space shared to be read, or a `>` naming a note in one - was gone without a word.
 *  Now the field empties only once the task is in, and the window waits for the app
 *  to say so. In the jsdom project because it mounts the field and presses real keys. */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

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

/** Types the words into the field and presses Enter; answers the field. */
async function typeAndAdd(words: string): Promise<HTMLInputElement> {
  const field = document.querySelector<HTMLInputElement>('input.field')
  if (!field) throw new Error('no field')
  field.value = words
  field.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await settled()
  return field
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
})
