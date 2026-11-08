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
  ProviderPoll,
  StickerSet,
} from '../provider'
import { UNKNOWN } from '../provider'
import { borrow, Ended, giveBack, type Notice, type Rpc } from './rpc'
import { list, maybe, number, numbers, said, text, words, type Said } from './said'
import { keptFor, type Kept, type RawStore } from './store'
import { isStyle, markdownOf, stylesOf, withMentions, type Mentioned, type Span } from './text'

const WORDS = {
  signedOut: 'Signed out of Signal. Link Orden again.',
  scan: 'Scan this with Signal on your phone',
  where: 'In Signal: Settings > Linked devices > Link new device',
  syncing: 'Signal is sending your contacts and groups',
  expired: 'The code ran out before it was scanned. Try again.',
  notMine: 'Signal changes only your own messages',
  owner: 'Signal groups have admins, not owners',
  group: 'That is something only a Signal group has',
  noVault: 'Signal needs the system keyring to keep its keys',
} as const

export interface Deps {
  store: () => RawStore
  now?: () => number
}

const MOST_KEPT = 5000
const MOST_KEPT_FILE = 100 * 1024 * 1024
const TYPING_FOR = 15_000
const SAVE_AFTER = 400
const EXPIRY_EVERY = 30_000
const RETRY_FIRST = 2000
const RETRY_MOST = 60_000

interface Me {
  number: string | null
  aci: string
}

interface Meta {
  id: string
  kind: 'direct' | 'group'
  title: string | null
  lastAt: number | null
  unread: number
  snippet?: string
  archived?: boolean
  timer?: number
}

interface Index {
  conversations: Meta[]
  votes?: Record<string, number>
}

interface GroupInfo {
  id: string
  name: string
  description: string
  member: boolean
  blocked: boolean
  members: { uuid: string; number: string; admin: boolean }[]
  onlyAdminsSend: boolean
}

const live = new Map<string, SignalConnection>()

function idOf(at: number, author: string): string {
  return `${at}:${author}`
}

function partsOf(message: string): { at: number; author: string } {
  const cut = message.indexOf(':')
  return { at: Number(message.slice(0, cut)), author: message.slice(cut + 1) }
}

function addressOf(source: Said, prefix = 'source'): string {
  return text(source[`${prefix}Uuid`]) || text(source[`${prefix}Number`]) || text(source[prefix])
}

function kindOf(type: string, voice: boolean): AttachmentKind {
  if (voice) return 'voice'
  if (type === 'image/gif') return 'gif'
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('audio/')) return 'audio'
  return 'file'
}

function base64Of(bytes: Uint8Array): string {
  let out = ''
  for (let at = 0; at < bytes.length; at += 0x8000)
    out += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
  return btoa(out)
}

function bytesOf(base64: string): Uint8Array {
  const plain = atob(base64)
  const out = new Uint8Array(plain.length)
  for (let at = 0; at < plain.length; at++) out[at] = plain.charCodeAt(at)
  return out
}

function dataUri(file: OutgoingFile): string {
  const name = file.name.replace(/[;,\s]/g, '_') || 'file'
  return `data:${file.type || 'application/octet-stream'};filename=${name};base64,${base64Of(file.bytes)}`
}

async function accountsOf(rpc: Rpc): Promise<Me[]> {
  return list(await rpc.call('listAccounts')).flatMap((one) => {
    const aci = text(one.aci)
    const phone = text(one.number)
    if (!aci && !phone) return []
    return [{ aci: aci || phone, number: phone || null }]
  })
}

async function link(rpc: Rpc, host: Host, device: string): Promise<Me> {
  const started = said(await rpc.call('startLink'))
  const uri = text(started.deviceLinkUri)
  host.show?.({ kind: 'qr', data: uri, label: WORDS.scan, note: WORDS.where })
  try {
    const done = said(await rpc.call('finishLink', { deviceLinkUri: uri, deviceName: device }))
    const aci = text(done.aci)
    const phone = text(done.number)
    if (!aci && !phone) throw new Error(WORDS.expired)
    if (aci) return { aci, number: phone || null }
    const found = (await accountsOf(rpc)).find((one) => one.number === phone)
    return found ?? { aci: phone, number: phone }
  } catch (error) {
    if (error instanceof Ended) throw error
    throw new Error(WORDS.expired, { cause: error })
  } finally {
    host.show?.(null)
  }
}

export async function open(
  config: Readonly<Record<string, string>>,
  host: Host,
  known: string | undefined,
  deps: Deps,
): Promise<Connection> {
  if (!host.sealed) throw new Error(WORDS.noVault)
  const rpc = await borrow(host)
  try {
    let me: Me
    if (known !== undefined) {
      const found = (await accountsOf(rpc)).find((one) => one.aci === known || one.number === known)
      if (!found) throw new Error(WORDS.signedOut)
      me = found
    } else {
      me = await link(rpc, host, (config.device ?? '').trim() || 'Orden')
      host.show?.({ kind: 'wait', label: WORDS.syncing })
    }
    const kept = await keptFor(deps.store(), host, me.aci)
    const connection = new SignalConnection(rpc, host, me, kept, deps)
    await connection.boot(known === undefined)
    live
      .get(me.aci)
      ?.close()
      .catch(() => undefined)
    live.set(me.aci, connection)
    return connection
  } catch (error) {
    await giveBack(host, rpc)
    throw error
  } finally {
    if (known === undefined) host.show?.(null)
  }
}

export async function forget(account: string, host: Host, deps: Deps): Promise<void> {
  const one = live.get(account)
  live.delete(account)
  if (one) await one.unlink()
  else if (host.sidecar) {
    const rpc = await borrow(host).catch(() => null)
    if (rpc) {
      const me = (await accountsOf(rpc).catch(() => [])).find((it) => it.aci === account)
      if (me) await unlinked(rpc, me.number ?? me.aci)
      await giveBack(host, rpc)
    }
  }
  const kept = await keptFor(deps.store(), host, account).catch(() => null)
  await kept?.forget().catch(() => undefined)
}

async function unlinked(rpc: Rpc, account: string): Promise<void> {
  await rpc.call('unregister', { account }).catch(() => undefined)
  await rpc
    .call('deleteLocalAccountData', { account, ignoreRegistered: true })
    .catch(() => undefined)
}

