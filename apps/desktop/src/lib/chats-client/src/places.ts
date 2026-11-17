import { account } from '../../accounts/src/api'
import { keepJson, stored } from '../../platform/src/api'

const KEY = 'orden:chat-own-pointers'

let current: string | null = null

export function startedFor(id: string): void {
  current = id
}

function who(): string | null {
  return current ?? account.user?.id ?? account.guest?.id ?? null
}

const own = new Map<string, Map<string, string>>()

function owned(id: string): Map<string, string> {
  const held = own.get(id)
  if (held) return held
  const map = new Map<string, string>()
  const kept = stored(`${KEY}:${id}`)
  if (kept && typeof kept === 'object' && !Array.isArray(kept)) {
    for (const [chat, path] of Object.entries(kept)) {
      if (typeof path === 'string') map.set(chat, path)
    }
  }
  own.set(id, map)
  return map
}

export function ownPointer(chat: string): string | null {
  const id = who()
  return id ? (owned(id).get(chat) ?? null) : null
}

export function ownPointers(): [string, string][] {
  const id = who()
  return id ? [...owned(id)] : []
}

export function keepOwnPointer(chat: string, path: string | null): void {
  const id = who()
  if (!id) return
  const map = owned(id)
  if ((map.get(chat) ?? null) === path) return
  if (path === null) map.delete(chat)
  else map.set(chat, path)
  keepJson(`${KEY}:${id}`, Object.fromEntries(map))
}

const moves = new Map<string, string>()

export function movedHere(chat: string, space: string): void {
  moves.set(chat, space)
}

export function lastMoved(chat: string): string | null {
  return moves.get(chat) ?? null
}

export function forgetMoves(): void {
  moves.clear()
}
