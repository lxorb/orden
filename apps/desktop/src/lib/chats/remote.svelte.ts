import type { FileRef, Mention, Message, Notify, Role, Who } from '@orden/chats'
import { TYPING_EVERY, TYPING_SHOWN } from '@orden/chats/limits'
import { MUTED_FOR_GOOD } from '@orden/chats/notify'
import type {
  Account,
  AttachmentKind,
  ChatProvider,
  Connection,
  Conversation,
  ConversationRole,
  Member,
  OutgoingFile,
  Page,
  Person,
  ProviderEvent,
  ProviderMessage,
} from '@orden/chats/provider'
import type {
  ChatAbilities,
  ChatEntry,
  ChatMember,
  ChatView,
  Draft,
  Hit,
  HistoryAsk,
  MessageList,
  Presence,
  RepliesView,
  Service,
  Shown,
} from './api'
import { conversationKey, conversationKeyOf } from './conversation-key'
import { sentText, shownText, subjectOf } from './formats'

const PAGE = 50
const JUMP_PAGES = 20
const MOST_URLS = 64
const MOST_URL_BYTES = 64 * 1024 * 1024
const READ_AFTER = 500

export interface Source {
  provider: ChatProvider
  account: Account
  connection: Connection
  conversations: readonly Conversation[]
}

export function whoOf(person: string): Who {
  return `guest:${person}`
}

function personOf(who: Who): string {
  return who.startsWith('guest:') ? who.slice(6) : who
}

function roleOf(conversation: Conversation, can: ChatProvider['can']): Role {
  if (conversation.readOnly || !can.send) return 'read'
  return conversation.role === 'admin' || conversation.role === 'owner' ? 'owner' : 'write'
}

function kindOf(file: FileRef): AttachmentKind {
  if (file.type.startsWith('audio/')) return file.wave || file.seconds ? 'voice' : 'audio'
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  return 'file'
}

export function abilitiesOf(
  provider: ChatProvider,
  connection: Connection,
  conversation: Conversation | null,
): ChatAbilities {
  const can = provider.can
  const may = (one: keyof Connection) => typeof connection[one] === 'function'
  const ruling = conversation?.role === 'admin' || conversation?.role === 'owner'
  return {
    files: can.attachments && can.send,
    maxFile: can.maxFile ?? null,
    voice: !!can.voice && can.attachments && can.send,
    polls: !!can.polls && can.send,
    quote: can.replies && can.send,
    threads: !!can.threads && may('thread'),
    react: may('react') ? (can.reactions ?? 'any') : null,
    editFor: may('edit') ? (can.editFor ?? Infinity) : null,
    removeFor: may('remove') ? (can.removeFor ?? Infinity) : null,
    removeForMe: may('remove') && !!can.removeForMe,
    pin: may('pin'),
    vote: may('vote'),
    markUnread: may('markUnread'),
    members: may('members'),
    topic:
      may('describe') &&
      (conversation?.kind === 'direct' ? false : ruling || conversation?.role === undefined),
    mute: may('mute'),
    search: may('search'),
    link: false,
    schedule: false,
    unsend: false,
    orden: false,
    stickers: may('stickers') && may('stickerBytes') && can.send,
    gifs: may('gifs') && may('stickerBytes') && can.send,
    formatting: can.formatting ?? 'plain',
  }
}

const CLOSED: ChatAbilities = {
  files: false,
  maxFile: null,
  voice: false,
  polls: false,
  quote: false,
  threads: false,
  react: null,
  editFor: null,
  removeFor: null,
  removeForMe: false,
  pin: false,
  vote: false,
  markUnread: false,
  members: false,
  topic: false,
  mute: false,
  search: false,
  link: false,
  schedule: false,
  unsend: false,
  orden: false,
  stickers: false,
  gifs: false,
  formatting: 'plain',
}

function titleOf(conversation: Conversation): string {
  return conversation.title ?? conversation.people.map((one) => one.name).join(', ')
}

interface Pending {
  shown: Shown
  conversation: string
  draft: Draft
}

class Urls {
  private readonly held = new Map<string, { url: string; size: number }>()
  private bytes = 0

  get(key: string): string | null {
    const found = this.held.get(key)
    if (!found) return null
    this.held.delete(key)
    this.held.set(key, found)
    return found.url
  }

  put(key: string, bytes: Uint8Array, type: string): string {
    const url = URL.createObjectURL(new Blob([bytes.slice()], { type }))
    this.held.set(key, { url, size: bytes.length })
    this.bytes += bytes.length
    while (this.held.size > MOST_URLS || (this.bytes > MOST_URL_BYTES && this.held.size > 1)) {
      const [oldest, one] = this.held.entries().next().value as [
        string,
        { url: string; size: number },
      ]
      this.held.delete(oldest)
      this.bytes -= one.size
      URL.revokeObjectURL(one.url)
    }
    return url
  }

