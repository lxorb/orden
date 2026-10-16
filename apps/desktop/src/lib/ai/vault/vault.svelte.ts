/** The AI accounts on every device of the reader's nib account (docs/ai.md, "Every
 *  device"): connected once, there on each device they sign in to.
 *
 *  Four standings. **Open**: this device holds the vault key, so it reads the sealed
 *  vault, meets it with its own accounts (merge.ts), and writes back what changed; it
 *  also shows any device asking for the key, with that device's six digits, and one
 *  press wraps the key to it. **Waiting**: another device has the key and this one has
 *  asked, showing its own six digits. **Stranded**: the account has a vault but no
 *  device that could allow this one, so the way on is to start over: the old vault is
 *  let go of and this device's accounts become the vault. **Off**: nobody signed in.
 *  The first device of an account makes the key without a word.
 *
 *  It reads again whenever its hub says another device changed something, when this
 *  device changes something, and now and then besides. The roads out - the account's
 *  routes, the secret store, the AI store - are handed in (`VaultWorld`), so the rules
 *  are tested with two devices in memory. */

import {
  type DeviceKey,
  deviceKeyIn,
  digits,
  fingerprint,
  newDeviceKey,
  newVaultKey,
  open,
  seal,
  unwrap,
  wrap,
} from './crypto'
import { agrees, type Base, baseOf, type Contents, contentsIn, merged, type Side } from './merge'

/** Where this device's key pair is kept in its secret store. */
const DEVICE_SECRET = 'ai-vault-device'

/** How many times a write is made again over a newer vault before it waits for the next
 *  read. */
const TRIES = 3

export type Standing = 'off' | 'opening' | 'open' | 'waiting' | 'stranded'

/** A device asking for the key, as an open device shows it. */
export interface Asking {
  id: string
  name: string
  digits: string
}

interface Read {
  rev: number
  blob: string | null
  wrapped: string | null
  devices: { id: string; name: string; pub: string; approved: boolean }[]
}

export interface VaultWorld {
  /** Whether somebody is signed in to an account, and which. */
  account(): string | null
  call<T>(path: string, method?: string, body?: unknown): Promise<T>
  readSecret(name: string): Promise<string | null>
  writeSecret(name: string, secret: string): Promise<void>
  deviceName(): string
  /** This device's accounts, keys and sign-ins as they are now. */
  local(): Promise<Contents>
  /** Puts contents in place here, without that counting as a change of this device's. */
  apply(contents: Contents, before: Contents): Promise<void>
  loadBase(account: string): Base | null
  keepBase(account: string, base: Base | null): void
}

/** A stale write's refusal, as the request says it. */
function isStale(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 409
  )
}

async function printsOf(keys: Record<string, string>): Promise<Record<string, string>> {
  const entries = await Promise.all(
    Object.entries(keys).map(async ([id, key]) => [id, await fingerprint(key)] as const),
  )
  return Object.fromEntries(entries)
}

async function sideOf(contents: Contents): Promise<Side> {
  return { contents, prints: await printsOf(contents.keys) }
}

export class Vault {
  standing = $state<Standing>('off')
  /** This device's six digits, while it waits. */
  digits = $state('')
  /** Devices asking for the key, while this one is open. */
  asking = $state.raw<Asking[]>([])
  /** Who each account was signed in as, on whichever device saw it. */
  seen = $state.raw<Record<string, string>>({})

  private device: DeviceKey | null = null
  private registered = ''
  private key: Uint8Array<ArrayBuffer> | null = null
  private running: Promise<void> | null = null
  private again = false

  constructor(private readonly world: VaultWorld) {}

  /** Reads the vault and meets it, once at a time: asked while running, it runs once
   *  more after. */
  refresh(): Promise<void> {
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = (async () => {
      do {
        this.again = false
        await this.once().catch(() => undefined)
      } while (this.asked())
    })().finally(() => {
      this.running = null
    })
    return this.running
  }

  /** Whether another read was asked for while one ran. */
  private asked(): boolean {
    return this.again
  }

  private async mine(): Promise<DeviceKey> {
    if (this.device) return this.device
    const kept = deviceKeyIn(JSON.parse((await this.world.readSecret(DEVICE_SECRET)) ?? 'null'))
    if (kept) return (this.device = kept)
    const made = await newDeviceKey()
    await this.world.writeSecret(DEVICE_SECRET, JSON.stringify(made))
    return (this.device = made)
  }

  private read(device: DeviceKey): Promise<Read> {
    return this.world.call<Read>(`/v2/ai?device=${device.id}`)
  }

