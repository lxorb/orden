import { isBoolean, isNumber, isRecord, isString } from '../../stored'
import type { Avatar, Presence, Status } from './face'

export interface Person {
  id: string
  name: string
  avatar: Avatar | null
  pronouns: string | null
  bio: string | null
  status: Status | null
  zone: string | null
  presence: Presence
}

const HASH = /^[a-f0-9]{64}$/

const textOrNull = (value: unknown): string | null => (isString(value) ? value : null)

function readAvatar(value: unknown): Avatar | null {
  if (!isRecord(value)) return null
  const { s, l } = value
  return isString(s) && isString(l) && HASH.test(s) && HASH.test(l) ? { s, l } : null
}

function readStatus(value: unknown): Status | null {
  if (!isRecord(value)) return null
  const { emoji, text, until, quiet } = value
  if (!isString(emoji) || !isString(text)) return null
  return {
    emoji,
    text,
    until: isNumber(until) ? until : null,
    quiet: isBoolean(quiet) ? quiet : false,
  }
}

export function readPresence(value: unknown): Presence {
  return value === 'active' || value === 'away' ? value : 'offline'
}

export function readPerson(value: unknown): Person | null {
  if (!isRecord(value) || !isString(value.id) || !isString(value.name)) return null
  return {
    id: value.id,
    name: value.name,
    avatar: readAvatar(value.avatar),
    pronouns: textOrNull(value.pronouns),
    bio: textOrNull(value.bio),
    status: readStatus(value.status),
    zone: textOrNull(value.zone),
    presence: readPresence(value.presence),
  }
}