  clear(): void {
    for (const one of this.held.values()) URL.revokeObjectURL(one.url)
    this.held.clear()
    this.bytes = 0
  }
}

export class Remote {
  readonly provider: string
  readonly account: string
  readSeqs = $state.raw<Readonly<Record<string, number>>>({})
  notifies = $state.raw<Readonly<Record<string, Notify>>>({})
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- views are told; nothing draws this
  private readonly views = new Map<string, { view: RemoteView; holds: number }>()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- numbering; nothing draws it
  private readonly seqs = new Map<string, Map<string, number>>()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- what was heard; nothing draws it
  readonly known = new Map<string, Map<string, ProviderMessage>>()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- which message holds a file
  private readonly owners = new Map<string, string>()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- bytes waiting to be sent
  private readonly uploads = new Map<string, { bytes: Uint8Array; type: string }>()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- sends that did not go
  private readonly failed = new Map<string, Pending>()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- sends on their way
  private readonly sending = new Map<string, Pending>()
  private readonly urls = new Urls()
  private made = 0
  private readTimers: Record<string, ReturnType<typeof setTimeout>> = {}

  constructor(
    key: { provider: string; account: string },
    readonly source: () => Source | undefined,
    private readonly seen: (conversation: string) => void,
  ) {
    this.provider = key.provider
    this.account = key.account
  }

  chatOf(conversation: string): string {
    return conversationKey({ provider: this.provider, account: this.account, conversation })
  }

  conversationIn(chat: string): string | null {
    const key = conversationKeyOf(chat)
    return key?.provider === this.provider && key.account === this.account ? key.conversation : null
  }

  private conv(chat: string): string {
    const found = this.conversationIn(chat)
    if (found === null) throw new Error('not a conversation of this account')
    return found
  }

  get connection(): Connection | null {
    return this.source()?.connection ?? null
  }

  get me(): Who {
    return whoOf(this.source()?.account.self?.id ?? '\u0000me')
  }

  conversation(id: string): Conversation | null {
    return this.source()?.conversations.find((one) => one.id === id) ?? null
  }

  can(conversation: string): ChatAbilities | null {
    const source = this.source()
    if (!source) return null
    return abilitiesOf(source.provider, source.connection, this.conversation(conversation))
  }

  service(conversation: string): Service | undefined {
    const source = this.source()
    if (!source) return undefined
    return {
      provider: this.provider,
      account: this.account,
      conversation,
      icon: source.provider.icon,
      name: source.provider.name,
    }
  }

  entry(chat: string): ChatEntry | null {
    const id = this.conversationIn(chat)
    const source = this.source()
    if (id === null || !source) return null
    const found = this.conversation(id)
    if (!found) return null
    return {
      id: chat,
      space: '',
      root: null,
      path: null,
      name: titleOf(found),
      role: roleOf(found, source.provider.can),
      members: found.members ?? found.people.length + 1,
      lastSeq: 0,
      lastAt: found.lastAt,
      lastBy: null,
      readSeq: this.readSeqs[id] ?? 0,
      unread: found.unread,
      mentions: found.mentions ?? 0,
      notify: this.notifies[id] ?? null,
      mutedUntil: found.mutedUntil ?? null,
      meta: { topic: found.topic ?? '', posting: 'writers', slowmode: 0 },
    }
  }

  seqOf(conversation: string, message: ProviderMessage): number {
    let held = this.seqs.get(conversation)
    if (!held) {
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- numbering; nothing draws it
      held = new Map()
      this.seqs.set(conversation, held)
    }
    const had = held.get(message.id)
    if (had !== undefined) return had
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and dropped here
    const taken = new Set(held.values())
    let seq = Math.max(1, Math.floor(message.at)) * 1000
    while (taken.has(seq)) seq += 1
    held.set(message.id, seq)
    return seq
  }

  idOfSeq(conversation: string, seq: number): string | null {
    for (const [id, one] of this.seqs.get(conversation) ?? []) if (one === seq) return id
    return null
  }

  remember(message: ProviderMessage): void {
    let held = this.known.get(message.conversation)
    if (!held) {
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- what was heard; nothing draws it
      held = new Map()
      this.known.set(message.conversation, held)
    }
    held.set(message.id, message)
    for (const file of message.attachments) this.owners.set(file.ref, message.id)
  }

