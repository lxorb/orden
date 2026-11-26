import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../platform/src/api', () => ({ isDesktop: false, invoke: () => Promise.resolve(null) }))
const world = vi.hoisted(() => ({
  refuses: false,
  made: [] as { title: string; options: NotificationOptions; onclick: (() => void) | null }[],
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
vi.stubGlobal('Notification', Paged)
vi.stubGlobal('window', { focus: () => undefined })
const { show } = await import('../src/api')
const settled = () => new Promise((done) => setTimeout(done, 0))
beforeEach(() => {
  world.refuses = false
  world.made.length = 0
})
describe('notices in a browser', () => {
  it('are shown by the page where the page may show them', async () => {
    const opened = vi.fn()
    show({ title: 'Lucile', body: 'The figures are in', tag: 'c_1', opened })
    await settled()
    expect(world.made).toHaveLength(1)
    world.made[0]?.onclick?.()
    expect(opened).toHaveBeenCalledOnce()
  })
  it('are not shown where the page may not, as on Android, and are no error', async () => {
    world.refuses = true
    const opened = vi.fn()
    expect(() => show({ title: 'Lucile', body: 'The figures are in', tag: 'c_2', opened })).not.toThrow()
    await settled()
    expect(world.made).toHaveLength(0)
    expect(opened).not.toHaveBeenCalled()
  })
})
