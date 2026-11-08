import type {
  AnyMessageContent,
  AuthenticationCreds,
  ChatModification,
  GroupMetadata,
  MiscMessageGenerationOptions,
  ParticipantAction,
  WAMessage,
  WAMessageKey,
  WAPresence,
  proto,
} from '@whiskeysockets/baileys'
import type { Host, Screen, WireAsk, WireSocket } from '../provider'
import type { Events, Kit, Link, Setup, Vote } from './client'
import type { MediaConn } from './media'
import { packed, unpacked } from './shelf'

export const ME = '41790000001@s.whatsapp.net'
export const ANNA = '41790000002@s.whatsapp.net'
export const BEN = '41790000003@s.whatsapp.net'
export const GROUP = '120363000000000001@g.us'

type Hearers = { [E in keyof Events]?: ((data: Events[E]) => void)[] }

export interface Call {
  name: string
  args: unknown[]
}

export class FakeLink implements Link {
  readonly hearers: Hearers = {}
  readonly calls: Call[] = []
  closed = false
  loggedOut = false
  sent = 0
  groupList: Record<string, GroupMetadata> = {}
  existing: Record<string, string> = {}
  onOlder: ((count: number, oldest: WAMessageKey) => void) | null = null
  reuploaded: ((message: WAMessage) => WAMessage) | null = null

  constructor(readonly setup: Setup) {}

  on<E extends keyof Events>(event: E, hear: (data: Events[E]) => void): void {
    const list = (this.hearers[event] ??= []) as ((data: Events[E]) => void)[]
    list.push(hear)
  }

  fire<E extends keyof Events>(event: E, data: Events[E]): void {
    for (const hear of (this.hearers[event] ?? []) as ((data: Events[E]) => void)[]) hear(data)
  }

  private call(name: string, ...args: unknown[]): void {
    this.calls.push({ name, args })
  }

  callsOf(name: string): unknown[][] {
    return this.calls.filter((one) => one.name === name).map((one) => one.args)
  }

  pairingCode(phone: string): Promise<string> {
    this.call('pairingCode', phone)
    return Promise.resolve('ABCD1234')
  }

  private made(jid: string, message: proto.IMessage): WAMessage {
    this.sent += 1
    return {
      key: { remoteJid: jid, fromMe: true, id: `SENT${this.sent}` },
      message,
      messageTimestamp: 1_800_000_000 + this.sent,
      status: 2,
    }
  }

  send(
    jid: string,
    content: AnyMessageContent,
    options?: MiscMessageGenerationOptions,
  ): Promise<WAMessage | undefined> {
    this.call('send', jid, content, options)
    if ('text' in content && !('edit' in content))
      return Promise.resolve(
        this.made(jid, {
          extendedTextMessage: {
            text: content.text,
            contextInfo: {
              ...('mentions' in content ? { mentionedJid: content.mentions } : {}),
              ...(options?.quoted?.key.id ? { stanzaId: options.quoted.key.id } : {}),
            },
          },
        }),
      )
    if ('poll' in content)
      return Promise.resolve(
        this.made(jid, {
          pollCreationMessage: {
            name: content.poll.name,
            options: content.poll.values.map((optionName) => ({ optionName })),
            selectableOptionsCount: content.poll.selectableCount ?? 0,
          },
          messageContextInfo: { messageSecret: new Uint8Array(32) },
        }),
      )
    return Promise.resolve(undefined)
  }

  relay(jid: string, message: proto.IMessage): Promise<WAMessage> {
    this.call('relay', jid, message)
    return Promise.resolve(this.made(jid, message))
  }

  mediaConn(): Promise<MediaConn> {
    return Promise.resolve({ hosts: [{ hostname: 'mmg.example' }], auth: 'secret auth' })
  }

  reupload(message: WAMessage): Promise<WAMessage> {
    this.call('reupload', message.key.id)
    return Promise.resolve(this.reuploaded ? this.reuploaded(message) : message)
  }

  modify(change: ChatModification, jid: string): Promise<void> {
    this.call('modify', change, jid)
    return Promise.resolve()
  }

  read(keys: WAMessageKey[]): Promise<void> {
    this.call('read', keys)
    return Promise.resolve()
  }

  presence(kind: WAPresence, jid?: string): Promise<void> {
    this.call('presence', kind, jid)
    return Promise.resolve()
  }

  subscribe(jid: string): Promise<void> {
    this.call('subscribe', jid)
    return Promise.resolve()
  }

  group(jid: string): Promise<GroupMetadata> {
    const found = this.groupList[jid]
    return found ? Promise.resolve(found) : Promise.reject(new Error('no group'))
  }

  groups(): Promise<Record<string, GroupMetadata>> {
    return Promise.resolve(this.groupList)
  }

  participants(jid: string, people: string[], action: ParticipantAction): Promise<void> {
    this.call('participants', jid, people, action)
    return Promise.resolve()
  }

  subject(jid: string, text: string): Promise<void> {
    this.call('subject', jid, text)
    return Promise.resolve()
  }

  description(jid: string, text: string): Promise<void> {
    this.call('description', jid, text)
    return Promise.resolve()
  }

  leave(jid: string): Promise<void> {
    this.call('leave', jid)
    return Promise.resolve()
  }

  picture(jid: string): Promise<string | undefined> {
    this.call('picture', jid)
    return Promise.resolve(`https://pps.example/${jid}`)
  }

