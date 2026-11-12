import { blank } from '@orden/pass/envelope'
import type { Content, Item, Login, Role, Vault, VaultMeta } from '@orden/pass/types'
import type { Invite, ItemRow, LinkRow, Member } from '@orden/pass/wire'
import { expect } from 'vitest'
import app from '../src'
import type { TestEnv } from './harness'
import type { Person } from './pass-fakes'

export const FAST = { m: 64, t: 1, p: 1 }
export const PASSWORD = 'correct horse battery staple'
export const ORIGIN = 'https://orden.so'

interface VersionRow {
  vault: string
  id: string
  rev: number
  key: string
  body: string
}

interface HeldVault {
  key: Uint8Array<ArrayBuffer>
  row: { keyVersion: number; role: Role }
}

interface Held {
  opened: { pair: { pub: string; priv: JsonWebKey }; signer: Signer | null }
  vaults: Map<string, HeldVault>
  items: Map<string, { key: Uint8Array<ArrayBuffer>; row: { vault: string } }>
}

export interface PersonShown {
  email: string
  key: { pub: string; signPub: string | null } | null
  code: string | null
  known: string
}

export interface Device {
  rows: { versionRows: VersionRow[]; itemRows: Map<string, { pending: boolean }> }
  held: Held | null
  items: Item[]
  vaults: Vault[]
  problems: { vault: string; item: string | null; reason: string }[]
  world(api: unknown, account: string, email: string): unknown
  setup(password: string, name?: string): Promise<string>
  makeVault(name: string): Promise<string>
  unlock(password: string): Promise<boolean>
  lock(): void
  create(vault: string, content: Content): Promise<string>
  change(id: string, next: (envelope: Item) => Item): Promise<void>
  item(id: string): Item
  pending(): unknown[]
}

export interface Api {
  personKey(email: string): Promise<{ pub: string; signPub: string | null } | null>
  members(vault: string): Promise<Member[]>
  accept(vault: string): Promise<unknown>
  decline(vault: string): Promise<void>
  setRole(vault: string, email: string, role: Role): Promise<void>
  removeMember(vault: string, email: string): Promise<void>
  setOwner(vault: string, email: string): Promise<void>
  allVaultItems(vault: string): Promise<ItemRow[]>
  putItem(
    vault: string,
    id: string,
    sent: { rev: number; key: string; body: string; keyVersion: number },
  ): Promise<{ ok: boolean; status?: number }>
  links(): Promise<LinkRow[]>
  removeLink(id: string): Promise<void>
  removeExpired(): Promise<number>
}

export interface Sharing {
  api: Api
  held: Held
  rows: unknown
  email: string
  versions(vault: string, id: string): Promise<VersionRow[]>
}

export interface Kit {
  TestDevice: new (kdf: typeof FAST) => Device
  ShareApi: new (call: unknown, from?: () => string | null) => Api
  fetchCall(fetcher: (request: Request) => Promise<Response>, base: string, token: string): unknown
  syncOnce(world: unknown): Promise<string>
  invitesOf(rows: unknown): Promise<Invite[]>
  invitedState(sharing: Sharing, vault: string, person: PersonShown, role: Role): Promise<string>
  confirmedMember(sharing: Sharing, vault: string, person: PersonShown): Promise<void>
  removedMember(sharing: Sharing, vault: string, email: string): Promise<number>
  personFor(sharing: Sharing, email: string): Promise<PersonShown>
  confirmedPerson(rows: unknown, person: PersonShown): Promise<PersonShown>
  acceptedInvite(sharing: Sharing, invite: Invite): Promise<void>
  handedOn(sharing: Sharing, vault: string, email: string): Promise<void>
  codeOf(key: { pub: string; signPub: string | null }): Promise<string>
  invitedMeta(held: Held, invite: Invite): Promise<VaultMeta | null>
  madeLink(
    api: Api,
    origin: string,
    item: Item,
    options: { expires: number; views: number | null },
  ): Promise<{ url: string; link: LinkRow }>
  linkKeyIn(hash: string): Uint8Array<ArrayBuffer> | null
  openedLink(key: Uint8Array<ArrayBuffer>, id: string, body: string): Promise<Content | null>
  sharedContent(content: Content): Content
  openItem(
    vaultKey: Uint8Array<ArrayBuffer>,
    vault: string,
    id: string,
    key: string,
    body: string,
    keyVersion: number,
  ): Promise<{ envelope: { content: Content } }>
  openVersion(
    vaultKey: Uint8Array<ArrayBuffer>,
    vault: string,
    id: string,
    rev: number,
    key: string,
    body: string,
  ): Promise<{ envelope: { content: Content } }>
  fingerprintOf(pub: string): Promise<string>
  newKey(): Uint8Array<ArrayBuffer>
  newSigner(): Promise<Signer>
  wrapVaultKey(key: Uint8Array<ArrayBuffer>, pub: string, vault: string): Promise<string>
  keyProofOf(
    signer: Signer,
    vault: string,
    keyVersion: number,
    key: Uint8Array<ArrayBuffer>,
    vouch: string | null,
  ): Promise<{ by: string; sig: string; vouch: string | null }>
  vouchFor(owner: Signer, vault: string, manager: string): Promise<string>
  acceptedOf(me: Signer, vault: string, owner: string): Promise<{ owner: string; sig: string }>
  sealVault(key: Uint8Array<ArrayBuffer>, vault: string, meta: VaultMeta): Promise<string>
  openItemBody(
    itemKey: Uint8Array<ArrayBuffer>,
    vault: string,
    id: string,
    body: string,
    keyVersion: number,
  ): Promise<unknown>
  roleGiven(sharing: Sharing, vault: string, email: string, role: Role): Promise<void>
}