  shown(message: ProviderMessage): Shown {
    this.remember(message)
    const source = this.source()
    const formatting = source?.provider.can.formatting ?? 'plain'
    const me = this.me
    const author = message.mine ? me : whoOf(message.author.id)
    const who = (person: string) => (person === source?.account.self?.id ? me : whoOf(person))
    const reactions: Record<string, Who[]> = {}
    for (const [emoji, people] of Object.entries(message.reactions ?? {})) {
      if (people.length) reactions[emoji] = people.map(who)
    }
    const conversation = this.conversation(message.conversation)
    const subject =
      message.subject &&
      conversation &&
      subjectOf(message.subject) !== subjectOf(titleOf(conversation))
        ? message.subject
        : undefined
    const poll = message.poll
    const votes: Record<Who, number[]> = {}
    if (poll) {
      for (const [person, answers] of Object.entries(poll.voters ?? {}))
        votes[who(person)] = [...answers]
      if (poll.mine.length) votes[me] = [...poll.mine]
    }
    const files: FileRef[] = message.attachments.map((one) => ({
      hash: one.ref,
      name: one.name,
      size: one.size,
      type: one.type,
      ...(one.width ? { width: one.width } : {}),
      ...(one.height ? { height: one.height } : {}),
      ...(one.seconds ? { seconds: one.seconds } : {}),
      ...(one.wave ? { wave: [...one.wave] } : {}),
      ...(one.kind === 'gif' || one.kind === 'sticker' ? { loop: true } : {}),
    }))
    return {
      id: message.id,
      seq: this.seqOf(message.conversation, message),
      at: message.at,
      author,
      body: message.deleted ? '' : shownText(message.text, formatting),
      ...(message.thread ? { parent: message.thread } : {}),
      ...(message.replyTo ? { quote: message.replyTo } : {}),
      alsoToChat: false,
      files: message.deleted ? [] : files,
      ...(poll
        ? {
            poll: {
              question: poll.question,
              answers: [...poll.answers],
              several: poll.several,
              ...(poll.ends !== undefined ? { ends: poll.ends } : poll.closed ? { ends: 0 } : {}),
              votes,
            },
            tally: [...poll.counts],
          }
        : {}),
      ...(message.preview
        ? {
            preview: {
              url: message.preview.url,
              title: message.preview.title,
              ...(message.preview.site ? { site: message.preview.site } : {}),
              ...(message.preview.text ? { text: message.preview.text } : {}),
            },
          }
        : {}),
      mentions: (message.mentions ?? []).map((one) => who(one) as Mention),
      reactions,
      pinned: message.pinned ?? false,
      ...(message.editedAt !== undefined ? { editedAt: message.editedAt } : {}),
      history: [],
      deleted: message.deleted ?? false,
      replies: message.replies ?? 0,
      ...(message.lastReplyAt !== undefined ? { lastReplyAt: message.lastReplyAt } : {}),
      sending: message.delivery === 'sending',
      refused: message.delivery === 'failed' ? 'invalid' : null,
      ...(message.mine && message.delivery ? { delivery: message.delivery } : {}),
      ...(message.system ? { system: true } : {}),
      ...(message.forwarded ? { forwarded: true } : {}),
      ...(subject ? { subject } : {}),
    }
  }

  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- looked up on a press; nothing draws it
  private readonly listed = new Map<string, readonly Member[]>()

  keepListed(conversation: string, members: readonly Member[] | null): void {
    if (members) this.listed.set(conversation, members)
  }

  memberOf(conversation: string, who: Who): Member | null {
    return (
      this.listed
        .get(conversation)
        ?.find(
          (one) => (one.id === this.source()?.account.self?.id ? this.me : whoOf(one.id)) === who,
        ) ?? null
    )
  }

  membersOf(conversation: string, listed: readonly Member[] | null): ChatMember[] {
    const found = this.conversation(conversation)
    const self = this.source()?.account.self
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and dropped here
    const byWho = new Map<Who, ChatMember>()
    const add = (person: Person, role: ConversationRole) => {
      const who = person.id === self?.id ? this.me : whoOf(person.id)
      if (!byWho.has(who))
        byWho.set(who, { who, name: person.name, role: role === 'member' ? 'write' : 'owner' })
    }
    if (self) add(self, found?.role ?? 'member')
    for (const one of listed ?? []) add(one, one.role)
    for (const one of found?.people ?? []) add(one, 'member')
    for (const one of this.known.get(conversation)?.values() ?? []) {
      if (!one.mine) add(one.author, 'member')
    }
    return [...byWho.values()]
  }

