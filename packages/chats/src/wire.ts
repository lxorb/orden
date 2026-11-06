import {
  LONGEST_ANSWER,
  LONGEST_QUESTION,
  LONGEST_TOPIC,
  MOST_ANSWERS,
  MOST_BODY,
  MOST_FILE_BYTES,
  MOST_FILES,
  MOST_MEMBERS,
  MOST_PAGE,
  MOST_POSTED,
  MOST_SLOWMODE,
  FEWEST_ANSWERS,
  WAVE_BARS,
} from './limits'
import { isChatId } from './pointer'
import type {
  Event,
  FileRef,
  Logged,
  Mention,
  Message,
  Meta,
  Notify,
  Poll,
  Post,
  Posting,
  Preview,
  Role,
  Who,
  Wording,
} from './types'

export function socketPath(chat: string): string {
  return `/v2/chats/${encodeURIComponent(chat)}/socket`
}

export type Refusal = 'role' | 'gone' | 'posting' | 'slow' | 'rate' | 'large' | 'invalid'

export const REFUSALS: readonly Refusal[] = [
  'role',
  'gone',
  'posting',
  'slow',
  'rate',
  'large',
  'invalid',
]

export type ClientFrame =
  | { t: 'hello'; since?: number }
  | { t: 'send'; event: Event }
  | { t: 'typing'; parent?: string }
  | { t: 'read'; seq: number }

export type ServerFrame =
  | { t: 'events'; events: Logged[] }
  | { t: 'behind'; seq: number }
  | { t: 'placed'; id: string; seq: number; at: number }
  | { t: 'refused'; id: string | null; error: Refusal }
  | { t: 'typing'; who: Who; parent?: string }
  | { t: 'read'; who: Who; seq: number }
  | { t: 'here'; who: Who[] }
  | { t: 'profile'; who: Who }

export function text(frame: ClientFrame | ServerFrame | ChatPoke): string {
  return JSON.stringify(frame)
}

export interface ChatPoke {
  t: 'chat'
  chat: string
  seq: number
  at: number
  by: Who
  mention: boolean
}

export interface ChatRow {
  id: string
  space: string
  role: Role
  members: number
  lastSeq: number
  lastAt: number | null
  lastBy: Who | null
  readSeq: number
  mentions: number
  notify: Notify | null
  mutedUntil: number | null
  meta: Meta
}

export interface ChatList {
  chats: ChatRow[]
}

export interface NewChat {
  space: string
}

export interface EventsPage {
  events: Logged[]
  more: boolean
}

export interface StatePage {
  messages: Message[]
  meta: Meta
  seq: number
  next: number | null
}

export interface PostEvents {
  events: Event[]
}

export type Result = { id: string; seq: number; at: number } | { id: string; refused: Refusal }

export interface Results {
  results: Result[]
}

const ID = /^[0-9A-Za-z_-]{1,64}$/

const WHO = /^(user|guest|program):[0-9A-Za-z_-]{1,64}$/

const HASH = /^[0-9a-f]{64}$/

const LONGEST_EMOJI = 64

const LONGEST_NAME = 255
const LONGEST_URL = 2048
const LONGEST_TITLE = 300
const LONGEST_SITE = 100
const LONGEST_TEXT = 1000
const LONGEST_AGENT = 100
const LONGEST_DEVICE = 200

const MOST_PIXELS = 100_000

const MOST_SECONDS = 24 * 60 * 60

const MOST_HISTORY = 100

type Fields = Record<string, unknown>

function isRecord(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value)
}

export function isWho(value: unknown): value is Who {
  return typeof value === 'string' && WHO.test(value)
}

