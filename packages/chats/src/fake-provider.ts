import type {
  AttachmentRef,
  Capabilities,
  ChatProvider,
  Connection,
  Conversation,
  ConversationRole,
  Host,
  Member,
  Outgoing,
  Page,
  Person,
  ProviderEvent,
  ProviderMessage,
  Sticker,
} from './provider'

export type Optional = Exclude<
  {
    [K in keyof Connection]-?: undefined extends Connection[K] ? K : never
  }[keyof Connection],
  undefined
>

export const OPTIONAL: readonly Optional[] = [
  'markRead',
  'thread',
  'edit',
  'remove',
  'react',
  'pin',
  'vote',
  'typing',
  'markUnread',
  'search',
  'members',
  'people',
  'begin',
  'invite',
  'kick',
  'promote',
  'rename',
  'describe',
  'leave',
  'mute',
  'archive',
  'pinConversation',
  'stickers',
  'gifs',
  'stickerBytes',
  'picture',
]

export const EVERYTHING: Capabilities = {
  send: true,
  attachments: true,
  live: true,
  replies: true,
  threads: true,
  editFor: 48 * 3_600_000,
  removeFor: 48 * 3_600_000,
  removeForMe: true,
  reactions: 'any',
  voice: true,
  polls: true,
  receipts: true,
  presence: true,
  maxFile: 50 * 1024 * 1024,
  formatting: 'markdown',
}

export const SEND_ONLY: Capabilities = {
  send: true,
  attachments: false,
  live: true,
  replies: false,
}

export interface FakeOptions {
  id?: string
  name?: string
  can?: Capabilities
  methods?: readonly Optional[]
  signIn?: 'none' | 'code' | 'qr'
  warning?: string
  code?: string
  now?: () => number
}

const PNG = base64(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
)
const GIF = base64('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==')

function base64(text: string): Uint8Array {
  const raw = atob(text)
  return Uint8Array.from(raw, (one) => one.charCodeAt(0))
}

function silence(seconds: number): Uint8Array {
  const rate = 8000
  const samples = rate * seconds
  const bytes = new Uint8Array(44 + samples)
  const view = new DataView(bytes.buffer)
  const text = (at: number, words: string) => {
    for (let i = 0; i < words.length; i++) bytes[at + i] = words.charCodeAt(i)
  }
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples, true)
  text(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate, true)
  view.setUint16(32, 1, true)
  view.setUint16(34, 8, true)
  text(36, 'data')
  view.setUint32(40, samples, true)
  bytes.fill(128, 44)
  return bytes
}

interface Held {
  message: ProviderMessage
  votes: Map<string, number[]>
}

export class FakeWorld {
  readonly me: Person = { id: 'me', name: 'Me', handle: 'me' }
  readonly people: Person[] = [
    { id: 'ada', name: 'Ada Lovelace', handle: 'ada', phone: '+41790000001' },
    { id: 'bo', name: 'Bo Chen', handle: 'bo' },
    { id: 'cy', name: 'Cy Park', handle: 'cy' },
  ]
  conversations: Conversation[] = []
  readonly messages = new Map<string, Held[]>()
  readonly files = new Map<string, Uint8Array>()
  readonly members = new Map<string, Member[]>()
  readonly typed: { conversation: string; on: boolean; thread?: string }[] = []
  readonly calls: { method: string; args: unknown[] }[] = []
  private readonly hearers = new Set<(event: ProviderEvent) => void>()
  private next = 0
  private paired: (() => void) | null = null

  constructor(
    readonly can: Capabilities,
    private readonly clock: () => number,
  ) {
    this.seed()
  }

  now(): number {
    return this.clock()
  }

  id(prefix: string): string {
    this.next += 1
    return `${prefix}${this.next}`
  }

  person(id: string): Person {
    if (id === this.me.id) return this.me
    return this.people.find((one) => one.id === id) ?? { id, name: id }
  }

  hear(listener: (event: ProviderEvent) => void): () => void {
    this.hearers.add(listener)
    return () => this.hearers.delete(listener)
  }

  tell(event: ProviderEvent): void {
    for (const hear of this.hearers) hear(event)
  }

  pair(): void {
    this.paired?.()
    this.paired = null
  }

  waitForPairing(): Promise<void> {
    return new Promise((resolve) => (this.paired = resolve))
  }

  conversation(id: string): Conversation {
    const found = this.conversations.find((one) => one.id === id)
    if (!found) throw new Error(`no conversation ${id}`)
    return found
  }

  change(id: string, change: Partial<Conversation>): Conversation {
    const next = { ...this.conversation(id), ...change }
    this.conversations = this.conversations.map((one) => (one.id === id ? next : one))
    this.tell({ t: 'conversation', conversation: next })
    return next
  }

