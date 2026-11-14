import type { KdfParams } from '@orden/pass/crypto'
import { newKey } from '@orden/pass/crypto'
import { newEnvelope } from '@orden/pass/envelope'
import {
  newKeyring,
  openItem,
  openVault,
  openWithPassword,
  sealedRevOf,
  sealItem,
  sealVersion,
  unwrapVaultKey,
  withSigner,
} from '@orden/pass/keys'
import type { Content, Envelope, Item, Vault } from '@orden/pass/types'
import type { Change, ItemRow, KeyringRow, VaultRow, VersionRow } from './local'
import type { Held } from './rows'
import { emptyHeld, envelopeOf, itemOf, newId, tombstoneOf, vaultOf } from './rows'
import type { Shown } from './shown'
import { shownAfter } from './shown'
import type { PassApi } from './sync'
import type { SyncWorld } from './sync-world'
import type { DeviceRows } from './synced'
import type { TrustProblem } from './trust-problem'
import { madeVaultRow } from './vault-made'

const at = (vault: string, id: string) => `${vault}\n${id}`

export class MemoryRows implements DeviceRows {
  keyringRow: KeyringRow | null = null
  readonly vaultRows = new Map<string, VaultRow>()
  readonly itemRows = new Map<string, ItemRow>()
  readonly versionRows: VersionRow[] = []
  readonly meta = new Map<string, unknown>()

  keyring(): Promise<KeyringRow | null> {
    return Promise.resolve(structuredClone(this.keyringRow))
  }

  writeKeyring(row: KeyringRow): Promise<void> {
    this.keyringRow = structuredClone(row)
    return Promise.resolve()
  }

  vaults(): Promise<VaultRow[]> {
    return Promise.resolve([...this.vaultRows.values()].map((one) => ({ ...one })))
  }

  items(): Promise<ItemRow[]> {
    return Promise.resolve([...this.itemRows.values()].map((one) => ({ ...one })))
  }

  item(vault: string, id: string): Promise<ItemRow | null> {
    const row = this.itemRows.get(at(vault, id))
    return Promise.resolve(row ? { ...row } : null)
  }

  versions(vault: string, id: string): Promise<VersionRow[]> {
    return Promise.resolve(
      this.versionRows
        .filter((one) => one.vault === vault && one.id === id)
        .map((one) => ({ ...one }))
        .reverse(),
    )
  }

  write(change: Change): Promise<void> {
    for (const row of change.vaults ?? []) this.vaultRows.set(row.id, { ...row })
    for (const row of change.items ?? []) this.itemRows.set(at(row.vault, row.id), { ...row })
    for (const ref of change.dropVersions ?? []) {
      for (let index = this.versionRows.length - 1; index >= 0; index--) {
        const one = this.versionRows[index]
        if (one?.vault === ref.vault && one.id === ref.id) this.versionRows.splice(index, 1)
      }
    }
    for (const row of change.versions ?? []) {
      const same = this.versionRows.findIndex(
        (one) => one.vault === row.vault && one.id === row.id && one.rev === row.rev,
      )
      if (same >= 0) this.versionRows.splice(same, 1, { ...row })
      else this.versionRows.push({ ...row })
    }
    return Promise.resolve()
  }

  read(key: string): Promise<unknown> {
    return Promise.resolve(structuredClone(this.meta.get(key) ?? null))
  }

  keep(key: string, value: unknown): Promise<void> {
    if (value === null) this.meta.delete(key)
    else this.meta.set(key, structuredClone(value))
    return Promise.resolve()
  }
}