function isMention(value: unknown): value is Mention {
  return value === 'here' || value === 'everyone' || isWho(value)
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && HASH.test(value)
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isText(value: unknown, most: number): value is string {
  return typeof value === 'string' && value.length <= most
}

function isLine(value: unknown, most: number): value is string {
  return isText(value, most) && value.trim().length > 0
}

function isEmoji(value: unknown): value is string {
  return isLine(value, LONGEST_EMOJI) && !/\s/.test(value)
}

function isUrl(value: unknown): value is string {
  return isText(value, LONGEST_URL) && /^https?:\/\/\S+$/i.test(value)
}

function oneOf<T>(list: readonly T[], value: unknown): value is T {
  return list.some((one) => one === value)
}

function listOf<T>(value: unknown, most: number, check: (one: unknown) => T | null): T[] | null {
  if (!Array.isArray(value) || value.length > most) return null
  const out: T[] = []
  for (const one of value) {
    const checked = check(one)
    if (checked === null) return null
    out.push(checked)
  }
  return out
}

function optional<T>(value: unknown, check: (one: unknown) => T | null): T | null | undefined {
  return value === undefined ? undefined : check(value)
}

function idOf(value: unknown): string | null {
  return isId(value) ? value : null
}

function whoOf(value: unknown): Who | null {
  return isWho(value) ? value : null
}

function mentionOf(value: unknown): Mention | null {
  return isMention(value) ? value : null
}

function answerOf(value: unknown): number | null {
  return isCount(value) && value < MOST_ANSWERS ? value : null
}

function parsed(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}

export function fileRefOf(value: unknown): FileRef | null {
  if (!isRecord(value)) return null
  const { hash, name, size, type } = value
  if (!isHash(hash) || !isLine(name, LONGEST_NAME) || !isLine(type, LONGEST_NAME)) return null
  if (!isCount(size) || size > MOST_FILE_BYTES) return null
  const file: FileRef = { hash, name, size, type }

  const side = (one: unknown) => (isCount(one) && one > 0 && one <= MOST_PIXELS ? one : null)
  const width = optional(value.width, side)
  const height = optional(value.height, side)
  const preview = optional(value.preview, (one) => (isHash(one) ? one : null))
  const seconds = optional(value.seconds, (one) =>
    isTime(one) && one <= MOST_SECONDS ? one : null,
  )
  const wave = optional(value.wave, (one) => {
    const bars = listOf(one, WAVE_BARS, (bar) => (isCount(bar) && bar <= 255 ? bar : null))
    return bars?.length === WAVE_BARS ? bars : null
  })
  if (width === null || height === null || preview === null || seconds === null || wave === null)
    return null
  if (width !== undefined) file.width = width
  if (height !== undefined) file.height = height
  if (preview !== undefined) file.preview = preview
  if (seconds !== undefined) file.seconds = seconds
  if (wave !== undefined) file.wave = wave
  return file
}

function previewOf(value: unknown): Preview | null {
  if (!isRecord(value) || !isUrl(value.url) || !isLine(value.title, LONGEST_TITLE)) return null
  const preview: Preview = { url: value.url, title: value.title }
  const site = optional(value.site, (one) => (isLine(one, LONGEST_SITE) ? one : null))
  const words = optional(value.text, (one) => (isText(one, LONGEST_TEXT) ? one : null))
  const picture = optional(value.picture, (one) => (isHash(one) ? one : null))
  if (site === null || words === null || picture === null) return null
  if (site !== undefined) preview.site = site
  if (words !== undefined) preview.text = words
  if (picture !== undefined) preview.picture = picture
  return preview
}

function pollOf(value: unknown): Poll | null {
  if (!isRecord(value) || !isLine(value.question, LONGEST_QUESTION)) return null
  if (typeof value.several !== 'boolean') return null
  const answers = listOf(value.answers, MOST_ANSWERS, (one) =>
    isLine(one, LONGEST_ANSWER) ? one : null,
  )
  if (!answers || answers.length < FEWEST_ANSWERS) return null
  const poll: Poll = { question: value.question, answers, several: value.several }
  const ends = optional(value.ends, (one) => (isTime(one) ? one : null))
  if (ends === null) return null
  if (ends !== undefined) poll.ends = ends
  return poll
}

function viaOf(value: unknown): { agent: string } | null {
  return isRecord(value) && isLine(value.agent, LONGEST_AGENT) ? { agent: value.agent } : null
}

function postOf(value: Fields): Post | null {
  const { id, message, body } = value
  if (!isId(id) || !isId(message) || !isText(body, MOST_BODY)) return null
  const post: Post = { kind: 'post', id, message, body }

  const parent = optional(value.parent, idOf)
  const quote = optional(value.quote, idOf)
  const files = optional(value.files, (one) => listOf(one, MOST_FILES, fileRefOf))
  const poll = optional(value.poll, pollOf)
  const preview = optional(value.preview, previewOf)
  const via = optional(value.via, viaOf)
  const also = optional(value.alsoToChat, (one) => (typeof one === 'boolean' ? one : null))
  const mentions = optional(value.mentions, (one) => listOf(one, MOST_MEMBERS + 2, mentionOf))
  if (parent === null || quote === null || files === null || poll === null) return null
  if (preview === null || via === null || also === null || mentions === null) return null

  if (!body.trim() && !files?.length && !poll) return null
  if (also !== undefined && parent === undefined) return null
  if (parent !== undefined) post.parent = parent
  if (quote !== undefined) post.quote = quote
  if (files !== undefined) post.files = files
  if (poll) post.poll = poll
  if (preview) post.preview = preview
  if (via) post.via = via
  if (also !== undefined) post.alsoToChat = also
  if (mentions) post.mentions = [...new Set(mentions)]
  return post
}

function metaKeysOf(value: Fields): Partial<Meta> | null {
  const topic = optional(value.topic, (one) => (isText(one, LONGEST_TOPIC) ? one : null))
  const posting = optional(value.posting, (one) =>
    oneOf<Posting>(['writers', 'owner'], one) ? one : null,
  )
  const slowmode = optional(value.slowmode, (one) =>
    isCount(one) && one <= MOST_SLOWMODE ? one : null,
  )
  if (topic === null || posting === null || slowmode === null) return null
  const meta: Partial<Meta> = {}
  if (topic !== undefined) meta.topic = topic
  if (posting !== undefined) meta.posting = posting
  if (slowmode !== undefined) meta.slowmode = slowmode
  return meta
}

export function eventOf(value: unknown): Event | null {
  if (!isRecord(value) || !isId(value.id)) return null
  const { id } = value
  if (value.kind === 'post') return postOf(value)
  if (value.kind === 'schedule') {
    if (!isTime(value.sendAt) || !isRecord(value.post) || value.post.kind !== 'post') return null
    const post = postOf(value.post)
    return post && { kind: 'schedule', id, sendAt: value.sendAt, post }
  }
  if (value.kind === 'meta') {
    const meta = metaKeysOf(value)
    if (!meta || Object.keys(meta).length === 0) return null
    return { kind: 'meta', id, ...meta }
  }

  const { target } = value
  if (!isId(target)) return null
  switch (value.kind) {
    case 'edit': {
      if (!isText(value.body, MOST_BODY)) return null
      const files = optional(value.files, (one) => listOf(one, MOST_FILES, fileRefOf))
      if (files === null) return null
      return files === undefined
        ? { kind: 'edit', id, target, body: value.body }
        : { kind: 'edit', id, target, body: value.body, files }
    }
    case 'delete':
      return { kind: 'delete', id, target }
    case 'react':
      return isEmoji(value.emoji) && typeof value.on === 'boolean'
        ? { kind: 'react', id, target, emoji: value.emoji, on: value.on }
        : null
    case 'pin':
      return typeof value.on === 'boolean' ? { kind: 'pin', id, target, on: value.on } : null
    case 'vote': {
      const answers = listOf(value.answers, MOST_ANSWERS, answerOf)
      return answers && { kind: 'vote', id, target, answers }
    }
    default:
      return null
  }
}

export function loggedOf(value: unknown): Logged | null {
  if (!isRecord(value)) return null
  const { seq, at, author, device, madeAt } = value
  if (!isCount(seq) || seq < 1 || !isTime(at) || !isWho(author)) return null
  if (device !== undefined && !isLine(device, LONGEST_DEVICE)) return null
  if (madeAt !== undefined && !isTime(madeAt)) return null
  const event = eventOf(value)
  if (!event) return null
  const logged: Logged = { ...event, seq, at, author }
  if (device !== undefined) logged.device = device
  if (madeAt !== undefined) logged.madeAt = madeAt
  return logged
}

function wordingOf(value: unknown): Wording | null {
  return isRecord(value) && isText(value.body, MOST_BODY) && isTime(value.at)
    ? { body: value.body, at: value.at }
    : null
}

function votesOf(value: unknown): Record<Who, number[]> | null {
  if (!isRecord(value)) return null
  const votes: Record<Who, number[]> = {}
  for (const [who, answers] of Object.entries(value)) {
    const checked = listOf(answers, MOST_ANSWERS, answerOf)
    if (!isWho(who) || !checked) return null
    votes[who] = checked
  }
  return votes
}

function reactionsOf(value: unknown): Record<string, Who[]> | null {
  if (!isRecord(value)) return null
  const reactions: [string, Who[]][] = []
  for (const [emoji, people] of Object.entries(value)) {
    const checked = listOf(people, MOST_MEMBERS, whoOf)
    if (!isEmoji(emoji) || !checked) return null
    reactions.push([emoji, checked])
  }
  return Object.fromEntries(reactions)
}

export function messageOf(value: unknown): Message | null {
  if (!isRecord(value)) return null
  const { id, seq, at, author, body, alsoToChat, pinned, deleted, replies } = value
  if (!isId(id) || !isCount(seq) || !isTime(at) || !isWho(author) || !isText(body, MOST_BODY))
    return null
  if (
    typeof alsoToChat !== 'boolean' ||
    typeof pinned !== 'boolean' ||
    typeof deleted !== 'boolean'
  )
    return null
  if (!isCount(replies)) return null

  const files = listOf(value.files, MOST_FILES, fileRefOf)
  const mentions = listOf(value.mentions, MOST_MEMBERS + 2, mentionOf)
  const reactions = reactionsOf(value.reactions)
  const history = listOf(value.history, MOST_HISTORY, wordingOf)
  if (!files || !mentions || !reactions || !history) return null

  const message: Message = {
    id,
    seq,
    at,
    author,
    body,
    alsoToChat,
    files,
    mentions,
    reactions,
    pinned,
    history,
    deleted,
    replies,
  }
  const parent = optional(value.parent, idOf)
  const quote = optional(value.quote, idOf)
  const preview = optional(value.preview, previewOf)
  const via = optional(value.via, viaOf)
  const editedAt = optional(value.editedAt, (one) => (isTime(one) ? one : null))
  const lastReplyAt = optional(value.lastReplyAt, (one) => (isTime(one) ? one : null))
  const poll = optional(value.poll, (one) => {
    const asked = pollOf(one)
    const votes = isRecord(one) ? votesOf(one.votes) : null
    return asked && votes && { ...asked, votes }
  })
  if ([parent, quote, preview, via, editedAt, lastReplyAt, poll].includes(null)) return null
  if (parent) message.parent = parent
  if (quote) message.quote = quote
  if (preview) message.preview = preview
  if (via) message.via = via
  if (editedAt !== undefined && editedAt !== null) message.editedAt = editedAt
  if (lastReplyAt !== undefined && lastReplyAt !== null) message.lastReplyAt = lastReplyAt
  if (poll) message.poll = poll
  return message
}

function metaOf(value: unknown): Meta | null {
  if (!isRecord(value)) return null
  const meta = metaKeysOf(value)
  const { topic, posting, slowmode } = meta ?? {}
  if (topic === undefined || posting === undefined || slowmode === undefined) return null
  return { topic, posting, slowmode }
}

export function clientFrameOf(raw: string): ClientFrame | null {
  const value = parsed(raw)
  if (!isRecord(value)) return null
  switch (value.t) {
    case 'hello':
      if (value.since === undefined) return { t: 'hello' }
      return isCount(value.since) ? { t: 'hello', since: value.since } : null
    case 'send': {
      const event = eventOf(value.event)
      return event && { t: 'send', event }
    }
    case 'typing':
      if (value.parent === undefined) return { t: 'typing' }
      return isId(value.parent) ? { t: 'typing', parent: value.parent } : null
    case 'read':
      return isCount(value.seq) ? { t: 'read', seq: value.seq } : null
    default:
      return null
  }
}

export function serverFrameOf(raw: string): ServerFrame | null {
  const value = parsed(raw)
  if (!isRecord(value)) return null
  switch (value.t) {
    case 'events': {
      const events = listOf(value.events, MOST_PAGE, loggedOf)
      return events && { t: 'events', events }
    }
    case 'behind':
      return isCount(value.seq) ? { t: 'behind', seq: value.seq } : null
    case 'placed':
      return isId(value.id) && isCount(value.seq) && isTime(value.at)
        ? { t: 'placed', id: value.id, seq: value.seq, at: value.at }
        : null
    case 'refused':
      return (value.id === null || isId(value.id)) && oneOf(REFUSALS, value.error)
        ? { t: 'refused', id: value.id, error: value.error }
        : null
    case 'typing':
      if (!isWho(value.who)) return null
      if (value.parent === undefined) return { t: 'typing', who: value.who }
      return isId(value.parent) ? { t: 'typing', who: value.who, parent: value.parent } : null
    case 'read':
      return isWho(value.who) && isCount(value.seq)
        ? { t: 'read', who: value.who, seq: value.seq }
        : null
    case 'here': {
      const who = listOf(value.who, MOST_MEMBERS, whoOf)
      return who && { t: 'here', who }
    }
    case 'profile':
      return isWho(value.who) ? { t: 'profile', who: value.who } : null
    default:
      return null
  }
}

export function chatPokeOf(value: unknown): ChatPoke | null {
  if (!isRecord(value) || value.t !== 'chat') return null
  const { chat, seq, at, by, mention } = value
  if (!isChatId(chat) || !isCount(seq) || !isTime(at) || !isWho(by) || typeof mention !== 'boolean')
    return null
  return { t: 'chat', chat, seq, at, by, mention }
}

export function chatRowOf(value: unknown): ChatRow | null {
  if (!isRecord(value)) return null
  const { id, space, members, lastSeq, lastAt, lastBy, readSeq, mentions, notify, mutedUntil } =
    value
  if (!isChatId(id) || !isLine(space, LONGEST_DEVICE) || !isCount(members)) return null
  const role = value.role
  if (!oneOf<Role>(['read', 'write', 'owner'], role)) return null
  if (
    !isCount(lastSeq) ||
    !(lastAt === null || isTime(lastAt)) ||
    !(lastBy === null || isWho(lastBy))
  )
    return null
  if (!isCount(readSeq) || !isCount(mentions) || !(mutedUntil === null || isTime(mutedUntil)))
    return null
  if (!(notify === null || oneOf<Notify>(['all', 'mentions', 'nothing'], notify))) return null
  const meta = metaOf(value.meta)
  if (!meta) return null
  return {
    id,
    space,
    role,
    members,
    lastSeq,
    lastAt,
    lastBy,
    readSeq,
    mentions,
    notify,
    mutedUntil,
    meta,
  }
}

export function chatListOf(value: unknown): ChatList | null {
  if (!isRecord(value) || !Array.isArray(value.chats)) return null
  const chats: ChatRow[] = []
  for (const one of value.chats) {
    const row = chatRowOf(one)
    if (row) chats.push(row)
  }
  return { chats }
}

export function newChatOf(value: unknown): NewChat | null {
  return isRecord(value) && isLine(value.space, LONGEST_DEVICE) ? { space: value.space } : null
}

export function eventsPageOf(value: unknown): EventsPage | null {
  if (!isRecord(value) || typeof value.more !== 'boolean') return null
  const events = listOf(value.events, MOST_PAGE, loggedOf)
  return events && { events, more: value.more }
}

export function statePageOf(value: unknown): StatePage | null {
  if (!isRecord(value) || !isCount(value.seq) || !(value.next === null || isCount(value.next)))
    return null
  const messages = listOf(value.messages, Number.MAX_SAFE_INTEGER, messageOf)
  const meta = metaOf(value.meta)
  return messages && meta && { messages, meta, seq: value.seq, next: value.next }
}

export function postEventsOf(value: unknown): PostEvents | null {
  if (!isRecord(value)) return null
  const events = listOf(value.events, MOST_POSTED, eventOf)
  return events && events.length > 0 ? { events } : null
}

function resultOf(value: unknown): Result | null {
  if (!isRecord(value) || !isId(value.id)) return null
  if (value.refused !== undefined) {
    return oneOf(REFUSALS, value.refused) ? { id: value.id, refused: value.refused } : null
  }
  return isCount(value.seq) && isTime(value.at)
    ? { id: value.id, seq: value.seq, at: value.at }
    : null
}

export function resultsOf(value: unknown): Results | null {
  if (!isRecord(value)) return null
  const results = listOf(value.results, MOST_POSTED, resultOf)
  return results && { results }
}