  exists(phone: string): Promise<string | null> {
    this.call('exists', phone)
    return Promise.resolve(this.existing[phone] ?? null)
  }

  older(count: number, oldest: WAMessageKey, at: number): Promise<void> {
    this.call('older', count, oldest, at)
    this.onOlder?.(count, oldest)
    return Promise.resolve()
  }

  create(subject: string, people: string[]): Promise<GroupMetadata> {
    this.call('create', subject, people)
    return Promise.resolve({
      id: '120363000000000099@g.us',
      subject,
      owner: ME,
      participants: [ME, ...people].map((id) => ({ id, admin: id === ME ? 'superadmin' : null })),
    } as GroupMetadata)
  }

  logOut(): Promise<void> {
    this.loggedOut = true
    return Promise.resolve()
  }

  close(): void {
    this.closed = true
  }

  open(): void {
    this.fire('connection.update', { connection: 'open' })
  }

  drop(statusCode: number, words = 'closed'): void {
    this.fire('connection.update', {
      connection: 'close',
      lastDisconnect: {
        error: Object.assign(new Error(words), { output: { statusCode } }),
        date: new Date(),
      },
    })
  }
}

function freshCreds(): AuthenticationCreds {
  return { registered: false, me: undefined } as unknown as AuthenticationCreds
}

const text = new TextDecoder()

export class FakeKit implements Kit {
  readonly links: FakeLink[] = []
  onDial: ((link: FakeLink) => void) | null = null

  get link(): FakeLink {
    const last = this.links.at(-1)
    if (!last) throw new Error('never dialed')
    return last
  }

  dial(setup: Setup): Link {
    const link = new FakeLink(setup)
    this.links.push(link)
    queueMicrotask(() => this.onDial?.(link))
    return link
  }

  fresh(): AuthenticationCreds {
    return freshCreds()
  }

  bytes(data: Uint8Array): Uint8Array {
    return data
  }

  revive(_type: string, value: unknown): unknown {
    return value
  }

  encode(message: WAMessage): Uint8Array {
    return new TextEncoder().encode(packed(message))
  }

  decode(bytes: Uint8Array): WAMessage {
    return unpacked(text.decode(bytes), (one) => one) as WAMessage
  }

  votes(message: WAMessage, me: string): Vote[] {
    const poll = message.message?.pollCreationMessage
    const out: Vote[] = (poll?.options ?? []).map((one) => ({
      name: one.optionName ?? '',
      voters: [],
    }))
    for (const update of message.pollUpdates ?? []) {
      const key = update.pollUpdateMessageKey
      const voter = key?.fromMe ? me : (key?.participant ?? key?.remoteJid ?? '')
      for (const option of update.vote?.selectedOptions ?? [])
        out.find((one) => one.name === text.decode(option))?.voters.push(voter)
    }
    return out
  }

  vote(
    poll: WAMessage,
    names: readonly string[],
  ): { message: proto.IMessage; selected: Uint8Array[] } {
    const selected = names.map((one) => new TextEncoder().encode(one))
    return {
      message: { pollUpdateMessage: { pollCreationMessageKey: poll.key, vote: {} } },
      selected,
    }
  }
}

export class FakeHost implements Host {
  readonly secrets = new Map<string, string>()
  readonly bigs = new Map<string, Uint8Array>()
  readonly shown: (Screen | null)[] = []
  readonly logged: string[] = []
  readonly fetched: { url: string; init?: RequestInit }[] = []
  answers: ((url: string, init?: RequestInit) => Response) | null = null
  clock = 1_800_000_000_000
  writes = 0

  fetch = ((url: string, init?: RequestInit) => {
    this.fetched.push(init ? { url, init } : { url })
    if (!this.answers) return Promise.reject(new Error('no network'))
    return Promise.resolve(this.answers(url, init))
  }) as unknown as typeof fetch

  now(): number {
    return this.clock
  }

  secret(name: string): Promise<string | null> {
    return Promise.resolve(this.secrets.get(name) ?? null)
  }

  keepSecret(name: string, value: string | null): Promise<void> {
    if (value === null) this.secrets.delete(name)
    else this.secrets.set(name, value)
    return Promise.resolve()
  }

  show = (screen: Screen | null): void => {
    this.shown.push(screen)
  }

  log = (level: string, message: string): void => {
    this.logged.push(`${level} ${message}`)
  }

  wire = (_ask: WireAsk): Promise<WireSocket> => Promise.reject(new Error('not in tests'))

  sealed = {
    read: (name: string) => Promise.resolve(this.bigs.get(name) ?? null),
    write: (name: string, bytes: Uint8Array | null) => {
      this.writes += 1
      if (bytes === null) this.bigs.delete(name)
      else this.bigs.set(name, bytes)
      return Promise.resolve()
    },
  }
}

export function incoming(
  id: string,
  jid: string,
  message: proto.IMessage | null,
  extra: Partial<WAMessage> = {},
): WAMessage {
  return {
    key: { remoteJid: jid, fromMe: false, id, ...extra.key },
    message,
    messageTimestamp: 1_800_000_000 + Number(id.replace(/\D/g, '') || 0),
    pushName: 'Anna',
    ...extra,
    ...(extra.key ? { key: { remoteJid: jid, fromMe: false, id, ...extra.key } } : {}),
  }
}
