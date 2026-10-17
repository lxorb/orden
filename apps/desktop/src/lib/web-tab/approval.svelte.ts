/** The web key on this computer: whether it has one, making the first, asking for it
 *  and giving it to another computer (docs/sync-v2.md section 6.6).
 *
 *  A computer holds the key only once its hub has handed it the key wrapped to it: a key
 *  in the keychain the account no longer knows about names leases nobody else can see,
 *  which is two computers on one login without either knowing. So `keyed` is what the
 *  hub said, and nothing else.
 *
 *  Three roads to it. The first computer ever makes the key without a word, wraps it to
 *  itself and is done. A computer on an account where another one holds it asks, and
 *  shows a quiet line while it waits. Asking is the three steps of lib/pairing.ts: it
 *  commits to its key and a nonce, a computer that holds the key answers with a nonce of
 *  its own, and only then does it reveal its key - and both screens show the same six
 *  digits, the asking one under the bar and the answering one in a small bubble with
 *  Don't allow and Allow. Allow wraps the key to exactly the key the digits came from. A computer on an account whose computers are
 *  all gone makes a fresh key, which is the first road again: the old state is let go of
 *  on the account, and the person signs in to their sites once more. Until it has the
 *  key a computer takes no leases and uploads nothing: its pages run on its own state,
 *  like a new browser's.
 *
 *  And a computer handed the key for the first time takes it only once the person says
 *  so, here: the line under the bar says which computer offers it, with Join. Taking a
 *  key is putting this computer's own web logins under it, so a key somebody else made
 *  and offered must never be taken without a word. A computer that already holds the
 *  account's key - after a reconnect, or when the key moves on a generation - takes it as
 *  it always did.
 *
 *  Two things are said rather than waited out. A hub from before the commitment does not
 *  answer the request at all, so a computer whose request is not held in a few seconds
 *  says it cannot be paired yet. And a computer from before the commitment that asks is
 *  shown to the computers with the key as one to update, since its digits would mean
 *  nothing. */

import { account } from '../account.svelte'
import { request } from '../api'
import { isRecord } from '../stored'
import type { Hub } from '../sync2/hub.svelte'
import type { HubFrame } from '../sync2/hub-frames'
import { commitment, digits, newNonce } from '../pairing'

/** What web logins' six digits are for, beside the AI vault's; see pairing.ts. */
const DIGITS = 'nib web key digits'

/** The six digits as one run of figures, which is how the line and the bubble read them. */
const run = (said: string) => said.replace(/\s/g, '')

/** A computer asking for the key, as a computer that has it shows the question. */
export interface Asking {
  device: string
  name: string
  pub: string
  digits: string
}

/** The account's computers, as `GET /v2/devices` answers them: which is this one, and
 *  which hold the key. */
export interface Known {
  id: string
  name: string
  current: boolean
  webKey: boolean
  lastSeenAt: number | null
}

/** What the approval needs from around it. */
export interface ApprovalWorld {
  hub: Pick<Hub, 'on' | 'send' | 'opened' | 'introduce' | 'leads'>
  /** This computer's public key, made the first time. */
  pub(): Promise<string>
  /** The web key wrapped to another computer. */
  wrap(pub: string): Promise<{ wrapped: string; generation: number }>
  /** Takes the key the hub handed over. */
  accept(wrapped: { wrapped: string; generation: number }): Promise<void>
  /** Whether this computer already holds a web key of the account's, from before. */
  holds(): Promise<boolean>
  /** A new key, one generation on: answers the generation. */
  rotate(): Promise<number>
  devices(): Promise<Known[]>
  /** How long to give the hub to hand over a key it has, before asking for one. */
  settle(): Promise<void>
  /** How long to give the hub to say it holds a request, before saying it cannot pair. */
  heldWithin(): Promise<void>
}

function readKnown(value: unknown): Known[] {
  if (!isRecord(value) || !Array.isArray(value.devices)) return []
  return value.devices.flatMap((one: unknown) =>
    isRecord(one) && typeof one.id === 'string'
      ? [
          {
            id: one.id,
            name: typeof one.name === 'string' ? one.name : '',
            current: one.current === true,
            webKey: one.webKey === true,
            lastSeenAt: typeof one.lastSeenAt === 'number' ? one.lastSeenAt : null,
          },
        ]
      : [],
  )
}

export class Approval {
  /** Whether this computer holds the web key, as its hub said. */
  keyed = $state(false)
  /** The computer this one waits on, and the digits, while it waits. */
  waiting = $state<{ device: string; digits: string } | null>(null)
  /** Computers asking this one for the key. */
  asking = $state<Asking[]>([])
  /** Computers from before the commitment that asked, to be updated to pair. */
  older = $state<{ device: string; name: string }[]>([])
  /** Why this computer cannot be paired, when it cannot: its hub is from before the
   *  commitment and never held the request. */
  unpairable = $state(false)

