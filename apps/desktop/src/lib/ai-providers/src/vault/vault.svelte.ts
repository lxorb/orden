import { answerNonce, commitment, digits as pairingDigits, newNonce } from '../pairing'
import { authOf, type DeviceKey, deviceKeyIn, fingerprint, idOf, newDeviceKey } from './crypto'
import { newVaultKey, open, seal, unwrap, wrap } from './crypto'
import type { Accounts } from '../accounts'
import { agrees, type Base, baseOf, type Contents, contentsIn, merged, type Side } from './merge'

const DIGITS = 'nib ai vault digits'
const DEVICE_SECRET = 'ai-vault-device'
const JOINED_SECRET = 'ai-vault-joined'
const ASKING_SECRET = 'ai-vault-asking'
const TRIES = 3
const MOST_BEFORE = 20
function beforeIn(value: unknown): string[] {
  const kept = typeof value === 'object' && value !== null ? (value as { before?: unknown }).before : null
  return Array.isArray(kept) ? kept.filter((one): one is string => typeof one === 'string').slice(-MOST_BEFORE) : []
}
export interface Allowed {
  id: string
  name: string
  mine: boolean
}
export type Standing = 'off' | 'opening' | 'open' | 'offered' | 'waiting' | 'stranded'
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
interface Mine {
  nonce: string
  answer: { nonce: string; from: string; digits: string } | null
}
export interface VaultWorld {
  account(): string | null
  call<T>(path: string, method?: string, body?: unknown): Promise<T>
  readSecret(name: string): Promise<string | null>
  writeSecret(name: string, secret: string): Promise<void>
  deviceName(): string
  local(): Promise<Contents>
  apply(contents: Contents, before: Contents, moved: Record<string, string>): Promise<void>
  loadBase(account: string): Base | null
  keepBase(account: string, base: Base | null): void
  served(): string | null
  serve(account: string | null): void
  drop(gone: Accounts['accounts']): Promise<void>
}
const isText = (value: unknown): value is string => typeof value === 'string'
function mineIn(value: unknown, account: string): Mine | null {
  if (typeof value !== 'object' || value === null) return null
  const kept = value as Record<string, unknown>
  if (kept.account !== account || !isText(kept.nonce)) return null
  const said = kept.answer as Record<string, unknown> | null
  const answer =
    typeof said === 'object' && said !== null && isText(said.nonce) && isText(said.from) && isText(said.digits)
      ? { nonce: said.nonce, from: said.from, digits: said.digits }
      : null
  return { nonce: kept.nonce, answer }
}
function isConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 409
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
  digits = $state('')
  asking = $state.raw<Asking[]>([])
  seen = $state.raw<Record<string, string>>({})
  offeredBy = $state('')
  allowed = $state.raw<Allowed[]>([])
  private device: DeviceKey | null = null
  private registered = ''
  private mineAsking: Mine | null = null
  private offered = ''
  private key: Uint8Array<ArrayBuffer> | null = null
  private running: Promise<void> | null = null
  private again = false
  constructor(private readonly world: VaultWorld) {}
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
  private async keptAsking(account: string): Promise<Mine | null> {
    return mineIn(JSON.parse((await this.world.readSecret(ASKING_SECRET)) ?? 'null'), account)
  }
  private async keepAsking(account: string, mine: Mine | null): Promise<void> {
    await this.world.writeSecret(ASKING_SECRET, JSON.stringify(mine ? { account, ...mine } : null))
  }
  private async register(device: DeviceKey, account: string): Promise<void> {
    const mine = { nonce: newNonce(), answer: null }
    await this.keepAsking(account, mine)
    await this.world.call('/v2/ai/devices', 'POST', {
      id: device.id,
      name: this.world.deviceName(),
      commitment: await commitment(device.pub, mine.nonce),
    })
    this.mineAsking = mine
  }
  private async once(): Promise<void> {
    const account = this.world.account()
    if (!account) {
      this.signedOut()
      return
    }
    const was = this.world.served()
    if (was !== account) {
      if (was) await this.left()
      this.world.serve(account)
    }
    if (this.standing === 'off') this.standing = 'opening'
    const device = await this.mine()
    if (this.registered !== account) {
      this.mineAsking = await this.keptAsking(account)
      if (!this.mineAsking) await this.register(device, account)
      this.registered = account
    }
    for (let tries = 0; tries < TRIES; tries++) {
      const read = await this.read(device)
      const me = read.devices.find((one) => one.id === device.id)
      if (!me) {
        await this.keepAsking(account, null)
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
          await this.ask(account, device, me, read.devices)
          return
        }
        if (await this.first(device, me)) continue
        return
      }
      const marker = await this.markerOf(this.key)
      const joined = await this.joined(account)
      if (joined && joined !== marker && (await this.before(this.key, read.blob)).includes(joined)) {
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
      this.digits = ''
      this.offeredBy = ''
      if (this.mineAsking) {
        this.mineAsking = null
        await this.keepAsking(account, null)
      }
      this.asking = await this.answer(device, others)
      if (await this.met(account, device, read)) return
    }
  }
  private async before(key: Uint8Array<ArrayBuffer>, blob: string | null): Promise<string[]> {
    const opened = blob ? await open(key, blob).catch(() => null) : null
    return opened === null ? [] : beforeIn(JSON.parse(opened))
  }
  private async markerOf(key: Uint8Array<ArrayBuffer>): Promise<string> {
    return await fingerprint(await authOf(key))
  }
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
  async join(): Promise<void> {
    const account = this.world.account()
    if (!account || this.standing !== 'offered' || !this.offered) return
    await this.keepJoined(account, this.offered)
    this.offered = ''
    await this.refresh()
  }
  private async ask(account: string, device: DeviceKey, me: Listed, devices: Listed[]): Promise<void> {
    const asking = await this.keptAsking(account)
    this.mineAsking = asking
    let answer = asking?.answer ?? null
    const moved = answer ? me.nonce !== answer.nonce || me.nonceFrom !== answer.from : me.pub !== null
    if (!asking || moved || (me.pub === null && me.commitment !== (await commitment(device.pub, asking.nonce)))) {
      await this.register(device, account)
      this.digits = ''
      this.again = true
      return
    }
    if (!answer) {
      if (!me.nonce || !me.nonceFrom) {
        this.digits = ''
        return
      }
      const answering = devices.find((one) => one.id === me.nonceFrom)
      if (!answering?.pub) {
        this.digits = ''
        return
      }
      const digits = await pairingDigits(DIGITS, device.pub, asking.nonce, me.nonce, answering.pub)
      answer = { nonce: me.nonce, from: me.nonceFrom, digits }
      this.mineAsking = { ...asking, answer }
      await this.keepAsking(account, this.mineAsking)
    }
    if (me.pub === null) {
      await this.world.call(`/v2/ai/devices/${device.id}/reveal`, 'PUT', {
        pub: device.pub,
        nonce: asking.nonce,
      })
    }
    this.digits = answer.digits
  }
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
      if (isConflict(error)) return true
      throw error
    }
    await this.world.call(`/v2/ai/devices/${device.id}/wrap`, 'PUT', {
      wrapped: await wrap(key, device.pub),
      from: device.id,
      auth,
    })
    const account = this.world.account()
    if (account) await this.keepJoined(account, await this.markerOf(key))
    return true
  }
  private async answer(device: DeviceKey, others: Listed[]): Promise<Asking[]> {
    const key = this.key
    if (!key) return []
    const shown: Asking[] = []
    for (const one of others) {
      if (one.approved || (one.nonce !== null && one.nonceFrom !== device.id)) continue
      const nonce = await answerNonce(JSON.stringify(device.priv), one.id, one.commitment)
      if (one.nonce !== nonce) {
        if (one.pub !== null) continue
        await this.world
          .call(`/v2/ai/devices/${one.id}/nonce`, 'PUT', { nonce, from: device.id, auth: await authOf(key) })
          .catch((error: unknown) => {
            if (!isConflict(error)) throw error
          })
        continue
      }
      if (one.pub === null || one.revealed === null) continue
      const holds = (await commitment(one.pub, one.revealed)) === one.commitment && (await idOf(one.pub)) === one.id
      if (!holds) continue
      shown.push({
        id: one.id,
        name: one.name,
        digits: await pairingDigits(DIGITS, one.pub, one.revealed, nonce, device.pub),
        pub: one.pub,
      })
    }
    return shown
  }
  private async met(account: string, device: DeviceKey, read: Read): Promise<boolean> {
    const key = this.key
    if (!key) return true
    const local = await this.world.local()
    const here = await sideOf({ ...local, seen: { ...this.seen, ...local.seen } })
    let remote: Side | null = null
    let before: string[] = []
    if (read.blob) {
      const opened = await open(key, read.blob).catch(() => null)
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
    const { contents, moved } = remote ? merged(base, here, remote) : { contents: here.contents, moved: {} }
    const prints = await printsOf(contents.keys)
    if (this.world.account() !== account) return true
    this.seen = contents.seen
    if (!agrees(baseOf(here.contents, here.prints), contents, prints)) {
      await this.world.apply(contents, local, moved)
    }
    this.standing = 'open'
    if (remote && agrees(baseOf(remote.contents, remote.prints), contents, prints)) {
      this.world.keepBase(account, baseOf(contents, prints))
      return true
    }
    if (this.world.account() !== account) return true
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
  async allow(id: string): Promise<void> {
    const key = this.key
    const device = this.device
    const shown = this.asking.find((one) => one.id === id)
    if (!key || !device || !shown) return
    const read = await this.read(device)
    const listed = read.devices.find((one) => one.id === id && !one.approved)
    if (listed?.pub === shown.pub) {
      await this.world.call(`/v2/ai/devices/${id}/wrap`, 'PUT', {
        wrapped: await wrap(key, shown.pub),
        from: device.id,
        auth: await authOf(key),
      })
    }
    this.dismiss(id)
  }
  dismiss(id: string): void {
    this.asking = this.asking.filter((one) => one.id !== id)
  }
  async deny(id: string): Promise<void> {
    const key = this.key
    await this.world
      .call(`/v2/ai/devices/${id}`, 'DELETE', key ? { auth: await authOf(key) } : {})
      .catch(() => undefined)
    this.dismiss(id)
  }
  async startOver(): Promise<void> {
    const account = this.world.account()
    if (!account) return
    await this.world.call('/v2/ai/vault', 'DELETE', {})
    this.world.keepBase(account, null)
    await this.refresh()
  }
  get deviceId(): string {
    return this.device?.id ?? ''
  }
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
  async leave(): Promise<void> {
    const device = this.device
    if (device && this.key && this.allowed.some((one) => one.mine)) {
      await this.remove(device.id).catch(() => false)
    } else if (device && this.registered) {
      await this.world.call(`/v2/ai/devices/${device.id}`, 'DELETE', {}).catch(() => undefined)
    }
    this.signedOut()
  }
  async left(kept = false): Promise<void> {
    const was = this.world.served()
    this.signedOut()
    if (!was) return
    const base = this.world.loadBase(was)
    this.world.keepBase(was, null)
    this.world.serve(null)
    if (base && !kept) await this.world.drop(base.accounts.accounts)
  }
  signedOut(): void {
    this.standing = 'off'
    this.seen = {}
    this.key = null
    this.registered = ''
    this.mineAsking = null
    this.offered = ''
    this.offeredBy = ''
    this.asking = []
    this.allowed = []
    this.digits = ''
  }
}
