import { base64, randomBytes, unbase64 } from '@orden/pass/bytes'
import type { KdfParams } from '@orden/pass/crypto'
import {
  kdfParamsIn,
  newKey,
  openText,
  PASSWORD_KDF,
  PIN_KDF,
  seal,
  WrongSecret,
} from '@orden/pass/crypto'
import { openForDevice, pinIn, sealForDevice } from '@orden/pass/device'
import { newEnvelope, vaultMetaIn } from '@orden/pass/envelope'
import { exportCsv, exportJson, sealExport } from '@orden/pass/export'
import type { Imported, ImportedVault } from '@orden/pass/import/types'
import type { Keyring, Opened } from '@orden/pass/keys'
import {
  changePassword,
  isOldPasswordSeal,
  newKeyring,
  newRecovery,
  openedWith,
  openWithPassword,
  openWithRecovery,
  sealVault,
  withSigner,
} from '@orden/pass/keys'
import { activeLogins } from '@orden/pass/monitor'
import type { Content, Envelope, Item, Vault, VaultMeta } from '@orden/pass/types'
import type { Invite, Member, MemberState } from '@orden/pass/wire'
import { rank } from '@orden/pass/urls'
import { forgetKey, keysAreGuarded, readSecret, writeSecret } from '../ai/keys'
import { message, t } from '../i18n.svelte'
import { deviceCan, deviceSays } from '../protect/device'
import { adoptedChange } from './adopt'
import type { AliasAccount } from './alias-account'
import type { Picked } from './attachments'
import { copySecret } from './clipboard'
import type { FileApi } from './file-api'
import { deviceRows } from './device-rows'
import type { DeviceRow, KeyringRow, VaultRow } from './local'
import {
  clearPinTries,
  KEPT_AFTER_DELETE,
  readDevice,
  readItems,
  readKeyring,
  readMeta,
  readVaults,
  readVersions,
  spendPinTry,
  write,
  writeDevice,
  writeKeyring,
  writeMeta,
} from './local'
import { ownVaults } from './own-vaults'
import { Relock } from './relock.svelte'
import type { Held, HeldVault, Put } from './rows'
import {
  emptyHeld,
  envelopeOf,
  folderFor,
  metaOf,
  newId,
  openAll,
  openVersions,
  sealPuts,
  tombstoneOf,
  vaultOf,
  withMade,
  without,
} from './rows'
import type { LockWay, PassSettings } from './settings'
import { keepSettings, readSettings } from './settings'
import type { InvitedRole, Sharing } from './share'
import type { Person } from './people'
import { codeOf, confirmedPerson } from './people'
import {
  acceptedInvite,
  confirmedMember,
  emailOf,
  handedOn,
  invitedMeta,
  invitedState,
  memberPerson,
  personFor,
  removedMember,
  roleGiven,
  trustBackfilled,
} from './share'
import type { Signed } from './share-call'
import type { Shown } from './shown'
import { shownAfter } from './shown'
import { accountKeyringOf, keepAdopted } from './synced'
import type { TrustProblem } from './trust-problem'
import { trustWords } from './trust-problem'
import { madeVaultRow } from './vault-made'

export type { LockWay, PassSettings } from './settings'

export type PassState = 'loading' | 'new' | 'locked' | 'open'

export interface Unlock {
  password?: string
  pin?: string
  device?: true
  recovery?: string
}

export const PIN_TRIES = 5

const DEVICE_SECRET = 'pass-device'
const HIBP = 'hibp'
const ALIAS = 'alias'
const SEALED_HERE = [HIBP, ALIAS]

let kdf: KdfParams = PASSWORD_KDF
let pinKdf: KdfParams = PIN_KDF

export function configurePass(given: { kdf?: KdfParams; pinKdf?: KdfParams }): void {
  kdf = given.kdf ?? PASSWORD_KDF
  pinKdf = given.pinKdf ?? PIN_KDF
}

const unlocked = new WeakMap<PassStore, Held>()

function files(): Promise<typeof import('./attachments')> {
  return import('./attachments')
}

async function signed(): Promise<Signed> {
  return (await import('./share-call')).signedSharing()
}

