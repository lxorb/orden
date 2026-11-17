import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'

const world = vi.hoisted(() => {
  return {
    posted: [] as Record<string, unknown>[],
    channels: [] as { onmessage: ((event: MessageEvent) => void) | null }[],
  }
})

let visible: DocumentVisibilityState = 'visible'

vi.mock('../../platform/src/api', async (original) => ({
  ...(await original<typeof import('../../platform/src/api')>()),
  invoke: () => Promise.resolve(),
}))

class Channel {
  onmessage: ((event: MessageEvent) => void) | null = null
  constructor() {
    world.channels.push(this)
  }
  postMessage(said: Record<string, unknown>) {
    world.posted.push(said)
  }
  close() {
    this.onmessage = null
  }
}
vi.stubGlobal('BroadcastChannel', Channel)
Object.defineProperty(document, 'visibilityState', {
  configurable: true,
  get: () => visible,
})

const Window = (await import('./Window.svelte')).default

let target: HTMLDivElement
let drawn: ReturnType<typeof mount>

beforeEach(() => {
  world.posted.length = 0
  world.channels.length = 0
  visible = 'visible'
  target = document.createElement('div')
  document.body.append(target)
  drawn = mount(Window, { target })
  flushSync()
})

afterEach(() => {
  void unmount(drawn)
  target.remove()
})

const field = () => target.querySelector<HTMLInputElement>('input.field')!

const turn = (state: DocumentVisibilityState) => {
  visible = state
  document.dispatchEvent(new Event('visibilitychange'))
  flushSync()
}

const leave = () => {
  window.dispatchEvent(new Event('blur'))
  turn('hidden')
}

const press = (key: string) => {
  field().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  flushSync()
}

const type = (words: string) => {
  field().value = words
  field().dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}

const send = () => {
  press('Enter')
  const task = world.posted.filter((one) => one.kind === 'task').at(-1)
  expect(task).toBeDefined()
  return task!.id
}

const answer = async (id: unknown, ok: boolean) => {
  world.channels[0]!.onmessage?.(new MessageEvent('message', { data: { kind: 'added', id, ok } }))
  await new Promise((done) => setTimeout(done, 0))
  flushSync()
}

test('a task that fails while the window is away is still typed when it opens again', async () => {
  type('Buy milk')
  const early = send()
  leave()
  turn('visible')
  await answer(early, false)
  expect(field().value).toBe('Buy milk')

  const late = send()
  leave()
  await answer(late, false)
  turn('visible')
  expect(field().value).toBe('Buy milk')
})

test('a task that adds, or one the reader closes after it failed, leaves the window empty', async () => {
  type('Buy milk')
  const added = send()
  leave()
  await answer(added, true)
  turn('visible')
  expect(field().value).toBe('')

  type('Call Ana')
  const refused = send()
  await answer(refused, false)
  expect(field().value).toBe('Call Ana')
  press('Escape')
  leave()
  turn('visible')
  expect(field().value).toBe('')
})
