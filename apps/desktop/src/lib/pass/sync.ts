import type { Keyring } from '@orden/pass/keys'
import type {
  Accepted,
  Changes,
  ItemPage,
  ItemRow,
  KeyProof,
  KeyringRow,
  VaultRow,
} from '@orden/pass/wire'
import { changesIn, itemPageIn, itemRowIn, keyringRowIn, vaultRowIn } from '@orden/pass/wire'

export type Method = 'GET' | 'PUT' | 'POST' | 'DELETE'

export type PassCall = (path: string, method?: Method, body?: unknown) => Promise<unknown>

export type Fetcher = (request: Request) => Promise<Response>

export const STALE = 'stale'
export const ROTATED = 'the vault has a newer key'
const NO_SUCH_VAULT = 'no such vault'
export const NO_SUCH_ITEM = 'no such item'
const NOT_YOUR_ROLE = 'your role in this vault does not allow that'
const TAKEN = 'that id is taken'

const PREFIX = '/v2/pass'

export class Refused extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body: unknown = null,
  ) {
    super(message)
  }
}

export class NoPass extends Error {
  constructor() {
    super('pass: this account keeps no Pass')
  }
}

export interface Landed {
  rev: number
  at: number
}

export type Answer<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string; current: unknown; keyVersion: number | null }

interface Said {
  status: number
  body: unknown
}

function isFields(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const FULL = 507

function saidOf(error: unknown): Said | null {
  if (!(error instanceof Error)) return null
  const status = (error as { status?: unknown }).status
  if (typeof status !== 'number') return null
  return { status, body: (error as { body?: unknown }).body ?? null }
}

function errorOf(body: unknown): string {
  return isFields(body) && typeof body.error === 'string' ? body.error : ''
}

const KNOWN = new Set([
  STALE,
  ROTATED,
  NO_SUCH_VAULT,
  NO_SUCH_ITEM,
  NOT_YOUR_ROLE,
  TAKEN,
  'no such member',
  'that is as many vaults as one account holds',
  'that is as many items as one vault holds',
  'not a vault',
  'not an item',
  'not a keyring',
  'a keyring keeps its public key',
  'a keyring is newer than the one it replaces',
  'the owner cannot leave or be changed - hand the vault on first',
])

function noPass(said: Said): boolean {
  return said.status === 404 && !KNOWN.has(errorOf(said.body))
}

function landedIn(value: unknown): Landed {
  if (!isFields(value)) throw new Error('pass: unreadable answer')
  const at = typeof value.at === 'number' ? value.at : Date.now()
  if (typeof value.rev === 'number') return { rev: value.rev, at }
  if (value.ok === true) return { rev: 0, at }
  throw new Error('pass: unreadable answer')
}

function withFrom(path: string, from: string | null): string {
  if (!from) return path
  return `${path}${path.includes('?') ? '&' : '?'}from=${encodeURIComponent(from)}`
}

export function fetchCall(fetcher: Fetcher, base: string, token: string): PassCall {
  return async (path, method, body) => {
    const headers: Record<string, string> = { authorization: `Bearer ${token}` }
    if (body !== undefined) headers['content-type'] = 'application/json'
    const response = await fetcher(
      new Request(`${base}${path}`, {
        method: method ?? (body === undefined ? 'GET' : 'POST'),
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    )
    const text = await response.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = null
    }
    if (!response.ok) {
      const said = errorOf(parsed) || `request failed (${String(response.status)})`
      throw new Refused(response.status, said, parsed)
    }
    return parsed
  }
}

export class PassApi {
  constructor(
    private readonly call: PassCall,
    private readonly from: () => string | null = () => null,
  ) {}

  async changes(since: number): Promise<Changes> {
    const read = changesIn(await this.asked(`/changes?since=${String(since)}`))
    if (!read) throw new Error('pass: unreadable changes')
    return read
  }

  async vaultItems(vault: string, after: string): Promise<ItemPage> {
    const path = `/vaults/${encodeURIComponent(vault)}/items?after=${encodeURIComponent(after)}`
    const read = itemPageIn(await this.asked(path))
    if (!read) throw new Error('pass: unreadable items')
    return read
  }

  async allVaultItems(vault: string): Promise<ItemRow[]> {
    const all: ItemRow[] = []
    for (;;) {
      const page = await this.vaultItems(vault, all[all.length - 1]?.id ?? '')
      all.push(...page.items)
      if (!page.more || !page.items.length) return all
    }
  }

  putKeyring(keyring: Keyring, rev: number): Promise<Answer<Landed>> {
    return this.wrote('/keyring', 'PUT', { keyring, rev })
  }

  putVault(
    id: string,
    sent: {
      rev: number
      meta: string
      key?: string
      keyVersion?: number
      proof?: KeyProof | null
      accepted?: Accepted | null
    },
  ): Promise<Answer<Landed>> {
    return this.wrote(`/vaults/${encodeURIComponent(id)}`, 'PUT', sent)
  }

  deleteVault(id: string): Promise<Answer<Landed>> {
    return this.wrote(`/vaults/${encodeURIComponent(id)}`, 'DELETE')
  }

  leaveVault(id: string, email: string): Promise<Answer<Landed>> {
    const path = `/vaults/${encodeURIComponent(id)}/members/${encodeURIComponent(email)}`
    return this.wrote(path, 'DELETE')
  }

  putItem(
    vault: string,
    id: string,
    sent: { rev: number; key: string; body: string; keyVersion: number; trashed?: boolean },
  ): Promise<Answer<Landed>> {
    return this.wrote(`/items/${encodeURIComponent(vault)}/${encodeURIComponent(id)}`, 'PUT', sent)
  }

  deleteItem(vault: string, id: string, rev: number): Promise<Answer<Landed>> {
    const path = `/items/${encodeURIComponent(vault)}/${encodeURIComponent(id)}?rev=${String(rev)}`
    return this.wrote(path, 'DELETE')
  }

  moveItem(
    vault: string,
    id: string,
    sent: { to: string; rev: number; key: string; body: string; keyVersion: number },
  ): Promise<Answer<Landed>> {
    const path = `/items/${encodeURIComponent(vault)}/${encodeURIComponent(id)}/move`
    return this.wrote(path, 'POST', sent)
  }

  private async asked(path: string, method?: Method, body?: unknown): Promise<unknown> {
    try {
      return await this.call(`${PREFIX}${path}`, method, body)
    } catch (error) {
      const said = saidOf(error)
      if (said && noPass(said)) throw new NoPass()
      throw error
    }
  }

  private async wrote(path: string, method: Method, body?: unknown): Promise<Answer<Landed>> {
    try {
      return {
        ok: true,
        value: landedIn(await this.asked(withFrom(path, this.from()), method, body)),
      }
    } catch (error) {
      const said = saidOf(error)
      if (!said || (said.status >= 500 && said.status !== FULL)) throw error
      const raw = isFields(said.body) ? said.body : {}
      return {
        ok: false,
        status: said.status,
        error: errorOf(said.body),
        current: raw.current ?? null,
        keyVersion: typeof raw.keyVersion === 'number' ? raw.keyVersion : null,
      }
    }
  }
}

export function currentItem(answer: { current: unknown }): ItemRow | null {
  return itemRowIn(answer.current)
}

export function currentVault(answer: { current: unknown }): VaultRow | null {
  return vaultRowIn(answer.current)
}

export function currentKeyring(answer: { current: unknown }): KeyringRow | null {
  return keyringRowIn(answer.current)
}