async function deviceSecret(): Promise<Uint8Array<ArrayBuffer> | null> {
  const text = await readSecret(DEVICE_SECRET)
  if (text === null) return null
  try {
    const bytes = unbase64(text)
    return bytes.length === 32 ? bytes : null
  } catch {
    return null
  }
}

async function ensuredDeviceSecret(): Promise<Uint8Array<ArrayBuffer>> {
  const known = await deviceSecret()
  if (known) return known
  const made = randomBytes(32)
  await writeSecret(DEVICE_SECRET, base64(made))
  return made
}

function exportName(format: 'sealed' | 'json' | 'csv'): string {
  const day = new Date().toISOString().slice(0, 10)
  switch (format) {
    case 'sealed':
      return `orden-pass-${day}.sealed.json`
    case 'json':
      return `orden-pass-${day}.json`
    case 'csv':
      return `orden-pass-${day}.csv`
  }
}

export class PassStore {
  state = $state<PassState>('loading')
  vaults = $state.raw<Vault[]>([])
  items = $state.raw<Item[]>([])
  settings = $state.raw<PassSettings>(readSettings())
  pinTries = $state(PIN_TRIES)
  canDevice = $state(false)
  canPin = $state(false)
  mustChangePassword = $state(false)
  error = $state<string | null>(null)
  conflict = $state(false)
  trustProblem = $state<string | null>(null)

  fileSource: () => Promise<FileApi | null> = async () => (await files()).accountFiles()

  aliasesStopped: Promise<void> = Promise.resolve()

  private keyring: KeyringRow | null = null
  private device: DeviceRow | null = null
  private queue: Promise<unknown> = Promise.resolve()
  private unlocking: Promise<unknown> = Promise.resolve()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- who is listening; nothing renders from it
  private readonly listeners = new Set<() => void>()
  private readonly relock = new Relock(
    () => this.settings.relockAfter,
    () => this.lock(),
  )

  async start(): Promise<void> {
    const [keyring, device] = await Promise.all([readKeyring(), readDevice()])
    this.keyring = keyring
    this.device = device
    this.canPin = keysAreGuarded()
    this.canDevice = this.canPin && (await deviceCan())
    const way = device?.seal.way ?? 'password'
    if (this.settings.lock !== way) this.setSetting('lock', way)
    this.pinTries = PIN_TRIES - (device?.seal.way === 'pin' ? device.seal.tries : 0)
    this.relock.watch()
    if (unlocked.has(this)) return
    this.state = keyring ? 'locked' : 'new'
  }

  async setup(password: string): Promise<string> {
    if (this.keyring) throw new Error('pass: Pass is already set up on this device')
    const made = await newKeyring(password, kdf)
    const row: KeyringRow = { keyring: made.keyring, rev: 1, pending: true }
    await writeKeyring(row)
    this.keyring = row
    this.hold(emptyHeld(made.opened), [], [])
    await this.serial(() => this.makeVault({ name: t('Personal'), color: 'purple', icon: 'home' }))
    return made.recovery
  }

  async unlock(way: Unlock): Promise<boolean> {
    const keyring = this.keyring?.keyring
    if (!keyring) return false
    this.error = null
    try {
      const found = await this.openedBy(keyring, way)
      if (!found) return false
      const opened = await this.keptKeyring(keyring, found, way.password)
      const all = await openAll(opened)
      this.hold(all.held, all.vaults, all.items)
      this.mustChangePassword = way.recovery !== undefined
      return true
    } catch (error) {
      if (!(error instanceof WrongSecret)) this.error = message(error, 'Pass could not be opened.')
      return false
    }
  }

  distrusted(problem: TrustProblem): void {
    this.trustProblem = t(trustWords(problem))
  }

  async backfillTrust(): Promise<number> {
    if (!unlocked.has(this)) return 0
    try {
      return await trustBackfilled(await this.sharing())
    } catch {
      return 0
    }
  }

  lock(): void {
    unlocked.delete(this)
    this.relock.back()
    this.items = []
    this.vaults = []
    this.mustChangePassword = false
    if (this.state === 'open') this.state = 'locked'
  }

