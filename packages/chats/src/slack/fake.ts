import type { Host, NativeAsk } from '../provider'
import type { Said } from './api'
import type { Dial, Line, LineEvents } from './socket'

type Method = (form: URLSearchParams, who: Said) => Said

interface Channel {
  id: string
  name?: string
  is_im?: boolean
  is_mpim?: boolean
  is_private?: boolean
  is_archived?: boolean
  user?: string
  creator?: string
  topic?: { value: string }
  members: string[]
  messages: Said[]
  last_read?: string
}

export interface FakeOptions {
  limited?: Readonly<Record<string, number>>
}

export class FakeSlack {
  readonly users = new Map<string, Said>()
  readonly channels = new Map<string, Channel>()
  readonly files = new Map<string, { said: Said; bytes: Uint8Array | null; upload: string }>()
  readonly uploads = new Map<string, Uint8Array>()
  readonly calls: { method: string; form: URLSearchParams }[] = []
  readonly tokens = new Map<string, string>([['xoxp-good', 'U1']])
  readonly appTokens = new Set(['xapp-good'])
  readonly lines: FakeLine[] = []
  readonly limited = new Map<string, number>()
  revoked: string[] = []
  clock = 1_700_000_000
  private serial = 0

  constructor(options: FakeOptions = {}) {
    for (const [method, times] of Object.entries(options.limited ?? {}))
      this.limited.set(method, times)
    this.user('U1', 'emil', 'Emil')
    this.user('U2', 'mia', 'Mia')
    this.user('U3', 'noah', 'Noah')
    this.channel({
      id: 'C1',
      name: 'general',
      creator: 'U2',
      members: ['U1', 'U2', 'U3'],
      messages: [],
    })
    this.channel({ id: 'D1', is_im: true, user: 'U2', members: ['U1', 'U2'], messages: [] })
    this.channel({
      id: 'G1',
      is_mpim: true,
      name: 'mpdm-emil--mia--noah-1',
      members: ['U1', 'U2', 'U3'],
      messages: [],
    })
  }

  user(id: string, name: string, real: string): void {
    this.users.set(id, {
      id,
      name,
      real_name: real,
      profile: {
        display_name: real,
        real_name: real,
        image_72: `https://avatars.slack-edge.com/${id}_72.png`,
      },
    })
  }

  channel(channel: Channel): void {
    this.channels.set(channel.id, channel)
  }

  ts(): string {
    this.clock += 1
    return `${this.clock}.000${String(++this.serial).padStart(3, '0')}`
  }

  post(channel: string, user: string, text: string, extra: Said = {}): Said {
    const message: Said = { type: 'message', user, text, ts: this.ts(), ...extra }
    this.place(channel).messages.push(message)
    return message
  }

  private place(id: string): Channel {
    const channel = this.channels.get(id)
    if (!channel) throw new Fail('channel_not_found')
    return channel
  }

  private find(channel: string, ts: string): Said {
    const found = this.place(channel).messages.find((one) => one.ts === ts)
    if (!found) throw new Fail('message_not_found')
    return found
  }

  private conversationOf(channel: Channel, who: string): Said {
    const { members, messages, ...rest } = channel
    const latest = messages.filter((one) => !one.thread_ts || one.thread_ts === one.ts).at(-1)
    return {
      ...rest,
      num_members: members.length,
      ...(channel.is_im && channel.user === who
        ? { user: members.find((one) => one !== who) }
        : {}),
      ...(latest ? { latest } : {}),
    }
  }