  open(chat: string): ChatView {
    const conversation = this.conv(chat)
    const held = this.views.get(conversation)
    if (held) {
      held.holds += 1
      return held.view
    }
    const view = new RemoteView(this, conversation, chat)
    this.views.set(conversation, { view, holds: 1 })
    for (const one of [...this.sending.values(), ...this.failed.values()])
      if (one.conversation === conversation) view.hold(one)
    void view.start()
    return view
  }

  release(conversation: string): boolean {
    const held = this.views.get(conversation)
    if (!held) return true
    held.holds -= 1
    if (held.holds > 0) return false
    this.views.delete(conversation)
    this.known.delete(conversation)
    if (this.views.size === 0) this.urls.clear()
    return true
  }

  heard(event: ProviderEvent): void {
    if (
      (event.t === 'message' || event.t === 'changed') &&
      this.views.has(event.message.conversation)
    )
      this.remember(event.message)
    const conversation =
      event.t === 'message' || event.t === 'changed'
        ? event.message.conversation
        : event.t === 'deleted' || event.t === 'typing' || event.t === 'read'
          ? event.conversation
          : null
    if (conversation !== null) {
      this.views.get(conversation)?.view.heard(event)
      return
    }
    if (event.t === 'presence') for (const { view } of this.views.values()) view.heard(event)
  }

  caughtUp(): void {
    for (const { view } of this.views.values()) void view.catchUp()
  }

  read(conversation: string, seq: number): void {
    if (seq <= (this.readSeqs[conversation] ?? 0)) return
    this.readSeqs = { ...this.readSeqs, [conversation]: seq }
    this.seen(conversation)
    clearTimeout(this.readTimers[conversation])
    this.readTimers[conversation] = setTimeout(() => {
      const id = this.idOfSeq(conversation, seq)
      if (id) void this.connection?.markRead?.(conversation, id).catch(() => undefined)
    }, READ_AFTER)
  }

  markUnread(conversation: string, seq: number): void {
    this.readSeqs = { ...this.readSeqs, [conversation]: Math.max(0, seq - 1) }
    void this.connection?.markUnread?.(conversation).catch(() => undefined)
  }

  upload(bytes: Uint8Array): string {
    this.made += 1
    const hash = `local:${this.made}`
    this.uploads.set(hash, { bytes, type: '' })
    return hash
  }

  async fileUrl(chat: string, hash: string): Promise<string | null> {
    const kept = this.urls.get(hash)
    if (kept) return kept
    const waiting = this.uploads.get(hash)
    if (waiting) return this.urls.put(hash, waiting.bytes, waiting.type)
    const connection = this.connection
    const conversation = this.conversationIn(chat)
    if (!connection || conversation === null) return null
    const owner = this.owners.get(hash)
    const known = owner ? this.known.get(conversation)?.get(owner) : undefined
    const file = known?.attachments.find((one) => one.ref === hash)
    const bytes = owner
      ? await connection.attachment(conversation, owner, hash)
      : connection.stickerBytes
        ? await connection.stickerBytes(hash)
        : null
    if (!bytes) return null
    return this.urls.put(hash, bytes, file?.type ?? '')
  }

  private outgoing(conversation: string, draft: Draft) {
    const formatting = this.source()?.provider.can.formatting ?? 'plain'
    const members = this.views.get(conversation)?.view.members ?? []
    const mentions = members
      .filter((one) => one.who !== this.me && one.name && draft.body.includes(`@${one.name}`))
      .map((one) => personOf(one.who))
    const attachments: OutgoingFile[] = (draft.files ?? []).flatMap((file) => {
      const held = this.uploads.get(file.hash)
      if (!held) return []
      return [
        {
          name: file.name,
          type: file.type,
          bytes: held.bytes,
          kind: kindOf(file),
          ...(file.width ? { width: file.width } : {}),
          ...(file.height ? { height: file.height } : {}),
          ...(file.seconds ? { seconds: file.seconds } : {}),
          ...(file.wave ? { wave: file.wave } : {}),
        },
      ]
    })
    return {
      text: sentText(draft.body, formatting),
      ...(draft.quote ? { replyTo: draft.quote } : {}),
      ...(draft.parent ? { thread: draft.parent } : {}),
      ...(mentions.length ? { mentions } : {}),
      ...(attachments.length ? { attachments } : {}),
      ...(draft.poll
        ? {
            poll: {
              question: draft.poll.question,
              answers: draft.poll.answers,
              several: draft.poll.several,
            },
          }
        : {}),
    }
  }

