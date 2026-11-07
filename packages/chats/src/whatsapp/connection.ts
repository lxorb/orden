import type {
  AnyMessageContent,
  Chat,
  ConnectionState,
  Contact,
  GroupMetadata,
  MinimalMessage,
  MiscMessageGenerationOptions,
  WAMessage,
  WAMessageKey,
  WAMessageUpdate,
  proto,
} from '@whiskeysockets/baileys'
import type {
  Account,
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
  ProviderPoll,
} from '../provider'
import { atOf, Cache, cacheName, type ChatRow, type GroupRow, secondsOf } from './cache'
import {
  FORBIDDEN,
  LOGGED_OUT,
  OUTDATED,
  REPLACED,
  RESTART,
  statusOf,
  TIMED_OUT,
  type Events,
  type Kit,
  type Link,
  type Load,
} from './client'
import { whatsappOf } from './format'
import {
  contentOf,
  contextInfoOf,
  firstOf,
  isPoll,
  MEDIA_REF,
  mediaOf,
  messageOf,
  pollOf,
  type Context,
} from './map'
import { download, Expired, sealMedia, upload, type MediaKind } from './media'
import { authName, Shelf } from './shelf'

export const WORDS = {
  signedOut: 'Signed out of WhatsApp. Connect again.',
  scan: 'Scan with WhatsApp on your phone',
  scanHow: 'WhatsApp > Settings > Linked devices > Link a device',
  code: 'In WhatsApp on your phone, open Settings > Linked devices > Link a device > Link with phone number instead, and enter this code',
  expired: 'The QR code expired. Try again.',
  replaced: 'WhatsApp was opened with this link somewhere else. Connect again.',
  outdated: 'WhatsApp no longer accepts this version of Orden. Update Orden.',
  refused: 'WhatsApp refused this connection',
  needsApp: 'WhatsApp needs the Orden app',
  unknownNumber: 'That number is not on WhatsApp',
  notHere: 'WhatsApp cannot do that in this conversation',
  owner: 'WhatsApp makes a new group owner only from its own app',
  noMessage: 'That message is no longer here',
  gone: 'That file is no longer on WhatsApp',
  offline: 'WhatsApp is not connected right now',
} as const

const WHATSAPP_USER = '@s.whatsapp.net'
const GROUP = '@g.us'
const BROADCAST = '@broadcast'
const NEWSLETTER = '@newsletter'
const STATUS = 'status@broadcast'
const TYPING_FOR = 10_000
const MOST_RETRIES = 3
const OLDER = 50
const OLDER_WAIT = 8000
const PIN_FOR = 604_800 as const

const live = new Map<string, WhatsAppConnection>()

function bareJid(jid: string): string {
  const [user = '', server = ''] = jid.split('@')
  return `${user.split(':')[0]}@${server}`
}

function digitsOf(jid: string): string {
  return jid.split('@')[0]?.split(':')[0] ?? ''
}

function kindOfFile(file: OutgoingFile): NonNullable<OutgoingFile['kind']> {
  if (file.kind) return file.kind
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  return 'file'
}

function mediaKindOf(kind: NonNullable<OutgoingFile['kind']>): MediaKind {
  if (kind === 'image') return 'image'
  if (kind === 'video' || kind === 'gif') return 'video'
  if (kind === 'audio' || kind === 'voice') return 'audio'
  if (kind === 'sticker') return 'sticker'
  return 'document'
}

function roleOf(admin: GroupRow['participants'][number]['admin']): ConversationRole {
  if (admin === 'superadmin') return 'owner'
  if (admin === 'admin') return 'admin'
  return 'member'
}

function groupRowOf(meta: Partial<GroupMetadata> & { id: string }, old?: GroupRow): GroupRow {
  const row: GroupRow = {
    id: meta.id,
    subject: meta.subject ?? old?.subject ?? '',
    participants: meta.participants
      ? meta.participants.map((one) => ({ id: bareJid(one.id), admin: one.admin ?? null }))
      : (old?.participants ?? []),
  }
  const desc = meta.desc ?? old?.desc
  if (desc !== undefined) row.desc = desc
  const announce = meta.announce ?? old?.announce
  if (announce !== undefined) row.announce = announce
  const community = meta.isCommunityAnnounce ?? meta.isCommunity ?? old?.community
  if (community !== undefined) row.community = community
  const parent = meta.linkedParent ?? old?.parent
  if (parent) row.parent = parent
  return row
}

export async function forget(load: Load, account: string, host: Host): Promise<void> {
  const one = live.get(account)
  live.delete(account)
  if (one) await one.logOut().catch(() => undefined)
  else if (host.wire) {
    const kit = await load(host.wire).catch(() => null)
    const shelf = kit ? await Shelf.read(host, kit, account).catch(() => null) : null
    if (kit && shelf) {
      const left = new WhatsAppConnection(kit, host, shelf)
      await left
        .signIn(undefined, false)
        .then(() => left.logOut())
        .catch(() => undefined)
      left.stop()
    }
  }
  await host.sealed?.write(cacheName(account), null).catch(() => undefined)
  await host.sealed?.write(authName(account), null).catch(() => undefined)
}

export async function open(
  load: Load,
  config: Readonly<Record<string, string>>,
  host: Host,
  known?: string,
): Promise<Connection> {
  if (!host.wire) throw new Error(WORDS.needsApp)
  const kit = await load(host.wire)
  let shelf: Shelf | null
  if (known !== undefined) {
    shelf = await Shelf.read(host, kit, known)
    if (!shelf) throw new Error(WORDS.signedOut)
  } else shelf = new Shelf(host, kit, kit.fresh())
  const one = new WhatsAppConnection(kit, host, shelf)
  if (known !== undefined) await one.cache.load(known)
  try {
    await one.signIn(config.phone, known === undefined)
  } catch (error) {
    one.stop()
    if (known !== undefined && error instanceof Error && error.message === WORDS.signedOut)
      await one.forgetAll()
    throw error
  }
  live.set(one.account.id, one)
  return one
}

type Hearer = (event: ProviderEvent) => void

interface Waiter {
  done(): void
  failed(error: Error): void
}