  async useLock(way: LockWay, pin?: string): Promise<boolean> {
    const { opened } = this.held()
    if (way === 'password') {
      await this.forgetDevice()
      return true
    }
    if (way === 'pin' ? !this.canPin : !this.canDevice) return false
    if (way === 'pin' && (pin === undefined || pinIn(pin) === null)) return false
    if (way === 'device' && !(await deviceSays(t('Unlock Pass')))) return false
    try {
      const secret = await ensuredDeviceSecret()
      const seal = await sealForDevice(opened.root, secret, way === 'pin' ? pin : undefined, pinKdf)
      await this.keepDevice({ seal, kdf: pinKdf })
      return true
    } catch (error) {
      this.error = message(error, 'This device could not keep the key.')
      return false
    }
  }

  async changePassword(old: string, password: string): Promise<boolean> {
    const { opened } = this.held()
    const row = this.keyring
    if (!row || password === '') return false
    if (!this.mustChangePassword && !(await this.confirmPassword(old))) return false
    await this.keepKeyring(row, await changePassword(row.keyring, opened, password, kdf))
    this.mustChangePassword = false
    return true
  }

  async newRecovery(password: string): Promise<string | null> {
    const { opened } = this.held()
    const row = this.keyring
    if (!row || !(await this.confirmPassword(password))) return null
    const made = await newRecovery(row.keyring, opened)
    await this.keepKeyring(row, made.keyring)
    return made.recovery
  }

  async confirmPassword(password: string): Promise<boolean> {
    const keyring = this.keyring?.keyring
    if (!keyring) return false
    try {
      await openWithPassword(keyring, password)
      return true
    } catch (error) {
      if (error instanceof WrongSecret) return false
      throw error
    }
  }

  async hibpKey(): Promise<string> {
    const { opened } = this.held()
    const sealed = await readMeta(HIBP)
    if (typeof sealed !== 'string') return ''
    try {
      return await openText(opened.root, sealed, 'local', HIBP)
    } catch {
      return ''
    }
  }

  async setHibpKey(key: string): Promise<void> {
    const { opened } = this.held()
    const trimmed = key.trim()
    await writeMeta(HIBP, trimmed === '' ? null : await seal(opened.root, trimmed, 'local', HIBP))
  }

  async aliasProvider(): Promise<AliasAccount | null> {
    const { opened } = this.held()
    const sealed = await readMeta(ALIAS)
    if (typeof sealed !== 'string') return null
    try {
      const text = await openText(opened.root, sealed, 'local', ALIAS)
      return (await import('./alias-account')).aliasAccountIn(text)
    } catch {
      return null
    }
  }

  async setAliasProvider(account: AliasAccount | null): Promise<void> {
    const { opened } = this.held()
    const key = account?.key.trim() ?? ''
    const text = account && key !== '' ? JSON.stringify({ ...account, key }) : null
    await writeMeta(ALIAS, text === null ? null : await seal(opened.root, text, 'local', ALIAS))
  }

  attach(id: string, picked: Picked): Promise<Item> {
    return this.serial(async () => {
      const held = this.held()
      const item = this.item(id)
      const box = held.items.get(id)
      if (!box) throw new Error('pass: no such item')
      const attachment = await (await files()).keptAttachment(deviceRows, box.key, id, picked)
      this.stillHeld(held)
      const attachments = [...item.attachments, attachment]
      const envelope = { ...envelopeOf(item), attachments, modified: Date.now() }
      const [made] = await this.put([{ vault: item.vault, id, envelope }])
      if (!made) throw new Error('pass: the item was not written')
      return made
    })
  }

  detach(id: string, file: string): Promise<Item> {
    return this.serial(async () => {
      const item = this.item(id)
      const attachments = item.attachments.filter((one) => one.id !== file)
      const envelope = { ...envelopeOf(item), attachments, modified: Date.now() }
      const [made] = await this.put([{ vault: item.vault, id, envelope }])
      if (!made) throw new Error('pass: the item was not written')
      await (await files()).forgottenAttachment(deviceRows, item.vault, id, file)
      return made
    })
  }

