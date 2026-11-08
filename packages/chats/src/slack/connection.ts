import type {
  Account,
  AttachmentKind,
  AttachmentRef,
  Connection,
  Conversation,
  ConversationRole,
  HistoryAsk,
  Host,
  Member,
  Outgoing,
  OutgoingFile,
  Page,
  Person,
  ProviderEvent,
  ProviderMessage,
  Status,
} from '../provider'
import { secretName } from '../provider'
import { Api, isRecord, list, record, type Said, sleep, type Sleep, SlackError, text } from './api'
import { type Emoji, emoji, emojiIn, nameFor, textFor } from './emoji'
import { type Dial, SocketMode, type SocketState } from './socket'
import { markdownOf, mrkdwnOf } from './text'

const WORDS = {
  signedOut: 'Signed out of Slack. Connect again.',
  noToken: 'That is not a Slack user token. It starts with xoxp-',
  noAppToken: 'That is not a Slack app-level token. It starts with xapp-',
  badAppToken:
    'Slack refused that app-level token. Generate one with connections:write under Basic Information',
  forEveryone: 'Slack removes messages for everyone',
  files: 'Slack files need the desktop app',
  unknownEmoji: 'Slack does not know that emoji',
  noName: 'A Slack channel name needs a letter or a number',
}

export interface Deps {
  dial?: Dial
  wait?: Sleep
  poll?: number
}

const KINDS = 'public_channel,private_channel,mpim,im'
const KEPT = 5000
const WATCHED_FOR = 10 * 60_000
const WATCHED_MOST = 5
const REFRESHED = 25
const RELIST_EVERY = 3 * 60_000
const PRESENCE_EVERY = 3 * 60_000
const PRESENCE_MOST = 20
const USER_PAGES = 25
const ONE_BY_ONE = 20
const THREAD_MOST = 1000
const AROUND_AFTER = 200
const SYSTEM = new Set([
  'channel_join',
  'channel_leave',
  'channel_topic',
  'channel_purpose',
  'channel_name',
  'channel_archive',
  'channel_unarchive',
  'group_join',
  'group_leave',
  'group_topic',
  'group_purpose',
  'group_name',
  'group_archive',
  'group_unarchive',
  'pinned_item',
  'unpinned_item',
])

export const live = new Map<string, SlackConnection>()

const vaultName = (account: string) => secretName('slack', account, 'token')

const secondsOf = (ts: string) => Math.round(Number(ts) * 1000)

export function earlier(ts: string): string {
  const [whole = '0', part = '0'] = ts.split('.')
  const micro = BigInt(whole) * 1_000_000n + BigInt(part.padEnd(6, '0').slice(0, 6)) - 1n
  const safe = micro < 0n ? 0n : micro
  return `${safe / 1_000_000n}.${String(safe % 1_000_000n).padStart(6, '0')}`
}

export function slugOf(title: string): string {
  const slug = Array.from(
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .normalize('NFC')
      .replace(/[^\p{L}\p{N}\p{M}_-]+/gu, '-')
      .replace(/^-+|-+$/g, ''),
  )
    .slice(0, 80)
    .join('')
    .replace(/-+$/, '')
  if (!slug) throw new Error(WORDS.noName)
  return slug
}

export function kindOfFile(file: Said): AttachmentKind {
  const type = text(file.mimetype)
  if (file.subtype === 'slack_audio') return 'voice'
  if (type === 'image/gif') return 'gif'
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('audio/')) return 'audio'
  return 'file'
}

export async function open(
  config: Readonly<Record<string, string>>,
  host: Host,
  known: string | undefined,
  deps: Deps,
): Promise<Connection> {
  const typed = (config.token ?? '').trim()
  const appToken = (config.appToken ?? '').trim()
  if (typed && !typed.startsWith('xoxp-')) throw new Error(WORDS.noToken)
  if (appToken && !appToken.startsWith('xapp-')) throw new Error(WORDS.noAppToken)
  let token = typed
  if (!token && known !== undefined) token = (await host.secret(vaultName(known))) ?? ''
  if (!token) throw new Error(known === undefined ? WORDS.noToken : WORDS.signedOut)
  const wait = deps.wait ?? sleep
  const api = new Api(host, token, wait)
  let who: Said
  try {
    who = await api.call('auth.test')
  } catch (error) {
    if (error instanceof SlackError && error.signedOut) {
      if (known !== undefined) await host.keepSecret(vaultName(known), null).catch(() => undefined)
      throw new Error(WORDS.signedOut, { cause: error })
    }
    throw error
  }
  if (appToken && known === undefined) {
    try {
      await new Api(host, appToken, wait).call('apps.connections.open')
    } catch (error) {
      if (error instanceof SlackError && error.signedOut)
        throw new Error(WORDS.badAppToken, { cause: error })
    }
  }
  const team = text(who.team_id)
  const user = text(who.user_id)
  const id = `${team}-${user}`
  const table = await emoji()
  const connection = new SlackConnection(api, host, table, token, who, deps, appToken)
  await connection.boot()
  live
    .get(id)
    ?.close()
    .catch(() => undefined)
  live.set(id, connection)
  return connection
}

export async function forget(account: string, host: Host): Promise<void> {
  const one = live.get(account)
  live.delete(account)
  const token = one?.token ?? (await host.secret(vaultName(account)).catch(() => null))
  if (token) await new Api(host, token).call('auth.revoke').catch(() => undefined)
  await one?.close()
  await host.keepSecret(vaultName(account), null).catch(() => undefined)
}

type Hearer = (event: ProviderEvent) => void

interface Watched {
  at: number
  thread?: string
}

type Handlers = Record<string, (event: Said) => void>