  private async once(): Promise<void> {
    const account = this.world.account()
    if (!account) {
      this.standing = 'off'
      this.key = null
      this.asking = []
      return
    }
    if (this.standing === 'off') this.standing = 'opening'
    const device = await this.mine()
    if (this.registered !== account) {
      await this.world.call('/v2/ai/devices', 'POST', {
        id: device.id,
        name: this.world.deviceName(),
        pub: device.pub,
      })
      this.registered = account
    }

    for (let tries = 0; tries < TRIES; tries++) {
      const read = await this.read(device)
      this.key = read.wrapped ? await unwrap(read.wrapped, device).catch(() => null) : null
      const others = read.devices.filter((one) => one.id !== device.id)

      if (!this.key) {
        const allowers = others.filter((one) => one.approved)
        if (read.blob || allowers.length) {
          this.asking = []
          this.digits = await digits(device.pub)
          this.standing = allowers.length ? 'waiting' : 'stranded'
          return
        }
        // The first device of the account: the key is made here, wrapped to itself.
        const key = newVaultKey()
        await this.world.call(`/v2/ai/devices/${device.id}/wrap`, 'PUT', {
          wrapped: await wrap(key, device.pub),
          from: device.id,
        })
        this.key = key
      }

      this.standing = 'open'
      this.digits = ''
      this.asking = await Promise.all(
        others
          .filter((one) => !one.approved)
          .map(async (one) => ({ id: one.id, name: one.name, digits: await digits(one.pub) })),
      )
      if (await this.met(account, device, read)) return
    }
  }

  /** The vault met with this device's accounts, and written back where they differ.
   *  Answers false where another device wrote first, to read again. */
  private async met(account: string, device: DeviceKey, read: Read): Promise<boolean> {
    const key = this.key
    if (!key) return true
    const local = await this.world.local()
    const here = await sideOf({ ...local, seen: { ...this.seen, ...local.seen } })
    let remote: Side | null = null
    if (read.blob) {
      const opened = await open(key, read.blob).catch(() => null)
      if (opened === null) {
        // Sealed under a key this device was never given (two devices made one at
        // the same moment): this one lets its own go and asks to be allowed.
        await this.world.call(`/v2/ai/devices/${device.id}`, 'DELETE').catch(() => undefined)
        this.registered = ''
        this.key = null
        this.again = true
        return true
      }
      remote = await sideOf(contentsIn(JSON.parse(opened)))
    }

    const base = this.world.loadBase(account)
    const contents = remote ? merged(base, here, remote) : here.contents
    const prints = await printsOf(contents.keys)
    this.seen = contents.seen
    if (!agrees(baseOf(here.contents, here.prints), contents, prints)) {
      await this.world.apply(contents, local)
    }
    if (remote && agrees(baseOf(remote.contents, remote.prints), contents, prints)) {
      this.world.keepBase(account, baseOf(contents, prints))
      return true
    }

    try {
      await this.world.call('/v2/ai/vault', 'PUT', {
        rev: read.rev,
        blob: await seal(key, JSON.stringify(contents)),
        from: device.id,
      })
    } catch (error) {
      if (isStale(error)) return false
      throw error
    }
    this.world.keepBase(account, baseOf(contents, prints))
    return true
  }

  /** Gives the key to a device that asked for it. */
  async allow(id: string): Promise<void> {
    const key = this.key
    const device = this.device
    if (!key || !device) return
    const read = await this.read(device)
    const asking = read.devices.find((one) => one.id === id && !one.approved)
    if (!asking) return
    await this.world.call(`/v2/ai/devices/${id}/wrap`, 'PUT', {
      wrapped: await wrap(key, asking.pub),
      from: device.id,
    })
    this.asking = this.asking.filter((one) => one.id !== id)
  }

  /** Puts a device's asking away unanswered; it comes back with the next read. */
  dismiss(id: string): void {
    this.asking = this.asking.filter((one) => one.id !== id)
  }

  /** Turns a device's asking down. */
  async deny(id: string): Promise<void> {
    await this.world.call(`/v2/ai/devices/${id}`, 'DELETE').catch(() => undefined)
    this.asking = this.asking.filter((one) => one.id !== id)
  }

  /** Lets go of the account's vault, for a device none of the others can allow: this
   *  device's accounts become the vault, and the other devices are allowed again from
   *  here. */
  async startOver(): Promise<void> {
    const account = this.world.account()
    if (!account) return
    await this.world.call('/v2/ai/vault', 'DELETE')
    this.world.keepBase(account, null)
    await this.refresh()
  }

  /** Signed out: nothing is read until somebody signs in. */
  signedOut(): void {
    this.standing = 'off'
    this.key = null
    this.registered = ''
    this.asking = []
    this.digits = ''
  }
}
