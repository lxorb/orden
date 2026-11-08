import type { Event, Notify, Pointer } from '@orden/chats'
import { chatOf } from '@orden/chats'
import {
  chatListOf,
  type ChatList,
  eventOf,
  eventsPageOf,
  type EventsPage,
  isWho,
  messageOf,
  type Results,
  resultsOf,
  statePageOf,
  type StatePage,
} from '@orden/chats/wire'
import { account } from '../account.svelte'
import { ApiError, BASE, fromServer, request } from '../api'
import { isRecord } from '../stored'
import type { ChatMember, Hit, Scheduled } from './api'

const chatPath = (chat: string) => `/v2/chats/${encodeURIComponent(chat)}`

async function ask(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<unknown> {
  const token = account.token
  if (!token) return null
  try {
    return await request<unknown>(path, { ...options, token, device: true })
  } catch (error) {
    if (error instanceof ApiError && error.status !== 429 && error.status < 500) throw error
    return null
  }
}

export async function listChats(): Promise<ChatList | null> {
  return chatListOf(await ask('/v2/chats'))
}

export async function makeChat(space: string): Promise<Pointer | null> {
  const said = await ask('/v2/chats', { body: { space } })
  return chatOf(JSON.stringify(said))
}

export async function moveChat(chat: string, space: string): Promise<boolean> {
  return (await ask(chatPath(chat), { method: 'PATCH', body: { space } })) !== null
}

export async function eventsOf(
  chat: string,
  where: { after?: number; before?: number; around?: number },
  limit = 500,
): Promise<EventsPage | null> {
  const query = new URLSearchParams({ limit: String(limit) })
  for (const [key, value] of Object.entries(where)) query.set(key, String(value))
  return eventsPageOf(await ask(`${chatPath(chat)}/events?${query.toString()}`))
}

export async function stateOf(chat: string, before?: number): Promise<StatePage | null> {
  const query = before === undefined ? '' : `?before=${String(before)}`
  return statePageOf(await ask(`${chatPath(chat)}/state${query}`))
}

export async function sendEvents(
  chat: string,
  events: readonly Event[],
): Promise<Results | 'gone' | null> {
  try {
    return resultsOf(await ask(`${chatPath(chat)}/events`, { body: { events } }))
  } catch (error) {
    return fromServer(error) && error.status !== 401 ? 'gone' : null
  }
}

export async function postRead(chat: string, seq: number, back = false): Promise<boolean> {
  return (await ask(`${chatPath(chat)}/read`, { body: { seq, back } })) !== null
}

export async function putMe(
  chat: string,
  notify: Notify | null,
  mutedUntil: number | null,
): Promise<boolean> {
  return (
    (await ask(`${chatPath(chat)}/me`, { method: 'PUT', body: { notify, mutedUntil } })) !== null
  )
}

const ROLES = ['read', 'write', 'owner'] as const

export async function membersOf(chat: string): Promise<ChatMember[] | null> {
  const said = await ask(`${chatPath(chat)}/members`)
  if (!isRecord(said) || !Array.isArray(said.members)) return null
  return said.members.flatMap((one): ChatMember[] => {
    if (!isRecord(one) || !isWho(one.who)) return []
    const role = ROLES.find((each) => each === one.role) ?? 'read'
    return [{ who: one.who, name: typeof one.name === 'string' ? one.name : null, role }]
  })
}

export async function noteReachOf(
  chat: string,
  space: string,
  note: string,
): Promise<{ missing: ChatMember[]; share: boolean } | null> {
  const query = new URLSearchParams({ space, note }).toString()
  const said = await ask(`${chatPath(chat)}/note?${query}`).catch(() => null)
  if (!isRecord(said) || !Array.isArray(said.missing)) return null
  const missing = said.missing.flatMap((one): ChatMember[] =>
    isRecord(one) && isWho(one.who)
      ? [{ who: one.who, name: typeof one.name === 'string' ? one.name : null, role: 'read' }]
      : [],
  )
  return { missing, share: said.share === true }
}

export async function shareNote(chat: string, space: string, note: string): Promise<boolean> {
  return (await ask(`${chatPath(chat)}/note`, { body: { space, note } }).catch(() => null)) !== null
}

export async function scheduledOf(chat: string): Promise<Scheduled[] | null> {
  const said = await ask(`${chatPath(chat)}/scheduled`)
  if (!isRecord(said) || !Array.isArray(said.scheduled)) return null
  return said.scheduled.flatMap((one): Scheduled[] => {
    if (!isRecord(one) || typeof one.id !== 'string' || typeof one.sendAt !== 'number') return []
    const post = eventOf(one.post)
    return post?.kind === 'post' ? [{ id: one.id, sendAt: one.sendAt, post }] : []
  })
}

export async function searchOnAccount(query: string, chat?: string): Promise<Hit[] | null> {
  const params = new URLSearchParams({
    q: query,
    zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  })
  const path = chat ? `${chatPath(chat)}/search` : '/v2/chats/search'
  const said = await ask(`${path}?${params.toString()}`)
  if (!isRecord(said) || !Array.isArray(said.hits)) return null
  return said.hits.flatMap((one): Hit[] => {
    if (chat) {
      const message = messageOf(one)
      return message ? [{ chat, message }] : []
    }
    const message = isRecord(one) ? messageOf(one.message) : null
    return isRecord(one) && typeof one.chat === 'string' && message
      ? [{ chat: one.chat, message }]
      : []
  })
}

export async function putBlob(hash: string, bytes: Uint8Array): Promise<boolean> {
  const token = account.token
  if (!token) return false
  try {
    const response = await fetch(`${BASE}/v2/blobs/${hash}`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/octet-stream' },
      body: new Uint8Array(bytes),
    })
    return response.ok
  } catch {
    return false
  }
}

export async function fileOf(chat: string, hash: string): Promise<Blob | null> {
  const token = account.token
  if (!token) return null
  try {
    const response = await fetch(`${BASE}${chatPath(chat)}/files/${hash}`, {
      headers: { authorization: `Bearer ${token}` },
    })
    return response.ok ? await response.blob() : null
  } catch {
    return null
  }
}