export class SlackConnection implements Connection {
  readonly account: Account
  private readonly self: string
  private readonly users = new Map<string, Said>()
  private readonly asking = new Map<string, Promise<void>>()
  private readonly known = new Map<string, Conversation>()
  private readonly raw = new Map<string, Said>()
  private readonly kept = new Map<string, Said>()
  private readonly baseline = new Set<string>()
  private readonly threadSeen = new Map<string, Map<string, string>>()
  private readonly watched = new Map<string, Watched>()
  private readonly online = new Map<string, boolean>()
  private readonly hearers = new Set<Hearer>()
  private readonly wait: Sleep
  private socket: SocketMode | null = null
  private everyone: Promise<void> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private listed = 0
  private presenceAt = 0
  private wasOnline = false
  private gone = false
  private closed = false
  private status: Status = 'online'

  constructor(
    private readonly api: Api,
    private readonly host: Host,
    private readonly table: Emoji,
    readonly token: string,
    who: Said,
    private readonly deps: Deps,
    appToken: string,
  ) {
    this.self = text(who.user_id)
    const team = text(who.team_id)
    this.wait = deps.wait ?? sleep
    this.account = {
      id: `${team}-${this.self}`,
      label: `${text(who.user)} (${text(who.team)})`,
      self: { id: this.self, name: text(who.user) || this.self, picture: this.self },
    }
    api.onSignedOut = () => void this.lost()
    if (appToken && deps.dial) {
      const socketApi = new Api(host, appToken, this.wait)
      this.socket = new SocketMode(
        socketApi,
        deps.dial,
        (event) => this.heard(event),
        (state) => this.socketState(state),
        this.wait,
        () => this.socketDropped(),
      )
    }
  }

  async boot(): Promise<void> {
    await this.ensure([this.self])
    const me = this.users.get(this.self)
    if (me) this.account.self = this.personOf(me)
    if (this.socket) this.socket.begin()
    this.schedule()
  }

  private socketState(state: SocketState): void {
    if (this.gone || this.closed) return
    this.status = state
    this.emit({ t: 'status', status: state })
    if (state !== 'online') return
    if (this.wasOnline) void this.catchUp().catch(() => undefined)
    this.wasOnline = true
  }

  private socketDropped(): void {
    this.socket = null
    if (this.gone || this.closed) return
    this.status = 'online'
    this.emit({ t: 'status', status: 'online' })
    void this.catchUp().catch(() => undefined)
  }

  private async catchUp(): Promise<void> {
    for (const conversation of [...this.watched.keys()])
      await this.refreshMessages(conversation).catch(() => undefined)
    await this.relist()
  }

  private emit(event: ProviderEvent): void {
    for (const hear of this.hearers) hear(event)
  }

  private async lost(): Promise<void> {
    if (this.gone) return
    this.gone = true
    this.status = 'signed-out'
    this.emit({ t: 'status', status: 'signed-out', reason: WORDS.signedOut })
    await this.host.keepSecret(vaultName(this.account.id), null).catch(() => undefined)
    this.stop()
  }