class SignalConnection implements Connection {
  readonly account: Account
  private readonly hearers = new Set<(event: ProviderEvent) => void>()
  private readonly metas = new Map<string, Meta>()
  private readonly messages = new Map<string, ProviderMessage[]>()
  private readonly loaded = new Set<string>()
  private readonly persons = new Map<string, Person>()
  private readonly groups = new Map<string, GroupInfo>()
  private readonly dirty = new Set<string>()
  private readonly typingTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly fetching: string[] = []
  private readonly files = new Map<string, Promise<Uint8Array>>()
  private readonly forgotten = new Map<string, string[]>()
  private early: Notice[] | null = null
  private votes: Record<string, number> = {}
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private expiryTimer: ReturnType<typeof setInterval> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private subscription: number | null = null
  private unhear: (() => void) | null = null
  private unend: (() => void) | null = null
  private closed = false
  private holding = true
  private retryIn = RETRY_FIRST
  private readonly now: () => number

  constructor(
    private rpc: Rpc,
    private readonly host: Host,
    private readonly me: Me,
    private readonly kept: Kept,
    deps: Deps,
  ) {
    this.now = deps.now ?? (() => host.now())
    const self: Person = {
      id: me.aci,
      name: me.number ?? 'Signal',
      ...(me.number ? { phone: me.number } : {}),
    }
    this.persons.set(me.aci, self)
    this.account = { id: me.aci, label: me.number ?? 'Signal', self }
  }

  private stopped(): boolean {
    return this.closed
  }

  private get who(): string {
    return this.me.number ?? this.me.aci
  }

