import type { Role } from '@orden/pass/types'
import { isSignPub } from '@orden/pass/shape'
import type {
  Accepted,
  KeyProof,
  LinkRow,
  Member,
  MemberState,
  Pin,
  VaultRow,
} from '@orden/pass/wire'
import {
  isCount,
  isSealed,
  linkRowIn,
  memberIn,
  MEMBER_STATES,
  MOST_KEY_BYTES,
  vaultRowIn,
} from '@orden/pass/wire'
import type { PersonKey } from './people'
import type { Method, PassCall } from './sync'
import { PassApi } from './sync'

const PREFIX = '/v2/pass'

export interface Resealed {
  key: string
  body: string
  rev: number
}

export interface Rotation {
  rev: number
  keyVersion: number
  meta: string
  members: Record<string, string>
  items: Record<string, Resealed>
  proof: KeyProof | null
}

export interface Invited {
  email: string
  role: Role
  key: string | null
  keyVersion: number
  vouch: string | null
  pin: Pin | null
}

export interface NewLink {
  id: string
  vault: string
  item: string
  body: string
  expires: number
  views: number | null
}

export interface Refusal {
  status: number
  error: string
  body: unknown
}

type Fields = Record<string, unknown>

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fieldsOf(value: unknown): Fields {
  if (!isFields(value)) throw new Error('pass: unreadable answer')
  return value
}

function listOf<T>(value: unknown, each: (one: unknown) => T | null): T[] {
  if (!Array.isArray(value)) throw new Error('pass: unreadable answer')
  return value.map((one) => {
    const read = each(one)
    if (read === null) throw new Error('pass: unreadable answer')
    return read
  })
}

function isState(value: unknown): value is MemberState {
  return typeof value === 'string' && (MEMBER_STATES as readonly string[]).includes(value)
}

export function refusalOf(error: unknown): Refusal | null {
  if (!(error instanceof Error)) return null
  const status = (error as { status?: unknown }).status
  if (typeof status !== 'number') return null
  const body = (error as { body?: unknown }).body ?? null
  const said = isFields(body) && typeof body.error === 'string' ? body.error : ''
  return { status, error: said, body }
}

const part = encodeURIComponent

export class ShareApi extends PassApi {
  constructor(
    private readonly reach: PassCall,
    private readonly sender: () => string | null = () => null,
  ) {
    super(reach, sender)
  }

  async personKey(email: string): Promise<PersonKey | null> {
    const { pub, signPub } = fieldsOf(await this.ask(`/people/key?email=${part(email)}`))
    if (pub === null || pub === undefined) return null
    if (!isSealed(pub, MOST_KEY_BYTES)) throw new Error('pass: unreadable answer')
    if (!(signPub === null || signPub === undefined || isSignPub(signPub))) {
      throw new Error('pass: unreadable answer')
    }
    return { pub, signPub: signPub ?? null }
  }

  async members(vault: string): Promise<Member[]> {
    return listOf(fieldsOf(await this.ask(`/vaults/${part(vault)}/members`)).members, memberIn)
  }

  async invite(vault: string, sent: Invited): Promise<MemberState> {
    const { state } = fieldsOf(await this.ask(`/vaults/${part(vault)}/invites`, 'POST', sent))
    if (!isState(state)) throw new Error('pass: unreadable answer')
    return state
  }

  async giveKey(vault: string, email: string, key: string, keyVersion: number): Promise<void> {
    const path = `/vaults/${part(vault)}/members/${part(email)}/key`
    await this.ask(path, 'PUT', { key, keyVersion })
  }

  async accept(vault: string, accepted: Accepted | null = null): Promise<VaultRow | null> {
    const answer = await this.ask(`/invites/${part(vault)}/accept`, 'POST', { accepted })
    return vaultRowIn(fieldsOf(answer).vault)
  }

  async trust(
    vault: string,
    sent: { accepted?: Accepted; proof?: KeyProof; keyVersion?: number },
  ): Promise<void> {
    await this.ask(`/vaults/${part(vault)}/trust`, 'PUT', sent)
  }

  async decline(vault: string): Promise<void> {
    await this.ask(`/invites/${part(vault)}/decline`, 'POST')
  }

  async setRole(
    vault: string,
    email: string,
    role: Role,
    vouch: string | null = null,
  ): Promise<void> {
    await this.ask(`/vaults/${part(vault)}/members/${part(email)}`, 'PUT', { role, vouch })
  }

  async removeMember(vault: string, email: string): Promise<void> {
    await this.ask(`/vaults/${part(vault)}/members/${part(email)}`, 'DELETE')
  }

  async setOwner(vault: string, email: string, handover: string | null = null): Promise<void> {
    await this.ask(`/vaults/${part(vault)}/owner`, 'PUT', { email, handover })
  }

  async rotate(vault: string, sent: Rotation): Promise<{ rev: number; keyVersion: number }> {
    const { rev, keyVersion } = fieldsOf(
      await this.ask(`/vaults/${part(vault)}/rotate`, 'POST', sent),
    )
    if (!isCount(rev) || !isCount(keyVersion)) throw new Error('pass: unreadable answer')
    return { rev, keyVersion }
  }

  async createLink(sent: NewLink): Promise<LinkRow> {
    const link = linkRowIn(fieldsOf(await this.ask('/links', 'POST', sent)).link)
    if (link === null) throw new Error('pass: unreadable answer')
    return link
  }

  async links(): Promise<LinkRow[]> {
    return listOf(fieldsOf(await this.ask('/links')).links, linkRowIn)
  }

  async removeLink(id: string): Promise<void> {
    await this.ask(`/links/${part(id)}`, 'DELETE')
  }

  async removeExpired(): Promise<number> {
    const { deleted } = fieldsOf(await this.ask('/links?expired=1', 'DELETE'))
    return isCount(deleted) ? deleted : 0
  }

  private async ask(path: string, method?: Method, body?: unknown): Promise<unknown> {
    const from = method && method !== 'GET' ? this.sender() : null
    const sent = from ? `${path}${path.includes('?') ? '&' : '?'}from=${part(from)}` : path
    return await this.reach(`${PREFIX}${sent}`, method, body)
  }
}