  held(conversation: string, message: string): Held {
    const found = this.messages.get(conversation)?.find((one) => one.message.id === message)
    if (!found) throw new Error(`no message ${message}`)
    return found
  }

  put(message: ProviderMessage): ProviderMessage {
    const list = this.messages.get(message.conversation) ?? []
    list.push({ message, votes: new Map() })
    this.messages.set(message.conversation, list)
    const conversation = this.conversations.find((one) => one.id === message.conversation)
    if (conversation && !message.thread) {
      const unread = message.mine ? conversation.unread : conversation.unread + 1
      const mentioned = message.mentions?.includes(this.me.id) ? 1 : 0
      this.conversations = this.conversations.map((one) =>
        one.id === message.conversation
          ? {
              ...one,
              lastAt: message.at,
              unread,
              mentions: (one.mentions ?? 0) + (message.mine ? 0 : mentioned),
              snippet: message.text,
            }
          : one,
      )
    }
    if (message.thread) {
      const parent = this.held(message.conversation, message.thread)
      parent.message = {
        ...parent.message,
        replies: (parent.message.replies ?? 0) + 1,
        lastReplyAt: message.at,
      }
    }
    return message
  }

  file(name: string, type: string, bytes: Uint8Array, more: Partial<AttachmentRef> = {}) {
    const ref = this.id('f')
    this.files.set(ref, bytes)
    return { ref, name, type, size: bytes.length, ...more }
  }

  say(conversation: string, from: string, text: string, more: Partial<ProviderMessage> = {}) {
    const message = this.put({
      id: this.id('m'),
      conversation,
      author: this.person(from),
      at: this.now(),
      text,
      attachments: [],
      mine: false,
      ...more,
    })
    this.tell({ t: 'message', message })
    if (more.thread)
      this.tell({ t: 'changed', message: this.held(conversation, more.thread).message })
    return message
  }

  changeMessage(conversation: string, id: string, change: Partial<ProviderMessage>) {
    const held = this.held(conversation, id)
    held.message = { ...held.message, ...change }
    this.tell({ t: 'changed', message: held.message })
    return held.message
  }

  private seed(): void {
    const start = this.now() - 3 * 3_600_000
    let at = start
    const step = () => (at += 60_000)
    this.conversations = [
      {
        id: 'ada',
        title: null,
        kind: 'direct',
        people: [this.person('ada')],
        lastAt: null,
        unread: 0,
        role: 'member',
      },
      {
        id: 'team',
        title: 'Team',
        kind: 'group',
        people: this.people,
        lastAt: null,
        unread: 0,
        topic: 'Everything about the launch',
        role: 'admin',
        members: 4,
      },
      {
        id: 'news',
        title: 'News',
        kind: 'channel',
        people: [],
        lastAt: null,
        unread: 0,
        readOnly: true,
        archived: true,
        role: 'member',
      },
    ]
    this.members.set('ada', [
      { ...this.me, role: 'member' },
      { ...this.person('ada'), role: 'member', online: true },
    ])
    this.members.set('team', [
      { ...this.me, role: 'admin' },
      { ...this.person('ada'), role: 'owner', online: true },
      { ...this.person('bo'), role: 'member', online: false, lastSeen: start },
      { ...this.person('cy'), role: 'member' },
    ])
    this.members.set('news', [{ ...this.me, role: 'member' }])
    const put = (
      one: Omit<ProviderMessage, 'id' | 'at' | 'attachments'> & Partial<ProviderMessage>,
    ) => this.put({ id: this.id('m'), at: step(), attachments: [], ...one })
    const ada = this.person('ada')
    const bo = this.person('bo')
    put({ conversation: 'ada', author: ada, text: 'Hello! Did you see the plan?', mine: false })
    const mine = put({
      conversation: 'ada',
      author: this.me,
      text: 'Yes, looks good.',
      mine: true,
      delivery: 'read',
    })
    put({
      conversation: 'ada',
      author: ada,
      text: 'Great, here is the sketch',
      mine: false,
      replyTo: mine.id,
      attachments: [
        this.file('sketch.png', 'image/png', PNG, { kind: 'image', width: 64, height: 48 }),
      ],
    })
    put({
      conversation: 'ada',
      author: ada,
      text: '',
      mine: false,
      attachments: [
        this.file('voice.wav', 'audio/wav', silence(2), {
          kind: 'voice',
          seconds: 2,
          wave: [10, 80, 200, 120, 40, 0, 60, 255],
        }),
      ],
    })
    put({
      conversation: 'ada',
      author: ada,
      text: '',
      mine: false,
      attachments: [
        this.file('wave.png', 'image/png', PNG, { kind: 'sticker', width: 64, height: 64 }),
      ],
    })
    put({
      conversation: 'ada',
      author: ada,
      text: '',
      mine: false,
      attachments: [
        this.file('dance.gif', 'image/gif', GIF, { kind: 'gif', width: 64, height: 64 }),
      ],
    })
    put({
      conversation: 'ada',
      author: ada,
      text: 'See https://example.org/plan',
      mine: false,
      preview: { url: 'https://example.org/plan', title: 'The plan', site: 'example.org' },
    })
    put({
      conversation: 'team',
      author: this.person('cy'),
      text: 'Cy joined',
      mine: false,
      system: true,
    })
    const parent = put({
      conversation: 'team',
      author: bo,
      text: 'Where do we meet?',
      mine: false,
      reactions: { '👍': ['ada', this.me.id] },
    })
    put({ conversation: 'team', author: ada, text: 'At the lab', mine: false, thread: parent.id })
    put({
      conversation: 'team',
      author: ada,
      text: 'Lunch?',
      mine: false,
      poll: {
        question: 'Lunch?',
        answers: ['Pizza', 'Salad'],
        several: false,
        counts: [2, 1],
        mine: [],
      },
    })
    put({ conversation: 'team', author: bo, text: 'Fixed the typo', mine: false, editedAt: step() })
    put({ conversation: 'team', author: bo, text: '', mine: false, deleted: true })
    put({ conversation: 'team', author: ada, text: 'From elsewhere', mine: false, forwarded: true })
    put({
      conversation: 'team',
      author: bo,
      text: '@me can you look?',
      mine: false,
      mentions: [this.me.id],
      pinned: true,
    })
    put({ conversation: 'news', author: ada, text: 'Release notes are out', mine: false })
  }
}

