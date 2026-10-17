/** The web key on a computer, against a hub and a keychain that are stood in for: the
 *  first computer makes it without a word, a new one asks and shows the six digits, one
 *  that has it is asked and answers, and only the hub handing it over makes a computer
 *  one that holds it. See docs/sync-v2.md section 6.6. */

import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { FromDevice, FromHub } from '../sync2/hub-frames'
import { commitment, digits, newNonce } from '../pairing'
import { Approval, type ApprovalWorld, type Known } from './approval.svelte'

class FakeHub {
  leads = true
  sent: FromDevice[] = []
  private readonly listeners = new Map<string, Set<(frame: FromHub) => void>>()
  private readonly openers = new Set<() => void>()
  introduced: (() => Promise<{ pub?: string }>) | null = null

  on<T extends FromHub['t']>(type: T, listener: (frame: Extract<FromHub, { t: T }>) => void) {
    const all = this.listeners.get(type) ?? new Set()
    this.listeners.set(type, all)
    all.add(listener as (frame: FromHub) => void)
    return () => all.delete(listener as (frame: FromHub) => void)
  }

  opened(run: () => void) {
    this.openers.add(run)
    return () => this.openers.delete(run)
  }

  introduce(run: () => Promise<{ pub?: string }>) {
    this.introduced = run
  }

  send(frame: FromDevice): boolean {
    this.sent.push(frame)
    return true
  }

  say(frame: FromHub): void {
    for (const listener of this.listeners.get(frame.t) ?? []) listener(frame)
  }

  open(): void {
    for (const run of this.openers) run()
  }
}

let hub: FakeHub
let devices: Known[]
let accepted: { wrapped: string; generation: number }[]
let rotated: number
/** Whether the keychain holds a web key from before this run. */
let held: boolean

function world(): ApprovalWorld {
  return {
    hub,
    pub: () => Promise.resolve(MINE),
    wrap: (pub) => Promise.resolve({ wrapped: `wrapped-for-${pub}`, generation: 1 }),
    accept: (wrapped) => {
      accepted.push(wrapped)
      return Promise.resolve()
    },
    rotate: () => {
      rotated += 1
      return Promise.resolve(1)
    },
    holds: () => Promise.resolve(held || rotated > 0 || accepted.length > 0),
    devices: () => Promise.resolve(devices),
    settle: () => Promise.resolve(),
    heldWithin: () => heldWithin,
  }
}

/** This computer's key, and another's, as base64 the way a computer's key is. */
const MINE = 'bXktcHVibGljLWtleQ=='
const THEIRS = 'bmV3LWtleQ=='

/** When the hub's time to hold a request runs out, which a test lets happen. */
let heldWithin: Promise<void>
let runOut: () => void

/** The digits as the approval shows them: one run of six figures. */
const shown = async (...parts: [string, string, string, string]) =>
  (await digits('nib web key digits', ...parts)).replace(/\s/g, '')

async function settle(): Promise<void> {
  for (let turns = 0; turns < 10; turns += 1) await new Promise((done) => setTimeout(done, 0))
}

/** The last frame of a type this computer sent. */
function lastSent<T extends FromDevice['t']>(type: T): Extract<FromDevice, { t: T }> | undefined {
  return hub.sent.filter((one): one is Extract<FromDevice, { t: T }> => one.t === type).at(-1)
}

const ME: Known = { id: 'me-000001', name: 'Laptop', current: true, webKey: false, lastSeenAt: 1 }
const DESKTOP: Known = {
  id: 'desk-00001',
  name: 'Desktop',
  current: false,
  webKey: true,
  lastSeenAt: 5,
}

beforeEach(() => {
  hub = new FakeHub()
  devices = [ME]
  accepted = []
  rotated = 0
  held = false
  heldWithin = new Promise((done) => (runOut = done))
})

