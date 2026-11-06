import { key } from '../i18n.svelte'
import { log } from '../log'
import { keep, stored, storedText } from '../stored'
import {
  type Account,
  type Accounts,
  accountsIn,
  accountsOf,
  accountsText,
  activated,
  activeOf,
  actives,
  added,
  defaulted,
  including,
  isActive,
  merged,
  migrated,
  NONE,
  removed,
  resolve,
  updated,
  used,
  type Vendor,
  vendors,
} from './accounts'
import { accountName, vendorName } from './account-words'
import { COPY, hearChanges, readKept, STALE, writeKept } from './accounts-file'
import { transcribersAre } from './hears'
import { accountsAre } from './switching'
import { type Provider, type ProviderKind, transcribes, usable } from './providers'
import { stuck } from './stuck'

const EARLIER = 'nib:ai'

const MOVED = 'nib:ai-moved'

const TRIES = 3

export type Feature = 'ask' | 'block' | 'rewrite'

export const FEATURES: readonly { id: Feature; label: string }[] = [
  { id: 'ask', label: key('Ask') },
  { id: 'block', label: key('AI block') },
  { id: 'rewrite', label: key('Rewrite') },
]

function isStale(error: unknown): boolean {
  return error === STALE || (error instanceof Error && error.message === STALE)
}

function parsedText(text: string | null): Accounts | null {
  if (text === null) return null
  try {
    return accountsIn(JSON.parse(text) as unknown)
  } catch {
    return null
  }
}

class Ai {
  state = $state<Accounts>(NONE)

  readonly accounts = $derived<Account[]>(this.state.accounts)

  readonly providers = $derived<Provider[]>(actives(this.state))

  readonly vendors = $derived<Vendor[]>(vendors(this.state))

  readonly uses = $derived<Record<string, Vendor>>(this.state.uses)

  readonly defaultVendor = $derived<Vendor>(this.state.defaultVendor)

  readonly chosen = $derived<Provider | null>(
    [activeOf(this.state, this.state.defaultVendor), ...actives(this.state)].find(
      (one): one is Account => !!one && usable(one),
    ) ?? null,
  )

  readonly ready = $derived(this.chosen !== null)

  readonly transcriber = $derived<Provider | null>(
    [activeOf(this.state, this.state.defaultVendor), ...actives(this.state)].find(
      (one): one is Account => !!one && transcribes(one),
    ) ?? null,
  )

  private stamp = ''
  private synced: Promise<void> | null = null
  private writing: Promise<void> = Promise.resolve()
  private local = new Set<() => void>()

  onLocalChange(listener: () => void): () => void {
    this.local.add(listener)
    return () => this.local.delete(listener)
  }

  adopt(state: Accounts): void {
    this.changed(() => state, true)
  }

  provider(id: string): Provider | null {
    return resolve(this.state, id)
  }

  accountsOf(vendor: Vendor): Account[] {
    return accountsOf(this.state, vendor)
  }

  isActive(id: string): boolean {
    return isActive(this.state, id)
  }

  providerFor(feature: Feature): Provider | null {
    const picked = this.state.uses[feature]
    const found = picked ? resolve(this.state, picked) : null
    return found && usable(found) ? found : this.chosen
  }

  restore() {
    const copy = parsedText(storedText(COPY))
    this.state = copy ?? migrated(stored(EARLIER))
    this.synced ??= this.sync()
  }

  private async sync(): Promise<void> {
    try {
      await this.reread(true)
      void hearChanges(() => void this.reread(false))
    } catch (error) {
      log('warn', `ai accounts: could not read the kept accounts: ${String(error)}`)
    }
  }

  private async reread(first: boolean): Promise<void> {
    const kept = await readKept()
    this.stamp = kept.stamp
    const read = parsedText(kept.text)
    if (read) this.took(read)
    if (!first) return

    const earlier = storedText(MOVED) === null ? migrated(stored(EARLIER)) : NONE
    const brought = read ? merged(read, earlier) : this.state
    if (!read || brought !== read) await this.change((state) => merged(state, brought))
    keep(MOVED, '1')
  }

  private took(state: Accounts) {
    this.state = state
    keep(COPY, accountsText(state))
    if (!__EVEN_PLUGIN__ && state.accounts.some(stuck)) {
      void import('./mend').then(({ mend }) => mend(this, state))
    }
  }

  private async change(make: (state: Accounts) => Accounts): Promise<void> {
    this.took(make(this.state))
    for (let tries = 0; tries < TRIES; tries++) {
      try {
        this.stamp = await writeKept(accountsText(this.state), this.stamp)
        return
      } catch (error) {
        if (!isStale(error)) {
          log('warn', `ai accounts: could not keep the accounts: ${String(error)}`)
          return
        }
        const kept = await readKept()
        this.stamp = kept.stamp
        this.took(make(parsedText(kept.text) ?? NONE))
      }
    }
  }

  private changed(make: (state: Accounts) => Accounts, quiet = false) {
    this.state = make(this.state)
    const before = this.writing
    this.writing = (async () => {
      await this.synced
      await before
      await this.change(make)
    })()
    if (!quiet) for (const one of this.local) one()
  }

  async written(): Promise<void> {
    await this.writing
  }

  use(feature: Feature, id: string) {
    this.changed((state) => used(state, feature, id))
  }

  add(kind: ProviderKind): Account {
    const { account } = added(this.state, kind)
    this.changed((state) => including(state, account))
    return account
  }

  update(id: string, change: Partial<Omit<Account, 'id' | 'kind' | 'own'>>) {
    this.changed((state) => updated(state, id, change))
  }

  remove(id: string) {
    this.changed((state) => removed(state, id))
  }

  activate(id: string) {
    this.changed((state) => activated(state, id))
  }

  setDefault(id: string) {
    this.changed((state) => defaulted(state, id))
  }
}

export const ai = new Ai()

transcribersAre(() => ai.transcriber)

accountsAre(
  () =>
    ai.vendors.flatMap((vendor) => {
      const mine = ai.accountsOf(vendor)
      if (mine.length < 2) return []
      const provider = vendorName(vendor, ai.accounts)
      return mine.map((one) => ({
        id: one.id,
        label: `${provider} · ${accountName(one)}`,
        active: ai.isActive(one.id),
      }))
    }),
  (id) => {
    ai.activate(id)
  },
)

ai.restore()

if (!__EVEN_PLUGIN__) void import('./vault/start.svelte').then((one) => one.startVault())