  /** This computer's own asking: the nonce it committed to, and the answer it revealed
   *  against. */
  private mine: { nonce: string; commitment: string; answered: boolean } | null = null
  /** Whether the hub said it holds this computer's request. */
  private held = false
  /** What this computer answered, by the asking computer: the commitment it answered and
   *  its own nonce. */
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- what was answered; nothing renders from it
  private readonly answered = new Map<string, { commitment: string; nonce: string; name: string }>()
  /** The key handed to this computer for the first time, and which computer it waited
   *  on, until the person joins; see `join`. */
  offered = $state<{ device: string; wrapped: { wrapped: string; generation: number } } | null>(
    null,
  )

  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- who is listening; nothing renders from it
  private readonly heard = new Set<() => void>()
  /** Whether the road to the key is being walked, so a reconnect does not walk it
   *  twice. */
  private walking = false

  constructor(private readonly world: ApprovalWorld) {}

  /** Listens to the hub. Answers how to stop. */
  start(): () => void {
    const { hub } = this.world
    hub.introduce(async () => ({ pub: await this.world.pub() }))

    const stops = [
      hub.on('key', (frame) => void this.given(frame)),
      hub.on('key-denied', () => {
        this.waiting = null
      }),
      hub.on('key-wanted', (frame) => void this.wanted(frame)),
      hub.on('key-wanted-old', (frame) => {
        if (!this.keyed || this.older.some((one) => one.device === frame.device)) return
        this.older = [...this.older, { device: frame.device, name: frame.name }]
      }),
      hub.on('key-asked', () => {
        this.held = true
        this.unpairable = false
      }),
      hub.on('key-answered', (frame) => void this.answeredBy(frame)),
      hub.on('key-revealed', (frame) => void this.revealed(frame)),
      hub.on('key-settled', (frame) => {
        this.asking = this.asking.filter((one) => one.device !== frame.device)
        this.older = this.older.filter((one) => one.device !== frame.device)
        this.answered.delete(frame.device)
      }),
      hub.on('refused', (frame) => {
        // Two computers made the first key at once, and the other one's landed: this
        // one asks for it instead. A reveal the hub would not take asks again afresh.
        if (frame.to === 'grant-key' || frame.to === 'want-key') void this.walk()
        if (frame.to === 'reveal-key') void this.ask()
      }),
      hub.opened(() => void this.walk()),
    ]
    return () => {
      for (const stop of stops) stop()
    }
  }

  /** Runs whenever this computer comes to hold the key. */
  keyedNow(run: () => void): () => void {
    this.heard.add(run)
    return () => this.heard.delete(run)
  }

  /** Gives the key to a computer that asked. */
  async allow(one: Asking): Promise<void> {
    this.asking = this.asking.filter((other) => other.device !== one.device)
    const wrapped = await this.world.wrap(one.pub)
    this.world.hub.send({ t: 'grant-key', to: one.device, ...wrapped })
  }

  /** Tells a computer that asked that it may not have it. */
  deny(one: Asking): void {
    this.asking = this.asking.filter((other) => other.device !== one.device)
    this.world.hub.send({ t: 'deny-key', to: one.device })
  }

  /** Hides a question without answering it; it is asked again after a reconnect. */
  dismiss(one: Asking): void {
    this.asking = this.asking.filter((other) => other.device !== one.device)
  }

  /** Puts away the word about a computer from before the commitment. */
  dismissOlder(device: string): void {
    this.older = this.older.filter((one) => one.device !== device)
  }

  /** The person's yes to the key this computer is offered: it takes it, and from then on
   *  its web logins are the account's. */
  async join(): Promise<void> {
    const offered = this.offered
    if (!offered) return
    this.offered = null
    await this.take(offered.wrapped)
  }

  private async given(frame: HubFrame<'key'>): Promise<void> {
    const wrapped = { wrapped: frame.wrapped, generation: frame.generation }
    // Handed the key for the first time: offered, and taken only on Join.
    if (!this.keyed && !(await this.world.holds().catch(() => false))) {
      this.offered = { device: this.waiting?.device ?? this.offered?.device ?? '', wrapped }
      this.waiting = null
      return
    }
    await this.take(wrapped)
  }

  private async take(wrapped: { wrapped: string; generation: number }): Promise<void> {
    try {
      await this.world.accept(wrapped)
    } catch {
      // Wrapped to a key this computer no longer has: it asks again below.
      return
    }
    this.waiting = null
    if (this.keyed) return
    this.keyed = true
    for (const run of this.heard) run()
  }