class WhatsAppConnection implements Connection {
  account: Account = { id: '', label: '' }
  readonly cache: Cache
  private link: Link | null = null
  private ready = false
  private stopped = false
  private waiter: Waiter | null = null
  private phone: string | undefined
  private asked = false
  private retries = 0
  private retry: ReturnType<typeof setTimeout> | null = null
  private readonly hearers = new Set<Hearer>()
  private readonly typists = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly older = new Map<string, () => void>()

  constructor(
    private readonly kit: Kit,
    private readonly host: Host,
    private readonly shelf: Shelf,
  ) {
    this.cache = new Cache(host, kit)
  }

  private emit(event: ProviderEvent): void {
    if (!this.ready) return
    for (const hear of this.hearers) hear(event)
  }

  private get me(): string {
    return bareJid(this.shelf.creds.me?.id ?? '')
  }

  private get meLid(): string {
    return bareJid(this.shelf.creds.me?.lid ?? '')
  }

  private mine(jid: string): boolean {
    const bare = bareJid(jid)
    return bare === this.me || (!!this.meLid && bare === this.meLid)
  }

  signIn(phone: string | undefined, fresh: boolean): Promise<void> {
    const digits = phone?.replace(/\D/g, '')
    this.phone = digits?.length ? digits : undefined
    return new Promise<void>((resolve, reject) => {
      this.waiter = {
        done: () => {
          this.waiter = null
          resolve()
        },
        failed: (error) => {
          this.waiter = null
          reject(error)
        },
      }
      this.dial()
    }).then(() => this.opened(fresh))
  }

  private async opened(fresh: boolean): Promise<void> {
    const me = this.shelf.creds.me
    if (!me?.id) throw new Error(WORDS.signedOut)
    const id = digitsOf(me.id)
    const self: Person = { id: this.me, name: firstOf(me.name, `+${id}`), phone: `+${id}` }
    this.account = { id, label: me.name ? `${me.name} (+${id})` : `+${id}`, self }
    this.host.show?.(null)
    await this.shelf.keepAs(id)
    if (fresh) await this.cache.keepAs(id)
    this.ready = true
    void this.refreshGroups()
  }

  private async refreshGroups(): Promise<void> {
    const groups = await this.link?.groups().catch(() => null)
    if (!groups) return
    for (const meta of Object.values(groups)) {
      this.cache.groups.set(meta.id, groupRowOf(meta, this.cache.groups.get(meta.id)))
      this.chatRow(meta.id)
    }
    this.cache.touch()
    this.emit({ t: 'conversations', conversations: this.conversationsNow() })
  }

  private dial(): void {
    if (this.stopped) return
    const link = this.kit.dial({
      creds: this.shelf.creds,
      keys: this.shelf.keys,
      message: (key) => Promise.resolve(this.stored(key)?.message ?? undefined),
    })
    this.link = link
    const on = <E extends keyof Events>(event: E, hear: (data: Events[E]) => void) =>
      link.on(event, (data) => {
        if (this.link !== link) return
        try {
          hear(data)
        } catch {
          return
        }
      })
    on('creds.update', (update) => this.shelf.credsChanged(update))
    on('connection.update', (update) => this.connectionChanged(link, update))
    on('messaging-history.set', (set) => this.historySet(set.chats, set.contacts, set.messages))
    on('chats.upsert', (chats) => this.chatsChanged(chats))
    on('chats.update', (chats) => this.chatsChanged(chats))
    on('chats.delete', (ids) => {
      for (const id of ids) {
        this.cache.forgetChat(id)
        this.emit({ t: 'gone', conversation: id })
      }
    })
    on('contacts.upsert', (contacts) => this.contactsChanged(contacts))
    on('contacts.update', (contacts) => this.contactsChanged(contacts))
    on('messages.upsert', ({ messages, type }) => {
      for (const message of messages) this.heard(message, type === 'notify')
    })
    on('messages.update', (updates) => {
      for (const update of updates) this.updated(update)
    })
    on('messages.delete', (gone) => {
      if ('keys' in gone) for (const key of gone.keys) this.removed(key)
      else {
        for (const message of [...this.cache.list(gone.jid)]) this.removed(message.key)
      }
    })
    on('messages.reaction', (reactions) => {
      for (const { key, reaction } of reactions) this.reacted(key, reaction)
    })
    on('message-receipt.update', (receipts) => {
      for (const { key, receipt } of receipts) this.receipt(key, receipt)
    })
    on('presence.update', ({ id, presences }) => this.presence(id, presences))
    on('groups.upsert', (groups) => this.groupsChanged(groups))
    on('groups.update', (groups) => this.groupsChanged(groups))
    on('group-participants.update', ({ id, participants, action }) => {
      const row = this.cache.groups.get(id)
      if (!row) {
        void this.link
          ?.group(id)
          .then((meta) => this.groupsChanged([meta]))
          .catch(() => undefined)
        return
      }
      const ids = participants.map((one) => bareJid(one))
      if (action === 'add')
        row.participants = [
          ...row.participants.filter((one) => !ids.includes(one.id)),
          ...ids.map((one) => ({ id: one, admin: null })),
        ]
      else if (action === 'remove') {
        row.participants = row.participants.filter((one) => !ids.includes(one.id))
        if (ids.some((one) => this.mine(one))) this.chatRow(id).readOnly = true
      } else if (action === 'promote' || action === 'demote')
        row.participants = row.participants.map((one) =>
          ids.includes(one.id) ? { ...one, admin: action === 'promote' ? 'admin' : null } : one,
        )
      this.cache.touch()
      this.emitConversation(id)
    })
  }