interface Signer {
  pub: string
  priv: JsonWebKey
}

export async function kit(): Promise<Kit> {
  const at = (file: string) => new URL(`../../../${file}`, import.meta.url).href
  const loaded = await Promise.all(
    [
      ...[
        'test-device',
        'sync',
        'exchange',
        'synced',
        'share',
        'share-api',
        'link-make',
        'link-seal',
        'people',
      ].map((file) => `apps/desktop/src/lib/pass/${file}.ts`),
      'packages/pass/src/keys.ts',
      'packages/pass/src/crypto.ts',
      'packages/pass/src/sign.ts',
      'packages/pass/src/trust.ts',
    ].map((file) => import(/* @vite-ignore */ at(file)) as Promise<object>),
  )
  return Object.assign({}, ...loaded) as Kit
}

export function login(title: string, more: Partial<Login> = {}): Login {
  return { ...blank('login'), title, ...more }
}

export const content = (device: Device, id: string) => device.item(id).content as Login

export const names = (device: Device) => device.vaults.map((one) => one.name)

export type Tamper = (request: Request, answer: Response) => Promise<Response>

export class Flow {
  readonly seen: Request[] = []
  tamper: Tamper | null = null

  constructor(
    readonly env: TestEnv,
    readonly k: Kit,
    readonly owner: Person,
  ) {}

  readonly worker = async (request: Request): Promise<Response> => {
    this.seen.push(request.clone())
    const answer = await app.fetch(request, this.env)
    return this.tamper ? await this.tamper(request, answer) : answer
  }

  apiOf(who: Person): Api {
    return new this.k.ShareApi(this.k.fetchCall(this.worker, ORIGIN, who.token))
  }

  synced(device: Device, who: Person): Promise<string> {
    return this.k.syncOnce(device.world(this.apiOf(who), who.id, who.email))
  }

  sharing(device: Device, who: Person): Sharing {
    if (!device.held) throw new Error('locked')
    return {
      api: this.apiOf(who),
      held: device.held,
      rows: device.rows,
      email: who.email,
      versions: (vault, id) =>
        Promise.resolve(
          device.rows.versionRows.filter((one) => one.vault === vault && one.id === id).reverse(),
        ),
    }
  }

  async deviceOf(who: Person): Promise<Device> {
    const device = new this.k.TestDevice(FAST)
    await device.setup(PASSWORD)
    expect(await this.synced(device, who)).toBe('synced')
    return device
  }

  async family(): Promise<{ a: Device; vault: string; id: string }> {
    const a = new this.k.TestDevice(FAST)
    await a.setup(PASSWORD)
    const vault = await a.makeVault('Family')
    const id = await a.create(vault, login('Bank', { username: 'ada', password: 'one' }))
    expect(await this.synced(a, this.owner)).toBe('synced')
    return { a, vault, id }
  }

  async checked(device: Device, who: Person, email: string): Promise<PersonShown> {
    const found = await this.k.personFor(this.sharing(device, who), email)
    return found.key === null ? found : await this.k.confirmedPerson(device.rows, found)
  }

  async invited(
    a: Device,
    vault: string,
    email: string,
    role: Role,
    by: Person = this.owner,
  ): Promise<string> {
    const person = await this.checked(a, by, email)
    return await this.k.invitedState(this.sharing(a, by), vault, person, role)
  }

  async accepted(device: Device, who: Person, vault: string): Promise<void> {
    expect(await this.synced(device, who)).toBe('synced')
    const invite = (await this.k.invitesOf(device.rows)).find((one) => one.vault === vault)
    if (!invite) throw new Error('no invitation')
    await this.k.acceptedInvite(this.sharing(device, who), invite)
    expect(await this.synced(device, who)).toBe('synced')
  }

  async joined(a: Device, vault: string, who: Person, role: Role): Promise<Device> {
    const device = await this.deviceOf(who)
    expect(await this.invited(a, vault, who.email, role)).toBe('pending')
    await this.accepted(device, who, vault)
    return device
  }
}