function connection(world: FakeWorld, methods: ReadonlySet<Optional>, label: string): Connection {
  const call = (method: string, args: unknown[]) => world.calls.push({ method, args })
  const page = (list: readonly Held[], limit: number, before?: string): Page => {
    const all = list.map((one) => one.message)
    const end = before === undefined ? all.length : all.findIndex((one) => one.id === before)
    const from = Math.max(0, end - limit)
    const messages = all.slice(from, end < 0 ? all.length : end)
    return { messages, before: from > 0 ? (messages[0]?.id ?? null) : null }
  }
  const outgoing = async (conversation: string, draft: Outgoing): Promise<ProviderMessage> => {
    const attachments = (draft.attachments ?? []).map((one) =>
      world.file(one.name, one.type, one.bytes, {
        ...(one.kind ? { kind: one.kind } : {}),
        ...(one.width ? { width: one.width } : {}),
        ...(one.height ? { height: one.height } : {}),
        ...(one.seconds ? { seconds: one.seconds } : {}),
        ...(one.wave ? { wave: one.wave } : {}),
      }),
    )
    if (draft.sticker) {
      attachments.push(
        world.file('sticker.png', 'image/png', PNG, { kind: 'sticker', width: 64, height: 64 }),
      )
    }
    const message = world.put({
      id: world.id('m'),
      conversation,
      author: world.me,
      at: world.now(),
      text: draft.text,
      attachments,
      mine: true,
      delivery: 'sent',
      ...(draft.replyTo ? { replyTo: draft.replyTo } : {}),
      ...(draft.thread ? { thread: draft.thread } : {}),
      ...(draft.mentions?.length ? { mentions: draft.mentions } : {}),
      ...(draft.poll
        ? {
            poll: {
              ...draft.poll,
              counts: draft.poll.answers.map(() => 0),
              mine: [],
            },
          }
        : {}),
    })
    world.tell({ t: 'message', message })
    await Promise.resolve()
    world.changeMessage(conversation, message.id, { delivery: 'delivered' })
    return world.held(conversation, message.id).message
  }
  const full: Required<Connection> = {
    account: { id: label, label, self: world.me },
    conversations: () => Promise.resolve([...world.conversations]),
    history: (conversation, ask) =>
      Promise.resolve(
        page(
          (world.messages.get(conversation) ?? []).filter((one) => !one.message.thread),
          ask.limit,
          ask.before,
        ),
      ),
    send: (conversation, draft) => {
      call('send', [conversation, draft])
      return outgoing(conversation, draft)
    },
    start: (hear) => {
      const stop = world.hear(hear)
      hear({ t: 'status', status: 'online' })
      return stop
    },
    attachment: (_conversation, _message, ref) => {
      const bytes = world.files.get(ref)
      return bytes ? Promise.resolve(bytes) : Promise.reject(new Error('no such file'))
    },
    close: () => Promise.resolve(),
    markRead: (conversation, upTo) => {
      call('markRead', [conversation, upTo])
      world.change(conversation, { unread: 0, mentions: 0 })
      return Promise.resolve()
    },
    thread: (conversation, parent, ask) =>
      Promise.resolve(
        page(
          (world.messages.get(conversation) ?? []).filter((one) => one.message.thread === parent),
          ask.limit,
          ask.before,
        ),
      ),
    edit: (conversation, message, draft) => {
      call('edit', [conversation, message, draft])
      world.changeMessage(conversation, message, { text: draft.text, editedAt: world.now() })
      return Promise.resolve()
    },
    remove: (conversation, message, everyone) => {
      call('remove', [conversation, message, everyone])
      if (everyone)
        world.changeMessage(conversation, message, { deleted: true, text: '', attachments: [] })
      else {
        const list = world.messages.get(conversation) ?? []
        world.messages.set(
          conversation,
          list.filter((one) => one.message.id !== message),
        )
        world.tell({ t: 'deleted', conversation, message })
      }
      return Promise.resolve()
    },
    react: (conversation, message, emoji, on) => {
      call('react', [conversation, message, emoji, on])
      const held = world.held(conversation, message)
      const me = world.me.id
      const reactions: Record<string, string[]> = {}
      for (const [key, who] of Object.entries(held.message.reactions ?? {})) {
        const kept = world.can.reactions === 'one' ? who.filter((one) => one !== me) : [...who]
        if (kept.length) reactions[key] = kept
      }
      const list = (reactions[emoji] ?? []).filter((one) => one !== me)
      if (on) list.push(me)
      const rest = Object.entries(reactions).filter(([key]) => key !== emoji)
      world.changeMessage(conversation, message, {
        reactions: Object.fromEntries(list.length ? [...rest, [emoji, list]] : rest),
      })
      return Promise.resolve()
    },
    pin: (conversation, message, on) => {
      call('pin', [conversation, message, on])
      world.changeMessage(conversation, message, { pinned: on })
      return Promise.resolve()
    },
    vote: (conversation, message, answers) => {
      call('vote', [conversation, message, answers])
      const held = world.held(conversation, message)
      const poll = held.message.poll
      if (!poll) return Promise.reject(new Error('not a poll'))
      const counts = poll.counts.map(
        (count, index) =>
          count - (poll.mine.includes(index) ? 1 : 0) + (answers.includes(index) ? 1 : 0),
      )
      world.changeMessage(conversation, message, { poll: { ...poll, counts, mine: [...answers] } })
      return Promise.resolve()
    },
    typing: (conversation, on, thread) => {
      world.typed.push({ conversation, on, ...(thread ? { thread } : {}) })
      return Promise.resolve()
    },
    markUnread: (conversation) => {
      call('markUnread', [conversation])
      world.change(conversation, { unread: Math.max(1, world.conversation(conversation).unread) })
      return Promise.resolve()
    },
    search: (query, conversation) => {
      const asked = query.toLowerCase()
      const found = [...world.messages.entries()]
        .filter(([id]) => conversation === undefined || id === conversation)
        .flatMap(([, list]) => list.map((one) => one.message))
        .filter((one) => !one.deleted && one.text.toLowerCase().includes(asked))
      return Promise.resolve(found)
    },
    members: (conversation) => Promise.resolve([...(world.members.get(conversation) ?? [])]),
    people: (query) => {
      const asked = query.toLowerCase()
      return Promise.resolve(
        world.people.filter(
          (one) => one.name.toLowerCase().includes(asked) || (one.handle ?? '').includes(asked),
        ),
      )
    },
    begin: (people, title) => {
      call('begin', [people, title])
      const id = world.id('c')
      const persons = people.map((one) => world.person(one))
      const conversation: Conversation = {
        id,
        title: title ?? null,
        kind: people.length > 1 ? 'group' : 'direct',
        people: persons,
        lastAt: world.now(),
        unread: 0,
        role: people.length > 1 ? 'owner' : 'member',
      }
      world.conversations = [conversation, ...world.conversations]
      world.members.set(id, [
        { ...world.me, role: conversation.role ?? 'member' },
        ...persons.map((one) => ({ ...one, role: 'member' as const })),
      ])
      world.tell({ t: 'conversation', conversation })
      return Promise.resolve(conversation)
    },
    invite: (conversation, people) => {
      call('invite', [conversation, people])
      const list = world.members.get(conversation) ?? []
      world.members.set(conversation, [
        ...list,
        ...people.map((one) => ({ ...world.person(one), role: 'member' as const })),
      ])
      world.change(conversation, { members: list.length + people.length })
      return Promise.resolve()
    },
    kick: (conversation, person) => {
      call('kick', [conversation, person])
      const list = (world.members.get(conversation) ?? []).filter((one) => one.id !== person)
      world.members.set(conversation, list)
      world.change(conversation, { members: list.length })
      return Promise.resolve()
    },
    promote: (conversation, person, role: ConversationRole) => {
      call('promote', [conversation, person, role])
      world.members.set(
        conversation,
        (world.members.get(conversation) ?? []).map((one) =>
          one.id === person ? { ...one, role } : one,
        ),
      )
      world.change(conversation, {})
      return Promise.resolve()
    },
    rename: (conversation, title) => {
      call('rename', [conversation, title])
      world.change(conversation, { title })
      return Promise.resolve()
    },
    describe: (conversation, topic) => {
      call('describe', [conversation, topic])
      world.change(conversation, { topic })
      return Promise.resolve()
    },
    leave: (conversation) => {
      call('leave', [conversation])
      world.conversations = world.conversations.filter((one) => one.id !== conversation)
      world.tell({ t: 'gone', conversation })
      return Promise.resolve()
    },
    mute: (conversation, until) => {
      call('mute', [conversation, until])
      world.change(conversation, { mutedUntil: until })
      return Promise.resolve()
    },
    archive: (conversation, on) => {
      call('archive', [conversation, on])
      world.change(conversation, { archived: on })
      return Promise.resolve()
    },
    pinConversation: (conversation, on) => {
      call('pinConversation', [conversation, on])
      world.change(conversation, { pinned: on })
      return Promise.resolve()
    },
    stickers: () =>
      Promise.resolve([
        {
          id: 'hello',
          name: 'Hello',
          stickers: [
            { ref: 's1', name: 'Wave', type: 'image/png', emoji: '👋', width: 64, height: 64 },
            { ref: 's2', name: 'Heart', type: 'image/png', emoji: '❤️', width: 64, height: 64 },
          ],
        },
      ]),
    gifs: (query): Promise<Sticker[]> =>
      Promise.resolve([
        {
          ref: 'g1',
          name: query.trim() ? query : 'dance',
          type: 'image/gif',
          width: 64,
          height: 64,
        },
      ]),
    stickerBytes: (ref) => Promise.resolve(ref.startsWith('g') ? GIF : PNG),
    picture: () => Promise.resolve(null),
  }
  const made: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(full)) {
    if (!(OPTIONAL as readonly string[]).includes(key) || methods.has(key as Optional))
      made[key] = value
  }
  Object.defineProperty(made, 'account', { value: full.account, enumerable: true })
  return made as unknown as Connection
}