  private call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return this.rpc.call(method, { account: this.who, ...params })
  }

  private emit(event: ProviderEvent): void {
    for (const hear of [...this.hearers]) hear(event)
  }

  async boot(fresh: boolean): Promise<void> {
    const index = await this.kept.read<Index>('index')
    for (const meta of index?.conversations ?? []) this.metas.set(meta.id, meta)
    this.votes = { ...index?.votes }
    if (fresh) await this.call('sendSyncRequest').catch(() => undefined)
    await this.refresh()
    await this.listen()
    this.expiryTimer = setInterval(() => void this.expire(), EXPIRY_EVERY)
  }

  private async listen(): Promise<void> {
    this.unhear?.()
    this.unend?.()
    this.unhear = this.rpc.hear((notice) => this.heard(notice))
    this.unend = this.rpc.onEnd((reason) => this.lost(reason))
    this.subscription = null
    this.early = []
    try {
      this.subscription = number(await this.call('subscribeReceive'))
    } finally {
      const early = this.early
      this.early = null
      for (const notice of early) this.heard(notice)
    }
  }

  private lost(reason: string): void {
    if (this.closed) return
    this.holding = false
    this.subscription = null
    this.emit({ t: 'status', status: 'offline', reason })
    this.retry()
  }

  private retry(): void {
    if (this.closed || this.retryTimer) return
    const wait = this.retryIn
    this.retryIn = Math.min(RETRY_MOST, this.retryIn * 2)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.again()
    }, wait)
  }

  private async again(): Promise<void> {
    if (this.closed) return
    let rpc: Rpc | null = null
    try {
      rpc = await borrow(this.host)
      if (this.stopped()) {
        await giveBack(this.host, rpc)
        return
      }
      this.rpc = rpc
      this.holding = true
      const mine = (await accountsOf(rpc)).some((one) => one.aci === this.me.aci)
      if (!mine) {
        this.holding = false
        await giveBack(this.host, rpc)
        this.emit({ t: 'status', status: 'signed-out', reason: WORDS.signedOut })
        return
      }
      await this.listen()
      await this.refresh()
      this.retryIn = RETRY_FIRST
      this.emit({ t: 'status', status: 'online' })
    } catch {
      if (rpc && this.holding && this.rpc === rpc) {
        this.holding = false
        await giveBack(this.host, rpc).catch(() => undefined)
      }
      this.retry()
    }
  }

  private async refresh(): Promise<void> {
    const [contacts, groups] = await Promise.all([
      this.call('listContacts', { allRecipients: true }).catch(() => []),
      this.call('listGroups').catch(() => []),
    ])
    for (const one of list(contacts)) this.knowContact(one)
    this.groups.clear()
    for (const one of list(groups)) {
      const group = groupOf(one)
      if (!group.id) continue
      this.groups.set(group.id, group)
      for (const member of group.members) if (member.uuid) this.know(member.uuid, '', member.number)
      const id = `g:${group.id}`
      const meta = this.metas.get(id)
      if (!group.member && !meta) continue
      this.metas.set(id, {
        ...(meta ?? { id, kind: 'group', lastAt: null, unread: 0 }),
        title: group.name || null,
      })
    }
    for (const meta of this.metas.values())
      if (meta.kind === 'direct') meta.title = this.nameOf(meta.id.slice(2))
    this.save('index')
  }

  private knowContact(one: Said): void {
    const uuid = text(one.uuid) || text(one.number)
    if (!uuid) return
    const profile = said(one.profile)
    const given = [text(one.givenName), text(one.familyName)].filter(Boolean).join(' ')
    const nick = [text(one.nickGivenName), text(one.nickFamilyName)].filter(Boolean).join(' ')
    const fromProfile = [text(profile.givenName), text(profile.familyName)]
      .filter(Boolean)
      .join(' ')
    const name = nick || text(one.name) || given || fromProfile
    this.know(uuid, name, text(one.number), text(one.username))
  }

  private know(uuid: string, name: string, phone = '', handle = ''): Person {
    const before = this.persons.get(uuid)
    const kept = phone !== '' ? phone : (before?.phone ?? '')
    const known = handle !== '' ? handle : (before?.handle ?? '')
    const person: Person = {
      id: uuid,
      name: [name, before?.name ?? '', kept, known].find((one) => one !== '') ?? UNKNOWN,
      ...(kept ? { phone: kept } : {}),
      ...(known ? { handle: known } : {}),
    }
    this.persons.set(uuid, person)
    return person
  }

  private nameOf(uuid: string): string {
    if (uuid === this.me.aci) return 'Note to Self'
    return this.persons.get(uuid)?.name ?? UNKNOWN
  }

  private personOf(uuid: string): Person {
    return this.persons.get(uuid) ?? this.know(uuid, '')
  }

  private conversationOf(meta: Meta): Conversation {
    const group = meta.kind === 'group' ? this.groups.get(meta.id.slice(2)) : undefined
    const people =
      meta.kind === 'group'
        ? (group?.members ?? [])
            .filter((one) => one.uuid && one.uuid !== this.me.aci)
            .map((one) => this.personOf(one.uuid))
        : meta.id === `u:${this.me.aci}`
          ? []
          : [this.personOf(meta.id.slice(2))]
    const admin = group?.members.some((one) => one.uuid === this.me.aci && one.admin) ?? false
    return {
      id: meta.id,
      title: meta.kind === 'group' ? meta.title : this.nameOf(meta.id.slice(2)),
      kind: meta.kind,
      people,
      lastAt: meta.lastAt,
      unread: meta.unread,
      ...(meta.snippet ? { snippet: meta.snippet } : {}),
      ...(meta.archived ? { archived: true } : {}),
      ...(group
        ? {
            ...(group.description ? { topic: group.description } : {}),
            role: admin ? ('admin' as const) : ('member' as const),
            members: group.members.length,
            readOnly: !group.member || (group.onlyAdminsSend && !admin),
          }
        : {}),
    }
  }

  conversations(): Promise<Conversation[]> {
    return Promise.resolve(
      [...this.metas.values()]
        .map((meta) => this.conversationOf(meta))
        .sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0)),
    )
  }

  private async load(conversation: string): Promise<ProviderMessage[]> {
    if (!this.loaded.has(conversation)) {
      const stored = (await this.kept.read<ProviderMessage[]>(`c:${conversation}`)) ?? []
      const here = this.messages.get(conversation) ?? []
      const ids = new Set(here.map((one) => one.id))
      const merged = [...stored.filter((one) => !ids.has(one.id)), ...here].sort(
        (a, b) => a.at - b.at,
      )
      this.messages.set(conversation, merged)
      this.loaded.add(conversation)
    }
    return this.messages.get(conversation) ?? []
  }

  private save(name: string): void {
    this.dirty.add(name)
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => void this.flush(), SAVE_AFTER)
  }

  async flush(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    const names = [...this.dirty]
    this.dirty.clear()
    for (const name of names) {
      if (name === 'index') {
        await this.kept.write('index', {
          conversations: [...this.metas.values()],
          votes: this.votes,
        } satisfies Index)
        continue
      }
      const conversation = name.slice(2)
      const here = await this.load(conversation)
      const stored = (await this.kept.read<ProviderMessage[]>(name)) ?? []
      const ids = new Set(here.map((one) => one.id))
      const gone = new Set(this.forgotten.get(conversation) ?? [])
      const merged = [...stored.filter((one) => !ids.has(one.id) && !gone.has(one.id)), ...here]
        .sort((a, b) => a.at - b.at)
        .slice(-MOST_KEPT)
      this.messages.set(conversation, merged)
      await this.kept.write(name, merged)
    }
  }

  private meta(conversation: string): Meta {
    let meta = this.metas.get(conversation)
    if (!meta) {
      const group = conversation.startsWith('g:')
      meta = {
        id: conversation,
        kind: group ? 'group' : 'direct',
        title: group
          ? (this.groups.get(conversation.slice(2))?.name ?? null)
          : this.nameOf(conversation.slice(2)),
        lastAt: null,
        unread: 0,
      }
      this.metas.set(conversation, meta)
    }
    return meta
  }

  private async put(message: ProviderMessage, counts: boolean): Promise<void> {
    const all = await this.load(message.conversation)
    const at = all.findIndex((one) => one.id === message.id)
    if (at !== -1) {
      all[at] = message
      this.emit({ t: 'changed', message })
    } else {
      let place = all.length
      while (place > 0 && (all[place - 1]?.at ?? 0) > message.at) place--
      all.splice(place, 0, message)
      this.emit({ t: 'message', message })
      const meta = this.meta(message.conversation)
      if (!message.system) {
        meta.lastAt = Math.max(meta.lastAt ?? 0, message.at)
        const snippet = message.text.slice(0, 120)
        if (snippet) meta.snippet = snippet
        if (counts && !message.mine) meta.unread += 1
        if (meta.archived && !message.mine) meta.archived = false
      }
      this.emit({ t: 'conversation', conversation: this.conversationOf(meta) })
      this.save('index')
    }
    this.save(`c:${message.conversation}`)
  }

  private async change(
    conversation: string,
    message: string,
    how: (found: ProviderMessage) => ProviderMessage | null,
  ): Promise<ProviderMessage | null> {
    const all = await this.load(conversation)
    const at = all.findIndex((one) => one.id === message)
    const found = all[at]
    if (!found) return null
    const next = how(found)
    if (!next) return null
    all[at] = next
    this.emit({ t: 'changed', message: next })
    this.save(`c:${conversation}`)
    return next
  }

  private async findAnywhere(message: string): Promise<ProviderMessage | null> {
    for (const conversation of this.metas.keys()) {
      const found = (await this.load(conversation)).find((one) => one.id === message)
      if (found) return found
    }
    return null
  }

  private heard(notice: Notice): void {
    if (notice.method !== 'receive') return
    const params = said(notice.params)
    if (this.early) {
      this.early.push(notice)
      return
    }
    if (this.subscription === null || number(params.subscription) !== this.subscription) return
    const result = said(params.result)
    const envelope = maybe(result.envelope)
    if (!envelope) return
    void this.envelope(envelope).catch(() => undefined)
  }

  private async envelope(envelope: Said): Promise<void> {
    const author = addressOf(envelope)
    if (!author) return
    const name = text(envelope.sourceName)
    if (author !== this.me.aci) this.know(author, name, text(envelope.sourceNumber))
    const at = number(envelope.timestamp)
    const data = maybe(envelope.dataMessage)
    if (data) await this.data(data, author, null, at, false)
    const edit = maybe(envelope.editMessage)
    if (edit) await this.edited(edit, author, null)
    const sync = maybe(envelope.syncMessage)
    if (sync) await this.sync(sync)
    const receipt = maybe(envelope.receiptMessage)
    if (receipt) await this.receipt(receipt, author)
    const typing = maybe(envelope.typingMessage)
    if (typing) this.typingHeard(typing, author)
  }

  private conversationFor(data: Said, other: string): string {
    const group = text(said(data.groupInfo).groupId)
    return group ? `g:${group}` : `u:${other}`
  }

  private async sync(sync: Said): Promise<void> {
    const sent = maybe(sync.sentMessage)
    if (sent) {
      const destination = addressOf(sent, 'destination') || this.me.aci
      const edit = maybe(sent.editMessage)
      if (edit) await this.edited(edit, this.me.aci, destination)
      else await this.data(sent, this.me.aci, destination, number(sent.timestamp), true)
    }
    for (const read of list(sync.readMessages)) {
      const message = idOf(number(read.timestamp), addressOf(read, 'sender'))
      const found = await this.findAnywhere(message)
      if (!found) continue
      const meta = this.meta(found.conversation)
      if (meta.unread === 0) continue
      meta.unread = 0
      this.emit({ t: 'conversation', conversation: this.conversationOf(meta) })
      this.save('index')
    }
    const type = text(sync.type)
    if (type === 'CONTACTS_SYNC' || type === 'GROUPS_SYNC') {
      await this.refresh()
      this.emit({ t: 'conversations', conversations: await this.conversations() })
    }
  }

  private async receipt(receipt: Said, from: string): Promise<void> {
    const read = receipt.isRead === true || receipt.isViewed === true
    const delivered = receipt.isDelivery === true
    if (!read && !delivered) return
    let newest: ProviderMessage | null = null
    for (const at of numbers(receipt.timestamps)) {
      const found = await this.findAnywhere(idOf(at, this.me.aci))
      if (!found) continue
      const now = found.delivery
      const next = read ? 'read' : now === 'read' ? 'read' : 'delivered'
      if (now !== next)
        await this.change(found.conversation, found.id, (one) => ({ ...one, delivery: next }))
      if (!newest || found.at > newest.at) newest = found
    }
    if (read && newest)
      this.emit({ t: 'read', conversation: newest.conversation, person: from, upTo: newest.id })
  }

  private typingHeard(typing: Said, from: string): void {
    if (from === this.me.aci) return
    const group = text(typing.groupId)
    const conversation = group ? `g:${group}` : `u:${from}`
    const on = text(typing.action) === 'STARTED'
    const key = `${conversation} ${from}`
    const timer = this.typingTimers.get(key)
    if (timer) clearTimeout(timer)
    this.typingTimers.delete(key)
    if (on)
      this.typingTimers.set(
        key,
        setTimeout(() => {
          this.typingTimers.delete(key)
          this.emit({ t: 'typing', conversation, person: from, on: false })
        }, TYPING_FOR),
      )
    this.emit({ t: 'typing', conversation, person: from, on })
  }

  private target(data: Said): string {
    return idOf(
      number(data.targetSentTimestamp ?? data.targetTimestamp),
      addressOf(data, 'targetAuthor'),
    )
  }

  private async data(
    data: Said,
    author: string,
    destination: string | null,
    at: number,
    mine: boolean,
  ): Promise<void> {
    const conversation = this.conversationFor(data, destination ?? author)
    const reaction = maybe(data.reaction)
    if (reaction) {
      await this.reacted(conversation, this.target(reaction), author, reaction)
      return
    }
    const remote = maybe(data.remoteDelete)
    if (remote) {
      await this.removedRemotely(conversation, idOf(number(remote.timestamp), author))
      return
    }
    const admin = maybe(data.adminDelete)
    if (admin) {
      await this.removedRemotely(conversation, this.target(admin))
      return
    }
    const pin = maybe(data.pinMessage)
    const unpin = maybe(data.unpinMessage)
    const which = pin ?? unpin
    if (which) {
      await this.change(conversation, this.target(which), (one) => ({
        ...one,
        pinned: pin !== null,
      }))
      return
    }
    const vote = maybe(data.pollVote)
    if (vote) {
      await this.voted(
        conversation,
        idOf(number(vote.targetSentTimestamp), addressOf(vote, 'author')),
        author,
        vote,
      )
      return
    }
    const ended = maybe(data.pollTerminate)
    if (ended) {
      await this.change(conversation, idOf(number(ended.targetSentTimestamp), author), (one) =>
        one.poll ? { ...one, poll: { ...one.poll, closed: true } } : null,
      )
      return
    }
    const message = this.messageOf(data, conversation, author, at, mine)
    if (!message) return
    this.timed(conversation, number(data.expiresInSeconds))
    if (
      data.isExpirationUpdate === true ||
      (said(data.groupInfo).type === 'UPDATE' && !message.text && !message.attachments.length)
    ) {
      if (said(data.groupInfo).type === 'UPDATE') await this.refresh()
      await this.put({ ...message, system: true, text: message.text || systemText(data) }, false)
      return
    }
    await this.put(message, true)
    this.fetchFiles(message, data)
  }

  private timed(conversation: string, seconds: number): void {
    const meta = this.meta(conversation)
    if ((meta.timer ?? 0) === seconds) return
    if (seconds > 0) meta.timer = seconds
    else delete meta.timer
    this.save('index')
  }

  private expiry(conversation: string): { expiresAt?: number } {
    const timer = this.metas.get(conversation)?.timer ?? 0
    return timer > 0 ? { expiresAt: this.now() + timer * 1000 } : {}
  }

  private messageOf(
    data: Said,
    conversation: string,
    author: string,
    at: number,
    mine: boolean,
  ): ProviderMessage | null {
    const body = text(data.message)
    const spans: Span[] = list(data.textStyles).flatMap((one) =>
      isStyle(one.style)
        ? [{ start: number(one.start), length: number(one.length), style: one.style }]
        : [],
    )
    const mentioned: Mentioned[] = list(data.mentions).map((one) => ({
      start: number(one.start),
      length: number(one.length),
      uuid: text(one.uuid) || text(one.number),
    }))
    for (const one of list(data.mentions)) {
      const uuid = text(one.uuid)
      if (uuid && text(one.name)) this.know(uuid, text(one.name), text(one.number))
    }
    const attachments: AttachmentRef[] = list(data.attachments).map((one) => this.fileOf(one))
    const sticker = maybe(data.sticker)
    if (sticker)
      attachments.push({
        ref: `s:${text(sticker.packId)}:${number(sticker.stickerId)}`,
        name: 'sticker',
        type: 'image/webp',
        size: 0,
        kind: 'sticker',
      })
    const poll = maybe(data.pollCreate)
    const quote = maybe(data.quote)
    const preview = list(data.previews)[0]
    const expires = number(data.expiresInSeconds)
    const update = data.isExpirationUpdate === true || said(data.groupInfo).type === 'UPDATE'
    if (!body && !attachments.length && !poll && !update) return null
    const message: ProviderMessage = {
      id: idOf(at, author),
      conversation,
      author: this.personOf(author),
      at,
      text: markdownOf(body, spans, mentioned, (uuid) => this.nameOf(uuid)),
      attachments,
      mine,
      ...(mine ? { delivery: 'sent' as const } : {}),
      ...(mentioned.length ? { mentions: mentioned.map((one) => one.uuid) } : {}),
      ...(quote ? { replyTo: idOf(number(quote.id), addressOf(quote, 'author')) } : {}),
      ...(preview && text(preview.url)
        ? {
            preview: {
              url: text(preview.url),
              title: text(preview.title),
              ...(text(preview.description) ? { text: text(preview.description) } : {}),
            },
          }
        : {}),
      ...(expires > 0 ? { expiresAt: at + expires * 1000 } : {}),
      ...(poll
        ? {
            poll: {
              question: text(poll.question),
              answers: words(poll.options),
              several: poll.allowMultiple !== false,
              counts: words(poll.options).map(() => 0),
              mine: [],
              voters: {},
            },
          }
        : {}),
    }
    return message
  }

  private fileOf(one: Said): AttachmentRef {
    const type = text(one.contentType) || 'application/octet-stream'
    const id = text(one.id)
    const width = number(one.width)
    const height = number(one.height)
    return {
      ref: `a:${id}`,
      name: text(one.filename) || id || 'file',
      type,
      size: number(one.size),
      kind: kindOf(type, one.isVoiceNote === true),
      ...(width ? { width } : {}),
      ...(height ? { height } : {}),
    }
  }

  private fetchFiles(message: ProviderMessage, data: Said): void {
    const wanted = list(data.attachments)
      .filter((one) => text(one.id) && number(one.size) <= MOST_KEPT_FILE)
      .map((one) => `${message.conversation} ${message.author.id} ${text(one.id)}`)
    if (!wanted.length) return
    const idle = this.fetching.length === 0
    this.fetching.push(...wanted)
    if (idle) void this.fetchNext()
  }

  private async fetchNext(): Promise<void> {
    while (this.fetching.length && !this.closed) {
      const [conversation = '', author = '', id = ''] = (this.fetching[0] ?? '').split(' ')
      if (!(await this.kept.bytes(`f:${id}`)))
        await this.attachmentFrom(conversation, author, id).catch(() => undefined)
      this.fetching.shift()
    }
  }

  private attachmentFrom(conversation: string, author: string, id: string): Promise<Uint8Array> {
    const going = this.files.get(id)
    if (going) return going
    const where = conversation.startsWith('g:')
      ? { groupId: conversation.slice(2) }
      : { recipient: author }
    const fetched = (async () => {
      const got = said(await this.call('getAttachment', { id, ...where }))
      const bytes = bytesOf(text(got.data))
      await this.kept.keepBytes(`f:${id}`, bytes)
      return bytes
    })()
    this.files.set(id, fetched)
    const forget = () => this.files.delete(id)
    fetched.then(forget, forget)
    return fetched
  }

  private async edited(edit: Said, author: string, destination: string | null): Promise<void> {
    const data = said(edit.dataMessage)
    const conversation = this.conversationFor(data, destination ?? author)
    const original = idOf(number(edit.targetSentTimestamp), author)
    const at = number(data.timestamp)
    const fresh = this.messageOf(data, conversation, author, at, author === this.me.aci)
    if (!fresh) return
    await this.change(conversation, original, (one) => ({
      ...one,
      text: fresh.text,
      attachments: fresh.attachments.length ? fresh.attachments : one.attachments,
      editedAt: at,
      ...(fresh.mentions ? { mentions: fresh.mentions } : {}),
    }))
    this.fetchFiles({ ...fresh, id: original }, data)
  }

  private async reacted(
    conversation: string,
    message: string,
    who: string,
    reaction: Said,
  ): Promise<void> {
    const emoji = text(reaction.emoji)
    const remove = reaction.isRemove === true
    await this.change(conversation, message, (one) => ({
      ...one,
      reactions: reactionsWith(one.reactions, who, remove ? null : emoji),
    }))
  }

  private async removedRemotely(conversation: string, message: string): Promise<void> {
    await this.change(conversation, message, (one) => ({
      ...one,
      text: '',
      attachments: [],
      deleted: true,
      reactions: {},
    }))
  }

  private async voted(
    conversation: string,
    poll: string,
    voter: string,
    vote: Said,
  ): Promise<void> {
    await this.change(conversation, poll, (one) => {
      if (!one.poll) return null
      const voters = { ...one.poll.voters, [voter]: numbers(vote.optionIndexes) }
      return { ...one, poll: tallied(one.poll, voters, this.me.aci) }
    })
  }

  async history(conversation: string, ask: HistoryAsk): Promise<Page> {
    await this.expire()
    const all = await this.load(conversation)
    let end = all.length
    if (ask.before) {
      const at = all.findIndex((one) => one.id === ask.before)
      end = at === -1 ? all.length : at
    } else if (ask.around) {
      const at = all.findIndex((one) => one.id === ask.around)
      if (at !== -1) end = Math.min(all.length, at + Math.ceil(ask.limit / 2))
    }
    const start = Math.max(0, end - ask.limit)
    const messages = all.slice(start, end)
    return { messages, before: start > 0 ? (messages[0]?.id ?? null) : null }
  }

  private where(conversation: string): Record<string, unknown> {
    if (conversation.startsWith('g:')) return { groupId: conversation.slice(2) }
    const other = conversation.slice(2)
    if (other === this.me.aci) return { noteToSelf: true }
    return { recipient: [other] }
  }

  private composed(draft: Outgoing): Record<string, unknown> {
    const people = (draft.mentions ?? [])
      .filter((uuid) => uuid !== this.me.aci)
      .map((uuid) => ({ uuid, name: this.nameOf(uuid) }))
      .sort((a, b) => b.name.length - a.name.length)
    const parsed = withMentions(stylesOf(draft.text), people)
    return {
      message: parsed.text,
      ...(parsed.spans.length
        ? { textStyle: parsed.spans.map((one) => `${one.start}:${one.length}:${one.style}`) }
        : {}),
      ...(parsed.mentions.length
        ? { mention: parsed.mentions.map((one) => `${one.start}:${one.length}:${one.uuid}`) }
        : {}),
    }
  }

  async send(conversation: string, draft: Outgoing): Promise<ProviderMessage> {
    const where = this.where(conversation)
    if (draft.poll) {
      const sent = said(
        await this.call('sendPollCreate', {
          ...where,
          question: draft.poll.question,
          option: [...draft.poll.answers],
          ...(draft.poll.several ? {} : { noMulti: true }),
        }),
      )
      const at = number(sent.timestamp) || this.now()
      const message: ProviderMessage = {
        id: idOf(at, this.me.aci),
        conversation,
        author: this.personOf(this.me.aci),
        at,
        text: '',
        attachments: [],
        mine: true,
        delivery: failed(sent) ? 'failed' : 'sent',
        ...this.expiry(conversation),
        poll: {
          question: draft.poll.question,
          answers: [...draft.poll.answers],
          several: draft.poll.several,
          counts: draft.poll.answers.map(() => 0),
          mine: [],
          voters: {},
        },
      }
      await this.put(message, false)
      return message
    }
    const params: Record<string, unknown> = { ...where }
    if (draft.sticker) {
      const [, pack = '', sticker = '0'] = draft.sticker.split(':')
      params.sticker = `${pack}:${sticker}`
    } else Object.assign(params, this.composed(draft))
    const files = draft.attachments ?? []
    if (files.length) {
      params.attachment = files.map(dataUri)
      if (files.some((one) => one.kind === 'voice')) params.voiceNote = true
    }
    if (draft.replyTo) {
      const quoted = (await this.load(conversation)).find((one) => one.id === draft.replyTo)
      const { at, author } = partsOf(draft.replyTo)
      params.quoteTimestamp = at
      params.quoteAuthor = author
      params.quoteMessage = quoted ? stylesOf(quoted.text).text : ''
    }
    const sent = said(await this.call('send', params))
    const at = number(sent.timestamp) || this.now()
    const kept = await Promise.all(
      files.map(async (file, index) => {
        const id = `out-${at}-${index}`
        if (file.bytes.length <= MOST_KEPT_FILE) await this.kept.keepBytes(`f:${id}`, file.bytes)
        return {
          ref: `a:${id}`,
          name: file.name,
          type: file.type,
          size: file.bytes.length,
          kind: file.kind ?? kindOf(file.type, false),
          ...(file.width ? { width: file.width } : {}),
          ...(file.height ? { height: file.height } : {}),
          ...(file.seconds ? { seconds: file.seconds } : {}),
        } satisfies AttachmentRef
      }),
    )
    if (draft.sticker)
      kept.push({
        ref: draft.sticker,
        name: 'sticker',
        type: 'image/webp',
        size: 0,
        kind: 'sticker',
      })
    const message: ProviderMessage = {
      id: idOf(at, this.me.aci),
      conversation,
      author: this.personOf(this.me.aci),
      at,
      text: draft.sticker ? '' : draft.text,
      attachments: kept,
      mine: true,
      delivery: failed(sent) ? 'failed' : 'sent',
      ...(draft.replyTo ? { replyTo: draft.replyTo } : {}),
      ...(draft.mentions?.length ? { mentions: [...draft.mentions] } : {}),
      ...this.expiry(conversation),
    }
    await this.put(message, false)
    return message
  }

  start(hear: (event: ProviderEvent) => void): () => void {
    this.hearers.add(hear)
    hear({ t: 'status', status: this.subscription === null ? 'offline' : 'online' })
    return () => this.hearers.delete(hear)
  }

  async attachment(conversation: string, message: string, ref: string): Promise<Uint8Array> {
    if (ref.startsWith('s:')) return this.stickerBytes(ref)
    const id = ref.slice(2)
    const going = this.files.get(id)
    if (going) return going
    const kept = await this.kept.bytes(`f:${id}`)
    if (kept) return kept
    return this.attachmentFrom(conversation, partsOf(message).author, id)
  }

  async stickerBytes(ref: string): Promise<Uint8Array> {
    const [, packId = '', stickerId = '0'] = ref.split(':')
    const got = said(await this.call('getSticker', { packId, stickerId: Number(stickerId) }))
    return bytesOf(text(got.data))
  }

  async markRead(conversation: string, upTo: string): Promise<void> {
    const all = await this.load(conversation)
    const end = all.findIndex((one) => one.id === upTo)
    const read = (end === -1 ? all : all.slice(0, end + 1)).filter(
      (one) => !one.mine && !one.system && !one.deleted,
    )
    const meta = this.meta(conversation)
    const unread = read.slice(Math.max(0, read.length - Math.max(meta.unread, 0)))
    meta.unread = 0
    this.save('index')
    this.emit({ t: 'conversation', conversation: this.conversationOf(meta) })
    const byAuthor = new Map<string, number[]>()
    for (const one of unread) {
      const { at, author } = partsOf(one.id)
      byAuthor.set(author, [...(byAuthor.get(author) ?? []), at])
    }
    for (const [author, stamps] of byAuthor)
      await this.call('sendReceipt', {
        recipient: author,
        targetTimestamp: stamps,
        type: 'read',
      }).catch(() => undefined)
  }

  private mine(message: string): void {
    if (partsOf(message).author !== this.me.aci) throw new Error(WORDS.notMine)
  }

  async edit(conversation: string, message: string, draft: Outgoing): Promise<void> {
    this.mine(message)
    const { at } = partsOf(message)
    const sent = said(
      await this.call('send', {
        ...this.where(conversation),
        ...this.composed(draft),
        editTimestamp: at,
      }),
    )
    const editedAt = number(sent.timestamp) || this.now()
    await this.change(conversation, message, (one) => ({ ...one, text: draft.text, editedAt }))
  }

  async remove(conversation: string, message: string, everyone: boolean): Promise<void> {
    if (!everyone) {
      const all = await this.load(conversation)
      const at = all.findIndex((one) => one.id === message)
      if (at !== -1) all.splice(at, 1)
      this.forgotten.set(conversation, [...(this.forgotten.get(conversation) ?? []), message])
      this.save(`c:${conversation}`)
      this.emit({ t: 'deleted', conversation, message })
      return
    }
    const { at, author } = partsOf(message)
    if (author === this.me.aci)
      await this.call('remoteDelete', { ...this.where(conversation), targetTimestamp: at })
    else if (conversation.startsWith('g:'))
      await this.call('sendAdminDelete', {
        groupId: conversation.slice(2),
        targetAuthor: author,
        targetTimestamp: at,
      })
    else throw new Error(WORDS.notMine)
    await this.removedRemotely(conversation, message)
  }

  async react(conversation: string, message: string, emoji: string, on: boolean): Promise<void> {
    const { at, author } = partsOf(message)
    await this.call('sendReaction', {
      ...this.where(conversation),
      emoji,
      targetAuthor: author,
      targetTimestamp: at,
      ...(on ? {} : { remove: true }),
    })
    await this.change(conversation, message, (one) => ({
      ...one,
      reactions: reactionsWith(one.reactions, this.me.aci, on ? emoji : null),
    }))
  }

  async pin(conversation: string, message: string, on: boolean): Promise<void> {
    const { at, author } = partsOf(message)
    await this.call(on ? 'sendPinMessage' : 'sendUnpinMessage', {
      ...this.where(conversation),
      targetAuthor: author,
      targetTimestamp: at,
    })
    await this.change(conversation, message, (one) => ({ ...one, pinned: on }))
  }

  async vote(conversation: string, message: string, answers: readonly number[]): Promise<void> {
    const { at, author } = partsOf(message)
    const count = (this.votes[message] ?? 0) + 1
    await this.call('sendPollVote', {
      ...this.where(conversation),
      pollAuthor: author,
      pollTimestamp: at,
      option: [...answers],
      voteCount: count,
    })
    this.votes[message] = count
    this.save('index')
    await this.change(conversation, message, (one) =>
      one.poll
        ? {
            ...one,
            poll: tallied(
              one.poll,
              { ...one.poll.voters, [this.me.aci]: [...answers] },
              this.me.aci,
            ),
          }
        : null,
    )
  }

  async typing(conversation: string, on: boolean): Promise<void> {
    const where = this.where(conversation)
    if (where.noteToSelf) return
    await this.call('sendTyping', { ...where, ...(on ? {} : { stop: true }) })
  }

  search(query: string, conversation?: string): Promise<ProviderMessage[]> {
    const wanted = query.trim().toLowerCase()
    const places = conversation ? [conversation] : [...this.metas.keys()]
    return (async () => {
      const found: ProviderMessage[] = []
      if (!wanted) return found
      for (const place of places)
        for (const one of await this.load(place))
          if (!one.deleted && one.text.toLowerCase().includes(wanted)) found.push(one)
      return found.sort((a, b) => b.at - a.at).slice(0, 200)
    })()
  }

  async members(conversation: string): Promise<Member[]> {
    if (!conversation.startsWith('g:')) {
      const other = this.personOf(conversation.slice(2))
      return [
        { ...this.personOf(this.me.aci), role: 'member' },
        ...(other.id === this.me.aci ? [] : [{ ...other, role: 'member' as const }]),
      ]
    }
    const groups = list(await this.call('listGroups', { groupId: [conversation.slice(2)] }))
    const group = groups[0] ? groupOf(groups[0]) : this.groups.get(conversation.slice(2))
    if (!group) throw new Error(WORDS.group)
    this.groups.set(group.id, group)
    return group.members
      .filter((one) => one.uuid)
      .map((one) => ({
        ...this.personOf(one.uuid),
        role: one.admin ? ('admin' as const) : ('member' as const),
      }))
  }

  async people(query: string): Promise<Person[]> {
    const wanted = query.trim().toLowerCase()
    const contacts = list(await this.call('listContacts').catch(() => []))
    for (const one of contacts) this.knowContact(one)
    const found = [...this.persons.values()].filter(
      (one) =>
        one.id !== this.me.aci &&
        (!wanted ||
          one.name.toLowerCase().includes(wanted) ||
          (one.phone ?? '').includes(wanted.replace(/\s/g, '')) ||
          (one.handle ?? '').toLowerCase().includes(wanted)),
    )
    const phone = query.replace(/[\s()-]/g, '')
    if (/^\+\d{6,15}$/.test(phone) && !found.some((one) => one.phone === phone)) {
      const status = list(
        await this.call('getUserStatus', { recipient: [phone] }).catch(() => []),
      )[0]
      const uuid = text(status?.uuid)
      if (status?.isRegistered === true && uuid) found.unshift(this.know(uuid, '', phone))
    }
    return found.slice(0, 50)
  }

  async begin(people: readonly string[], title?: string): Promise<Conversation> {
    if (people.length === 1 && !title) {
      const meta = this.meta(`u:${people[0] ?? ''}`)
      this.save('index')
      const conversation = this.conversationOf(meta)
      this.emit({ t: 'conversation', conversation })
      return conversation
    }
    const named = title?.trim() ?? ''
    const made = said(
      await this.call('updateGroup', {
        name: named || 'Signal group',
        member: [...people],
      }),
    )
    const id = text(made.groupId)
    await this.refresh()
    const meta = this.meta(`g:${id}`)
    if (named) meta.title = named
    this.save('index')
    const conversation = this.conversationOf(meta)
    this.emit({ t: 'conversation', conversation })
    return conversation
  }

  private async group(conversation: string, change: Record<string, unknown>): Promise<void> {
    if (!conversation.startsWith('g:')) throw new Error(WORDS.group)
    await this.call('updateGroup', { groupId: conversation.slice(2), ...change })
    await this.refresh()
    const meta = this.metas.get(conversation)
    if (meta) this.emit({ t: 'conversation', conversation: this.conversationOf(meta) })
  }

  invite(conversation: string, people: readonly string[]): Promise<void> {
    return this.group(conversation, { member: [...people] })
  }

  kick(conversation: string, person: string): Promise<void> {
    return this.group(conversation, { removeMember: [person] })
  }

  promote(conversation: string, person: string, role: ConversationRole): Promise<void> {
    if (role === 'owner') return Promise.reject(new Error(WORDS.owner))
    return this.group(
      conversation,
      role === 'admin' ? { admin: [person] } : { removeAdmin: [person] },
    )
  }

  rename(conversation: string, title: string): Promise<void> {
    return this.group(conversation, { name: title })
  }

  describe(conversation: string, topic: string): Promise<void> {
    return this.group(conversation, { description: topic })
  }

  async leave(conversation: string): Promise<void> {
    if (!conversation.startsWith('g:')) throw new Error(WORDS.group)
    await this.call('quitGroup', { groupId: conversation.slice(2) })
    this.metas.delete(conversation)
    this.groups.delete(conversation.slice(2))
    this.save('index')
    this.emit({ t: 'gone', conversation })
  }

  archive(conversation: string, on: boolean): Promise<void> {
    const meta = this.meta(conversation)
    meta.archived = on
    this.save('index')
    this.emit({ t: 'conversation', conversation: this.conversationOf(meta) })
    return Promise.resolve()
  }

  async stickers(): Promise<StickerSet[]> {
    const packs = list(await this.call('listStickerPacks'))
    return packs
      .filter((one) => one.installed !== false)
      .map((pack) => {
        const id = text(pack.packId)
        return {
          id,
          name: text(pack.title) || 'Stickers',
          stickers: list(pack.stickers).map((one) => ({
            ref: `s:${id}:${number(one.id)}`,
            name: text(one.emoji),
            type: text(one.contentType) || 'image/webp',
            ...(text(one.emoji) ? { emoji: text(one.emoji) } : {}),
          })),
        }
      })
  }

  async picture(id: string): Promise<Uint8Array | null> {
    const ask = id.startsWith('g:')
      ? { groupId: id.slice(2) }
      : { contact: id.startsWith('u:') ? id.slice(2) : id }
    const tries = 'contact' in ask ? [ask, { profile: ask.contact }] : [ask]
    for (const one of tries) {
      const got = said(await this.call('getAvatar', one).catch(() => null))
      if (text(got.data)) return bytesOf(text(got.data))
    }
    return null
  }

  private async expire(): Promise<void> {
    const now = this.now()
    for (const [conversation, all] of this.messages) {
      const gone = all.filter((one) => one.expiresAt !== undefined && one.expiresAt <= now)
      if (!gone.length) continue
      this.messages.set(
        conversation,
        all.filter((one) => !gone.includes(one)),
      )
      this.forgotten.set(conversation, [
        ...(this.forgotten.get(conversation) ?? []),
        ...gone.map((one) => one.id),
      ])
      for (const one of gone) {
        for (const file of one.attachments)
          if (file.ref.startsWith('a:')) await this.kept.keepBytes(`f:${file.ref.slice(2)}`, null)
        this.emit({ t: 'deleted', conversation, message: one.id })
      }
      this.save(`c:${conversation}`)
    }
  }

  async unlink(): Promise<void> {
    await unlinked(this.rpc, this.who)
    await this.close()
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    if (live.get(this.me.aci) === this) live.delete(this.me.aci)
    if (this.expiryTimer) clearInterval(this.expiryTimer)
    if (this.retryTimer) clearTimeout(this.retryTimer)
    for (const timer of this.typingTimers.values()) clearTimeout(timer)
    this.typingTimers.clear()
    await this.flush().catch(() => undefined)
    if (this.subscription !== null)
      await this.call('unsubscribeReceive', { subscription: this.subscription }).catch(
        () => undefined,
      )
    this.unhear?.()
    this.unend?.()
    this.hearers.clear()
    if (this.holding) await giveBack(this.host, this.rpc)
  }
}

