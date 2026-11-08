import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import type { Message } from '../../src/lib/slides/presenter'

const heard = vi.hoisted(() => ({ handler: null as ((message: Message) => void) | null }))
const fitted = vi.hoisted(() => ({ count: 0 }))

vi.mock('../../src/lib/slides/presenter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/slides/presenter')>()),
  presenterChannel: (handler: (message: Message) => void) => {
    heard.handler = handler
    return { send: () => undefined, close: () => undefined }
  },
}))

vi.mock('../../src/lib/slides/fit', () => ({
  fitSurface: () => {
    fitted.count += 1
    return 1
  },
}))

Object.defineProperty(document, 'fonts', {
  configurable: true,
  value: { ready: Promise.resolve() },
})

const Presenter = (await import('../../src/lib/slides/Presenter.svelte')).default

let app: ReturnType<typeof mount> | null = null

afterEach(() => {
  if (app) void unmount(app)
  app = null
  document.body.replaceChildren()
})

test('a picture that lands after its slide is shown fits the slide again', async () => {
  const target = document.createElement('div')
  document.body.append(target)
  app = mount(Presenter, { target })
  flushSync()

  heard.handler?.({
    kind: 'stage',
    show: 'deck',
    took: 1,
    stage: {
      slide: '<h1>Field notes</h1><p><img src="asset://localhost/kestrel.png" alt=""></p>',
      next: '<p>Next</p>',
      shape: 'picture',
      nextShape: 'prose',
      notes: '',
      at: 1,
      count: 2,
      started: Date.now(),
      scheme: 'light',
    },
  })
  flushSync()
  await document.fonts.ready
  await Promise.resolve()

  const picture = target.querySelector('img')
  expect(picture).not.toBeNull()
  const before = fitted.count
  picture?.dispatchEvent(new Event('load'))
  flushSync()

  expect(fitted.count).toBeGreaterThan(before)
})