  private readonly methods: Record<string, Method> = {
    'auth.test': (_, who) => ({ user_id: who.id, user: who.name, team_id: 'T1', team: 'Acme' }),
    'auth.revoke': (form) => {
      this.revoked.push(form.get('token') ?? '')
      this.tokens.delete(form.get('token') ?? '')
      return { revoked: true }
    },
    'users.info': (form) => {
      const user = this.users.get(form.get('user') ?? '')
      if (!user) throw new Fail('user_not_found')
      return { user }
    },
    'users.list': () => ({ members: [...this.users.values()] }),
    'users.getPresence': (form) => ({ presence: form.get('user') === 'U2' ? 'active' : 'away' }),
    'users.conversations': (_, who) => ({
      channels: [...this.channels.values()]
        .filter((one) => one.members.includes(text(who.id)))
        .map((one) => this.conversationOf(one, text(who.id))),
    }),
    'conversations.info': (form, who) => ({
      channel: this.conversationOf(this.place(form.get('channel') ?? ''), text(who.id)),
    }),
    'conversations.history': (form) => {
      const channel = this.place(form.get('channel') ?? '')
      const latest = Number(form.get('latest') ?? Infinity)
      const oldest = Number(form.get('oldest') ?? 0)
      const inclusive = form.get('inclusive') === 'true'
      const limit = Number(form.get('limit') ?? 100)
      const fits = channel.messages
        .filter(
          (one) => !one.thread_ts || one.thread_ts === one.ts || one.subtype === 'thread_broadcast',
        )
        .filter((one) => {
          const at = Number(one.ts)
          return (
            (inclusive ? at <= latest : at < latest) && (inclusive ? at >= oldest : at > oldest)
          )
        })
        .reverse()
      return { messages: fits.slice(0, limit), has_more: fits.length > limit }
    },
    'conversations.replies': (form) => {
      const channel = this.place(form.get('channel') ?? '')
      const parent = form.get('ts') ?? ''
      const latest = Number(form.get('latest') ?? Infinity)
      const oldest = Number(form.get('oldest') ?? 0)
      const inclusive = form.get('inclusive') === 'true'
      const limit = Number(form.get('limit') ?? 1000)
      const head = channel.messages.filter((one) => one.ts === parent)
      const replies = channel.messages.filter((one) => {
        const at = Number(one.ts)
        return (
          one.ts !== parent &&
          one.thread_ts === parent &&
          (inclusive ? at <= latest && at >= oldest : at < latest && at > oldest)
        )
      })
      const all = [...head, ...replies]
      return { messages: all.slice(0, limit), has_more: all.length > limit }
    },
    'conversations.mark': (form) => {
      this.place(form.get('channel') ?? '').last_read = form.get('ts') ?? ''
      return {}
    },
    'conversations.members': (form) => ({ members: this.place(form.get('channel') ?? '').members }),
    'conversations.open': (form, who) => {
      const users = (form.get('users') ?? '').split(',')
      const existing = [...this.channels.values()].find(
        (one) => one.is_im && users.length === 1 && one.members.includes(users[0] ?? ''),
      )
      const channel: Channel = existing ?? {
        id: `D${this.serial++}`,
        is_im: users.length === 1,
        is_mpim: users.length > 1,
        user: users[0] ?? '',
        members: [text(who.id), ...users],
        messages: [],
      }
      this.channels.set(channel.id, channel)
      return { channel: this.conversationOf(channel, text(who.id)) }
    },
    'conversations.create': (form, who) => {
      const channel = {
        id: `C${100 + this.serial++}`,
        name: form.get('name') ?? '',
        is_private: form.get('is_private') === 'true',
        creator: text(who.id),
        members: [text(who.id)],
        messages: [],
      }
      this.channels.set(channel.id, channel)
      return { channel: this.conversationOf(channel, text(who.id)) }
    },
    'conversations.invite': (form) => {
      const channel = this.place(form.get('channel') ?? '')
      for (const user of (form.get('users') ?? '').split(','))
        if (!channel.members.includes(user)) channel.members.push(user)
      return {}
    },
    'conversations.kick': (form) => {
      const channel = this.place(form.get('channel') ?? '')
      channel.members = channel.members.filter((one) => one !== form.get('user'))
      return {}
    },
    'conversations.rename': (form, who) => {
      const channel = this.place(form.get('channel') ?? '')
      channel.name = form.get('name') ?? ''
      return { channel: this.conversationOf(channel, text(who.id)) }
    },
    'conversations.setTopic': (form) => {
      this.place(form.get('channel') ?? '').topic = { value: form.get('topic') ?? '' }
      return {}
    },
    'conversations.leave': (form, who) => {
      const channel = this.place(form.get('channel') ?? '')
      channel.members = channel.members.filter((one) => one !== who.id)
      return {}
    },
    'conversations.close': () => ({}),
    'chat.postMessage': (form, who) => {
      const channel = form.get('channel') ?? ''
      const thread = form.get('thread_ts')
      const message = this.post(channel, text(who.id), form.get('text') ?? '', {
        ...(thread ? { thread_ts: thread } : {}),
        ...(form.get('reply_broadcast') === 'true' ? { subtype: 'thread_broadcast' } : {}),
      })
      if (thread) {
        const parent = this.find(channel, thread)
        parent.thread_ts = thread
        parent.reply_count = Number(parent.reply_count ?? 0) + 1
        parent.latest_reply = message.ts
      }
      return { channel, ts: message.ts, message }
    },
    'chat.update': (form) => {
      const message = this.find(form.get('channel') ?? '', form.get('ts') ?? '')
      message.text = form.get('text') ?? ''
      message.edited = { user: message.user, ts: this.ts() }
      return {}
    },
    'chat.delete': (form) => {
      const channel = this.place(form.get('channel') ?? '')
      channel.messages = channel.messages.filter((one) => one.ts !== form.get('ts'))
      return {}
    },
    'reactions.add': (form, who) => {
      const message = this.find(form.get('channel') ?? '', form.get('timestamp') ?? '')
      const reactions = (message.reactions ?? []) as {
        name: string
        users: string[]
        count: number
      }[]
      const name = form.get('name') ?? ''
      let entry = reactions.find((one) => one.name === name)
      if (entry?.users.includes(text(who.id))) throw new Fail('already_reacted')
      if (!entry) {
        entry = { name, users: [], count: 0 }
        reactions.push(entry)
      }
      entry.users.push(text(who.id))
      entry.count = entry.users.length
      message.reactions = reactions
      return {}
    },
    'reactions.remove': (form, who) => {
      const message = this.find(form.get('channel') ?? '', form.get('timestamp') ?? '')
      const reactions = (message.reactions ?? []) as {
        name: string
        users: string[]
        count: number
      }[]
      const entry = reactions.find((one) => one.name === form.get('name'))
      if (!entry?.users.includes(text(who.id))) throw new Fail('no_reaction')
      entry.users = entry.users.filter((one) => one !== who.id)
      entry.count = entry.users.length
      message.reactions = reactions.filter((one) => one.count > 0)
      return {}
    },
    'reactions.get': (form) => ({
      message: this.find(form.get('channel') ?? '', form.get('timestamp') ?? ''),
    }),
    'pins.add': (form) => {
      const channel = form.get('channel') ?? ''
      const message = this.find(channel, form.get('timestamp') ?? '')
      message.pinned_to = [channel]
      return {}
    },
    'pins.remove': (form) => {
      const message = this.find(form.get('channel') ?? '', form.get('timestamp') ?? '')
      delete message.pinned_to
      return {}
    },
    'search.messages': (form) => {
      const words = (form.get('query') ?? '').replace(/\s*in:[#@]\S+/, '').toLowerCase()
      const matches = [...this.channels.values()].flatMap((channel) =>
        channel.messages
          .filter((one) => text(one.text).toLowerCase().includes(words))
          .map((one) => ({ ...one, channel: { id: channel.id, name: channel.name } })),
      )
      return { messages: { matches } }
    },
    'files.getUploadURLExternal': (form) => {
      const id = `F${++this.serial}`
      const upload = `https://files.slack.com/upload/v1/${id}`
      this.files.set(id, {
        said: { id, name: form.get('filename'), size: Number(form.get('length')) },
        bytes: null,
        upload,
      })
      return { upload_url: upload, file_id: id }
    },
    'files.completeUploadExternal': (form, who) => {
      const listed = JSON.parse(form.get('files') ?? '[]') as { id: string; title: string }[]
      const channel = form.get('channel_id') ?? ''
      const files = listed.map((one) => {
        const file = this.files.get(one.id)
        if (!file?.bytes) throw new Fail('file_not_uploaded')
        file.said = {
          ...file.said,
          title: one.title,
          mimetype: file.said.mimetype ?? 'image/png',
          url_private: `https://files.slack.com/files-pri/T1-${one.id}/${text(file.said.name)}`,
          url_private_download: `https://files.slack.com/files-pri/T1-${one.id}/download/${text(file.said.name)}`,
        }
        return file.said
      })
      const thread = form.get('thread_ts')
      const message = this.post(channel, text(who.id), form.get('initial_comment') ?? '', {
        files,
        subtype: 'file_share',
        ...(thread ? { thread_ts: thread } : {}),
      })
      for (const file of files) file.shares = { public: { [channel]: [{ ts: message.ts }] } }
      return { files }
    },
    'files.info': (form) => {
      const file = this.files.get(form.get('file') ?? '')
      if (!file) throw new Fail('file_not_found')
      return { file: file.said }
    },
    'apps.connections.open': () => ({ url: `wss://wss.slack.test/link/?ticket=${++this.serial}` }),
  }

  readonly fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
    Promise.resolve(this.answer(urlOf(input), init))

  private answer(url: string, init?: RequestInit): Response {
    const method = url.replace('https://slack.com/api/', '')
    const form = new URLSearchParams(typeof init?.body === 'string' ? init.body : '')
    this.calls.push({ method, form })
    const left = this.limited.get(method) ?? 0
    if (left > 0) {
      this.limited.set(method, left - 1)
      return Response.json(
        { ok: false, error: 'ratelimited' },
        {
          status: 429,
          headers: { 'retry-after': '7' },
        },
      )
    }
    const token = form.get('token') ?? ''
    const app = method === 'apps.connections.open'
    if (app ? !this.appTokens.has(token) : !this.tokens.has(token))
      return Response.json({ ok: false, error: 'invalid_auth' })
    const who = app ? {} : (this.users.get(this.tokens.get(token) ?? '') ?? {})
    const run = this.methods[method]
    if (!run) return Response.json({ ok: false, error: 'unknown_method' })
    try {
      return Response.json({ ok: true, ...run(form, who) })
    } catch (error) {
      if (error instanceof Fail) return Response.json({ ok: false, error: error.code })
      throw error
    }
  }

  readonly request = (ask: NativeAsk): Promise<Uint8Array> => {
    const upload = [...this.files.values()].find((one) => one.upload === ask.url)
    if (upload && ask.method === 'POST') {
      upload.bytes = ask.body ?? new Uint8Array()
      upload.said.mimetype = ask.type
      return Promise.resolve(new TextEncoder().encode('OK'))
    }
    const download = [...this.files.values()].find(
      (one) => one.said.url_private_download === ask.url || one.said.url_private === ask.url,
    )
    if (download?.bytes) {
      if (!ask.bearer || !this.tokens.has(ask.bearer))
        return Promise.reject(new Error('the chat service answered 403'))
      return Promise.resolve(download.bytes)
    }
    if (ask.url.startsWith('https://avatars.slack-edge.com/'))
      return Promise.resolve(new TextEncoder().encode(ask.url))
    return Promise.reject(new Error('the chat service answered 404'))
  }

  readonly dial: Dial = (url: string, events: LineEvents): Line => {
    const line = new FakeLine(url, events)
    this.lines.push(line)
    queueMicrotask(() => line.say({ type: 'hello' }))
    return line
  }

  event(event: Said): void {
    const line = this.lines.at(-1)
    line?.say({
      envelope_id: `e${++this.serial}`,
      type: 'events_api',
      payload: { event },
    })
  }
}

export class FakeLine implements Line {
  readonly sent: string[] = []
  open = true

  constructor(
    readonly url: string,
    private readonly events: LineEvents,
  ) {}

  say(said: Said): void {
    if (this.open) this.events.message(JSON.stringify(said))
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    if (!this.open) return
    this.open = false
    this.events.closed()
  }
}

class Fail extends Error {
  constructor(readonly code: string) {
    super(code)
  }
}

const urlOf = (input: string | URL | Request): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

export interface FakeHost extends Host {
  vault: Map<string, string>
}

export function fakeHost(slack: FakeSlack, extra: Partial<Host> = {}): FakeHost {
  const vault = new Map<string, string>()
  return {
    vault,
    secret: (name) => Promise.resolve(vault.get(name) ?? null),
    keepSecret: (name, value) => {
      if (value === null) vault.delete(name)
      else vault.set(name, value)
      return Promise.resolve()
    },
    fetch: slack.fetch,
    request: slack.request,
    now: () => slack.clock * 1000,
    ...extra,
  }
}