function failed(sent: Said): boolean {
  const results = list(sent.results)
  return results.length > 0 && results.every((one) => text(one.type) !== 'SUCCESS')
}

function systemText(data: Said): string {
  if (data.isExpirationUpdate === true) {
    const seconds = number(data.expiresInSeconds)
    return seconds > 0
      ? `Disappearing messages: ${durationOf(seconds)}`
      : 'Disappearing messages off'
  }
  return 'Group updated'
}

function durationOf(seconds: number): string {
  if (seconds % 604800 === 0) return `${seconds / 604800} w`
  if (seconds % 86400 === 0) return `${seconds / 86400} d`
  if (seconds % 3600 === 0) return `${seconds / 3600} h`
  if (seconds % 60 === 0) return `${seconds / 60} min`
  return `${seconds} s`
}

function reactionsWith(
  before: Readonly<Record<string, readonly string[]>> | undefined,
  who: string,
  emoji: string | null,
): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [one, people] of Object.entries(before ?? {})) {
    const kept = people.filter((person) => person !== who)
    if (kept.length) out[one] = kept
  }
  if (emoji) out[emoji] = [...(out[emoji] ?? []), who]
  return out
}

function tallied(
  poll: ProviderPoll,
  voters: Readonly<Record<string, readonly number[]>>,
  self: string,
): ProviderPoll {
  const counts = poll.answers.map(() => 0)
  for (const chosen of Object.values(voters))
    for (const index of chosen)
      if (index >= 0 && index < counts.length) counts[index] = (counts[index] ?? 0) + 1
  return { ...poll, voters, counts, mine: [...(voters[self] ?? [])] }
}

function groupOf(one: Said): GroupInfo {
  const admins = new Set(list(one.admins).map((it) => text(it.uuid) || text(it.number)))
  return {
    id: text(one.id),
    name: text(one.name),
    description: text(one.description),
    member: one.isMember !== false,
    blocked: one.isBlocked === true,
    members: list(one.members).map((it) => {
      const uuid = text(it.uuid) || text(it.number)
      return { uuid, number: text(it.number), admin: it.isAdmin === true || admins.has(uuid) }
    }),
    onlyAdminsSend: text(one.permissionSendMessage).toUpperCase().includes('ADMIN'),
  }
}
