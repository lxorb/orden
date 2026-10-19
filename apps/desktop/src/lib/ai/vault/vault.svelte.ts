/** The AI accounts on every device of the reader's nib account (docs/ai.md, "Every
 *  device"): connected once, there on each device they sign in to.
 *
 *  Five standings. **Open**: this device holds the vault key, so it reads the sealed
 *  vault, meets it with its own accounts (merge.ts), and writes back what changed; it
 *  also answers any device asking for the key and, once that device has revealed its
 *  key, shows it with the six digits both screens work out, and one press wraps the key
 *  to exactly the key those digits were worked out from. **Waiting**: another device has
 *  the key and this one has asked, showing the same six digits once it has been answered.
 *  **Stranded**: the account has a vault but no device that could allow this one, so the
 *  way on is to start over: the old vault is let go of and this device's accounts become
 *  the vault. **Offered**: another device has wrapped the key to this one, and it waits for
 *  the reader to press Join here before it opens the vault, takes what is in it or puts
 *  this device's own keys in - a vault somebody else made and offered would otherwise
 *  have taken them without a word. **Off**: nobody signed in. The first device of an
 *  account makes the key without a word, and never one beside a vault that is there.
 *
 *  Letting a device in is three steps, so the digits cannot be chosen by anyone between
 *  the two screens (services/sync/src/ai/vault.ts): the asking device commits to its key
 *  and a nonce, a device with the key answers with a nonce of its own, and only then does
 *  the asking device reveal its key and nonce. The answering device checks the reveal
 *  against the commitment it answered and the key against the device's id, and wraps the
 *  vault key to that key and no other.
 *
 *  An allowed device is let go of by changing the key (#389, `remove`): an open device
 *  seals the vault under a new key and wraps that to every allowed device but the one
 *  going, which keeps a key that opens nothing written after. The sealed words remember
 *  the vaults they were changed from (`before`), so a device that joined the vault before
 *  the change opens the new one without being offered it again.
 *
 *  It reads again whenever its hub says another device changed something, when this
 *  device changes something, and now and then besides. The roads out - the account's
 *  routes, the secret store, the AI store - are handed in (`VaultWorld`), so the rules
 *  are tested with two devices in memory. */

import { commitment, digits as pairingDigits, newNonce } from '../../pairing'
import {
  authOf,
  type DeviceKey,
  deviceKeyIn,
  fingerprint,
  idOf,
  newDeviceKey,
  newVaultKey,
  open,
  seal,
  unwrap,
  wrap,
} from './crypto'
import { SvelteMap } from 'svelte/reactivity'
import { agrees, type Base, baseOf, type Contents, contentsIn, merged, type Side } from './merge'

/** What the vault's six digits are for; see pairing.ts. */
const DIGITS = 'nib ai vault digits'

/** Where this device's key pair is kept in its secret store. */
const DEVICE_SECRET = 'ai-vault-device'

/** Which vault this device joined, per account: a fingerprint of the vault's token, kept
 *  in the secret store beside the device key so a reinstall that keeps one keeps both. */
const JOINED_SECRET = 'ai-vault-joined'

/** How many times a write is made again over a newer vault before it waits for the next
 *  read. */
const TRIES = 3

/** How many vaults back a device that joined one still opens the one it became. */
const MOST_BEFORE = 20

/** The vaults sealed words say they were changed from, oldest first. */
function beforeIn(value: unknown): string[] {
  const kept =
    typeof value === 'object' && value !== null ? (value as { before?: unknown }).before : null
  return Array.isArray(kept)
    ? kept.filter((one): one is string => typeof one === 'string').slice(-MOST_BEFORE)
    : []
}

/** An allowed device, as an open device lists it. */
export interface Allowed {
  id: string
  name: string
  /** This device. */
  mine: boolean
}

export type Standing = 'off' | 'opening' | 'open' | 'offered' | 'waiting' | 'stranded'

/** A device asking for the key, as an open device shows it: with the key the digits
 *  were worked out from, which is the one the vault key is wrapped to. */
export interface Asking {
  id: string
  name: string
  digits: string
  pub: string
}

