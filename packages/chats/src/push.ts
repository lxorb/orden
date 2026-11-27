import { type Hours, inHours, isHours, type Moment } from './notify'
import { isChatId } from './pointer'
import type { Who } from './types'
import { isWho } from './wire'

export type ChatPushReason = 'mention' | 'reply' | 'direct' | 'all'
export interface ChatPush {
  kind: 'chat'
  v: '1'
  id: string
  title: string
  body: string
  chat: string
  space: string
  message: string
  seq: string
  at: string
  from: Who
  reason: ChatPushReason
  text: 'yes' | 'no'
}
export const LONGEST_PUSH_TEXT = 240
const REASONS: readonly ChatPushReason[] = ['mention', 'reply', 'direct', 'all']
const PREFIX = 'orden-chat://chat/'
const MESSAGE = /^[0-9A-Za-z_-]{1,64}$/
const WHOLE = /^\d{1,16}$/
export function pushText(body: string): string {
  const line = body.replace(/\s+/g, ' ').trim()
  const letters = Array.from(new Intl.Segmenter().segment(line), (one) => one.segment)
  if (letters.length <= LONGEST_PUSH_TEXT) return line
  return `${letters.slice(0, LONGEST_PUSH_TEXT - 1).join('')}…`
}
export const chatPushLink = (chat: string, message?: string): string =>
  message === undefined ? `${PREFIX}${chat}` : `${PREFIX}${chat}?message=${message}`
export function chatPushLinkOf(url: string): { chat: string; message?: string } | null {
  if (!url.startsWith(PREFIX)) return null
  const [chat, query, ...rest] = url.slice(PREFIX.length).split('?')
  if (rest.length > 0 || !isChatId(chat)) return null
  if (query === undefined) return { chat }
  const message = new URLSearchParams(query).get('message')
  if (message === null) return { chat }
  return MESSAGE.test(message) ? { chat, message } : null
}
export function chatPushOf(data: unknown): ChatPush | null {
  if (typeof data !== 'object' || data === null) return null
  const one = data as Record<string, unknown>
  const { id, title, body, chat, space, message, seq, at, from, text } = one
  const reason = REASONS.find((known) => known === one.reason)
  if (one.kind !== 'chat' || one.v !== '1' || !reason || !isWho(from)) return null
  if (typeof id !== 'string' || typeof title !== 'string' || typeof body !== 'string') return null
  if (typeof space !== 'string' || !space || !isChatId(chat)) return null
  if (typeof message !== 'string' || !MESSAGE.test(message)) return null
  if (typeof seq !== 'string' || !WHOLE.test(seq) || typeof at !== 'string' || !WHOLE.test(at)) return null
  if (text !== 'yes' && text !== 'no') return null
  return { kind: 'chat', v: '1', id, title, body, chat, space, message, seq, at, from, reason, text }
}
export interface PushQuiet {
  hours: Hours | null
  dndUntil: number | null
  previews: boolean
  sound: boolean
}
export function pushQuietOf(data: unknown): PushQuiet | null {
  if (typeof data !== 'object' || data === null) return null
  const { hours, dndUntil, previews, sound } = data as Record<string, unknown>
  if (hours !== null && !isHours(hours)) return null
  if (dndUntil !== null && (typeof dndUntil !== 'number' || !Number.isSafeInteger(dndUntil))) return null
  if (typeof previews !== 'boolean' || typeof sound !== 'boolean') return null
  return { hours, dndUntil, previews, sound }
}
export const pushShows = (quiet: PushQuiet, moment: Moment): boolean =>
  !(quiet.dndUntil !== null && quiet.dndUntil > moment.now) && inHours(quiet.hours, moment)
