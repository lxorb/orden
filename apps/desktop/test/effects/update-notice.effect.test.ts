/** The update notice, both ways it is shown.
 *
 *  Emil, 2026-10-14: where a package manager keeps the install, the notice only says a
 *  newer version is out - no restart, a cross to put it away, and gone on its own after
 *  a while. Everywhere else it is the offer to restart into the download it was. */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../../src/lib/updater', () => ({ restartToUpdate: () => Promise.resolve() }))
vi.mock('../../src/lib/app-place', () => ({
  stuck: () => Promise.resolve(false),
  moveToApplications: () => Promise.resolve(),
}))

/** The card flies in through the Web Animations API, which jsdom has none of; nothing
 *  here asks how it moves, so every animation is over at once. */
Element.prototype.animate = () =>
  ({
    cancel: () => undefined,
    finished: Promise.resolve(),
    effect: { getComputedTiming: () => ({ delay: 0, duration: 0 }) },
    set onfinish(then: (() => void) | null) {
      queueMicrotask(() => then?.())
    },
  }) as unknown as Animation

const UpdateNotice = (await import('../../src/lib/UpdateNotice.svelte')).default

let target: HTMLElement
let app: ReturnType<typeof mount> | null = null
let dismissed = 0

function show(managed: boolean) {
  app = mount(UpdateNotice, {
    target,
    props: { version: '1.4.0', managed, ondismiss: () => dismissed++ },
  })
  flushSync()
}

const buttons = () => [...target.querySelectorAll('button')]
const words = () => target.querySelector('p')?.textContent

beforeEach(() => {
  vi.useFakeTimers()
  dismissed = 0
  target = document.createElement('div')
  document.body.append(target)
})

afterEach(() => {
  if (app) void unmount(app)
  app = null
  target.remove()
  vi.useRealTimers()
})

describe('where a package manager keeps the install', () => {
  test('says the version is out, with nothing to press but the cross', () => {
    show(true)

    expect(words()).toBe('Orden 1.4.0 is available.')
    expect(buttons().map((button) => button.getAttribute('aria-label'))).toEqual(['Dismiss'])
  })

  test('goes when the cross is pressed', () => {
    show(true)

    buttons()[0]?.click()

    expect(dismissed).toBe(1)
  })

  test('goes on its own after a few seconds', () => {
    show(true)

    vi.advanceTimersByTime(5999)
    expect(dismissed).toBe(0)

    vi.advanceTimersByTime(1)
    expect(dismissed).toBe(1)
  })

  test('stays while the pointer is on it', () => {
    show(true)
    const card = target.querySelector('.notice')

    card?.dispatchEvent(new PointerEvent('pointerenter'))
    flushSync()
    vi.advanceTimersByTime(20_000)
    expect(dismissed).toBe(0)

    card?.dispatchEvent(new PointerEvent('pointerleave'))
    flushSync()
    vi.advanceTimersByTime(6000)
    expect(dismissed).toBe(1)
  })
})

describe('where the app updates itself', () => {
  test('offers the restart, and waits for an answer', () => {
    show(false)

    expect(words()).toBe('Orden 1.4.0 is ready to install.')
    expect(buttons().map((button) => button.textContent)).toEqual(['Later', 'Restart now'])

    vi.advanceTimersByTime(60_000)
    expect(dismissed).toBe(0)
  })
})