  async fileBytes(id: string, file: string): Promise<Uint8Array<ArrayBuffer>> {
    const item = this.item(id)
    const attachment = item.attachments.find((one) => one.id === file)
    const box = this.held().items.get(id)
    if (!attachment || !box) throw new Error('pass: no such file')
    return await (await files()).openedAttachment(box.key, item, attachment, this.fileSource)
  }

  createVault(meta: Partial<VaultMeta>): Promise<Vault> {
    return this.serial(() => this.makeVault(meta))
  }

  updateVault(id: string, meta: Partial<VaultMeta>): Promise<void> {
    return this.serial(() => this.changeVault(id, meta))
  }

  deleteVault(id: string): Promise<void> {
    return this.serial(async () => {
      const held = this.held()
      const box = this.heldVault(id)
      if (held.vaults.size <= 1) throw new Error('pass: the last vault cannot be deleted')
      const at = Date.now()
      const inside = [...held.items.values()].filter((one) => one.row.vault === id)
      const row: VaultRow = { ...box.row, rev: box.row.rev + 1, pending: true, deleted: true }
      await write({
        vaults: [row],
        items: inside.map((one) => tombstoneOf(one.row, at)),
        dropVersions: inside.map((one) => one.row),
      })
      held.vaults.delete(id)
      for (const one of inside) held.items.delete(one.row.id)
      this.vaults = this.vaults.filter((vault) => vault.id !== id)
      this.items = this.items.filter((item) => item.vault !== id)
      if (this.settings.defaultVault === id) this.setSetting('defaultVault', null)
    })
  }

  moveAll(from: string, to: string): Promise<void> {
    const ids = this.items.filter((item) => item.vault === from).map((item) => item.id)
    return this.move(ids, to, null)
  }

  create(vault: string, content: Content, folder: string | null = null): Promise<Item> {
    return this.serial(async () => {
      const envelope = { ...newEnvelope(content, Date.now()), folder }
      const [made] = await this.put([{ vault, id: newId(), envelope, fresh: true }])
      if (!made) throw new Error('pass: the item was not written')
      return made
    })
  }

  update(id: string, content: Content): Promise<Item> {
    return this.change(id, (envelope) => ({ ...envelope, content, modified: Date.now() }))
  }

  duplicate(id: string): Promise<Item> {
    const item = this.item(id)
    const content = { ...item.content, title: t('Copy of {title}', { title: item.content.title }) }
    return this.create(item.vault, content, item.folder)
  }

  async trash(ids: string[]): Promise<void> {
    const at = Date.now()
    const trashed = await this.changeAll(ids, (envelope) =>
      envelope.trashed === null ? { ...envelope, trashed: at } : null,
    )
    this.aliasesStopped = import('./alias-make')
      .then(({ stoppedAliases }) => stoppedAliases(this, trashed))
      .catch(() => undefined)
  }

  async restore(ids: string[]): Promise<void> {
    await this.changeAll(ids, (envelope) =>
      envelope.trashed === null ? null : { ...envelope, trashed: null },
    )
  }

  remove(ids: string[]): Promise<void> {
    return this.serial(async () => {
      const held = this.held()
      const gone = ids.flatMap((id) => held.items.get(id) ?? [])
      if (!gone.length) return
      const at = Date.now()
      await write({
        items: gone.map((one) => tombstoneOf(one.row, at)),
        dropVersions: gone.map((one) => one.row),
      })
      for (const one of gone) held.items.delete(one.row.id)
      await (
        await files()
      ).forgottenItemFiles(
        deviceRows,
        gone.map((one) => one.row.id),
      )
      this.items = without(
        this.items,
        gone.map((one) => one.row.id),
      )
    })
  }

  emptyTrash(): Promise<void> {
    return this.remove(this.items.filter((item) => item.trashed !== null).map((item) => item.id))
  }

  move(ids: string[], vault: string, folder: string | null = null): Promise<void> {
    return this.serial(async () => {
      this.heldVault(vault)
      const puts = ids.flatMap((id) => {
        const item = this.items.find((one) => one.id === id)
        if (!item || (item.vault === vault && item.folder === folder)) return []
        return [{ vault, id, envelope: { ...envelopeOf(item), folder } }]
      })
      await this.put(puts)
    })
  }