  async post(chat: string, draft: Draft): Promise<string> {
    const conversation = this.conv(chat)
    const connection = this.connection
    this.made += 1
    const id = `local-${this.made}`
    const view = () => this.views.get(conversation)?.view
    const shown: Shown = {
      id,
      seq: Number.MAX_SAFE_INTEGER - 1000 + this.made,
      at: Date.now(),
      author: this.me,
      body: draft.body,
      ...(draft.parent ? { parent: draft.parent } : {}),
      ...(draft.quote ? { quote: draft.quote } : {}),
      alsoToChat: false,
      files: draft.files ?? [],
      mentions: [],
      reactions: {},
      pinned: false,
      history: [],
      deleted: false,
      replies: 0,
      sending: true,
      refused: null,
      delivery: 'sending',
      ...(draft.poll
        ? { poll: { ...draft.poll, votes: {} }, tally: draft.poll.answers.map(() => 0) }
        : {}),
    }
    const pending: Pending = { shown, conversation, draft }
    this.sending.set(id, pending)
    view()?.hold(pending)
    try {
      if (!connection) throw new Error('not connected')
      const sent = await connection.send(conversation, {
        ...this.outgoing(conversation, draft),
        ...(draft.sticker ? { sticker: draft.sticker } : {}),
      })
      this.sending.delete(id)
      for (const file of draft.files ?? []) this.uploads.delete(file.hash)
      view()?.drop(id)
      view()?.heard({ t: 'message', message: sent })
      return sent.id
    } catch {
      this.sending.delete(id)
      const failed = {
        ...pending,
        shown: {
          ...shown,
          sending: false,
          refused: 'invalid' as const,
          delivery: 'failed' as const,
        },
      }
      this.failed.set(id, failed)
      view()?.hold(failed)
      return id
    }
  }

  async retry(chat: string, message: string): Promise<void> {
    const held = this.failed.get(message)
    if (!held) return
    this.failed.delete(message)
    this.views.get(held.conversation)?.view.drop(message)
    await this.post(chat, held.draft)
  }

  discard(chat: string, message: string): void {
    const held = this.failed.get(message)
    if (!held) return
    this.failed.delete(message)
    for (const file of held.draft.files ?? []) this.uploads.delete(file.hash)
    this.views.get(this.conv(chat))?.view.drop(message)
  }

  private patch(
    conversation: string,
    message: string,
    change: (one: ProviderMessage) => ProviderMessage,
  ): ProviderMessage | undefined {
    const known = this.known.get(conversation)?.get(message)
    if (known) this.views.get(conversation)?.view.heard({ t: 'changed', message: change(known) })
    return known
  }

  private async tried(
    conversation: string,
    message: string,
    change: (one: ProviderMessage) => ProviderMessage,
    work: () => Promise<void> | undefined,
  ): Promise<void> {
    const was = this.patch(conversation, message, change)
    try {
      await work()
    } catch (error) {
      const now = this.known.get(conversation)?.get(message)
      if (was && now) this.views.get(conversation)?.view.heard({ t: 'changed', message: was })
      throw error
    }
  }

  async edit(chat: string, message: string, body: string): Promise<void> {
    const conversation = this.conv(chat)
    const formatting = this.source()?.provider.can.formatting ?? 'plain'
    const text = sentText(body, formatting)
    await this.connection?.edit?.(conversation, message, { text })
    this.patch(conversation, message, (one) => ({ ...one, text, editedAt: Date.now() }))
  }

  async remove(chat: string, message: string, everyone = true): Promise<void> {
    const conversation = this.conv(chat)
    if (this.failed.has(message)) {
      this.discard(chat, message)
      return
    }
    await this.connection?.remove?.(conversation, message, everyone)
    if (everyone)
      this.patch(conversation, message, (one) => ({
        ...one,
        deleted: true,
        text: '',
        attachments: [],
      }))
    else this.views.get(conversation)?.view.heard({ t: 'deleted', conversation, message })
  }

  async react(chat: string, message: string, emoji: string, on: boolean): Promise<void> {
    const conversation = this.conv(chat)
    const self = this.source()?.account.self?.id
    const one = this.source()?.provider.can.reactions === 'one'
    const change = (known: ProviderMessage): ProviderMessage => {
      if (!self) return known
      const reactions: Record<string, string[]> = {}
      for (const [key, people] of Object.entries(known.reactions ?? {})) {
        const kept = people.filter((person) => person !== self || (key !== emoji && !(one && on)))
        if (kept.length) reactions[key] = kept
      }
      if (on) reactions[emoji] = [...(reactions[emoji] ?? []), self]
      return { ...known, reactions }
    }
    await this.tried(conversation, message, change, () =>
      this.connection?.react?.(conversation, message, emoji, on),
    )
  }

  async pin(chat: string, message: string, on: boolean): Promise<void> {
    const conversation = this.conv(chat)
    await this.connection?.pin?.(conversation, message, on)
    this.patch(conversation, message, (one) => ({ ...one, pinned: on }))
  }

