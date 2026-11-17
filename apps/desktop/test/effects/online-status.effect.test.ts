import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'
import { Arrival } from '../../src/lib/terminal/src/online/arrival.svelte'

const OnlineStatus = (await import('../../src/lib/terminal/src/online/OnlineStatus.svelte')).default

let app: ReturnType<typeof mount> | null = null
let target: HTMLElement

afterEach(() => {
  if (app) void unmount(app)
  app = null
  target.remove()
})

function shown(arrival: Arrival, onretry: () => void = () => undefined) {
  target = document.body.appendChild(document.createElement('div'))
  app = mount(OnlineStatus, {
    target,
    props: {
      get status() {
        return arrival.status
      },
      onretry,
    },
  })
  flushSync()
}

const line = () => target.querySelector('p')?.textContent
const button = () => target.querySelector('button')

test('follows the wait: connecting, the machine starting, the screen put back', () => {
  const arrival = new Arrival({ after: () => () => undefined })
  arrival.begin()
  shown(arrival)
  expect(line()).toBe('Connecting…')
  expect(button()).toBeNull()

  arrival.linkedNow(true)
  arrival.machine('starting')
  flushSync()
  expect(line()).toBe('Starting machine…')

  arrival.machine('awake')
  flushSync()
  expect(line()).toBe('Restoring…')
})

test('a boot that failed says so, and Try again starts a new wait', () => {
  const arrival = new Arrival({ after: () => () => undefined })
  arrival.begin()
  const retry = vi.fn(() => {
    arrival.begin()
  })
  shown(arrival, retry)

  arrival.linkedNow(true)
  arrival.machine('starting')
  arrival.machine('asleep', 'restart')
  flushSync()
  expect(line()).toBe('Your machine could not start')
  expect(button()?.textContent).toBe('Try again')

  button()?.click()
  flushSync()
  expect(retry).toHaveBeenCalledOnce()
  expect(line()).toBe('Connecting…')
  expect(button()).toBeNull()
})

test('a refusal is its own line', () => {
  const arrival = new Arrival({ after: () => () => undefined })
  arrival.begin()
  shown(arrival)
  arrival.fail('This month’s online hours are used')
  flushSync()
  expect(line()).toBe('This month’s online hours are used')
  expect(button()).not.toBeNull()
})

test('silence for too long is a failure too', () => {
  let giveUp: (() => void) | null = null
  const arrival = new Arrival({
    after: (_ms, run) => {
      giveUp = run
      return () => {
        giveUp = null
      }
    },
  })
  arrival.begin()
  shown(arrival)
  ;(giveUp as (() => void) | null)?.()
  flushSync()
  expect(line()).toBe('Could not reach your machine')
})

test('a session that is gone offers a new online terminal', () => {
  const arrival = new Arrival({ after: () => () => undefined })
  arrival.begin()
  const renew = vi.fn()
  shown(arrival, renew)
  arrival.fail('This terminal is gone', true)
  flushSync()
  expect(line()).toBe('This terminal is gone')
  expect(button()?.textContent).toBe('New online terminal')

  button()?.click()
  expect(renew).toHaveBeenCalledOnce()
})