export interface FakeProvider extends ChatProvider {
  readonly world: FakeWorld
  connection: Connection | null
}

export function fakeProvider(options: FakeOptions = {}): FakeProvider {
  const can = options.can ?? EVERYTHING
  const world = new FakeWorld(can, options.now ?? (() => Date.now()))
  const methods = new Set(options.methods ?? OPTIONAL)
  const id = options.id ?? 'fake'
  const provider: FakeProvider = {
    id,
    name: options.name ?? 'Fake',
    icon: 'M4 4h16v12H8l-4 4z',
    fields: [
      {
        key: 'name',
        label: 'Account name',
        kind: 'text',
        note: 'Any name; nothing leaves this device',
      },
      ...(options.signIn === 'code'
        ? [{ key: 'phone', label: 'Phone number', kind: 'phone' as const }]
        : []),
    ],
    can,
    ...(options.warning ? { warning: options.warning } : {}),
    world,
    connection: null,
    available: () => true,
    async connect(config, host: Host) {
      if (options.signIn === 'code') {
        if (!host.ask) throw new Error('this needs a code')
        const code = await host.ask({
          kind: 'code',
          label: 'Code',
          note: `Sent to ${config.phone ?? ''}`,
        })
        if (code !== (options.code ?? '12345')) throw new Error('wrong code')
      }
      if (options.signIn === 'qr') {
        if (!host.show) throw new Error('this needs a screen')
        host.show({
          kind: 'qr',
          data: 'fake://pair/0123456789',
          label: 'Scan this with your phone',
        })
        await world.waitForPairing()
        host.show(null)
      }
      await host.sealed?.write(`${id}-session`, new TextEncoder().encode(config.name ?? id))
      const made = connection(world, methods, config.name?.trim() ? config.name : `${id}-account`)
      provider.connection = made
      return made
    },
  }
  return provider
}
