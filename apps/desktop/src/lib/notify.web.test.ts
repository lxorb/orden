import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./platform/src/tauri', () => ({ isDesktop: false, invoke: () => Promise.resolve(null) }))

const world = vi.hoisted(() => ({
  refuses: false,
  made: [] as { title: string; options: NotificationOptions; onclick: (() => void) | null }[],
  byWorker: [] as { title: string; options: NotificationOptions & { data?: unknown } }[],
  heard: null as ((event: { data: unknown }) => void) | null,
}))

class Paged {
  static permission = 'granted'
  onclick: (() => void) | null = null
  constructor(title: string, options: NotificationOptions) {
    if (world.refuses) {
      throw new TypeError(
        "Failed to construct 'Notification': Illegal constructor. Use ServiceWorkerRegistration.showNotification() instead.",
      )
    }
    world.made.push({ title, options, onclick: null })
    const made = world.made.at(-1)
    queueMicrotask(() => {
      if (made) made.onclick = this.onclick
    })
  }
  close = vi.fn()
}

const registration = {
  showNotification: (title: string, options: NotificationOptions) => {
    world.byWorker.push({ title, options })
    return Promise.resolve()
  },
  getNotifications: () => Promise.resolve([]),
}

vi.stubGlobal('Notification', Paged)
vi.stubGlobal('window', { focus: () => undefined })
vi.stubGlobal('navigator', {
  serviceWorker: {
    ready: Promise.resolve(registration),
    getRegistration: () => Promise.resolve(registration),
    addEventListener: (_kind: string, heard: (event: { data: unknown }) => void) => {
      world.heard = heard
    },
    startMessages: () => undefined,
  },
})

const { show } = await import('./notify')

const settled = () => new Promise((done) => setTimeout(done, 0))

beforeEach(() => {
  world.refuses = false
  world.made.length = 0
  world.byWorker.length = 0
})

describe('notices in a browser', () => {
  it('are shown by the page where the page may show them', async () => {
    const opened = vi.fn()
    show({ title: 'Lucile', body: 'The figures are in', tag: 'c_1', opened })
    await settled()
    expect(world.made).toHaveLength(1)
    expect(world.byWorker).toHaveLength(0)
    world.made[0]?.onclick?.()
    expect(opened).toHaveBeenCalledOnce()
  })

  it('go through the service worker where the page may not, as on Android, and are no error', async () => {
    world.refuses = true
    const opened = vi.fn()
    expect(() =>
      show({ title: 'Lucile', body: 'The figures are in', tag: 'c_2', opened }),
    ).not.toThrow()
    await settled()
    expect(world.byWorker).toEqual([
      {
        title: 'Lucile',
        options: expect.objectContaining({
          body: 'The figures are in',
          tag: 'c_2',
          data: { ordenNotice: 'c_2' },
        }),
      },
    ])

    world.heard?.({ data: { ordenNotice: 'c_2' } })
    expect(opened).toHaveBeenCalledOnce()
    world.heard?.({ data: { ordenNotice: 'someone else' } })
    world.heard?.({ data: 'c_2' })
    expect(opened).toHaveBeenCalledOnce()
  })

  it('without a tag still get one, so a press finds its way back', async () => {
    world.refuses = true
    const opened = vi.fn()
    show({ title: 'Reminder', body: 'Call Ada', opened })
    await settled()
    const tag = (world.byWorker[0]?.options.data as { ordenNotice: string }).ordenNotice
    expect(tag).toMatch(/^[0-9a-f]{16}$/)
    world.heard?.({ data: { ordenNotice: tag } })
    expect(opened).toHaveBeenCalledOnce()
  })
})