  async pin(id: string, on: boolean): Promise<void> {
    await this.changeAll([id], (envelope) =>
      envelope.pinned === on ? null : { ...envelope, pinned: on },
    )
  }

  async monitor(id: string, on: boolean): Promise<void> {
    await this.changeAll([id], (envelope) =>
      envelope.monitored === on ? null : { ...envelope, monitored: on },
    )
  }

  async used(id: string): Promise<void> {
    const at = Date.now()
    await this.changeAll([id], (envelope) => ({ ...envelope, used: at }))
  }

  async history(id: string): Promise<Item[]> {
    const item = this.item(id)
    return await openVersions(this.heldVault(item.vault), item.vault, id)
  }

  async restoreVersion(id: string, rev: number): Promise<Item> {
    const version = (await this.history(id)).find((one) => one.rev === rev)
    if (!version) throw new Error('pass: no such version')
    return await this.update(id, version.content)
  }

  clearHistory(id: string): Promise<void> {
    return this.serial(async () => {
      const item = this.item(id)
      await write({ dropVersions: [{ vault: item.vault, id }] })
    })
  }

  setSetting<K extends keyof PassSettings>(key: K, value: PassSettings[K]): void {
    this.settings = { ...this.settings, [key]: value }
    keepSettings(this.settings)
  }

  async copy(text: string): Promise<void> {
    await copySecret(text, this.settings.clipboardClear)
  }

  importItems(imported: Imported, into: string): Promise<{ added: number }> {
    return this.serial(async () => {
      const now = Date.now()
      const puts: Put[] = []
      for (const one of imported.vaults) {
        if (!one.items.length) continue
        const vault = into === 'new' ? (await this.makeVault({ name: one.name })).id : into
        puts.push(...(await this.importedInto(vault, one, now)))
      }
      await this.put(puts)
      return { added: puts.length }
    })
  }

  async exportAll(
    password: string,
    format: 'sealed' | 'json' | 'csv',
    passphrase?: string,
  ): Promise<{ name: string; text: string } | null> {
    if (!(await this.confirmPassword(password))) return null
    const name = exportName(format)
    const own = ownVaults(this.vaults, this.items)
    if (format === 'csv') {
      return { name, text: exportCsv(own.flatMap(({ items }) => items).map(envelopeOf)) }
    }
    const json = exportJson(
      own.map(({ vault, items }) => ({ meta: metaOf(vault), items: items.map(envelopeOf) })),
    )
    if (format === 'json') return { name, text: json }
    if (!passphrase) throw new Error('pass: a sealed export needs a passphrase')
    return { name, text: await sealExport(json, passphrase, kdf) }
  }

  matching(url: string): Item[] {
    return activeLogins(this.items)
      .map((item) => ({
        item,
        best: item.content.websites
          .map((website) => rank(website, url))
          .reduce((high, one) => Math.max(high, one), 0),
      }))
      .filter((one) => one.best > 0)
      .sort((a, b) => b.best - a.best || (b.item.used ?? 0) - (a.item.used ?? 0))
      .map((one) => one.item)
  }

  async members(vault: string): Promise<Member[]> {
    return await (await signed()).api.members(vault)
  }

  async person(email: string): Promise<Person> {
    return await personFor(await this.sharing(), email)
  }

  async memberPerson(member: Member): Promise<Person> {
    return await memberPerson(await this.sharing(), member)
  }

  async codesMatch(person: Person): Promise<Person> {
    return await confirmedPerson(deviceRows, person)
  }

  async invite(vault: string, person: Person, role: InvitedRole): Promise<MemberState> {
    const state = await invitedState(await this.sharing(), vault, person, role)
    this.changed()
    return state
  }

  async confirmMember(vault: string, person: Person): Promise<void> {
    await confirmedMember(await this.sharing(), vault, person)
    this.changed()
  }

  async setRole(vault: string, email: string, role: InvitedRole): Promise<void> {
    await roleGiven(await this.sharing(), vault, email, role)
    this.changed()
  }

  removeMember(vault: string, email: string): Promise<void> {
    return this.serial(async () => {
      await removedMember(await this.sharing(), vault, email)
    })
  }