  private connectionChanged(link: Link, update: Partial<ConnectionState>): void {
    if (update.qr && this.waiter) void this.signInScreen(link, update.qr)
    if (update.connection === 'open') {
      this.retries = 0
      if (this.waiter) this.waiter.done()
      else this.emit({ t: 'status', status: 'online' })
      return
    }
    if (update.connection === 'connecting' && !this.waiter)
      this.emit({ t: 'status', status: 'connecting' })
    if (update.connection !== 'close') return
    if (this.link === link) this.link = null
    if (this.stopped) return
    const code = statusOf(update.lastDisconnect?.error)
    if (code === RESTART) {
      this.dial()
      return
    }
    if (code === LOGGED_OUT || code === FORBIDDEN) {
      if (this.waiter)
        this.waiter.failed(new Error(code === FORBIDDEN ? WORDS.refused : WORDS.signedOut))
      else void this.lost()
      return
    }
    if (code === OUTDATED) {
      this.fail(WORDS.outdated)
      return
    }
    if (code === REPLACED) {
      this.fail(WORDS.replaced)
      return
    }
    if (this.waiter && code === TIMED_OUT && !this.shelf.creds.registered) {
      this.waiter.failed(new Error(WORDS.expired))
      return
    }
    if (this.waiter && ++this.retries > MOST_RETRIES) {
      this.waiter.failed(
        update.lastDisconnect?.error instanceof Error
          ? update.lastDisconnect.error
          : new Error(WORDS.refused),
      )
      return
    }
    if (!this.waiter) this.emit({ t: 'status', status: 'offline' })
    const wait = Math.min(60_000, 1000 * 2 ** Math.min(this.retries++, 6))
    this.retry = setTimeout(() => {
      this.retry = null
      this.dial()
    }, wait)
  }

  private fail(reason: string): void {
    if (this.waiter) this.waiter.failed(new Error(reason))
    else this.emit({ t: 'status', status: 'offline', reason })
  }

  private async signInScreen(link: Link, qr: string): Promise<void> {
    if (this.shelf.creds.registered) return
    if (this.phone) {
      if (this.asked) return
      this.asked = true
      try {
        const code = await link.pairingCode(this.phone)
        const shown = code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code
        this.host.show?.({ kind: 'wait', label: WORDS.code, note: shown })
      } catch (error) {
        this.waiter?.failed(error instanceof Error ? error : new Error(String(error)))
      }
      return
    }
    this.host.show?.({ kind: 'qr', data: qr, label: WORDS.scan, note: WORDS.scanHow })
  }

  private async lost(): Promise<void> {
    if (this.stopped) return
    this.emit({ t: 'status', status: 'signed-out', reason: WORDS.signedOut })
    this.stop()
    live.delete(this.account.id)
    await this.forgetAll()
  }

  async forgetAll(): Promise<void> {
    await this.shelf.forget().catch(() => undefined)
    await this.cache.forget().catch(() => undefined)
  }

  stop(): void {
    this.stopped = true
    if (this.retry) clearTimeout(this.retry)
    this.retry = null
    for (const timer of this.typists.values()) clearTimeout(timer)
    this.typists.clear()
    const link = this.link
    this.link = null
    link?.close()
  }

  async logOut(): Promise<void> {
    const link = this.link
    this.stopped = true
    if (link) await link.logOut().catch(() => undefined)
    this.stop()
    await this.forgetAll()
  }

  private stored(key: WAMessageKey): WAMessage | undefined {
    if (!key.id) return undefined
    return key.remoteJid ? this.cache.find(key.remoteJid, key.id) : this.cache.findAnywhere(key.id)
  }

  private needLink(): Link {
    if (!this.link) throw new Error(WORDS.offline)
    return this.link
  }

  private chatRow(jid: string): ChatRow {
    let row = this.cache.chats.get(jid)
    if (!row) {
      row = { id: jid, unread: 0, lastAt: null }
      this.cache.chats.set(jid, row)
    }
    return row
  }

  private person(jid: string, pushName?: string | null): Person {
    const bare = bareJid(jid)
    if (this.mine(bare) && this.account.self) return this.account.self
    const contact = this.cache.contacts.get(bare)
    const digits = digitsOf(bare)
    const phone = bare.endsWith(WHATSAPP_USER)
      ? `+${digits}`
      : contact?.phone
        ? `+${digitsOf(contact.phone)}`
        : undefined
    const name = firstOf(
      contact?.name,
      contact?.notify,
      pushName,
      contact?.verifiedName,
      phone,
      digits,
    )
    if (pushName && contact && !contact.notify) {
      contact.notify = pushName
      this.cache.touch()
    } else if (pushName && !contact) {
      this.cache.contacts.set(bare, { id: bare, notify: pushName })
      this.cache.touch()
    }
    const out: Person = { id: bare, name }
    if (phone) out.phone = phone
    return out
  }

  private context(): Context {
    return {
      self: this.account.self ?? { id: this.me, name: this.account.label },
      person: (jid, pushName) => this.person(jid, pushName),
      poll: (message) => this.pollOf(message),
      reactions: (message) => this.reactionsOf(message),
      pinned: (message) =>
        !!message.key.id &&
        (this.cache.chats.get(message.key.remoteJid ?? '')?.pins ?? []).includes(message.key.id),
    }
  }

  private mapped(message: WAMessage): ProviderMessage | null {
    return messageOf(message, this.context())
  }

  private pollOf(message: WAMessage): ProviderPoll | undefined {
    const poll = pollOf(contentOf(message.message))
    if (!poll) return undefined
    const tally = this.kit.votes(message, this.me)
    const voters: Record<string, number[]> = {}
    const counts = poll.answers.map((answer) => {
      const found = tally.find((one) => one.name === answer)
      for (const voter of found?.voters ?? []) {
        const id = bareJid(voter)
        ;(voters[id] ??= []).push(poll.answers.indexOf(answer))
      }
      return found?.voters.length ?? 0
    })
    return {
      question: poll.question,
      answers: poll.answers,
      several: poll.several,
      counts,
      mine: voters[this.me] ?? (this.meLid ? voters[this.meLid] : undefined) ?? [],
      voters,
    }
  }

  private reactionsOf(message: WAMessage): Record<string, string[]> | undefined {
    const out: Record<string, string[]> = {}
    for (const reaction of message.reactions ?? []) {
      if (!reaction.text) continue
      const who = this.reactor(reaction.key ?? {}, message)
      ;(out[reaction.text] ??= []).push(who)
    }
    return out
  }

  private reactor(key: proto.IMessageKey, of: WAMessage): string {
    if (key.fromMe) return this.me
    return bareJid(firstOf(key.participant, key.remoteJid, of.key.remoteJid))
  }