describe('the web key', () => {
  test('hello carries this computer’s public key', async () => {
    new Approval(world()).start()
    await expect(hub.introduced?.()).resolves.toEqual({ pub: MINE })
  })

  test('the first computer ever makes it, wraps it to itself, and holds it once the hub says so', async () => {
    const approval = new Approval(world())
    approval.start()
    hub.open()
    await settle()

    expect(rotated).toBe(1)
    expect(hub.sent).toEqual([
      { t: 'grant-key', to: ME.id, wrapped: `wrapped-for-${MINE}`, generation: 1 },
    ])
    expect(approval.keyed).toBe(false)

    hub.say({ t: 'key', wrapped: 'wrapped-for-me', generation: 1 })
    await settle()
    expect(approval.keyed).toBe(true)
    expect(accepted).toEqual([{ wrapped: 'wrapped-for-me', generation: 1 }])
  })

  test('a new computer asks committed, reveals once answered, and waits with the six digits', async () => {
    devices = [ME, DESKTOP]
    const approval = new Approval(world())
    approval.start()
    hub.open()
    await settle()

    expect(rotated).toBe(0)
    const asked = lastSent('want-key')
    expect(asked).toEqual({ t: 'want-key', commitment: expect.any(String) })
    // Committed to, and not said: no key goes out before an answer.
    expect(JSON.stringify(hub.sent)).not.toContain(MINE)
    expect(approval.waiting).toEqual({ device: 'Desktop', digits: '' })
    hub.say({ t: 'key-asked' })

    const answer = newNonce()
    hub.say({ t: 'key-answered', from: DESKTOP.id, nonce: answer, pub: THEIRS })
    await settle()
    const revealed = lastSent('reveal-key')
    expect(revealed?.pub).toBe(MINE)
    expect(await commitment(MINE, revealed?.nonce ?? '')).toBe(asked?.commitment)
    expect(approval.waiting).toEqual({
      device: 'Desktop',
      digits: await shown(MINE, revealed?.nonce ?? '', answer, THEIRS),
    })

    hub.say({ t: 'key', wrapped: 'from-desktop', generation: 1 })
    await settle()
    expect(approval.waiting).toBeNull()
    expect(approval.offered).toEqual({
      device: 'Desktop',
      wrapped: { wrapped: 'from-desktop', generation: 1 },
    })
    await approval.join()
    expect(approval.keyed).toBe(true)
    expect(accepted).toEqual([{ wrapped: 'from-desktop', generation: 1 }])
  })

  /** A key handed over is not one taken: until the person joins, this computer takes
   *  no key, so it takes no leases and puts none of its own logins under somebody's. */
  test('a computer handed the key for the first time takes nothing until it joins', async () => {
    devices = [ME, DESKTOP]
    const approval = new Approval(world())
    let told = 0
    approval.keyedNow(() => (told += 1))
    approval.start()
    hub.open()
    await settle()

    hub.say({ t: 'key', wrapped: 'from-desktop', generation: 1 })
    hub.say({ t: 'key', wrapped: 'from-desktop', generation: 1 })
    await settle()
    expect(accepted).toEqual([])
    expect(approval.keyed).toBe(false)
    expect(told).toBe(0)

    await approval.join()
    expect(approval.keyed).toBe(true)
    expect(told).toBe(1)
  })

  test('a computer that already holds the key takes it again without asking', async () => {
    devices = [ME, DESKTOP]
    held = true
    const approval = new Approval(world())
    approval.start()
    hub.say({ t: 'key', wrapped: 'again', generation: 2 })
    await settle()
    expect(approval.offered).toBeNull()
    expect(approval.keyed).toBe(true)
    expect(accepted).toEqual([{ wrapped: 'again', generation: 2 }])
  })

  test('a computer that was refused stops waiting', async () => {
    devices = [ME, DESKTOP]
    const approval = new Approval(world())
    approval.start()
    hub.open()
    await settle()

    hub.say({ t: 'key-denied' })
    expect(approval.waiting).toBeNull()
    expect(approval.keyed).toBe(false)
  })

  test('a computer that has it is asked, with the asking computer’s digits, and Allow wraps it there', async () => {
    // A computer that held the key before this run, as the hub hands it back.
    held = true
    const approval = new Approval(world())
    approval.start()
    hub.say({ t: 'key', wrapped: 'mine', generation: 1 })
    await settle()

    const theirs = newNonce()
    hub.say({
      t: 'key-wanted',
      device: 'new-000001',
      name: 'Desktop',
      commitment: await commitment(THEIRS, theirs),
    })
    await settle()
    // Answered, and asked nothing yet: there is no key to show digits for.
    const answer = lastSent('answer-key')
    expect(answer).toEqual({
      t: 'answer-key',
      to: 'new-000001',
      nonce: expect.any(String),
      pub: MINE,
    })
    expect(approval.asking).toEqual([])

    hub.say({ t: 'key-revealed', device: 'new-000001', pub: THEIRS, nonce: theirs })
    await settle()
    const [asking] = approval.asking
    expect(asking).toEqual({
      device: 'new-000001',
      name: 'Desktop',
      pub: THEIRS,
      digits: await shown(THEIRS, theirs, answer?.nonce ?? '', MINE),
    })

    if (asking) await approval.allow(asking)
    expect(hub.sent.at(-1)).toEqual({
      t: 'grant-key',
      to: 'new-000001',
      wrapped: `wrapped-for-${THEIRS}`,
      generation: 1,
    })
    expect(approval.asking).toEqual([])
  })

  test('Don’t allow says so, and another computer answering closes the question here', async () => {
    // A computer that held the key before this run, as the hub hands it back.
    held = true
    const approval = new Approval(world())
    approval.start()
    hub.say({ t: 'key', wrapped: 'mine', generation: 1 })
    await settle()

    for (const [device, name, pub] of [
      ['new-000001', 'Desktop', THEIRS],
      ['new-000002', 'Phone', 'b3RoZXI='],
    ] as const) {
      const nonce = newNonce()
      hub.say({ t: 'key-wanted', device, name, commitment: await commitment(pub, nonce) })
      await settle()
      hub.say({ t: 'key-revealed', device, pub, nonce })
      await settle()
    }

    const first = approval.asking[0]
    if (first) approval.deny(first)
    expect(hub.sent.at(-1)).toEqual({ t: 'deny-key', to: 'new-000001' })

    hub.say({ t: 'key-settled', device: 'new-000002' })
    expect(approval.asking).toEqual([])
  })

  test('a computer without the key is asked nothing', async () => {
    const approval = new Approval(world())
    approval.start()
    hub.say({ t: 'key-wanted', device: 'new-000001', name: 'Desktop', commitment: THEIRS })
    await settle()
    expect(approval.asking).toEqual([])
    expect(lastSent('answer-key')).toBeUndefined()
  })

  test('says once when it comes to hold the key', async () => {
    // A computer that held the key before this run, as the hub hands it back.
    held = true
    const approval = new Approval(world())
    const told = vi.fn()
    approval.keyedNow(told)
    approval.start()
    hub.say({ t: 'key', wrapped: 'mine', generation: 1 })
    hub.say({ t: 'key', wrapped: 'mine', generation: 1 })
    await settle()
    expect(told).toHaveBeenCalledTimes(1)
  })

  /** A key revealed that is not the one committed to is never put in front of anybody. */
  test('a key revealed other than the one committed to is shown to nobody', async () => {
    held = true
    const approval = new Approval(world())
    approval.start()
    hub.say({ t: 'key', wrapped: 'mine', generation: 1 })
    await settle()

    const nonce = newNonce()
    hub.say({
      t: 'key-wanted',
      device: 'new-000001',
      name: 'Desktop',
      commitment: await commitment(THEIRS, nonce),
    })
    await settle()
    hub.say({ t: 'key-revealed', device: 'new-000001', pub: 'b3RoZXI=', nonce })
    await settle()
    expect(approval.asking).toEqual([])
  })

  /** Somebody between the two computers puts a computer of its own in the asking one's
   *  place: it had to commit before the computer with the key answered, and the asking
   *  computer worked its digits out against an answer that somebody chose without
   *  knowing its nonce, so the two screens do not show the same digits. */
  test('a key put in between cannot be made to show the asking computer’s digits', async () => {
    held = true
    const holder = new Approval(world())
    holder.start()
    hub.say({ t: 'key', wrapped: 'mine', generation: 1 })
    await settle()

    // What the computer with the key is shown: the one in between, committed first.
    const between = 'aW4tYmV0d2Vlbg=='
    const betweenNonce = newNonce()
    hub.say({
      t: 'key-wanted',
      device: 'new-000001',
      name: 'Studio',
      commitment: await commitment(between, betweenNonce),
    })
    await settle()
    hub.say({ t: 'key-revealed', device: 'new-000001', pub: between, nonce: betweenNonce })
    await settle()
    const forBetween = holder.asking[0]?.digits

    // What the asking computer is shown: an answer made up between, never the holder's.
    hub = new FakeHub()
    devices = [ME, DESKTOP]
    held = false
    const asking = new Approval(world())
    asking.start()
    hub.open()
    await settle()
    hub.say({ t: 'key-answered', from: DESKTOP.id, nonce: newNonce(), pub: THEIRS })
    await settle()

    expect(forBetween).toMatch(/^\d{6}$/)
    expect(asking.waiting?.digits).toMatch(/^\d{6}$/)
    expect(asking.waiting?.digits).not.toBe(forBetween)
  })

  test('says it cannot be paired when the hub never holds the request', async () => {
    devices = [ME, DESKTOP]
    const approval = new Approval(world())
    approval.start()
    hub.open()
    await settle()
    expect(approval.unpairable).toBe(false)

    runOut()
    await settle()
    expect(approval.unpairable).toBe(true)
  })

  test('and does not when the hub holds it', async () => {
    devices = [ME, DESKTOP]
    const approval = new Approval(world())
    approval.start()
    hub.open()
    await settle()
    hub.say({ t: 'key-asked' })

    runOut()
    await settle()
    expect(approval.unpairable).toBe(false)
  })

  test('a computer from before pairing by commitment is shown as one to update', async () => {
    held = true
    const approval = new Approval(world())
    approval.start()
    hub.say({ t: 'key', wrapped: 'mine', generation: 1 })
    await settle()

    hub.say({ t: 'key-wanted-old', device: 'old-000001', name: 'Old laptop' })
    expect(approval.older).toEqual([{ device: 'old-000001', name: 'Old laptop' }])
    approval.dismissOlder('old-000001')
    expect(approval.older).toEqual([])
  })
})