  async vote(chat: string, message: string, answers: number[]): Promise<void> {
    const conversation = this.conv(chat)
    const change = (one: ProviderMessage): ProviderMessage => {
      const poll = one.poll
      if (!poll) return one
      const counts = poll.counts.map(
        (count, index) =>
          count - (poll.mine.includes(index) ? 1 : 0) + (answers.includes(index) ? 1 : 0),
      )
      return { ...one, poll: { ...poll, counts, mine: [...answers] } }
    }
    await this.tried(conversation, message, change, () =>
      this.connection?.vote?.(conversation, message, answers),
    )
  }

  async describe(chat: string, topic: string): Promise<void> {
    await this.connection?.describe?.(this.conv(chat), topic)
  }

  async notifyFor(chat: string, notify: Notify | null, mutedUntil: number | null): Promise<void> {
    const conversation = this.conv(chat)
    const rest = Object.entries(this.notifies).filter(([id]) => id !== conversation)
    this.notifies = Object.fromEntries(notify ? [...rest, [conversation, notify]] : rest)
    const until = notify === 'nothing' ? MUTED_FOR_GOOD : mutedUntil
    await this.connection?.mute?.(conversation, until)
  }

  async members(chat: string): Promise<ChatMember[]> {
    const conversation = this.conv(chat)
    const listed = await this.connection?.members?.(conversation).catch(() => null)
    return this.membersOf(conversation, listed ?? null)
  }

  async search(query: string, chat?: string): Promise<Hit[]> {
    const conversation = chat === undefined ? undefined : this.conv(chat)
    const found = (await this.connection?.search?.(query, conversation)) ?? []
    return found.map((one) => ({ chat: this.chatOf(one.conversation), message: this.shown(one) }))
  }

  async history(chat: string, ask: HistoryAsk): Promise<Message[]> {
    const conversation = this.conv(chat)
    const page = await this.connection?.history(conversation, { limit: ask.limit })
    return (page?.messages ?? []).map((one) => this.shown(one))
  }

  message(chat: string, id: string): Message | null {
    const conversation = this.conversationIn(chat)
    const known = conversation === null ? undefined : this.known.get(conversation)?.get(id)
    return known ? this.shown(known) : null
  }

  close(): void {
    for (const timer of Object.values(this.readTimers)) clearTimeout(timer)
    this.urls.clear()
    this.uploads.clear()
  }
}

class RemoteList implements MessageList {
  messages = $state.raw<Shown[]>([])
  pending = $state.raw<Shown[]>([])
  atStart = $state(false)
  atEnd = $state(true)
  loading = $state(false)
  protected window: ProviderMessage[] = []
  protected cursor: string | null = null
  private readonly listeners = new Set<() => void>()
  protected held: Pending[] = []

  constructor(
    protected readonly remote: Remote,
    readonly conversation: string,
  ) {}

