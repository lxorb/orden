import { describe, expect, test } from 'vitest'
import { Arrival, BOOT_PATIENCE, heldLine, PATIENCE, statusLine } from './arrival.svelte'
import { refusalWords } from './words'

function fakeClock() {
  let now = 0
  let due: { at: number; run: () => void }[] = []
  return {
    after(ms: number, run: () => void) {
      const one = { at: now + ms, run }
      due.push(one)
      return () => {
        due = due.filter((other) => other !== one)
      }
    },
    pass(ms: number) {
      now += ms
      const ready = due.filter((one) => one.at <= now)
      due = due.filter((one) => one.at > now)
      for (const one of ready) one.run()
    },
  }
}

function arriving() {
  const clock = fakeClock()
  const arrival = new Arrival(clock)
  arrival.begin()
  return { clock, arrival }
}

describe('an online terminal on its way to its screen', () => {
  test('says what it waits on: the socket, the machine starting, the screen put back', () => {
    const { arrival } = arriving()
    expect(statusLine(arrival.status)).toBe('Connecting…')

    arrival.linkedNow(true)
    arrival.machine('asleep', 'idle')
    expect(arrival.status).toEqual({ waiting: 'connecting' })

    arrival.machine('starting')
    expect(statusLine(arrival.status)).toBe('Starting machine…')

    arrival.machine('awake')
    expect(statusLine(arrival.status)).toBe('Restoring…')

    arrival.arrived()
    expect(arrival.failure).toBeNull()
  })

  test('a machine asleep again after starting is a boot that failed, with Try again', () => {
    const { arrival } = arriving()
    arrival.linkedNow(true)
    arrival.machine('asleep', 'restart')
    expect(arrival.failure).toBeNull()

    arrival.machine('starting')
    arrival.machine('asleep', 'restart')
    expect(arrival.status).toEqual({ failed: 'Your machine could not start' })

    arrival.begin()
    expect(arrival.status).toEqual({ waiting: 'connecting' })
  })

  test('a boot stopped by the month or the service says which', () => {
    const { arrival } = arriving()
    arrival.linkedNow(true)
    arrival.machine('starting')
    arrival.machine('asleep', 'allowance')
    expect(arrival.failure).toBe(refusalWords('allowance'))
  })

  test('a screen arriving after a failure ends it all the same', () => {
    const { arrival } = arriving()
    arrival.fail('Online terminals are paused for now')
    arrival.arrived()
    expect(arrival.failure).toBeNull()
  })

  test('gives up after a stretch of silence, and each word from the socket resets it', () => {
    const { clock, arrival } = arriving()
    clock.pass(PATIENCE - 1)
    arrival.linkedNow(true)
    clock.pass(PATIENCE - 1)
    arrival.machine('starting')
    clock.pass(BOOT_PATIENCE - 1)
    expect(arrival.failure).toBeNull()

    clock.pass(1)
    expect(arrival.status).toEqual({ failed: 'Could not reach your machine' })
  })

  test('a live terminal whose machine starts again waits for it once more', () => {
    const { clock, arrival } = arriving()
    arrival.linkedNow(true)
    arrival.arrived()
    clock.pass(PATIENCE * 2)

    arrival.lost()
    arrival.machine('starting')
    expect(arrival.status).toEqual({ waiting: 'starting' })
    arrival.machine('asleep', 'restart')
    expect(arrival.status).toEqual({ failed: 'Your machine could not start' })
  })

  test('never gives up on a terminal whose screen is here, until its socket drops', () => {
    const { clock, arrival } = arriving()
    arrival.linkedNow(true)
    arrival.arrived()
    arrival.heard()
    clock.pass(PATIENCE * 2)
    expect(arrival.failure).toBeNull()

    arrival.linkedNow(false)
    expect(arrival.status).toEqual({ waiting: 'connecting' })
    clock.pass(PATIENCE)
    expect(arrival.failure).toBe('Could not reach your machine')
  })

  test('stops waiting when the tab goes', () => {
    const { clock, arrival } = arriving()
    arrival.stop()
    clock.pass(PATIENCE)
    expect(arrival.failure).toBeNull()
  })
})

describe('the refusal lines', () => {
  test('each refusal a wait can end with has its own line', () => {
    const lines = (['list', 'allowance', 'budget', 'flag', 'gone', 'signed-out'] as const).map(
      (why) => refusalWords(why),
    )
    expect(lines).toEqual([
      'Online terminals are not open to your account yet',
      'This month’s online hours are used',
      'Online terminals are paused for now',
      'This machine is stopped',
      'This terminal is gone',
      'Sign in to use an online terminal',
    ])
    expect(refusalWords('off')).toBe(refusalWords('budget'))
  })

  test('a refusal with no words of its own still says something', () => {
    const { arrival } = arriving()
    arrival.fail('')
    expect(arrival.failure).toBe('Could not reach your machine')
  })
})

describe('a terminal whose session is gone', () => {
  test('ends the wait for good, with no Try again, and a new wait forgets it', () => {
    const { clock, arrival } = arriving()
    arrival.fail(refusalWords('gone') ?? '', true)
    expect(arrival.status).toEqual({ failed: 'This terminal is gone', gone: true })

    arrival.heard()
    clock.pass(BOOT_PATIENCE)
    expect(arrival.status).toEqual({ failed: 'This terminal is gone', gone: true })

    arrival.begin()
    expect(arrival.status).toEqual({ waiting: 'connecting' })
    arrival.fail('Could not reach your machine')
    expect(arrival.status).toEqual({ failed: 'Could not reach your machine' })
  })
})

describe('an online terminal another device holds (issue 1055)', () => {
  test('says who and since when, and is no wait that runs out', () => {
    const { clock, arrival } = arriving()
    arrival.linkedNow(true)
    const since = new Date(2026, 10, 3, 14, 5).getTime()
    arrival.held({ by: 'Emil’s phone', since, taken: false })
    expect(arrival.status).toEqual({
      held: heldLine({ by: 'Emil’s phone', since, taken: false }),
      taken: false,
    })
    expect(statusLine(arrival.status)).toMatch(/^Open on Emil’s phone since /)

    clock.pass(PATIENCE * 10)
    arrival.heard()
    expect(arrival.failure).toBeNull()
    expect('held' in arrival.status).toBe(true)
  })

  test('taken from this one says by whom; handed back, it waits for its screen', () => {
    const { arrival } = arriving()
    arrival.held({ by: 'Laptop', since: 1, taken: true })
    expect(statusLine(arrival.status)).toBe('Taken over by Laptop')

    arrival.unheld()
    expect(arrival.status).toEqual({ waiting: 'connecting' })
    arrival.arrived()
    expect(arrival.holder).toBeNull()
  })

  test('a device with no name is another device, and a drop forgets who held it', () => {
    const { arrival } = arriving()
    arrival.held({ by: '', since: 1, taken: true })
    expect(statusLine(arrival.status)).toBe('Taken over by another device')
    arrival.linkedNow(false)
    expect(arrival.status).toEqual({ waiting: 'connecting' })
  })

  test('says the day as well where it was taken before today', () => {
    const now = new Date(2026, 10, 3, 9).getTime()
    const today = heldLine({ by: 'Phone', since: now - 60_000, taken: false }, now)
    const before = heldLine({ by: 'Phone', since: now - 2 * 86_400_000, taken: false }, now)
    expect(before.length).toBeGreaterThan(today.length)
  })
})
