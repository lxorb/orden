import { objectIn } from '../body'
import { cleanPersonName } from '../crypto'
import { personName } from '../spaces/share'
import { avatarIn } from './avatar'

export interface Status {
  emoji: string
  text: string
  until: number | null
  quiet: boolean
}

export type Presence = 'active' | 'away' | 'offline'

export interface ProfileRow {
  id: string
  email: string
  name: string | null
  avatar: string | null
  pronouns: string | null
  bio: string | null
  status: string | null
  zone: string | null
  hidden: number
}

export const PROFILE_COLUMNS =
  'u.id, u.email, u.name, u.avatar, u.pronouns, u.bio, u.status, u.zone, u.hidden'

const PRONOUNS_LIMIT = 40
const BIO_LIMIT = 190
const STATUS_LIMIT = 100
const EMOJI_LIMIT = 16
export const NICK_LIMIT = 60
export const AVATAR_BYTES = 100 * 1024

export function statusIn(raw: string | null, now: number): Status | null {
  const held = objectIn(raw)
  if (!held) return null

  const status = statusFrom(held)
  if (!status || (status.until !== null && status.until <= now)) return null
  return status
}

function statusFrom(value: Record<string, unknown>): Status | null {
  const { emoji, text, until, quiet } = value
  if (typeof emoji !== 'string' || emoji.length > EMOJI_LIMIT) return null
  if (typeof text !== 'string' || text.length > STATUS_LIMIT) return null
  if (until !== null && until !== undefined && !Number.isSafeInteger(until)) return null
  if (quiet !== undefined && typeof quiet !== 'boolean') return null

  const words = cleanPersonName(text)
  if (!emoji.trim() && !words && quiet !== true) return null
  return {
    emoji: emoji.trim(),
    text: words,
    until: typeof until === 'number' ? until : null,
    quiet: quiet === true,
  }
}

function isZone(zone: string): boolean {
  if (zone.length > 64) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

export interface ProfileChanges {
  pronouns?: string | null
  bio?: string | null
  status?: Status | null
  zone?: string | null
  hidden?: boolean
}

export function profileChanges(
  fields: Record<string, unknown>,
): { changes: ProfileChanges } | { problem: string } {
  const changes: ProfileChanges = {}

  const words = (
    name: 'pronouns' | 'bio',
    limit: number,
  ): { kept: string | null | undefined } | { problem: string } => {
    if (!Object.hasOwn(fields, name)) return { kept: undefined }
    const value = fields[name]
    if (value === null) return { kept: null }
    if (typeof value !== 'string') return { problem: `${name} must be text` }
    const kept =
      name === 'bio' ? value.replace(/(?!\n)\p{Cc}/gu, '').trim() : cleanPersonName(value)
    if (kept.length > limit) return { problem: `use at most ${limit} characters` }
    return { kept: kept || null }
  }

  for (const [name, limit] of [
    ['pronouns', PRONOUNS_LIMIT],
    ['bio', BIO_LIMIT],
  ] as const) {
    const read = words(name, limit)
    if ('problem' in read) return read
    if (read.kept !== undefined) changes[name] = read.kept
  }

  if (Object.hasOwn(fields, 'status')) {
    const value = fields.status
    if (value === null) changes.status = null
    else if (typeof value === 'object' && !Array.isArray(value)) {
      const status = statusFrom(value as Record<string, unknown>)
      if (!status) return { problem: `use at most ${STATUS_LIMIT} characters` }
      changes.status = status
    } else return { problem: 'status must be an object' }
  }

  if (Object.hasOwn(fields, 'zone')) {
    const value = fields.zone
    if (value !== null && (typeof value !== 'string' || !isZone(value))) {
      return { problem: 'zone must be a time zone' }
    }
    changes.zone = value
  }

  if (Object.hasOwn(fields, 'hidden')) {
    if (typeof fields.hidden !== 'boolean') return { problem: 'hidden must be true or false' }
    changes.hidden = fields.hidden
  }

  return { changes }
}

function presentFace(row: ProfileRow) {
  return {
    id: row.id,
    name: personName(row),
    avatar: avatarIn(row.avatar),
  }
}

export function presentProfile(
  row: ProfileRow,
  presence: Presence | null,
  now: number,
  asker: string,
) {
  const mine = row.id === asker
  return {
    ...presentFace(row),
    pronouns: row.pronouns,
    bio: row.bio,
    status: statusIn(row.status, now),
    zone: row.zone,
    presence: !mine && row.hidden ? 'offline' : (presence ?? 'offline'),
  }
}

export function presentOwnProfile(row: ProfileRow, now: number) {
  return {
    avatar: avatarIn(row.avatar),
    pronouns: row.pronouns,
    bio: row.bio,
    status: statusIn(row.status, now),
    zone: row.zone,
    hidden: row.hidden === 1,
  }
}