  private stop(): void {
    this.socket?.stop()
    this.socket = null
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private schedule(): void {
    if (this.closed || this.gone) return
    this.timer = setTimeout(() => {
      void this.tick().finally(() => this.schedule())
    }, this.deps.poll ?? 15_000)
  }

  async tick(): Promise<void> {
    const now = this.host.now()
    if (!this.socket || this.status !== 'online') {
      for (const [conversation, seen] of [...this.watched]) {
        if (now - seen.at > WATCHED_FOR) {
          this.watched.delete(conversation)
          continue
        }
        await this.refreshMessages(conversation).catch(() => undefined)
        if (seen.thread) await this.refreshThread(conversation, seen.thread).catch(() => undefined)
      }
      if (now - this.listed > RELIST_EVERY) await this.relist().catch(() => undefined)
    }
    if (now - this.presenceAt > PRESENCE_EVERY) {
      this.presenceAt = now
      await this.presence().catch(() => undefined)
    }
  }

  private async relist(): Promise<void> {
    const before = new Map(this.known)
    const now = await this.conversations()
    for (const one of now) {
      const was = before.get(one.id)
      if (!was) this.emit({ t: 'conversation', conversation: one })
    }
    for (const id of before.keys())
      if (!now.some((one) => one.id === id)) this.emit({ t: 'gone', conversation: id })
  }

  private async presence(): Promise<void> {
    const partners = [...this.known.values()]
      .filter((one) => one.kind === 'direct')
      .sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))
      .slice(0, PRESENCE_MOST)
      .flatMap((one) => one.people.map((person) => person.id))
    for (const person of partners) {
      if (person === this.self) continue
      const said = await this.api.call('users.getPresence', { user: person })
      const on = said.presence === 'active'
      if (this.online.get(person) === on) continue
      this.online.set(person, on)
      this.emit({ t: 'presence', person, online: on })
    }
  }

  private async ensure(ids: readonly string[]): Promise<void> {
    const unknown = () =>
      [...new Set(ids)].filter((id) => id && /^[UW]/.test(id) && !this.users.has(id))
    if (unknown().length > ONE_BY_ONE) await this.allUsers().catch(() => undefined)
    const missing = unknown()
    await Promise.all(
      missing.map((id) => {
        let asked = this.asking.get(id)
        if (!asked) {
          asked = this.api
            .call('users.info', { user: id })
            .then((said) => void this.users.set(id, record(said.user)))
            .catch(() => undefined)
            .finally(() => this.asking.delete(id))
          this.asking.set(id, asked)
        }
        return asked
      }),
    )
  }

  private allUsers(): Promise<void> {
    this.everyone ??= this.api
      .pages('users.list', { limit: 200 }, 'members', USER_PAGES)
      .then((found) => {
        for (const one of found) this.users.set(text(one.id), one)
      })
      .catch((error: unknown) => {
        this.everyone = null
        throw error
      })
    return this.everyone
  }

  private nameOf = (id: string): string | undefined => {
    const user = this.users.get(id)
    if (user) return this.personOf(user).name
    const conversation = this.known.get(id)
    return conversation?.title ?? undefined
  }

  private personOf(user: Said): Person {
    const profile = record(user.profile)
    const name =
      text(profile.display_name) ||
      text(profile.real_name) ||
      text(user.real_name) ||
      text(user.name) ||
      text(user.id)
    const person: Person = { id: text(user.id), name }
    if (text(user.name)) person.handle = text(user.name)
    if (text(profile.phone)) person.phone = text(profile.phone)
    if (text(profile.image_192) || text(profile.image_72)) person.picture = text(user.id)
    return person
  }

  private author(raw: Said): Person {
    const id = text(raw.user) || text(raw.bot_id)
    const user = this.users.get(id)
    if (user) return this.personOf(user)
    const bot = record(raw.bot_profile)
    return { id: id || 'slack', name: text(raw.username) || text(bot.name) || id || 'Slack' }
  }

  private conversationOf(channel: Said): Conversation {
    const id = text(channel.id)
    const im = channel.is_im === true
    const mpim = channel.is_mpim === true
    const partner = im ? text(channel.user) : ''
    const people: Person[] = []
    if (partner) {
      const user = this.users.get(partner)
      people.push(user ? this.personOf(user) : { id: partner, name: partner })
    }
    if (mpim) {
      const handles = text(channel.name)
        .replace(/^mpdm-/, '')
        .replace(/-\d+$/, '')
        .split('--')
      for (const handle of handles) {
        const user = [...this.users.values()].find((one) => text(one.name) === handle)
        if (user && text(user.id) !== this.self) people.push(this.personOf(user))
      }
    }
    const topic = text(record(channel.topic).value) || text(record(channel.purpose).value)
    const latest = record(channel.latest)
    const updated = Number(channel.updated)
    const lastAt = text(latest.ts)
      ? secondsOf(text(latest.ts))
      : Number.isFinite(updated) && updated > 0
        ? updated
        : null
    const title = im
      ? (people[0]?.name ?? partner)
      : mpim
        ? people.map((one) => one.name).join(', ') || null
        : text(channel.name) || null
    const conversation: Conversation = {
      id,
      title,
      kind: im ? 'direct' : 'group',
      people,
      lastAt,
      unread: Number(channel.unread_count_display ?? channel.unread_count ?? 0) || 0,
    }
    if (topic) conversation.topic = topic
    if (channel.is_archived === true) {
      conversation.archived = true
      conversation.readOnly = true
    }
    if (partner) conversation.picture = partner
    if (typeof channel.num_members === 'number') conversation.members = channel.num_members
    if (!im && !mpim) conversation.role = text(channel.creator) === this.self ? 'owner' : 'member'
    if (text(latest.text)) conversation.snippet = this.read(text(latest.text)).text
    const was = this.known.get(id)
    if (was && conversation.lastAt === null) conversation.lastAt = was.lastAt
    if (was && !('unread_count_display' in channel) && !('unread_count' in channel))
      conversation.unread = was.unread
    if (was?.snippet && !conversation.snippet) conversation.snippet = was.snippet
    this.known.set(id, conversation)
    return conversation
  }

  private read(mrkdwn: string) {
    const said = markdownOf(mrkdwn, this.nameOf)
    return { ...said, text: emojiIn(this.table, said.text) }
  }

  private keep(channel: string, message: Said): void {
    const key = `${channel}\n${text(message.ts)}`
    this.raw.delete(key)
    this.raw.set(key, message)
    if (this.raw.size > KEPT) {
      const oldest = this.raw.keys().next().value
      if (oldest !== undefined) this.raw.delete(oldest)
    }
  }

  private reactionKey(name: string): string {
    return textFor(this.table, name)
  }

  private messageOf(channel: string, raw: Said, inThread = false): ProviderMessage {
    this.keep(channel, raw)
    const ts = text(raw.ts)
    const subtype = text(raw.subtype)
    const author = this.author(raw)
    let body = text(raw.text)
    if (!body) {
      const legacy = list(raw.attachments)[0]
      if (legacy) body = text(legacy.text) || text(legacy.fallback)
    }
    const said = this.read(body)
    const files = list(raw.files).filter(
      (file) => file.mode !== 'tombstone' && file.mode !== 'hidden_by_limit',
    )
    const message: ProviderMessage = {
      id: ts,
      conversation: channel,
      author,
      at: secondsOf(ts),
      text: said.text,
      attachments: files.map((file) => this.attachmentOf(file)),
      mine: author.id === this.self,
    }
    const thread = text(raw.thread_ts)
    if (thread && thread !== ts) {
      if (inThread || subtype !== 'thread_broadcast') message.thread = thread
      else message.replyTo = thread
    }
    const count = Number(raw.reply_count)
    if (Number.isFinite(count) && count > 0) {
      message.replies = count
      if (text(raw.latest_reply)) message.lastReplyAt = secondsOf(text(raw.latest_reply))
    }
    const reactions: Record<string, string[]> = {}
    for (const one of list(raw.reactions)) {
      const users = Array.isArray(one.users) ? one.users.filter((it) => typeof it === 'string') : []
      if (users.length) reactions[this.reactionKey(text(one.name))] = users
    }
    if (Object.keys(reactions).length) message.reactions = reactions
    const edited = text(record(raw.edited).ts)
    if (edited) message.editedAt = secondsOf(edited)
    if (subtype === 'tombstone') message.deleted = true
    const pinned = Array.isArray(raw.pinned_to) && raw.pinned_to.includes(channel)
    if (pinned) message.pinned = true
    const mentions = [...said.mentions]
    if (said.everyone && !mentions.includes(this.self)) mentions.push(this.self)
    if (mentions.length) message.mentions = mentions
    if (SYSTEM.has(subtype)) message.system = true
    if (message.mine) message.delivery = 'sent'
    return message
  }

  private attachmentOf(file: Said): AttachmentRef {
    const ref: AttachmentRef = {
      ref: text(file.id),
      name: text(file.name) || text(file.title) || 'file',
      type: text(file.mimetype) || 'application/octet-stream',
      size: Number(file.size) || 0,
      kind: kindOfFile(file),
    }
    const width = Number(file.original_w)
    const height = Number(file.original_h)
    if (width > 0 && height > 0) {
      ref.width = width
      ref.height = height
    }
    const ms = Number(file.duration_ms)
    if (ms > 0) ref.seconds = ms / 1000
    return ref
  }

  private async mapped(
    channel: string,
    raws: readonly Said[],
    inThread = false,
  ): Promise<ProviderMessage[]> {
    const ids: string[] = []
    for (const raw of raws) {
      ids.push(text(raw.user))
      for (const match of text(raw.text).matchAll(/<@([UW][A-Z0-9]+)/g)) ids.push(match[1] ?? '')
    }
    await this.ensure(ids)
    return raws.map((raw) => this.messageOf(channel, raw, inThread))
  }

  async conversations(): Promise<Conversation[]> {
    const found = await this.api.pages(
      'users.conversations',
      { types: KINDS, exclude_archived: false, limit: 200 },
      'channels',
    )
    this.listed = this.host.now()
    await this.ensure(found.map((one) => text(one.user)))
    if (found.some((one) => one.is_mpim === true)) await this.allUsers().catch(() => undefined)
    const out = found.map((one) => this.conversationOf(one))
    for (const id of [...this.known.keys()])
      if (!out.some((one) => one.id === id)) this.known.delete(id)
    void this.refresh(out).catch(() => undefined)
    return out
  }

  private async refresh(all: readonly Conversation[]): Promise<void> {
    const order = [...all]
      .filter((one) => !one.archived)
      .sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))
      .slice(0, REFRESHED)
    for (const one of order) {
      if (this.closed || this.gone) return
      const info = record((await this.api.call('conversations.info', { channel: one.id })).channel)
      const lastRead = text(info.last_read)
      const after = await this.api.call('conversations.history', {
        channel: one.id,
        limit: lastRead ? 100 : 1,
        ...(lastRead ? { oldest: lastRead } : {}),
      })
      let messages = list(after.messages)
      const unread = lastRead
        ? messages.filter((message) => text(message.user) !== this.self).length
        : one.unread
      if (!messages.length && lastRead)
        messages = list(
          (await this.api.call('conversations.history', { channel: one.id, limit: 1 })).messages,
        )
      const latest = messages[0]
      const next: Conversation = { ...one, unread }
      if (latest) {
        next.lastAt = secondsOf(text(latest.ts))
        next.snippet = this.read(text(latest.text)).text
      }
      if (info.is_archived === true) next.archived = true
      if (typeof info.num_members === 'number') next.members = info.num_members
      this.known.set(one.id, next)
      this.emit({ t: 'conversation', conversation: next })
    }
  }

  private watch(conversation: string, thread?: string): void {
    const kept = thread ?? this.watched.get(conversation)?.thread
    this.watched.delete(conversation)
    this.watched.set(conversation, { at: this.host.now(), ...(kept ? { thread: kept } : {}) })
    while (this.watched.size > WATCHED_MOST) {
      const oldest = this.watched.keys().next().value
      if (oldest === undefined) break
      this.watched.delete(oldest)
    }
  }

  private fingerprint(raw: Said): string {
    return JSON.stringify([
      raw.text,
      record(raw.edited).ts,
      raw.reply_count,
      raw.latest_reply,
      raw.reactions,
      raw.pinned_to,
      list(raw.files).map((file) => file.id),
      raw.subtype,
    ])
  }

  private async refreshMessages(conversation: string): Promise<void> {
    const said = await this.api.call('conversations.history', { channel: conversation, limit: 30 })
    const raws = list(said.messages)
    const known = this.baseline.has(conversation)
    const oldest = raws.reduce((least, one) => Math.min(least, Number(one.ts)), Infinity)
    const present = new Set(raws.map((one) => text(one.ts)))
    const before = new Map<string, string>()
    for (const [key, raw] of this.kept) {
      const [channel = '', ts = ''] = key.split('\n')
      if (channel === conversation) before.set(ts, this.fingerprint(raw))
    }
    const mapped = await this.mapped(conversation, [...raws].reverse())
    for (const message of mapped) {
      const raw = this.raw.get(`${conversation}\n${message.id}`) ?? {}
      const print = this.fingerprint(raw)
      const was = before.get(message.id)
      this.kept.set(`${conversation}\n${message.id}`, raw)
      if (was === undefined) {
        if (known) {
          this.bump(conversation, message)
          this.emit({ t: 'message', message })
        }
      } else if (was !== print) this.emit({ t: 'changed', message })
    }
    for (const ts of before.keys()) {
      if ((!raws.length || Number(ts) >= oldest) && !present.has(ts)) {
        this.kept.delete(`${conversation}\n${ts}`)
        this.emit({ t: 'deleted', conversation, message: ts })
      }
    }
    this.baseline.add(conversation)
  }

  private printsOf(raws: readonly Said[]): Map<string, string> {
    return new Map(raws.map((raw) => [text(raw.ts), this.fingerprint(raw)]))
  }

  private async refreshThread(conversation: string, parent: string): Promise<void> {
    const key = `${conversation}\n${parent}`
    const before = this.threadSeen.get(key)
    if (!before) return
    const all = (
      await this.api.pages(
        'conversations.replies',
        { channel: conversation, ts: parent, limit: 200 },
        'messages',
        Math.ceil(THREAD_MOST / 200),
      )
    ).filter((one) => text(one.ts) !== parent)
    const now = this.printsOf(all)
    this.threadSeen.set(key, now)
    const fresh = all.filter((raw) => before.get(text(raw.ts)) !== this.fingerprint(raw))
    const messages = await this.mapped(conversation, fresh, true)
    for (const message of messages)
      this.emit({ t: before.has(message.id) ? 'changed' : 'message', message })
    for (const ts of before.keys())
      if (!now.has(ts)) this.emit({ t: 'deleted', conversation, message: ts })
  }

  private bump(conversation: string, message: ProviderMessage): void {
    const was = this.known.get(conversation)
    if (!was) return
    const next: Conversation = {
      ...was,
      lastAt: Math.max(was.lastAt ?? 0, message.at),
      snippet: message.text,
      unread: message.mine ? 0 : was.unread + 1,
    }
    this.known.set(conversation, next)
  }

  private noted(conversation: string, ts: string): void {
    const key = `${conversation}\n${ts}`
    if (!this.baseline.has(conversation)) return
    const raw = this.raw.get(key)
    if (raw) this.kept.set(key, raw)
    else this.kept.delete(key)
  }

  private remember(conversation: string, raws: readonly Said[]): void {
    this.baseline.add(conversation)
    for (const raw of raws) this.kept.set(`${conversation}\n${text(raw.ts)}`, raw)
    while (this.kept.size > KEPT) {
      const oldest = this.kept.keys().next().value
      if (oldest === undefined) break
      this.kept.delete(oldest)
    }
  }

  async history(conversation: string, ask: HistoryAsk): Promise<Page> {
    this.watch(conversation)
    if (ask.around) {
      const half = Math.max(1, Math.floor(ask.limit / 2))
      const [older, newer] = await Promise.all([
        this.api.call('conversations.history', {
          channel: conversation,
          latest: ask.around,
          inclusive: true,
          limit: half,
        }),
        this.api.call('conversations.history', {
          channel: conversation,
          oldest: ask.around,
          limit: AROUND_AFTER,
        }),
      ])
      const after = list(newer.messages).slice(-half)
      const raws = [...list(older.messages), ...after]
      const unique = new Map(raws.map((one) => [text(one.ts), one]))
      const sorted = [...unique.values()].sort((a, b) => Number(a.ts) - Number(b.ts))
      const messages = await this.mapped(conversation, sorted)
      return {
        messages,
        before: older.has_more === true && sorted[0] ? text(sorted[0].ts) : null,
      }
    }
    const said = await this.api.call('conversations.history', {
      channel: conversation,
      limit: ask.limit,
      ...(ask.before ? { latest: ask.before } : {}),
    })
    const raws = list(said.messages).reverse()
    if (!ask.before) this.remember(conversation, raws)
    const messages = await this.mapped(conversation, raws)
    return {
      messages,
      before: said.has_more === true && raws[0] ? text(raws[0].ts) : null,
    }
  }

  async thread(conversation: string, parent: string, ask: HistoryAsk): Promise<Page> {
    this.watch(conversation, parent)
    const all = (
      await this.api.pages(
        'conversations.replies',
        { channel: conversation, ts: parent, limit: 200 },
        'messages',
        Math.ceil(THREAD_MOST / 200),
      )
    ).filter((one) => text(one.ts) !== parent)
    const cut = ask.before ? all.filter((one) => Number(one.ts) < Number(ask.before)) : all
    const page = cut.slice(Math.max(0, cut.length - ask.limit))
    if (!ask.before) this.threadSeen.set(`${conversation}\n${parent}`, this.printsOf(all))
    const messages = await this.mapped(conversation, page, true)
    return {
      messages,
      before: cut.length > page.length && page[0] ? text(page[0].ts) : null,
    }
  }

  private async mentioned(draft: Outgoing) {
    const ids = draft.mentions ?? []
    await this.ensure(ids)
    return ids.flatMap((id) => {
      const user = this.users.get(id)
      if (!user) return []
      const person = this.personOf(user)
      return [{ id, name: person.name, ...(person.handle ? { handle: person.handle } : {}) }]
    })
  }

  async send(conversation: string, draft: Outgoing): Promise<ProviderMessage> {
    const body = mrkdwnOf(draft.text, await this.mentioned(draft))
    const thread = draft.thread ?? draft.replyTo
    if (draft.attachments?.length) return this.sendFiles(conversation, draft, body, thread)
    const said = await this.api.call('chat.postMessage', {
      channel: conversation,
      text: body,
      ...(thread ? { thread_ts: thread } : {}),
      ...(thread && draft.broadcast ? { reply_broadcast: true } : {}),
    })
    const posted = record(said.message)
    const raw: Said = { ...posted, ts: text(said.ts) || text(posted.ts) }
    raw.user ??= this.self
    const [message] = await this.mapped(text(said.channel) || conversation, [raw], !!thread)
    if (!message) throw new SlackError('no_message')
    return message
  }

  private async upload(file: OutgoingFile): Promise<string> {
    const request = this.host.request
    if (!request) throw new Error(WORDS.files)
    const said = await this.api.call('files.getUploadURLExternal', {
      filename: file.name,
      length: file.bytes.length,
    })
    await request({
      url: text(said.upload_url),
      method: 'POST',
      type: file.type || 'application/octet-stream',
      body: file.bytes,
    })
    return text(said.file_id)
  }

  private async sendFiles(
    conversation: string,
    draft: Outgoing,
    body: string,
    thread: string | undefined,
  ): Promise<ProviderMessage> {
    const ids: string[] = []
    for (const file of draft.attachments ?? []) ids.push(await this.upload(file))
    await this.api.call('files.completeUploadExternal', {
      files: JSON.stringify(
        ids.map((id, index) => ({ id, title: draft.attachments?.[index]?.name ?? 'file' })),
      ),
      channel_id: conversation,
      ...(body ? { initial_comment: body } : {}),
      ...(thread ? { thread_ts: thread } : {}),
    })
    const first = ids[0] ?? ''
    for (let tries = 0; tries < 8; tries++) {
      const info = record((await this.api.call('files.info', { file: first })).file)
      const shares = record(info.shares)
      const where = [
        ...list(record(shares.public)[conversation]),
        ...list(record(shares.private)[conversation]),
      ]
      const ts = text(where[0]?.ts)
      if (ts) {
        const found = await this.fetchOne(conversation, ts, thread)
        if (found) return found
      }
      await this.wait(500 * (tries + 1))
    }
    const [message] = await this.mapped(
      conversation,
      [
        {
          ts: String(this.host.now() / 1000),
          user: this.self,
          text: body,
          files: ids.map((id, index) => {
            const file = draft.attachments?.[index]
            return { id, name: file?.name, mimetype: file?.type, size: file?.bytes.length }
          }),
          ...(thread ? { thread_ts: thread } : {}),
        },
      ],
      !!thread,
    )
    if (!message) throw new SlackError('no_message')
    return message
  }

  private async fetchOne(
    conversation: string,
    ts: string,
    thread?: string,
  ): Promise<ProviderMessage | null> {
    const said = thread
      ? await this.api.call('conversations.replies', {
          channel: conversation,
          ts: thread,
          oldest: ts,
          latest: ts,
          inclusive: true,
          limit: 2,
        })
      : await this.api.call('conversations.history', {
          channel: conversation,
          latest: ts,
          inclusive: true,
          limit: 1,
        })
    const raw = list(said.messages).find((one) => text(one.ts) === ts)
    if (!raw) return null
    const [message] = await this.mapped(conversation, [raw], !!thread)
    return message ?? null
  }

  async attachment(conversation: string, message: string, ref: string): Promise<Uint8Array> {
    const request = this.host.request
    if (!request) throw new Error(WORDS.files)
    const kept = this.raw.get(`${conversation}\n${message}`)
    let file = list(kept?.files).find((one) => text(one.id) === ref)
    if (!file || !text(file.url_private))
      file = record((await this.api.call('files.info', { file: ref })).file)
    const url = text(file.url_private_download) || text(file.url_private)
    if (!url) throw new SlackError('file_not_found')
    return request({ url, bearer: this.token })
  }

  async edit(conversation: string, message: string, draft: Outgoing): Promise<void> {
    await this.api.call('chat.update', {
      channel: conversation,
      ts: message,
      text: mrkdwnOf(draft.text, await this.mentioned(draft)),
    })
  }

  async remove(conversation: string, message: string, everyone: boolean): Promise<void> {
    if (!everyone) throw new Error(WORDS.forEveryone)
    await this.api.call('chat.delete', { channel: conversation, ts: message })
  }

  async react(conversation: string, message: string, emoji: string, on: boolean): Promise<void> {
    let name: string
    try {
      name = nameFor(this.table, emoji)
    } catch {
      throw new Error(WORDS.unknownEmoji)
    }
    try {
      await this.api.call(on ? 'reactions.add' : 'reactions.remove', {
        channel: conversation,
        timestamp: message,
        name,
      })
    } catch (error) {
      if (error instanceof SlackError && ['already_reacted', 'no_reaction'].includes(error.code))
        return
      throw error
    }
  }

  async pin(conversation: string, message: string, on: boolean): Promise<void> {
    try {
      await this.api.call(on ? 'pins.add' : 'pins.remove', {
        channel: conversation,
        timestamp: message,
      })
    } catch (error) {
      if (error instanceof SlackError && ['already_pinned', 'no_pin'].includes(error.code)) return
      throw error
    }
  }

  async markRead(conversation: string, upTo: string): Promise<void> {
    await this.api.call('conversations.mark', { channel: conversation, ts: upTo })
    const was = this.known.get(conversation)
    if (was) this.known.set(conversation, { ...was, unread: 0 })
  }

  async markUnread(conversation: string): Promise<void> {
    const said = await this.api.call('conversations.history', { channel: conversation, limit: 1 })
    const latest = text(list(said.messages)[0]?.ts)
    if (!latest) return
    await this.api.call('conversations.mark', { channel: conversation, ts: earlier(latest) })
    const was = this.known.get(conversation)
    if (was) {
      const next = { ...was, unread: Math.max(1, was.unread) }
      this.known.set(conversation, next)
      this.emit({ t: 'conversation', conversation: next })
    }
  }

  async search(query: string, conversation?: string): Promise<ProviderMessage[]> {
    const where = conversation ? this.known.get(conversation) : undefined
    const partner = where?.kind === 'direct' ? where.people[0]?.handle : undefined
    const scoped =
      where?.kind === 'group' && where.title && !where.title.includes(',')
        ? `${query} in:#${where.title}`
        : partner
          ? `${query} in:@${partner}`
          : query
    const said = await this.api.call('search.messages', {
      query: scoped,
      count: 50,
      sort: 'timestamp',
    })
    const matches = list(record(said.messages).matches).filter(
      (one) => !conversation || text(record(one.channel).id) === conversation,
    )
    const out: ProviderMessage[] = []
    for (const match of matches) {
      const channel = text(record(match.channel).id)
      const [message] = await this.mapped(channel, [match])
      if (message) out.push(message)
    }
    return out
  }

  async members(conversation: string): Promise<Member[]> {
    const all = await this.api.ids(
      'conversations.members',
      { channel: conversation, limit: 200 },
      'members',
      10,
    )
    await this.ensure(all)
    const creator = text(
      record((await this.api.call('conversations.info', { channel: conversation })).channel)
        .creator,
    )
    return all.map((id) => {
      const user = this.users.get(id)
      const person = user ? this.personOf(user) : { id, name: id }
      const role: ConversationRole =
        id === creator ? 'owner' : user?.is_admin === true ? 'admin' : 'member'
      const member: Member = { ...person, role }
      if (user?.is_bot === true) member.bot = true
      const on = this.online.get(id)
      if (on !== undefined) member.online = on
      return member
    })
  }

  async people(query: string): Promise<Person[]> {
    await this.allUsers()
    const wanted = query.trim().toLowerCase()
    return [...this.users.values()]
      .filter(
        (user) => user.deleted !== true && user.is_bot !== true && text(user.id) !== 'USLACKBOT',
      )
      .map((user) => this.personOf(user))
      .filter(
        (person) =>
          !wanted ||
          person.name.toLowerCase().includes(wanted) ||
          (person.handle ?? '').toLowerCase().includes(wanted),
      )
      .slice(0, 50)
  }

  async begin(people: readonly string[], title?: string): Promise<Conversation> {
    let channel: Said
    if (title?.trim()) {
      channel = record(
        (await this.api.call('conversations.create', { name: slugOf(title), is_private: true }))
          .channel,
      )
      const others = people.filter((one) => one !== this.self)
      if (others.length)
        await this.api.call('conversations.invite', {
          channel: text(channel.id),
          users: others.join(','),
        })
    } else {
      channel = record(
        (
          await this.api.call('conversations.open', {
            users: people.filter((one) => one !== this.self).join(','),
            return_im: true,
          })
        ).channel,
      )
      if (!channel.is_im && !channel.is_mpim && !channel.name) {
        channel = record(
          (await this.api.call('conversations.info', { channel: text(channel.id) })).channel,
        )
      }
    }
    await this.ensure([text(channel.user)])
    const conversation = this.conversationOf(channel)
    this.emit({ t: 'conversation', conversation })
    return conversation
  }

  async invite(conversation: string, people: readonly string[]): Promise<void> {
    await this.api.call('conversations.invite', { channel: conversation, users: people.join(',') })
  }

  async kick(conversation: string, person: string): Promise<void> {
    await this.api.call('conversations.kick', { channel: conversation, user: person })
  }

  async rename(conversation: string, title: string): Promise<void> {
    const said = await this.api.call('conversations.rename', {
      channel: conversation,
      name: slugOf(title),
    })
    this.changed(record(said.channel))
  }

  async describe(conversation: string, topic: string): Promise<void> {
    await this.api.call('conversations.setTopic', { channel: conversation, topic })
    const was = this.known.get(conversation)
    if (was) {
      const next = { ...was, topic }
      this.known.set(conversation, next)
      this.emit({ t: 'conversation', conversation: next })
    }
  }

  async leave(conversation: string): Promise<void> {
    if (this.known.get(conversation)?.kind === 'direct')
      await this.api.call('conversations.close', { channel: conversation })
    else await this.api.call('conversations.leave', { channel: conversation })
    this.known.delete(conversation)
    this.emit({ t: 'gone', conversation })
  }

  async picture(id: string): Promise<Uint8Array | null> {
    const person = this.known.get(id)?.picture ?? id
    await this.ensure([person])
    const profile = record(this.users.get(person)?.profile)
    const url = text(profile.image_192) || text(profile.image_72)
    if (!url) return null
    if (this.host.request && /^https:\/\/[a-z0-9.-]+\.slack-edge\.com\//.test(url))
      return this.host.request({ url })
    const answer = await this.host.fetch(url)
    return answer.ok ? new Uint8Array(await answer.arrayBuffer()) : null
  }

  private changed(channel: Said, joined = false): void {
    if (!text(channel.id)) return
    const was = this.known.get(text(channel.id))
    if (!was && (!joined || channel.is_member === false)) return
    const next = this.conversationOf(
      was ? { ...channel, unread_count_display: was.unread } : channel,
    )
    this.emit({ t: 'conversation', conversation: next })
  }

  private async channelChanged(id: string, joined = false): Promise<void> {
    if (!joined && !this.known.has(id)) return
    const said = await this.api.call('conversations.info', { channel: id })
    this.changed(record(said.channel), joined)
  }

  private async heardMessage(event: Said): Promise<void> {
    const channel = text(event.channel)
    const subtype = text(event.subtype)
    if (subtype === 'message_deleted') {
      this.raw.delete(`${channel}\n${text(event.deleted_ts)}`)
      this.noted(channel, text(event.deleted_ts))
      this.emit({ t: 'deleted', conversation: channel, message: text(event.deleted_ts) })
      return
    }
    if (subtype === 'message_changed' || subtype === 'message_replied' || isRecord(event.message)) {
      const inner = record(event.message)
      if (!text(inner.ts)) return
      const shown = await this.shapes(channel, inner)
      const message = shown[0]
      if (!message) return
      if (!message.thread) this.noted(channel, message.id)
      if (message.deleted && !message.replies)
        this.emit({ t: 'deleted', conversation: channel, message: message.id })
      else for (const one of shown) this.emit({ t: 'changed', message: one })
      return
    }
    if (!this.known.has(channel)) await this.channelChanged(channel, true).catch(() => undefined)
    const shown = await this.shapes(channel, event)
    const message = shown[0]
    if (!message) return
    if (!message.thread) {
      this.noted(channel, message.id)
      this.bump(channel, message)
    }
    for (const one of shown) this.emit({ t: 'message', message: one })
    const parent = text(event.thread_ts)
    if (parent && parent !== message.id)
      void this.parentChanged(channel, parent).catch(() => undefined)
  }

  private async shapes(channel: string, raw: Said): Promise<ProviderMessage[]> {
    const [inChannel] = await this.mapped(channel, [raw])
    if (!inChannel) return []
    if (text(raw.subtype) !== 'thread_broadcast') return [inChannel]
    const [inThread] = await this.mapped(channel, [raw], true)
    return inThread ? [inChannel, inThread] : [inChannel]
  }

  private async parentChanged(channel: string, parent: string): Promise<void> {
    if (!this.raw.has(`${channel}\n${parent}`)) return
    const message = await this.fetchOne(channel, parent)
    if (!message) return
    this.noted(channel, parent)
    this.emit({ t: 'changed', message })
  }

  private async heardReaction(event: Said, on: boolean): Promise<void> {
    const item = record(event.item)
    const channel = text(item.channel)
    const ts = text(item.ts)
    if (!channel || !ts) return
    const key = `${channel}\n${ts}`
    let raw = this.raw.get(key)
    if (!raw) {
      const said = await this.api.call('reactions.get', { channel, timestamp: ts, full: true })
      raw = record(said.message)
    } else {
      const name = text(event.reaction)
      const user = text(event.user)
      const reactions = list(raw.reactions).map((one) => ({ ...one }))
      let entry = reactions.find((one) => one.name === name)
      if (!entry && on) {
        entry = { name, users: [], count: 0 }
        reactions.push(entry)
      }
      if (entry) {
        const users = (Array.isArray(entry.users) ? entry.users : []).filter((one) => one !== user)
        if (on) users.push(user)
        entry.users = users
        entry.count = users.length
      }
      raw = {
        ...raw,
        reactions: reactions.filter((one) => Array.isArray(one.users) && one.users.length),
      }
    }
    this.changedAll(channel, await this.shapes(channel, raw))
  }

  private changedAll(channel: string, shown: readonly ProviderMessage[]): void {
    const message = shown[0]
    if (message && !message.thread) this.noted(channel, message.id)
    for (const one of shown) this.emit({ t: 'changed', message: one })
  }

  private async heardPin(event: Said, on: boolean): Promise<void> {
    const channel = text(event.channel_id) || text(record(event.item).channel)
    const inner = record(record(event.item).message)
    const ts = text(inner.ts)
    if (!channel || !ts) return
    const was = this.raw.get(`${channel}\n${ts}`) ?? inner
    const pinned = (Array.isArray(was.pinned_to) ? was.pinned_to : []).filter(
      (one) => one !== channel,
    )
    if (on) pinned.push(channel)
    this.changedAll(channel, await this.shapes(channel, { ...was, pinned_to: pinned }))
  }

  private readonly handlers: Handlers = {
    message: (event) => void this.heardMessage(event).catch(() => undefined),
    reaction_added: (event) => void this.heardReaction(event, true).catch(() => undefined),
    reaction_removed: (event) => void this.heardReaction(event, false).catch(() => undefined),
    pin_added: (event) => void this.heardPin(event, true).catch(() => undefined),
    pin_removed: (event) => void this.heardPin(event, false).catch(() => undefined),
    channel_rename: (event) => this.changed(record(event.channel)),
    group_rename: (event) => this.changed(record(event.channel)),
    channel_archive: (event) =>
      void this.channelChanged(text(event.channel)).catch(() => undefined),
    channel_unarchive: (event) =>
      void this.channelChanged(text(event.channel)).catch(() => undefined),
    group_archive: (event) => void this.channelChanged(text(event.channel)).catch(() => undefined),
    group_unarchive: (event) =>
      void this.channelChanged(text(event.channel)).catch(() => undefined),
    channel_deleted: (event) => this.dropped(text(event.channel)),
    group_deleted: (event) => this.dropped(text(event.channel)),
    channel_left: (event) => this.dropped(text(event.channel)),
    group_left: (event) => this.dropped(text(event.channel)),
    im_close: (event) => this.dropped(text(event.channel)),
    member_left_channel: (event) => {
      if (text(event.user) === this.self) this.dropped(text(event.channel))
    },
    member_joined_channel: (event) => {
      if (text(event.user) === this.self)
        void this.channelChanged(text(event.channel), true).catch(() => undefined)
    },
    channel_created: (event) => {
      const channel = record(event.channel)
      this.changed(channel, text(channel.creator) === this.self)
    },
    group_open: (event) =>
      void this.channelChanged(text(event.channel), true).catch(() => undefined),
    im_open: (event) => void this.channelChanged(text(event.channel), true).catch(() => undefined),
    im_created: (event) => this.changed(record(event.channel), true),
    user_change: (event) => {
      const user = record(event.user)
      if (!text(user.id)) return
      this.users.set(text(user.id), user)
      const person = this.personOf(user)
      for (const one of [...this.known.values()]) {
        if (one.kind !== 'direct' || one.picture !== person.id) continue
        const next: Conversation = { ...one, title: person.name, people: [person] }
        this.known.set(one.id, next)
        this.emit({ t: 'conversation', conversation: next })
      }
    },
    team_join: (event) => {
      const user = record(event.user)
      if (text(user.id)) this.users.set(text(user.id), user)
    },
  }

  private dropped(conversation: string): void {
    if (!conversation) return
    this.known.delete(conversation)
    this.emit({ t: 'gone', conversation })
  }

  heard(event: Said): void {
    this.handlers[text(event.type)]?.(event)
  }

  start(hear: (event: ProviderEvent) => void): () => void {
    this.hearers.add(hear)
    hear({ t: 'status', status: this.status })
    return () => this.hearers.delete(hear)
  }

  close(): Promise<void> {
    this.closed = true
    this.stop()
    this.hearers.clear()
    if (live.get(this.account.id) === this) live.delete(this.account.id)
    return Promise.resolve()
  }
}