  watch(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  protected belongs(message: ProviderMessage): boolean {
    return !message.thread
  }

  protected heldHere(one: Pending): boolean {
    return !one.draft.parent
  }

  hold(one: Pending): void {
    if (!this.heldHere(one)) return
    this.held = [...this.held.filter((it) => it.shown.id !== one.shown.id), one]
    this.draw()
  }

  drop(id: string): void {
    this.held = this.held.filter((one) => one.shown.id !== id)
    this.draw()
  }

  take(event: ProviderEvent): void {
    if (event.t === 'message' || event.t === 'changed') {
      const message = event.message
      if (!this.belongs(message)) return
      const at = this.window.findIndex((one) => one.id === message.id)
      if (at >= 0) this.window = this.window.map((one, index) => (index === at ? message : one))
      else if (event.t === 'message') {
        this.window = [...this.window, message].sort((a, b) => a.at - b.at)
      } else return
      this.draw()
    } else if (event.t === 'deleted') {
      const before = this.window.length
      this.window = this.window.filter((one) => one.id !== event.message)
      if (this.window.length !== before) this.draw()
    }
  }

  protected draw(): void {
    this.messages = this.window.map((one) => this.remote.shown(one))
    this.pending = this.held.map((one) => one.shown)
    for (const listener of this.listeners) listener()
  }

  protected async page(before?: string) {
    const connection = this.remote.connection
    if (!connection) return { messages: [], before: null }
    return connection.history(this.conversation, { limit: PAGE, ...(before ? { before } : {}) })
  }

  async older(): Promise<void> {
    if (this.atStart || this.loading || this.cursor === null) return
    this.loading = true
    try {
      const page = await this.page(this.cursor)
      const have = new Set(this.window.map((one) => one.id))
      this.window = [
        ...page.messages.filter((one) => this.belongs(one) && !have.has(one.id)),
        ...this.window,
      ]
      this.cursor = page.before
      this.atStart = page.before === null
    } finally {
      this.loading = false
      this.draw()
    }
  }

  newer(): Promise<void> {
    return Promise.resolve()
  }

  async catchUp(): Promise<void> {
    let page: Page
    try {
      page = await this.page()
    } catch {
      return
    }
    const fresh = page.messages.filter((one) => this.belongs(one))
    const have = new Set(this.window.map((one) => one.id))
    const oldest = fresh[0]
    if (page.before !== null && !fresh.some((one) => have.has(one.id))) {
      this.window = fresh
      this.cursor = page.before
      this.atStart = false
    } else {
      const byId = new Map(fresh.map((one) => [one.id, one]))
      const kept = this.window.flatMap((one) => {
        const now = byId.get(one.id)
        if (now) return [now]
        return oldest && one.at >= oldest.at ? [] : [one]
      })
      this.window = [...kept, ...fresh.filter((one) => !have.has(one.id))].sort(
        (a, b) => a.at - b.at,
      )
      if (this.window.length === fresh.length) {
        this.cursor = page.before
        this.atStart = page.before === null
      }
    }
    this.draw()
  }

  async latest(): Promise<void> {
    this.loading = true
    try {
      const page = await this.page()
      this.window = page.messages.filter((one) => this.belongs(one))
      this.cursor = page.before
      this.atStart = page.before === null
    } catch {
      this.atStart = true
    } finally {
      this.loading = false
      this.draw()
    }
  }
}

class RemoteReplies extends RemoteList implements RepliesView {
  parent = $state.raw<Shown | null>(null)

  constructor(
    remote: Remote,
    conversation: string,
    private readonly parentId: string,
    private readonly done: (replies: RemoteReplies) => void,
  ) {
    super(remote, conversation)
  }

  protected override belongs(message: ProviderMessage): boolean {
    return message.thread === this.parentId
  }

  protected override heldHere(one: Pending): boolean {
    return one.draft.parent === this.parentId
  }

  protected override async page(before?: string) {
    const connection = this.remote.connection
    if (!connection?.thread) return { messages: [], before: null }
    return connection.thread(this.conversation, this.parentId, {
      limit: PAGE,
      ...(before ? { before } : {}),
    })
  }

  override take(event: ProviderEvent): void {
    super.take(event)
    if ((event.t === 'changed' || event.t === 'message') && event.message.id === this.parentId)
      this.parent = this.remote.shown(event.message)
  }

  protected override draw(): void {
    const known = this.remote.known.get(this.conversation)?.get(this.parentId)
    if (known) this.parent = this.remote.shown(known)
    super.draw()
  }

  close(): void {
    this.done(this)
  }
}

export class RemoteView extends RemoteList implements ChatView {
  members = $state.raw<ChatMember[]>([])
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- replaced whole, never changed
  presence = $state.raw<Presence>({ here: [], typing: [], reads: new Map<Who, number>() })
  lineAt = $state(0)
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- told, not drawn
  private readonly replying = new Set<RemoteReplies>()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- `presence` is what renders
  private readonly reads = new Map<Who, number>()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- likewise
  private readonly typists = new Map<string, { who: Who; parent?: string; until: number }>()
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- likewise
  private readonly online = new Map<Who, boolean>()
  private typingTimer: ReturnType<typeof setTimeout> | undefined
  private typedAt = 0
  private listed: readonly Member[] | null = null
  private closed = false

  constructor(
    remote: Remote,
    conversation: string,
    readonly chat: string,
  ) {
    super(remote, conversation)
  }

  get can(): ChatAbilities {
    return this.remote.can(this.conversation) ?? CLOSED
  }

  get me(): Who {
    return this.remote.me
  }

  get service(): Service | undefined {
    return this.remote.service(this.conversation)
  }

  get entry(): ChatEntry | null {
    return this.remote.entry(this.chat)
  }

  get meta() {
    return this.entry?.meta ?? { topic: '', posting: 'writers' as const, slowmode: 0 }
  }

  get role(): Role | null {
    return this.entry?.role ?? null
  }