  /** A computer asking: answered with a nonce of this one's own, and remembered with the
   *  commitment it answered, which the reveal has to open. */
  private async wanted(frame: HubFrame<'key-wanted'>): Promise<void> {
    if (!this.keyed) return
    this.asking = this.asking.filter((one) => one.device !== frame.device)
    const nonce = newNonce()
    this.answered.set(frame.device, { commitment: frame.commitment, nonce, name: frame.name })
    this.world.hub.send({ t: 'answer-key', to: frame.device, nonce, pub: await this.world.pub() })
  }

  /** The asking computer's key and nonce: shown with the digits only when they open the
   *  commitment this computer answered. A reveal this computer has no answer for - it
   *  reconnected since - is answered afresh, which has the asking computer ask again. */
  private async revealed(frame: HubFrame<'key-revealed'>): Promise<void> {
    if (!this.keyed) return
    const mine = this.answered.get(frame.device)
    if (!mine) {
      this.world.hub.send({
        t: 'answer-key',
        to: frame.device,
        nonce: newNonce(),
        pub: await this.world.pub(),
      })
      return
    }
    if ((await commitment(frame.pub, frame.nonce).catch(() => null)) !== mine.commitment) return
    const said = await digits(DIGITS, frame.pub, frame.nonce, mine.nonce, await this.world.pub())
    this.asking = [
      ...this.asking.filter((one) => one.device !== frame.device),
      { device: frame.device, name: mine.name, pub: frame.pub, digits: run(said) },
    ]
  }

  /** The answer to this computer's asking: the key and nonce it committed to revealed,
   *  and the digits shown. A second answer to an asking already revealed is the answering
   *  computer starting over, so this one asks again afresh. */
  private async answeredBy(frame: HubFrame<'key-answered'>): Promise<void> {
    if (this.keyed || !this.mine) return
    if (this.mine.answered) {
      await this.ask()
      return
    }
    const pub = await this.world.pub()
    this.mine.answered = true
    this.world.hub.send({ t: 'reveal-key', pub, nonce: this.mine.nonce })
    const said = await digits(DIGITS, pub, this.mine.nonce, frame.nonce, frame.pub)
    this.waiting = { device: this.waiting?.device ?? '', digits: run(said) }
  }

  /** Asks the hub for the key, committed to this computer's key and a nonce, and says so
   *  when the hub does not hold the request. On a reconnect it asks with the commitment
   *  it already made, which the hub takes for the same request; `fresh` starts over. */
  private async ask(fresh = true): Promise<void> {
    const pub = await this.world.pub()
    const kept = !fresh && this.mine && !this.mine.answered ? this.mine : null
    const nonce = kept?.nonce ?? newNonce()
    const said = kept?.commitment ?? (await commitment(pub, nonce))
    this.mine = { nonce, commitment: said, answered: false }
    this.held = false
    this.world.hub.send({ t: 'want-key', commitment: said })
    this.waiting = { device: this.waiting?.device ?? '', digits: '' }
    void this.world.heldWithin().then(() => {
      if (!this.held && !this.keyed && this.mine?.nonce === nonce) this.unpairable = true
    })
  }

  /** The road to the key, walked on every connect: nothing if the hub handed it over,
   *  the first key if nobody has one, and a request otherwise. */
  private async walk(): Promise<void> {
    // Once a device, not once a window: the window holding the socket walks it.
    if (this.walking || !this.world.hub.leads) return
    this.walking = true
    try {
      // The hub hands a key it has for this computer straight after `hello`.
      await this.world.settle()
      if (this.keyed) return

      const devices = await this.world.devices()
      const holders = devices.filter((one) => one.webKey && !one.current)
      if (!devices.some((one) => one.webKey)) {
        await this.make()
        return
      }
      if (devices.some((one) => one.webKey && one.current)) return

      const newest = holders.sort(
        (one, other) => (other.lastSeenAt ?? 0) - (one.lastSeenAt ?? 0),
      )[0]
      this.waiting = { device: newest?.name ?? '', digits: '' }
      await this.ask(false)
    } catch {
      // The account out of reach: the next connect walks it again.
    } finally {
      this.walking = false
    }
  }

  /** The first key on the account, wrapped to this computer: the hub hands it straight
   *  back as `key`, which is when this computer holds it. */
  private async make(): Promise<void> {
    const pub = await this.world.pub()
    await this.world.rotate()
    const wrapped = await this.world.wrap(pub)
    const device = (await this.world.devices()).find((one) => one.current)?.id
    if (device) this.world.hub.send({ t: 'grant-key', to: device, ...wrapped })
  }
}

/** The account's computers, from the account. */
export async function accountDevices(): Promise<Known[]> {
  const token = account.accountToken
  if (!token) return []
  return readKnown(await request<unknown>('/v2/devices', { token }))
}