  private conversationOf(row: ChatRow): Conversation {
    const jid = row.id
    const group = this.cache.groups.get(jid)
    const last = this.cache.list(jid).at(-1)
    const lastMapped = last ? this.mapped(last) : null
    const isGroup = jid.endsWith(GROUP)
    const readOnlyKind = jid.endsWith(BROADCAST) || jid.endsWith(NEWSLETTER)
    const myRole = group?.participants.find((one) => this.mine(one.id))?.admin
    const conversation: Conversation = {
      id: jid,
      title: firstOf(group?.subject, row.name, isGroup ? null : this.person(jid).name) || null,
      kind: isGroup
        ? group?.community
          ? 'channel'
          : 'group'
        : readOnlyKind
          ? 'channel'
          : 'direct',
      people: isGroup
        ? (group?.participants ?? [])
            .filter((one) => !this.mine(one.id))
            .slice(0, 50)
            .map((one) => this.person(one.id))
        : readOnlyKind
          ? []
          : [this.person(jid)],
      lastAt: row.lastAt ?? (last ? atOf(last) : null),
      unread: row.markedUnread ? Math.max(1, row.unread) : row.unread,
    }
    if (row.muteEnd) conversation.mutedUntil = row.muteEnd < 0 ? 8_640_000_000_000_000 : row.muteEnd
    if (row.pinned) conversation.pinned = true
    if (row.archived) conversation.archived = true
    if (group?.desc) conversation.topic = group.desc
    if (group) {
      conversation.members = group.participants.length
      conversation.role = roleOf(myRole ?? null)
    }
    const announce = !!group?.announce && !myRole
    if (readOnlyKind || announce || row.readOnly) conversation.readOnly = true
    if (lastMapped) conversation.snippet = firstOf(lastMapped.text, lastMapped.attachments[0]?.name)
    return conversation
  }