  async start(): Promise<void> {
    const unread = this.remote.conversation(this.conversation)?.unread ?? 0
    await this.latest()
    const seqs = this.messages.map((one) => one.seq)
    const line = unread > 0 ? (seqs[seqs.length - unread - 1] ?? 0) : (seqs.at(-1) ?? 0)
    this.lineAt = line
    if ((this.remote.readSeqs[this.conversation] ?? 0) < line) {
      this.remote.readSeqs = { ...this.remote.readSeqs, [this.conversation]: line }
    }
    this.drawMembers()
    const listed = await this.remote.connection?.members?.(this.conversation).catch(() => null)
    if (this.closed) return
    this.listed = listed ?? null
    this.remote.keepListed(this.conversation, this.listed)
    for (const one of listed ?? [])
      if (one.online !== undefined) this.online.set(whoOfMember(this.remote, one), one.online)
    this.drawMembers()
  }

  private drawMembers(): void {
    this.members = this.remote.membersOf(this.conversation, this.listed)
    this.drawPresence()
  }

  protected override draw(): void {
    super.draw()
    if (this.members.length < this.remote.membersOf(this.conversation, this.listed).length)
      this.drawMembers()
  }

  heard(event: ProviderEvent): void {
    this.take(event)
    for (const one of this.replying) one.take(event)
    if (event.t === 'typing') this.typing(event.person, event.on, event.thread)
    else if (event.t === 'presence') {
      const who = whoOf(event.person)
      if (!this.members.some((one) => one.who === who)) return
      this.online.set(who, event.online)
      this.drawPresence()
    } else if (event.t === 'read') {
      if (!this.remote.source()?.provider.can.receipts) return
      const self = this.remote.source()?.account.self?.id
      if (event.person === self) return
      const known = this.remote.known.get(this.conversation)?.get(event.upTo)
      if (!known) return
      this.reads.set(whoOf(event.person), this.remote.seqOf(this.conversation, known))
      this.drawPresence()
    }
  }

  async jump(message: string): Promise<boolean> {
    for (let pages = 0; pages < JUMP_PAGES; pages++) {
      if (this.window.some((one) => one.id === message)) return true
      const parent = this.remote.known.get(this.conversation)?.get(message)?.thread
      if (parent && this.window.some((one) => one.id === parent)) return true
      if (this.atStart) return false
      await this.older()
    }
    return this.window.some((one) => one.id === message)
  }

  override async catchUp(): Promise<void> {
    await Promise.all([super.catchUp(), ...[...this.replying].map((one) => one.catchUp())])
  }

  replies(parent: string): RepliesView {
    const replies = new RemoteReplies(this.remote, this.conversation, parent, (one) =>
      this.replying.delete(one),
    )
    this.replying.add(replies)
    for (const one of this.held) replies.hold(one)
    void replies.latest()
    return replies
  }

  override hold(one: Pending): void {
    super.hold(one)
    for (const replies of this.replying) replies.hold(one)
  }

  override drop(id: string): void {
    super.drop(id)
    for (const replies of this.replying) replies.drop(id)
  }

  read(seq: number): void {
    this.remote.read(this.conversation, seq)
  }

  markUnread(seq: number): void {
    this.lineAt = Math.max(0, seq - 1)
    this.remote.markUnread(this.conversation, seq)
  }

  typed(parent?: string): void {
    const now = Date.now()
    if (now - this.typedAt < TYPING_EVERY) return
    this.typedAt = now
    void this.remote.connection?.typing?.(this.conversation, true, parent).catch(() => undefined)
  }

  close(): void {
    if (this.closed || !this.remote.release(this.conversation)) return
    this.closed = true
    clearTimeout(this.typingTimer)
  }

  private typing(person: string, on: boolean, thread: string | undefined): void {
    if (person === this.remote.source()?.account.self?.id) return
    const who = whoOf(person)
    const key = `${who}\u0000${thread ?? ''}`
    if (on)
      this.typists.set(key, {
        who,
        ...(thread ? { parent: thread } : {}),
        until: Date.now() + TYPING_SHOWN,
      })
    else this.typists.delete(key)
    this.drawPresence()
  }

  private drawPresence(): void {
    const now = Date.now()
    for (const [key, one] of this.typists) if (one.until <= now) this.typists.delete(key)
    const typing = [...this.typists.values()].map(({ who, parent }) =>
      parent ? { who, parent } : { who },
    )
    const here = [...this.online.entries()].filter(([, on]) => on).map(([who]) => who)
    this.presence = {
      here,
      typing,
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- replaced whole, never changed
      reads: new Map(this.reads),
    }
    clearTimeout(this.typingTimer)
    const next = [...this.typists.values()].reduce((low, one) => Math.min(low, one.until), Infinity)
    if (Number.isFinite(next))
      this.typingTimer = setTimeout(() => this.drawPresence(), Math.max(0, next - now))
  }
}

function whoOfMember(remote: Remote, member: Member): Who {
  return member.id === remote.source()?.account.self?.id ? remote.me : whoOf(member.id)
}