export class TestDevice {
  readonly rows = new MemoryRows()
  held: Held | null = null
  vaults: Vault[] = []
  items: Item[] = []
  conflict = false
  readonly problems: TrustProblem[] = []
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly kdf: KdfParams) {}

  world(api: PassApi, account: string, email: string): SyncWorld {
    return {
      api,
      rows: this.rows,
      account,
      email,
      exclusive: (run) => {
        const next = this.queue.then(() => run(this.held))
        this.queue = next.catch(() => undefined)
        return next
      },
      shown: (update: Shown) => {
        if (!this.held) return
        const next = shownAfter(this.vaults, this.items, update)
        this.vaults = next.vaults
        this.items = next.items
      },
      tookKeyring: () => undefined,
      conflicted: (on) => {
        this.conflict = on
      },
      invited: () => undefined,
      distrusted: (problem) => {
        this.problems.push(problem)
      },
    }
  }

  async setup(password: string, name = 'Personal'): Promise<string> {
    const made = await newKeyring(password, this.kdf)
    await this.rows.writeKeyring({ keyring: made.keyring, rev: 1, pending: true })
    this.held = emptyHeld(made.opened)
    return await this.makeVault(name)
  }

  async makeVault(name: string): Promise<string> {
    const held = this.mustHold()
    const id = newId()
    const key = newKey()
    const meta = {
      v: 1 as const,
      name,
      description: '',
      color: 'purple' as const,
      icon: 'home' as const,
      folders: [],
      hidePasswordsFromViewers: false,
    }
    const row: VaultRow = await madeVaultRow(held.opened, id, key, meta)
    await this.rows.write({ vaults: [row] })
    held.vaults.set(id, { key, row })
    this.vaults = [...this.vaults, vaultOf(row, meta)]
    return id
  }

  async unlock(password: string): Promise<boolean> {
    const keyring = this.rows.keyringRow?.keyring
    if (!keyring) return false
    try {
      const signing = await withSigner(keyring, await openWithPassword(keyring, password))
      if (signing.keyring !== keyring && this.rows.keyringRow) {
        const was = this.rows.keyringRow
        await this.rows.writeKeyring({ keyring: signing.keyring, rev: was.rev, pending: true })
      }
      const opened = signing.opened
      const held = emptyHeld(opened)
      const vaults: Vault[] = []
      const items: Item[] = []
      for (const row of this.rows.vaultRows.values()) {
        if (row.deleted) continue
        const key = await unwrapVaultKey(row.key, opened.pair, row.id)
        held.vaults.set(row.id, { key, row })
        vaults.push(vaultOf(row, await openVault(key, row.id, row.meta)))
      }
      for (const row of this.rows.itemRows.values()) {
        const box = held.vaults.get(row.vault)
        if (row.deleted || !box) continue
        const { envelope, itemKey } = await openItem(
          box.key,
          row.vault,
          row.id,
          row.key,
          row.body,
          row.keyVersion,
        )
        held.items.set(row.id, { key: itemKey, row })
        items.push(itemOf(row, envelope))
      }
      this.held = held
      this.vaults = vaults
      this.items = items
      return true
    } catch {
      return false
    }
  }

  lock(): void {
    this.held = null
    this.vaults = []
    this.items = []
  }

  async create(vault: string, content: Content): Promise<string> {
    const id = newId()
    await this.put(vault, id, newEnvelope(content, Date.now()), null)
    return id
  }

  async change(id: string, next: (envelope: Envelope) => Envelope): Promise<void> {
    const item = this.item(id)
    await this.put(item.vault, id, next(envelopeOf(item)), item)
  }

  async remove(id: string): Promise<void> {
    const held = this.mustHold()
    const one = held.items.get(id)
    if (!one) throw new Error('no such item')
    await this.rows.write({ items: [tombstoneOf(one.row, Date.now())], dropVersions: [one.row] })
    held.items.delete(id)
    this.items = this.items.filter((item) => item.id !== id)
  }

  async move(id: string, vault: string): Promise<void> {
    const held = this.mustHold()
    const one = held.items.get(id)
    if (!one) throw new Error('no such item')
    const item = this.item(id)
    await this.rows.write({ items: [tombstoneOf(one.row, Date.now())], dropVersions: [one.row] })
    held.items.delete(id)
    await this.put(vault, id, envelopeOf(item), null)
  }

  item(id: string): Item {
    const item = this.items.find((one) => one.id === id)
    if (!item) throw new Error('no such item')
    return item
  }

  vaultNamed(name: string): Vault {
    const vault = this.vaults.find((one) => one.name === name)
    if (!vault) throw new Error(`no vault ${name}`)
    return vault
  }

  pending(): ItemRow[] {
    return [...this.rows.itemRows.values()].filter((one) => one.pending)
  }

  private mustHold(): Held {
    if (!this.held) throw new Error('locked')
    return this.held
  }

  private async put(vault: string, id: string, envelope: Envelope, was: Item | null) {
    const held = this.mustHold()
    const box = held.vaults.get(vault)
    if (!box) throw new Error('no such vault')
    const before = held.items.get(id)
    const rev = (before?.row.rev ?? 0) + 1
    const last = sealedRevOf(before?.row.body ?? '') ?? 0
    const at = { keyVersion: box.row.keyVersion, rev: Math.max(rev, last + 1) }
    const sealed = await sealItem(box.key, vault, id, envelope, at, before?.key)
    const row: ItemRow = {
      vault,
      id,
      rev,
      key: sealed.key,
      body: sealed.body,
      keyVersion: box.row.keyVersion,
      at: Date.now(),
      pending: true,
      deleted: false,
    }
    const versions: VersionRow[] =
      was && before
        ? [
            {
              vault,
              id,
              rev: before.row.rev,
              at: before.row.at,
              ...(await sealVersion(
                box.key,
                vault,
                id,
                before.row.rev,
                envelopeOf(was),
                before.key,
              )),
            },
          ]
        : []
    await this.rows.write({ items: [row], versions })
    held.items.set(id, { key: sealed.itemKey, row })
    const item = itemOf(row, envelope)
    this.items = [...this.items.filter((one) => one.id !== id), item]
  }
}