  private conversationsNow(): Conversation[] {
    return [...this.cache.chats.values()]
      .filter((row) => row.id !== STATUS)
      .map((row) => this.conversationOf(row))
      .sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0))
  }

  private emitConversation(jid: string): void {
    if (jid === STATUS) return
    this.emit({ t: 'conversation', conversation: this.conversationOf(this.chatRow(jid)) })
  }

  private chatsChanged(chats: readonly Partial<Chat>[]): void {
    for (const chat of chats) {
      if (!chat.id) continue
      const row = this.chatRow(chat.id)
      if (chat.name) row.name = chat.name
      if (typeof chat.unreadCount === 'number')
        row.unread = chat.unreadCount < 0 ? 0 : chat.unreadCount
      if (chat.unreadCount === -1) row.markedUnread = true
      if (chat.markedAsUnread !== undefined && chat.markedAsUnread !== null)
        row.markedUnread = chat.markedAsUnread
      if (chat.archived !== undefined && chat.archived !== null) row.archived = chat.archived
      if (chat.pinned !== undefined) row.pinned = !!chat.pinned
      if (chat.muteEndTime !== undefined)
        row.muteEnd = chat.muteEndTime ? secondsOf(chat.muteEndTime) : null
      if (chat.conversationTimestamp)
        row.lastAt = Math.max(row.lastAt ?? 0, secondsOf(chat.conversationTimestamp) * 1000)
      if (chat.ephemeralExpiration !== undefined) row.ephemeral = chat.ephemeralExpiration ?? 0
      if (chat.readOnly !== undefined && chat.readOnly !== null) row.readOnly = chat.readOnly
      this.emitConversation(chat.id)
    }
    this.cache.touch()
  }

  private contactsChanged(contacts: readonly Partial<Contact>[]): void {
    for (const contact of contacts) {
      if (!contact.id) continue
      const ids = [contact.id, contact.lid].filter((one): one is string => !!one)
      for (const id of ids.map(bareJid)) {
        const old = this.cache.contacts.get(id) ?? { id }
        const next = { ...old }
        if (contact.name) next.name = contact.name
        if (contact.notify) next.notify = contact.notify
        if (contact.verifiedName) next.verifiedName = contact.verifiedName
        if (contact.lid) next.lid = bareJid(contact.lid)
        this.cache.contacts.set(id, next)
      }
    }
    this.cache.touch()
  }

  private groupsChanged(groups: readonly Partial<GroupMetadata>[]): void {
    for (const meta of groups) {
      if (!meta.id) continue
      this.cache.groups.set(
        meta.id,
        groupRowOf({ ...meta, id: meta.id }, this.cache.groups.get(meta.id)),
      )
      this.chatRow(meta.id)
      this.emitConversation(meta.id)
    }
    this.cache.touch()
  }

  private historySet(
    chats: readonly Chat[],
    contacts: readonly Contact[],
    messages: readonly WAMessage[],
  ): void {
    this.contactsChanged(contacts)
    for (const chat of chats) if (chat.id) this.chatRow(chat.id)
    this.chatsChanged(chats)
    const touched = new Set<string>()
    for (const message of messages) {
      const jid = message.key.remoteJid
      if (!jid || !message.key.id) continue
      if (this.special(message, false)) continue
      this.cache.put(message, jid)
      touched.add(jid)
      const row = this.chatRow(jid)
      row.lastAt = Math.max(row.lastAt ?? 0, atOf(message))
    }
    for (const jid of touched) this.older.get(jid)?.()
    this.emit({ t: 'conversations', conversations: this.conversationsNow() })
  }

  private special(message: WAMessage, live: boolean): boolean {
    const content = contentOf(message.message)
    const jid = message.key.remoteJid ?? ''
    if (!content) return false
    if (content.reactionMessage?.key) {
      this.reacted(content.reactionMessage.key, {
        key: message.key,
        text: content.reactionMessage.text ?? '',
        senderTimestampMs: content.reactionMessage.senderTimestampMs ?? null,
      })
      return true
    }
    const protocol = message.message?.protocolMessage ?? content.protocolMessage
    if (protocol) {
      const target = protocol.key
      const type = Number(protocol.type)
      if (type === 0 && target?.id) {
        this.revoked({ ...target, remoteJid: firstOf(target.remoteJid, jid) })
      } else if (type === 14 && target?.id && protocol.editedMessage) {
        this.edited(
          { ...target, remoteJid: firstOf(target.remoteJid, jid) },
          protocol.editedMessage,
        )
      } else if (type === 3) {
        this.chatRow(jid).ephemeral = protocol.ephemeralExpiration ?? 0
        this.cache.touch()
        if (live) this.emitConversation(jid)
      }
      return true
    }
    if (content.pinInChatMessage?.key?.id) {
      const row = this.chatRow(jid)
      const id = content.pinInChatMessage.key.id
      const pins = (row.pins ?? []).filter((one) => one !== id)
      row.pins = Number(content.pinInChatMessage.type) === 1 ? [...pins, id] : pins
      this.cache.touch()
      this.changedId(jid, id)
      return true
    }
    if (content.pollUpdateMessage) return true
    return false
  }

  private heard(message: WAMessage, notify: boolean): void {
    const jid = message.key.remoteJid
    if (!jid || !message.key.id || jid === STATUS) return
    if (this.special(message, true)) return
    const known = this.cache.find(jid, message.key.id)
    if (known) {
      message.reactions ??= known.reactions ?? null
      message.pollUpdates ??= known.pollUpdates ?? null
    }
    const fresh = this.cache.put(message, jid) === 'new'
    const row = this.chatRow(jid)
    row.lastAt = Math.max(row.lastAt ?? 0, atOf(message))
    if (fresh && notify && !message.key.fromMe) row.unread += 1
    const mapped = this.mapped(message)
    this.cache.touch()
    if (mapped)
      this.emit(fresh ? { t: 'message', message: mapped } : { t: 'changed', message: mapped })
    this.emitConversation(jid)
  }

  private changedId(jid: string, id: string): void {
    const found = this.cache.find(jid, id)
    const mapped = found ? this.mapped(found) : null
    if (mapped) this.emit({ t: 'changed', message: mapped })
  }

  private revoked(key: WAMessageKey): void {
    const jid = key.remoteJid ?? ''
    const found = key.id ? this.cache.find(jid, key.id) : undefined
    if (!found || !key.id) return
    found.message = null
    found.messageStubType = 1
    this.cache.touch()
    this.changedId(jid, key.id)
  }

  private edited(key: WAMessageKey, content: proto.IMessage): void {
    const jid = key.remoteJid ?? ''
    const found = key.id ? this.cache.find(jid, key.id) : undefined
    if (!found || !key.id) return
    found.message = { editedMessage: { message: content } }
    this.cache.touch()
    this.changedId(jid, key.id)
  }

  private updated({ key, update }: WAMessageUpdate): void {
    const jid = key.remoteJid ?? ''
    const found = key.id ? this.cache.find(jid, key.id) : undefined
    if (!found || !key.id) return
    if (update.message === null && Number(update.messageStubType) === 1) {
      this.revoked(key)
      return
    }
    const edited = contentOf(update.message?.editedMessage?.message ?? undefined)
    if (edited) {
      this.edited(key, edited)
      return
    }
    if (typeof update.status === 'number' && (found.status ?? 0) < update.status)
      found.status = update.status
    if (update.pollUpdates) {
      const authors = new Set(
        update.pollUpdates.map((one) => this.reactor(one.pollUpdateMessageKey ?? {}, found)),
      )
      found.pollUpdates = [
        ...(found.pollUpdates ?? []).filter(
          (one) => !authors.has(this.reactor(one.pollUpdateMessageKey ?? {}, found)),
        ),
        ...update.pollUpdates,
      ]
    }
    if (update.message && !update.message.editedMessage) found.message = update.message
    this.cache.touch()
    this.changedId(jid, key.id)
  }

  private removed(key: WAMessageKey): void {
    const jid = key.remoteJid ?? ''
    if (!key.id) return
    this.cache.remove(jid, key.id)
    this.emit({ t: 'deleted', conversation: jid, message: key.id })
  }

  private reacted(key: WAMessageKey, reaction: proto.IReaction): void {
    const jid = key.remoteJid ?? ''
    const found = key.id ? this.cache.find(jid, key.id) : undefined
    if (!found || !key.id) return
    const who = this.reactor(reaction.key ?? {}, found)
    found.reactions = [
      ...(found.reactions ?? []).filter((one) => this.reactor(one.key ?? {}, found) !== who),
      ...(reaction.text ? [reaction] : []),
    ]
    this.cache.touch()
    this.changedId(jid, key.id)
  }

  private receipt(key: WAMessageKey, receipt: proto.IUserReceipt): void {
    const jid = key.remoteJid ?? ''
    const found = key.id ? this.cache.find(jid, key.id) : undefined
    if (!key.id || !receipt.userJid) return
    if (found) {
      found.userReceipt = [
        ...(found.userReceipt ?? []).filter((one) => one.userJid !== receipt.userJid),
        receipt,
      ]
      this.cache.touch()
    }
    if (receipt.readTimestamp)
      this.emit({ t: 'read', conversation: jid, person: bareJid(receipt.userJid), upTo: key.id })
  }

  private presence(jid: string, presences: Events['presence.update']['presences']): void {
    for (const [participant, data] of Object.entries(presences)) {
      const person = bareJid(participant)
      if (this.mine(person)) continue
      const typing =
        data.lastKnownPresence === 'composing' || data.lastKnownPresence === 'recording'
      const key = `${jid}\n${person}`
      const timer = this.typists.get(key)
      if (timer) clearTimeout(timer)
      this.typists.delete(key)
      if (typing) {
        this.typists.set(
          key,
          setTimeout(() => {
            this.typists.delete(key)
            this.emit({ t: 'typing', conversation: jid, person, on: false })
          }, TYPING_FOR),
        )
      }
      this.emit({ t: 'typing', conversation: jid, person, on: typing })
      if (data.lastKnownPresence === 'available' || data.lastKnownPresence === 'unavailable') {
        const online = data.lastKnownPresence === 'available'
        this.emit(
          data.lastSeen
            ? { t: 'presence', person, online, lastSeen: data.lastSeen * 1000 }
            : { t: 'presence', person, online },
        )
      }
    }
  }

  conversations(): Promise<Conversation[]> {
    return Promise.resolve(this.conversationsNow())
  }

  private pageOf(
    jid: string,
    ask: HistoryAsk,
  ): { messages: ProviderMessage[]; first: WAMessage | undefined } {
    const list = this.cache.list(jid)
    let end = list.length
    if (ask.before) {
      const at = list.findIndex((one) => one.key.id === ask.before)
      end = at === -1 ? list.length : at
    } else if (ask.around) {
      const at = list.findIndex((one) => one.key.id === ask.around)
      if (at !== -1) end = Math.min(list.length, at + Math.ceil(ask.limit / 2))
    }
    const messages: ProviderMessage[] = []
    let start = end
    while (start > 0 && messages.length < ask.limit) {
      start--
      const one = list[start]
      const mapped = one ? this.mapped(one) : null
      if (mapped) messages.unshift(mapped)
    }
    return { messages, first: list[start] }
  }

  async history(conversation: string, ask: HistoryAsk): Promise<Page> {
    let page = this.pageOf(conversation, ask)
    if (ask.before && page.messages.length < ask.limit && this.link) {
      const oldest = this.cache.list(conversation)[0]
      if (oldest?.key.id) {
        const before = this.cache.list(conversation).length
        await new Promise<void>((resolve) => {
          const timer = setTimeout(done, OLDER_WAIT)
          function done() {
            clearTimeout(timer)
            resolve()
          }
          this.older.set(conversation, done)
          this.link
            ?.older(OLDER, oldest.key, secondsOf(oldest.messageTimestamp))
            .catch(() => done())
        })
        this.older.delete(conversation)
        const grew = this.cache.list(conversation).length > before
        page = this.pageOf(conversation, ask)
        if (!grew)
          return {
            messages: page.messages,
            before: page.messages.length >= ask.limit ? (page.messages[0]?.id ?? null) : null,
          }
      }
    }
    return { messages: page.messages, before: page.messages[0]?.id ?? null }
  }

  private options(jid: string, replyTo?: string): MiscMessageGenerationOptions {
    const options: MiscMessageGenerationOptions = {}
    const ephemeral = this.cache.chats.get(jid)?.ephemeral
    if (ephemeral) options.ephemeralExpiration = ephemeral
    if (replyTo) {
      const quoted = this.cache.find(jid, replyTo)
      if (quoted) options.quoted = quoted
    }
    return options
  }

  private written(draft: Outgoing): { text: string; mentions: string[] } {
    let text = whatsappOf(draft.text)
    const mentions: string[] = []
    for (const id of draft.mentions ?? []) {
      const person = this.person(id)
      const at = `@${person.name}`
      if (text.includes(at)) text = text.replace(at, `@${digitsOf(id)}`)
      mentions.push(id)
    }
    return { text, mentions }
  }

  private kept(message: WAMessage | undefined): ProviderMessage {
    if (!message?.key.remoteJid || !message.key.id) throw new Error(WORDS.noMessage)
    this.cache.put(message, message.key.remoteJid)
    const row = this.chatRow(message.key.remoteJid)
    row.lastAt = Math.max(row.lastAt ?? 0, atOf(message))
    const mapped = this.mapped(message)
    if (!mapped) throw new Error(WORDS.noMessage)
    this.emitConversation(message.key.remoteJid)
    return mapped
  }

  async send(conversation: string, draft: Outgoing): Promise<ProviderMessage> {
    const link = this.needLink()
    const options = this.options(conversation, draft.replyTo)
    if (draft.poll) {
      const sent = await link.send(
        conversation,
        {
          poll: {
            name: draft.poll.question,
            values: [...draft.poll.answers],
            selectableCount: draft.poll.several ? 0 : 1,
          },
        },
        options,
      )
      return this.kept(sent)
    }
    const { text, mentions } = this.written(draft)
    const files = draft.attachments ?? []
    let last: ProviderMessage | null = null
    for (const [index, file] of files.entries()) {
      const caption = index === 0 && files.length === 1 ? text : ''
      const message = await this.mediaMessage(conversation, file, caption, mentions, draft.replyTo)
      last = this.kept(await link.relay(conversation, message))
    }
    if (files.length === 1 && text && last) return last
    if (text || !last) {
      const content: AnyMessageContent = { text }
      if (mentions.length) content.mentions = mentions
      last = this.kept(await link.send(conversation, content, options))
    }
    return last
  }

  private async mediaMessage(
    jid: string,
    file: OutgoingFile,
    caption: string,
    mentions: readonly string[],
    replyTo?: string,
  ): Promise<proto.IMessage> {
    const kind = kindOfFile(file)
    const media = mediaKindOf(kind)
    const sealed = await sealMedia(file.bytes, media)
    const placed = await upload(this.host.fetch, await this.needLink().mediaConn(), sealed, media)
    const contextInfo: proto.IContextInfo = {}
    if (mentions.length) contextInfo.mentionedJid = [...mentions]
    const quoted = replyTo ? this.cache.find(jid, replyTo) : undefined
    if (quoted?.key.id) {
      contextInfo.stanzaId = quoted.key.id
      contextInfo.participant = quoted.key.fromMe
        ? this.me
        : firstOf(quoted.key.participant, quoted.key.remoteJid, jid)
      contextInfo.quotedMessage = quoted.message ?? null
    }
    const ephemeral = this.cache.chats.get(jid)?.ephemeral
    if (ephemeral) contextInfo.expiration = ephemeral
    const common = {
      url: placed.url,
      directPath: placed.directPath,
      mediaKey: this.kit.bytes(sealed.mediaKey),
      fileEncSha256: this.kit.bytes(sealed.fileEncSha256),
      fileSha256: this.kit.bytes(sealed.fileSha256),
      fileLength: sealed.fileLength,
      mimetype: file.type,
      mediaKeyTimestamp: Math.floor(this.host.now() / 1000),
      contextInfo,
    }
    const size = {
      ...(file.width ? { width: file.width } : {}),
      ...(file.height ? { height: file.height } : {}),
    }
    const seconds = file.seconds ? { seconds: Math.round(file.seconds) } : {}
    switch (kind) {
      case 'image':
        return { imageMessage: { ...common, ...size, caption } }
      case 'video':
      case 'gif':
        return {
          videoMessage: { ...common, ...size, ...seconds, caption, gifPlayback: kind === 'gif' },
        }
      case 'voice':
        return {
          audioMessage: {
            ...common,
            ...seconds,
            mimetype: 'audio/ogg; codecs=opus',
            ptt: true,
            ...(file.wave?.length
              ? {
                  waveform: this.kit.bytes(
                    Uint8Array.from(file.wave.slice(0, 64), (one) =>
                      Math.max(0, Math.min(100, Math.round(one * 100))),
                    ),
                  ),
                }
              : {}),
          },
        }
      case 'audio':
        return { audioMessage: { ...common, ...seconds } }
      case 'sticker':
        return { stickerMessage: { ...common, ...size, mimetype: 'image/webp' } }
      case 'file':
        return { documentMessage: { ...common, fileName: file.name, title: file.name, caption } }
    }
  }

  private keyOf(conversation: string, message: string): WAMessageKey {
    const found = this.cache.find(conversation, message)
    if (!found) throw new Error(WORDS.noMessage)
    return found.key
  }

  async edit(conversation: string, message: string, draft: Outgoing): Promise<void> {
    const key = this.keyOf(conversation, message)
    const { text, mentions } = this.written(draft)
    const content: AnyMessageContent = { text, edit: key }
    if (mentions.length) content.mentions = mentions
    await this.needLink().send(conversation, content)
    const found = this.cache.find(conversation, message)
    if (found) {
      const old = contentOf(found.message)
      const media = mediaOf(old)
      const next: proto.IMessage = media
        ? {
            ...old,
            [`${media.kind}Message`]: { ...media.field, caption: text },
          }
        : { extendedTextMessage: { text, contextInfo: contextInfoOf(old) ?? null } }
      this.edited(key, next)
    }
  }

  async remove(conversation: string, message: string, everyone: boolean): Promise<void> {
    const found = this.cache.find(conversation, message)
    if (!found) throw new Error(WORDS.noMessage)
    if (everyone) {
      await this.needLink().send(conversation, { delete: found.key })
      this.revoked(found.key)
      return
    }
    await this.needLink().modify(
      {
        deleteForMe: {
          deleteMedia: false,
          key: found.key,
          timestamp: secondsOf(found.messageTimestamp),
        },
      },
      conversation,
    )
    this.removed(found.key)
  }

  async react(conversation: string, message: string, emoji: string, on: boolean): Promise<void> {
    const key = this.keyOf(conversation, message)
    await this.needLink().send(conversation, { react: { text: on ? emoji : '', key } })
    this.reacted(key, { key: { remoteJid: conversation, fromMe: true }, text: on ? emoji : '' })
  }

  async pin(conversation: string, message: string, on: boolean): Promise<void> {
    const key = this.keyOf(conversation, message)
    await this.needLink().send(conversation, { pin: key, type: on ? 1 : 2, time: PIN_FOR })
    const row = this.chatRow(conversation)
    const pins = (row.pins ?? []).filter((one) => one !== message)
    row.pins = on ? [...pins, message] : pins
    this.cache.touch()
    this.changedId(conversation, message)
  }

  async vote(conversation: string, message: string, answers: readonly number[]): Promise<void> {
    const found = this.cache.find(conversation, message)
    const poll = pollOf(contentOf(found?.message))
    if (!found || !poll || !isPoll(contentOf(found.message))) throw new Error(WORDS.noMessage)
    const names = answers.flatMap((at) =>
      poll.answers[at] === undefined ? [] : [poll.answers[at]],
    )
    const voter =
      conversation.endsWith(GROUP) && found.key.participant?.endsWith('@lid') && this.meLid
        ? this.meLid
        : this.me
    const vote = this.kit.vote(found, names, voter)
    const sent = await this.needLink().relay(conversation, vote.message)
    this.updated({
      key: found.key,
      update: {
        pollUpdates: [
          {
            pollUpdateMessageKey: sent.key,
            vote: { selectedOptions: vote.selected },
            senderTimestampMs: this.host.now(),
          },
        ],
      },
    })
  }

  async typing(conversation: string, on: boolean): Promise<void> {
    await this.needLink().presence(on ? 'composing' : 'paused', conversation)
  }

  async markRead(conversation: string, upTo: string): Promise<void> {
    const list = this.cache.list(conversation)
    const end = list.findIndex((one) => one.key.id === upTo)
    const keys = list
      .slice(0, end === -1 ? list.length : end + 1)
      .filter((one) => !one.key.fromMe && one.key.id)
      .slice(-100)
      .map((one) => one.key)
    const row = this.chatRow(conversation)
    if (keys.length) await this.needLink().read(keys)
    const last = list.at(-1)
    if (row.markedUnread && last) {
      await this.needLink().modify(
        {
          markRead: true,
          lastMessages: [{ key: last.key, messageTimestamp: last.messageTimestamp ?? null }],
        },
        conversation,
      )
    }
    row.unread = 0
    row.markedUnread = false
    this.cache.touch()
    this.emitConversation(conversation)
  }

  async markUnread(conversation: string): Promise<void> {
    const last = this.cache.list(conversation).at(-1)
    if (!last) throw new Error(WORDS.notHere)
    await this.needLink().modify(
      {
        markRead: false,
        lastMessages: [{ key: last.key, messageTimestamp: last.messageTimestamp ?? null }],
      },
      conversation,
    )
    this.chatRow(conversation).markedUnread = true
    this.cache.touch()
    this.emitConversation(conversation)
  }

  search(query: string, conversation?: string): Promise<ProviderMessage[]> {
    const words = query.toLowerCase().trim()
    const found: ProviderMessage[] = []
    if (!words) return Promise.resolve(found)
    for (const [jid, list] of this.cache.chatsWithMessages()) {
      if (conversation && jid !== conversation) continue
      for (const message of list) {
        const mapped = this.mapped(message)
        if (!mapped || mapped.deleted) continue
        const haystack = [
          mapped.text,
          ...mapped.attachments.map((one) => one.name),
          mapped.poll?.question ?? '',
        ]
          .join('\n')
          .toLowerCase()
        if (haystack.includes(words)) found.push(mapped)
      }
    }
    return Promise.resolve(found.sort((a, b) => b.at - a.at).slice(0, 200))
  }

  async members(conversation: string): Promise<Member[]> {
    if (!conversation.endsWith(GROUP)) {
      const person = this.person(conversation)
      return [
        { ...person, role: 'member' },
        { ...this.context().self, role: 'member' },
      ]
    }
    const meta = await this.link?.group(conversation).catch(() => null)
    if (meta) this.groupsChanged([meta])
    const row = this.cache.groups.get(conversation)
    return (row?.participants ?? []).map((one) => ({
      ...this.person(one.id),
      role: roleOf(one.admin ?? null),
    }))
  }

  people(query: string): Promise<Person[]> {
    const words = query.toLowerCase().trim()
    const seen = new Set<string>()
    const out: Person[] = []
    for (const contact of this.cache.contacts.values()) {
      if (!contact.id.endsWith(WHATSAPP_USER) || this.mine(contact.id)) continue
      const person = this.person(contact.id)
      if (seen.has(person.id)) continue
      const haystack = `${person.name}\n${person.phone ?? ''}`.toLowerCase()
      const digits = words.replace(/\D/g, '')
      const matches =
        !words ||
        haystack.includes(words) ||
        (!!digits && haystack.replace(/\D/g, '').includes(digits))
      if (!matches) continue
      seen.add(person.id)
      out.push(person)
      if (out.length >= 50) break
    }
    return Promise.resolve(out)
  }

  private async jidOf(person: string): Promise<string> {
    if (person.includes('@')) return bareJid(person)
    const jid = await this.needLink().exists(person.replace(/\D/g, ''))
    if (!jid) throw new Error(WORDS.unknownNumber)
    return bareJid(jid)
  }

  async begin(people: readonly string[], title?: string): Promise<Conversation> {
    const jids = await Promise.all(people.map((one) => this.jidOf(one)))
    if (jids.length === 1 && !title) {
      const [jid = ''] = jids
      this.chatRow(jid)
      this.cache.touch()
      this.emitConversation(jid)
      return this.conversationOf(this.chatRow(jid))
    }
    const meta = await this.needLink().create(title ?? '', jids)
    this.groupsChanged([meta])
    return this.conversationOf(this.chatRow(meta.id))
  }

  private group(conversation: string): void {
    if (!conversation.endsWith(GROUP)) throw new Error(WORDS.notHere)
  }

  async invite(conversation: string, people: readonly string[]): Promise<void> {
    this.group(conversation)
    const jids = await Promise.all(people.map((one) => this.jidOf(one)))
    await this.needLink().participants(conversation, jids, 'add')
  }

  async kick(conversation: string, person: string): Promise<void> {
    this.group(conversation)
    await this.needLink().participants(conversation, [person], 'remove')
  }

  async promote(conversation: string, person: string, role: ConversationRole): Promise<void> {
    this.group(conversation)
    if (role === 'owner') throw new Error(WORDS.owner)
    await this.needLink().participants(
      conversation,
      [person],
      role === 'admin' ? 'promote' : 'demote',
    )
  }

  async rename(conversation: string, title: string): Promise<void> {
    this.group(conversation)
    await this.needLink().subject(conversation, title)
    this.groupsChanged([{ id: conversation, subject: title }])
  }

  async describe(conversation: string, topic: string): Promise<void> {
    this.group(conversation)
    await this.needLink().description(conversation, topic)
    this.groupsChanged([{ id: conversation, desc: topic }])
  }

  async leave(conversation: string): Promise<void> {
    this.group(conversation)
    await this.needLink().leave(conversation)
    this.chatRow(conversation).readOnly = true
    this.cache.touch()
    this.emitConversation(conversation)
  }

  async mute(conversation: string, until: number | null): Promise<void> {
    await this.needLink().modify({ mute: until }, conversation)
    this.chatRow(conversation).muteEnd = until
    this.cache.touch()
    this.emitConversation(conversation)
  }

  private lastMessages(conversation: string): MinimalMessage[] {
    const last = this.cache.list(conversation).at(-1)
    return last ? [{ key: last.key, messageTimestamp: last.messageTimestamp ?? null }] : []
  }

  async archive(conversation: string, on: boolean): Promise<void> {
    await this.needLink().modify(
      { archive: on, lastMessages: this.lastMessages(conversation) },
      conversation,
    )
    this.chatRow(conversation).archived = on
    this.cache.touch()
    this.emitConversation(conversation)
  }

  async pinConversation(conversation: string, on: boolean): Promise<void> {
    await this.needLink().modify({ pin: on }, conversation)
    this.chatRow(conversation).pinned = on
    this.cache.touch()
    this.emitConversation(conversation)
  }

  async picture(id: string): Promise<Uint8Array | null> {
    const url = await this.link?.picture(id).catch(() => undefined)
    if (!url) return null
    const answer = await this.host.fetch(url).catch(() => null)
    if (!answer?.ok) return null
    return new Uint8Array(await answer.arrayBuffer())
  }

  async attachment(conversation: string, message: string, ref: string): Promise<Uint8Array> {
    if (ref !== MEDIA_REF) throw new Error(WORDS.gone)
    let found = this.cache.find(conversation, message)
    let media = mediaOf(contentOf(found?.message))
    if (!found || !media) throw new Error(WORDS.gone)
    try {
      return await download(this.host.fetch, media.field, media.kind)
    } catch (error) {
      if (!(error instanceof Expired) || !this.link) throw error
    }
    found = await this.link.reupload(found)
    this.cache.put(found, conversation)
    media = mediaOf(contentOf(found.message))
    if (!media) throw new Error(WORDS.gone)
    return download(this.host.fetch, media.field, media.kind)
  }

  start(hear: (event: ProviderEvent) => void): () => void {
    this.hearers.add(hear)
    return () => this.hearers.delete(hear)
  }

  async close(): Promise<void> {
    this.stop()
    live.delete(this.account.id)
    await Promise.all([
      this.shelf.flush().catch(() => undefined),
      this.cache.flush().catch(() => undefined),
    ])
  }
}