interface Listed {
  id: string
  name: string
  pub: string | null
  commitment: string
  nonce: string | null
  nonceFrom: string | null
  revealed: string | null
  approved: boolean
}

interface Read {
  rev: number
  blob: string | null
  wrapped: string | null
  devices: Listed[]
}

/** This device's own asking: the nonce it committed to, and once it has been answered,
 *  the answer it revealed against and the digits that came out of it. */
interface Mine {
  nonce: string
  answer: { nonce: string; from: string; digits: string } | null
}

/** An asking this device answered: what it committed to, and the nonce it answered with. */
interface Answered {
  commitment: string
  nonce: string
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

/** A refusal for being out of date or answered already, as the request says it. */
function isConflict(error: unknown): boolean {
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
  /** This device's six digits, while it waits and once it has been answered. */
  digits = $state('')
  /** Devices asking for the key, while this one is open. */
  asking = $state.raw<Asking[]>([])
  /** Who each account was signed in as, on whichever device saw it. */
  seen = $state.raw<Record<string, string>>({})
  /** The device offering this one the vault, while it is offered. */
  offeredBy = $state('')
  /** The devices allowed, while this one is open. */
  allowed = $state.raw<Allowed[]>([])

  private device: DeviceKey | null = null
  private registered = ''
  private mineAsking: Mine | null = null
  private readonly answered = new SvelteMap<string, Answered>()
  /** The vault this device is offered, by its marker, until the reader joins it. */
  private offered = ''
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

  /** Says this device is here, committed to its key and a fresh nonce. */
  private async register(device: DeviceKey): Promise<void> {
    const nonce = newNonce()
    await this.world.call('/v2/ai/devices', 'POST', {
      id: device.id,
      name: this.world.deviceName(),
      commitment: await commitment(device.pub, nonce),
    })
    this.mineAsking = { nonce, answer: null }
  }

  private async once(): Promise<void> {
    const account = this.world.account()
    if (!account) {
      this.signedOut()
      return
    }
    if (this.standing === 'off') this.standing = 'opening'
    const device = await this.mine()
    if (this.registered !== account) {
      await this.register(device)
      this.registered = account
    }

    for (let tries = 0; tries < TRIES; tries++) {
      const read = await this.read(device)
      const me = read.devices.find((one) => one.id === device.id)
      // Let go of by another device, or the account's devices let go of all at once:
      // asked again from the start.
      if (!me) {
        this.registered = ''
        this.again = true
        return
      }
      this.key = read.wrapped ? await unwrap(read.wrapped, device).catch(() => null) : null
      const others = read.devices.filter((one) => one.id !== device.id)
      this.allowed = read.devices
        .filter((one) => one.approved)
        .map((one) => ({ id: one.id, name: one.name, mine: one.id === device.id }))

      if (!this.key) {
        const allowers = others.filter((one) => one.approved)
        if (read.blob || allowers.length) {
          this.asking = []
          if (!allowers.length) {
            this.digits = ''
            this.standing = 'stranded'
            return
          }
          this.standing = 'waiting'
          await this.ask(device, me, read.devices)
          return
        }
        // The first device of the account: the vault is made here, and the key
        // wrapped to itself.
        if (await this.first(device, me)) continue
        return
      }

      // Offered by another device: nothing is opened, taken or put in until the reader
      // joins here.
      const marker = await this.markerOf(this.key)
      const joined = await this.joined(account)
      // The key changed under a vault this device joined: the same vault, joined still.
      if (
        joined &&
        joined !== marker &&
        (await this.before(this.key, read.blob)).includes(joined)
      ) {
        await this.keepJoined(account, marker)
      } else if (joined !== marker) {
        const by = read.devices.find((one) => one.id === me.nonceFrom)
        this.offeredBy = by?.name ?? ''
        this.digits = this.mineAsking?.answer?.digits ?? ''
        this.offered = marker
        this.asking = []
        this.standing = 'offered'
        return
      }

      this.standing = 'open'
      this.digits = ''
      this.offeredBy = ''
      this.mineAsking = null
      this.asking = await this.answer(device, others)
      if (await this.met(account, device, read)) return
    }
  }

  /** The vaults the sealed vault was changed from, as it says. */
  private async before(key: Uint8Array<ArrayBuffer>, blob: string | null): Promise<string[]> {
    const opened = blob ? await open(key, blob).catch(() => null) : null
    return opened === null ? [] : beforeIn(JSON.parse(opened))
  }

  /** Which vault a key opens, as this device keeps it: a fingerprint of the vault's token,
   *  which says nothing of the key. */
  private async markerOf(key: Uint8Array<ArrayBuffer>): Promise<string> {
    return await fingerprint(await authOf(key))
  }

  /** The vault this device joined on this account, if any. */
  private async joined(account: string): Promise<string | null> {
    const kept: unknown = JSON.parse((await this.world.readSecret(JOINED_SECRET)) ?? 'null')
    if (typeof kept !== 'object' || kept === null) return null
    const one = (kept as Record<string, unknown>)[account]
    return typeof one === 'string' ? one : null
  }

  private async keepJoined(account: string, marker: string): Promise<void> {
    const kept: unknown = JSON.parse((await this.world.readSecret(JOINED_SECRET)) ?? 'null')
    const all = typeof kept === 'object' && kept !== null ? (kept as Record<string, unknown>) : {}
    await this.world.writeSecret(JOINED_SECRET, JSON.stringify({ ...all, [account]: marker }))
  }

  /** The reader's yes to the vault this device is offered: it opens, takes what is in it
   *  and puts this device's own keys in. */
  async join(): Promise<void> {
    const account = this.world.account()
    if (!account || this.standing !== 'offered' || !this.offered) return
    await this.keepJoined(account, this.offered)
    this.offered = ''
    await this.refresh()
  }

  /** This device's side of being let in: waits to be answered, reveals against the answer,
   *  and shows the digits that came out of it. */
  private async ask(device: DeviceKey, me: Listed, devices: Listed[]): Promise<void> {
    const asking = this.mineAsking
    // Revealed in an earlier run, whose nonce this one never had: asked again afresh.
    if (!asking || (me.pub !== null && !asking.answer)) {
      await this.register(device)
      this.digits = ''
      this.again = true
      return
    }
    if (asking.answer) {
      // Answered, and revealed against that answer. An answer that changed since is not
      // one this device revealed against: asked again afresh.
      if (me.nonce !== asking.answer.nonce || me.nonceFrom !== asking.answer.from) {
        await this.register(device)
        this.digits = ''
        this.again = true
        return
      }
      this.digits = asking.answer.digits
      return
    }
    if (!me.nonce || !me.nonceFrom) {
      this.digits = ''
      return
    }

    const answering = devices.find((one) => one.id === me.nonceFrom)
    if (!answering?.pub) {
      this.digits = ''
      return
    }
    await this.world.call(`/v2/ai/devices/${device.id}/reveal`, 'PUT', {
      pub: device.pub,
      nonce: asking.nonce,
    })
    const said = await pairingDigits(DIGITS, device.pub, asking.nonce, me.nonce, answering.pub)
    asking.answer = { nonce: me.nonce, from: me.nonceFrom, digits: said }
    this.digits = said
  }

  /** The first device of an account: the vault made with this device's accounts in it,
   *  and the key wrapped to this device. Answers whether to read again at once. */
  private async first(device: DeviceKey, me: Listed): Promise<boolean> {
    if (me.pub === null) {
      await this.world.call(`/v2/ai/devices/${device.id}/reveal`, 'PUT', {
        pub: device.pub,
        nonce: this.mineAsking?.nonce ?? '',
      })
    }
    const key = newVaultKey()
    const auth = await authOf(key)
    const contents = await this.world.local()
    try {
      await this.world.call('/v2/ai/vault', 'PUT', {
        rev: 0,
        blob: await seal(key, JSON.stringify(contents)),
        from: device.id,
        auth,
      })
    } catch (error) {
      // Another device made it first: this one asks to be let in instead.
      if (isConflict(error)) return true
      throw error
    }
    await this.world.call(`/v2/ai/devices/${device.id}/wrap`, 'PUT', {
      wrapped: await wrap(key, device.pub),
      from: device.id,
      auth,
    })
    // Made here, so joined here.
    const account = this.world.account()
    if (account) await this.keepJoined(account, await this.markerOf(key))
    return true
  }

  /** Answers every device asking, and lists those that revealed against this device's
   *  answer with the key they revealed, once it is the key they committed to and the key
   *  their id names. */
  private async answer(device: DeviceKey, others: Listed[]): Promise<Asking[]> {
    const key = this.key
    if (!key) return []
    const shown: Asking[] = []
    for (const one of others) {
      if (one.approved) continue
      if (one.nonce === null) {
        const nonce = newNonce()
        try {
          await this.world.call(`/v2/ai/devices/${one.id}/nonce`, 'PUT', {
            nonce,
            from: device.id,
            auth: await authOf(key),
          })
          this.answered.set(one.id, { commitment: one.commitment, nonce })
        } catch (error) {
          if (!isConflict(error)) throw error
        }
        continue
      }
      const mine = this.answered.get(one.id)
      if (one.nonceFrom !== device.id) continue
      // Answered by this device in a run that has ended, whose nonce this one never had:
      // let go of, so it asks again and is answered afresh.
      if (mine?.nonce !== one.nonce) {
        await this.world.call(`/v2/ai/devices/${one.id}`, 'DELETE', {}).catch(() => undefined)
        continue
      }
      if (one.pub === null || one.revealed === null) continue
      const holds =
        (await commitment(one.pub, one.revealed)) === mine.commitment &&
        (await idOf(one.pub)) === one.id
      if (!holds) continue
      shown.push({
        id: one.id,
        name: one.name,
        digits: await pairingDigits(DIGITS, one.pub, one.revealed, mine.nonce, device.pub),
        pub: one.pub,
      })
    }
    return shown
  }

  /** The vault met with this device's accounts, and written back where they differ.
   *  Answers false where another device wrote first, to read again. */
  private async met(account: string, device: DeviceKey, read: Read): Promise<boolean> {
    const key = this.key
    if (!key) return true
    const local = await this.world.local()
    const here = await sideOf({ ...local, seen: { ...this.seen, ...local.seen } })
    let remote: Side | null = null
    let before: string[] = []
    if (read.blob) {
      const opened = await open(key, read.blob).catch(() => null)
      // Sealed under a key this device was never given: nothing here is the account's,
      // so nothing is written over it, and the reader is asked to start over.
      if (opened === null) {
        this.key = null
        this.standing = 'stranded'
        return true
      }
      const parsed: unknown = JSON.parse(opened)
      before = beforeIn(parsed)
      remote = await sideOf(contentsIn(parsed))
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
        blob: await seal(key, JSON.stringify(before.length ? { ...contents, before } : contents)),
        from: device.id,
        auth: await authOf(key),
      })
    } catch (error) {
      if (isConflict(error)) return false
      throw error
    }
    this.world.keepBase(account, baseOf(contents, prints))
    return true
  }

  /** Gives the key to a device that asked for it: wrapped to the key its digits were
   *  worked out from, and only while the account still lists that key for it. */
  async allow(id: string): Promise<void> {
    const key = this.key
    const device = this.device
    const shown = this.asking.find((one) => one.id === id)
    if (!key || !device || !shown) return
    const read = await this.read(device)
    const listed = read.devices.find((one) => one.id === id && !one.approved)
    if (listed?.pub !== shown.pub) {
      // The key changed under the digits the reader compared: nothing is wrapped, and
      // the asking starts over.
      this.asking = this.asking.filter((one) => one.id !== id)
      this.answered.delete(id)
      return
    }
    await this.world.call(`/v2/ai/devices/${id}/wrap`, 'PUT', {
      wrapped: await wrap(key, shown.pub),
      from: device.id,
      auth: await authOf(key),
    })
    this.asking = this.asking.filter((one) => one.id !== id)
    this.answered.delete(id)
  }

  /** Puts a device's asking away unanswered; it comes back with the next read. */
  dismiss(id: string): void {
    this.asking = this.asking.filter((one) => one.id !== id)
  }

  /** Turns a device's asking down. */
  async deny(id: string): Promise<void> {
    const key = this.key
    await this.world
      .call(`/v2/ai/devices/${id}`, 'DELETE', key ? { auth: await authOf(key) } : {})
      .catch(() => undefined)
    this.asking = this.asking.filter((one) => one.id !== id)
    this.answered.delete(id)
  }

  /** Lets go of the account's vault, for a device none of the others can allow: this
   *  device's accounts become the vault, and the other devices are allowed again from
   *  here. The account takes it only where no device is allowed any more. */
  async startOver(): Promise<void> {
    const account = this.world.account()
    if (!account) return
    await this.world.call('/v2/ai/vault', 'DELETE', {})
    this.world.keepBase(account, null)
    await this.refresh()
  }

  /** This device's id on the account, once it has one. */
  get deviceId(): string {
    return this.device?.id ?? ''
  }

  /** An allowed device let go of (#389), this one included: the vault sealed under a new
   *  key, wrapped to every allowed device but that one, and the old key's token the proof.
   *  Over a newer vault it reads and tries again. The last allowed device takes the vault
   *  with it, since nobody would be left to hold a new key. Answers whether it went. */
  async remove(id: string): Promise<boolean> {
    const account = this.world.account()
    const device = this.device
    if (!account || !device) return false
    for (let tries = 0; tries < TRIES; tries++) {
      const key = this.key
      if (!key) return false
      const read = await this.read(device)
      if (!read.devices.some((one) => one.id === id && one.approved)) return false
      const keep = read.devices.filter((one) => one.approved && one.id !== id && one.pub)
      const auth = await authOf(key)
      if (!keep.length) {
        await this.world.call('/v2/ai/vault', 'DELETE', { auth })
        await this.world.call(`/v2/ai/devices/${id}`, 'DELETE', {}).catch(() => undefined)
        this.world.keepBase(account, null)
        this.signedOut()
        return true
      }

      const opened = read.blob ? await open(key, read.blob).catch(() => null) : null
      if (read.blob && opened === null) return false
      const parsed: unknown = opened === null ? null : JSON.parse(opened)
      const before = [...beforeIn(parsed), await this.markerOf(key)].slice(-MOST_BEFORE)
      const next = newVaultKey()
      try {
        await this.world.call('/v2/ai/rotate', 'PUT', {
          rev: read.rev,
          blob: await seal(next, JSON.stringify({ ...contentsIn(parsed), before })),
          from: device.id,
          auth,
          next: await authOf(next),
          keep: keep.map((one) => one.id),
          wraps: await Promise.all(keep.map((one) => wrap(next, one.pub ?? ''))),
          go: [id],
        })
      } catch (error) {
        if (isConflict(error)) continue
        throw error
      }
      if (id === device.id) {
        this.signedOut()
        return true
      }
      this.key = next
      await this.keepJoined(account, await this.markerOf(next))
      this.allowed = this.allowed.filter((one) => one.id !== id)
      void this.refresh()
      return true
    }
    return false
  }

  /** This device out of the vault: let go of by changing the key where it is allowed, its
   *  asking let go of otherwise, and nothing read again until it is let back in. What it
   *  holds here stays. */
  async leave(): Promise<void> {
    const device = this.device
    if (device && this.key && this.allowed.some((one) => one.mine)) {
      await this.remove(device.id).catch(() => false)
    } else if (device && this.registered) {
      await this.world.call(`/v2/ai/devices/${device.id}`, 'DELETE', {}).catch(() => undefined)
    }
    this.signedOut()
  }

  /** Signed out: nothing is read until somebody signs in. */
  signedOut(): void {
    this.standing = 'off'
    this.key = null
    this.registered = ''
    this.mineAsking = null
    this.answered.clear()
    this.offered = ''
    this.offeredBy = ''
    this.asking = []
    this.allowed = []
    this.digits = ''
  }
}
