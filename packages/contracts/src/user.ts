import type { GuestId, SpaceId, UserId } from './ids'

export interface Avatar {
  readonly s: string
  readonly l: string
}

export interface Status {
  readonly emoji: string
  readonly text: string
  readonly until: number | null
  readonly quiet: boolean
}

export type Presence = 'active' | 'away' | 'offline'

export interface User {
  readonly id: UserId
  readonly email: string
  readonly name: string | null
  readonly created_at: number
}

export interface Guest {
  readonly id: GuestId
  readonly name: string
  readonly email: string | null
  readonly created_at: number
}

export type Whoever =
  { readonly kind: 'user'; readonly user: User } | { readonly kind: 'guest'; readonly guest: Guest }

export interface Account {
  readonly id: UserId
  readonly email: string
  readonly name: string | null
  readonly syncVersion?: number
  readonly avatar?: Avatar | null
  readonly pronouns?: string | null
  readonly bio?: string | null
  readonly status?: Status | null
  readonly zone?: string | null
  readonly hidden?: boolean
  readonly nicks?: Readonly<Record<string, string>>
}

export type SpaceRole = 'owner' | 'write' | 'read'

export type GivenRole = 'write' | 'read'

export const SPACE_ROLES: readonly SpaceRole[] = ['owner', 'write', 'read']

export function isSpaceRole(value: unknown): value is SpaceRole {
  return typeof value === 'string' && (SPACE_ROLES as readonly string[]).includes(value)
}

export interface Member {
  readonly id?: UserId | null
  readonly avatar?: Avatar | null
  readonly email: string | null
  readonly guest: GuestId | null
  readonly name: string | null
  readonly role: GivenRole
  readonly pending: boolean
}

export interface Space {
  readonly id: SpaceId
  readonly name: string
  readonly root: string
}

export interface SigningOutPort {
  signOut(): Promise<void>
}

export interface AccountPorts {
  readonly 'account.signingOut': SigningOutPort
}