  async leave(vault: string): Promise<void> {
    if (this.vaults.find((one) => one.id === vault)?.role === 'owner') {
      throw new Error('pass: the owner hands the vault on before leaving it')
    }
    const { api, email } = await signed()
    await api.removeMember(vault, email)
    this.changed()
  }

  async transfer(vault: string, email: string): Promise<void> {
    await handedOn(await this.sharing(), vault, email)
    this.changed()
  }

  async acceptInvite(invite: Invite): Promise<void> {
    await acceptedInvite(await this.sharing(), invite)
    this.changed()
  }

  async declineInvite(vault: string): Promise<void> {
    await (await signed()).api.decline(vault)
    this.changed()
  }

  async inviterCode(invite: Invite): Promise<string | null> {
    return invite.fromKey ? await codeOf(invite.fromKey) : null
  }

  async deletedElsewhere(): Promise<Item[]> {
    const held = this.held()
    const after = Date.now() - KEPT_AFTER_DELETE
    const gone = (await readItems()).filter(
      (row) => row.deleted && !row.pending && row.at >= after && held.vaults.has(row.vault),
    )
    const found: Item[] = []
    for (const row of gone) {
      const box = held.vaults.get(row.vault)
      const [last] = box ? await openVersions(box, row.vault, row.id) : []
      if (last) found.push(last)
    }
    return found
  }

  restoreDeleted(item: Item): Promise<Item> {
    return this.serial(async () => {
      const envelope = {
        ...envelopeOf(item),
        attachments: [],
        trashed: null,
        modified: Date.now(),
      }
      const [made] = await this.put([{ vault: item.vault, id: newId(), envelope, fresh: true }])
      if (!made) throw new Error('pass: the item was not written')
      await write({ dropVersions: [{ vault: item.vault, id: item.id }] })
      return made
    })
  }

  async inviteMeta(invite: Invite): Promise<VaultMeta | null> {
    return await invitedMeta(this.held(), invite)
  }

  onLocalChange(run: () => void): () => void {
    this.listeners.add(run)
    return () => this.listeners.delete(run)
  }

  exclusive<T>(run: (held: Held | null) => Promise<T>): Promise<T> {
    return this.queued(() => run(unlocked.get(this) ?? null))
  }

  shown(update: Shown): void {
    if (this.state !== 'open') return
    const next = shownAfter(this.vaults, this.items, update)
    this.vaults = next.vaults
    this.items = next.items
  }

  tookKeyring(row: KeyringRow): void {
    this.keyring = row
    if (this.state === 'new') this.state = 'locked'
  }

  adoptAccountPass(password: string): Promise<boolean> {
    return this.serial(async () => {
      const account = await accountKeyringOf(deviceRows)
      if (!account) return false
      const opened = await this.openedByPassword(account.keyring, password)
      if (!opened) return false
      const local = await this.localOpened(password)
      if (!local) return false
      const before = { vaults: await readVaults(), items: await readItems() }
      const name = t('From this device')
      await write(await adoptedChange(before, local.items, local.vaults, opened, name))
      const row: KeyringRow = { keyring: account.keyring, rev: account.rev, pending: false }
      await writeKeyring(row)
      await keepAdopted(deviceRows, account.rev)
      await this.movedSealed(local.opened, opened)
      await this.forgetDevice()
      this.keyring = row
      this.conflict = false
      const all = await openAll(opened)
      this.hold(all.held, all.vaults, all.items)
      return true
    })
  }

  private async openedByPassword(keyring: Keyring, password: string): Promise<Opened | null> {
    try {
      return await openWithPassword(keyring, password)
    } catch (error) {
      if (error instanceof WrongSecret) return null
      throw error
    }
  }

  private async localOpened(
    password: string,
  ): Promise<{ opened: Opened; vaults: Vault[]; items: Item[] } | null> {
    const held = unlocked.get(this)
    if (held) return { opened: held.opened, vaults: this.vaults, items: this.items }
    const keyring = this.keyring?.keyring
    const opened = keyring ? await this.openedByPassword(keyring, password) : null
    if (!opened) return null
    const all = await openAll(opened)
    return { opened, vaults: all.vaults, items: all.items }
  }

  private async movedSealed(from: Opened, to: Opened): Promise<void> {
    for (const name of SEALED_HERE) {
      const sealed = await readMeta(name)
      if (typeof sealed !== 'string') continue
      try {
        const text = await openText(from.root, sealed, 'local', name)
        await writeMeta(name, await seal(to.root, text, 'local', name))
      } catch {
        await writeMeta(name, null)
      }
    }
  }

  private async sharing(): Promise<Sharing> {
    const held = this.held()
    const { api, email } = await signed()
    return { api, held, rows: deviceRows, email: emailOf(email), versions: readVersions }
  }

  private async keptKeyring(
    keyring: Keyring,
    found: Opened,
    password: string | undefined,
  ): Promise<Opened> {
    const signing = await withSigner(keyring, found)
    const resealed =
      password !== undefined && isOldPasswordSeal(signing.keyring)
        ? await changePassword(
            signing.keyring,
            signing.opened,
            password,
            kdfParamsIn(keyring.password) ?? kdf,
          )
        : signing.keyring
    const row = this.keyring
    if (row && resealed !== keyring) await this.keepKeyring(row, resealed)
    return signing.opened
  }

  private serial<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queued(run)
    void next.then(
      () => this.changed(),
      () => undefined,
    )
    return next
  }

  private queued<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run, run)
    this.queue = next.catch(() => undefined)
    return next
  }

  private changed(): void {
    for (const run of this.listeners) run()
  }

  private held(): Held {
    const held = unlocked.get(this)
    if (!held) throw new Error('pass: Pass is locked')
    return held
  }

  private heldVault(id: string): HeldVault {
    const box = this.held().vaults.get(id)
    if (!box) throw new Error('pass: no such vault')
    return box
  }

  private item(id: string): Item {
    const item = this.items.find((one) => one.id === id)
    if (!item) throw new Error('pass: no such item')
    return item
  }

  private stillHeld(held: Held): void {
    if (unlocked.get(this) !== held) throw new Error('pass: Pass was locked')
  }

  private hold(held: Held, vaults: Vault[], items: Item[]): void {
    unlocked.set(this, held)
    this.vaults = vaults
    this.items = items
    this.state = 'open'
    this.relock.watch()
  }

  private async openedBy(keyring: Keyring, way: Unlock): Promise<Opened | null> {
    if (way.password !== undefined) return await openWithPassword(keyring, way.password)
    if (way.recovery !== undefined) return await openWithRecovery(keyring, way.recovery)
    if (way.pin !== undefined) return await this.openedByPin(keyring, way.pin)
    if (way.device) return await this.openedByDevice(keyring)
    return null
  }

  private openedByPin(keyring: Keyring, pin: string): Promise<Opened | null> {
    const next = this.unlocking.then(() => this.openedByOnePin(keyring, pin))
    this.unlocking = next.catch(() => undefined)
    return next
  }

  private async openedByOnePin(keyring: Keyring, pin: string): Promise<Opened | null> {
    if (this.device?.seal.way !== 'pin') return null
    const secret = await deviceSecret()
    if (!secret) return null
    const device = await spendPinTry()
    this.sawDevice(device)
    if (device?.seal.way !== 'pin') return null
    if (device.seal.tries > PIN_TRIES) {
      await this.forgetPin()
      return null
    }
    let root: Uint8Array<ArrayBuffer>
    try {
      root = await openForDevice(device.seal, secret, pin, device.kdf)
    } catch (error) {
      if (!(error instanceof WrongSecret)) throw error
      if (device.seal.tries >= PIN_TRIES) await this.forgetPin()
      return null
    }
    this.sawDevice(await clearPinTries(device.seal.sealed))
    return await openedWith(keyring, root)
  }

  private async openedByDevice(keyring: Keyring): Promise<Opened | null> {
    const device = this.device
    if (device?.seal.way !== 'device') return null
    if (!(await deviceSays(t('Unlock Pass')))) return null
    const secret = await deviceSecret()
    if (!secret) return null
    return await openedWith(
      keyring,
      await openForDevice(device.seal, secret, undefined, device.kdf),
    )
  }

  private async forgetPin(): Promise<void> {
    await this.forgetDevice()
    this.pinTries = 0
  }

  private async forgetDevice(): Promise<void> {
    await this.keepDevice(null)
    if (this.canPin) await forgetKey(DEVICE_SECRET, true).catch(() => undefined)
  }

  private async keepDevice(row: DeviceRow | null): Promise<void> {
    await writeDevice(row)
    this.sawDevice(row)
  }

  private sawDevice(row: DeviceRow | null): void {
    this.device = row
    this.setSetting('lock', row?.seal.way ?? 'password')
    this.pinTries = PIN_TRIES - (row?.seal.way === 'pin' ? Math.min(row.seal.tries, PIN_TRIES) : 0)
  }

  private async keepKeyring(was: KeyringRow, keyring: Keyring): Promise<void> {
    const row: KeyringRow = { keyring, rev: was.rev + 1, pending: true }
    await writeKeyring(row)
    this.keyring = row
    this.changed()
  }

  private async makeVault(given: Partial<VaultMeta>): Promise<Vault> {
    const held = this.held()
    const meta = vaultMetaIn({ ...given, v: 1 })
    if (!meta) throw new Error('pass: unreadable vault')
    const id = newId()
    const key = newKey()
    const row: VaultRow = await madeVaultRow(held.opened, id, key, meta)
    this.stillHeld(held)
    await write({ vaults: [row] })
    held.vaults.set(id, { key, row })
    const vault = vaultOf(row, meta)
    this.vaults = [...this.vaults, vault]
    return vault
  }

  private async changeVault(id: string, given: Partial<VaultMeta>): Promise<void> {
    const held = this.held()
    const box = this.heldVault(id)
    const current = this.vaults.find((vault) => vault.id === id)
    if (!current) throw new Error('pass: no such vault')
    const meta = vaultMetaIn({ ...metaOf(current), ...given, v: 1 })
    if (!meta) throw new Error('pass: unreadable vault')
    const row: VaultRow = {
      ...box.row,
      rev: box.row.rev + 1,
      meta: await sealVault(box.key, id, meta),
      pending: true,
    }
    this.stillHeld(held)
    await write({ vaults: [row] })
    held.vaults.set(id, { key: box.key, row })
    const vault = vaultOf(row, meta)
    this.vaults = this.vaults.map((one) => (one.id === id ? vault : one))
  }

  private async importedInto(vault: string, imported: ImportedVault, now: number): Promise<Put[]> {
    const current = this.vaults.find((one) => one.id === vault)
    if (!current) throw new Error('pass: no such vault')
    const folders = [...current.folders]
    const puts = imported.items.map((one) => {
      const created = one.created ?? now
      const envelope: Envelope = {
        ...newEnvelope(one.content, created),
        modified: one.modified ?? created,
        pinned: one.pinned,
        trashed: one.trashed ? now : null,
        folder: folderFor(folders, one.folder),
      }
      return { vault, id: newId(), envelope, fresh: true as const }
    })
    if (folders.length !== current.folders.length) await this.changeVault(vault, { folders })
    return puts
  }

  private change(id: string, next: (envelope: Envelope) => Envelope): Promise<Item> {
    return this.serial(async () => {
      const item = this.item(id)
      const [made] = await this.put([{ vault: item.vault, id, envelope: next(envelopeOf(item)) }])
      if (!made) throw new Error('pass: the item was not written')
      return made
    })
  }

  private changeAll(ids: string[], next: (envelope: Envelope) => Envelope | null): Promise<Item[]> {
    return this.serial(async () => {
      const puts = ids.flatMap((id) => {
        const item = this.items.find((one) => one.id === id)
        const envelope = item ? next(envelopeOf(item)) : null
        return item && envelope ? [{ vault: item.vault, id, envelope }] : []
      })
      return await this.put(puts)
    })
  }

  private async put(puts: readonly Put[]): Promise<Item[]> {
    if (!puts.length) return []
    const held = this.held()
    const sealed = await sealPuts(held, puts, this.items)
    this.stillHeld(held)
    await write(sealed.change)
    for (const one of sealed.held) held.items.set(one.row.id, one)
    this.items = withMade(this.items, sealed.made)
    return sealed.made
  }
}

export const pass = new PassStore()
