import type { tl } from '@mtcute/core'
import Long from 'long'
import type { Host, Prompt, Screen } from '../provider'
import type { Client, ClientState, Found, SentCode, Setup } from './client'
import { API_HASH, API_ID } from './index'

export const KEYS = { [API_ID]: '12345', [API_HASH]: '0123456789abcdef0123456789abcdef' }

export function failure(text: string): Error {
  return Object.assign(new Error(text), { text, code: 400 })
}

export function user(id: number, first: string, extra: Partial<tl.RawUser> = {}): tl.RawUser {
  return { _: 'user', id, firstName: first, accessHash: Long.fromNumber(id * 7), ...extra }
}

export function channel(
  id: number,
  title: string,
  extra: Partial<tl.RawChannel> = {},
): tl.RawChannel {
  return {
    _: 'channel',
    id,
    title,
    accessHash: Long.fromNumber(id * 11),
    photo: { _: 'chatPhotoEmpty' },
    date: 1,
    megagroup: true,
    ...extra,
  }
}

export function chat(id: number, title: string, extra: Partial<tl.RawChat> = {}): tl.RawChat {
  return {
    _: 'chat',
    id,
    title,
    photo: { _: 'chatPhotoEmpty' },
    participantsCount: 3,
    date: 1,
    version: 1,
    ...extra,
  }
}

export function text(
  id: number,
  peer: tl.TypePeer,
  from: number,
  words: string,
  extra: Partial<tl.RawMessage> = {},
): tl.RawMessage {
  return {
    _: 'message',
    id,
    peerId: peer,
    fromId: { _: 'peerUser', userId: from },
    date: 1_700_000_000 + id,
    message: words,
    ...extra,
  }
}

export function dialog(
  peer: tl.TypePeer,
  top: number,
  extra: Partial<tl.RawDialog> = {},
): tl.RawDialog {
  return {
    _: 'dialog',
    peer,
    topMessage: top,
    readInboxMaxId: 0,
    readOutboxMaxId: 0,
    unreadCount: 0,
    unreadMentionsCount: 0,
    unreadReactionsCount: 0,
    unreadPollVotesCount: 0,
    notifySettings: { _: 'peerNotifySettings' },
    ...extra,
  }
}

type Answer = (request: tl.RpcMethod) => unknown

export class FakeTelegram implements Client {
  readonly calls: tl.RpcMethod[] = []
  readonly answers = new Map<string, Answer>()
  readonly uploads: { name: string; type: string; bytes: Uint8Array }[] = []
  readonly downloads: { location: tl.TypeInputFileLocation; dc: number }[] = []
  readonly files = new Map<string, Uint8Array>()
  me: tl.RawUser = user(1, 'Emil', { self: true, phone: '41790000001' })
  setup: Setup | null = null
  code = '12345'
  password: string | null = null
  expireOnce = false
  sessionText = 'session-one'
  qrUrls = ['tg://login?token=first', 'tg://login?token=second']
  readied = false
  loggedOut = false
  closed = false
  private hearUpdate: ((update: tl.TypeUpdate, found: Found) => void) | null = null
  private hearState: ((state: ClientState) => void) | null = null

  answer(name: string, answer: (request: never) => unknown): void {
    this.answers.set(name, answer as Answer)
  }

  called<T extends tl.RpcMethod['_']>(name: T): Extract<tl.RpcMethod, { _: T }>[] {
    return this.calls.filter((one) => one._ === name) as Extract<tl.RpcMethod, { _: T }>[]
  }

  call<T extends tl.RpcMethod>(request: T): Promise<tl.RpcCallReturn[T['_']]> {
    this.calls.push(request)
    const answer = this.answers.get(request._)
    if (!answer) return Promise.reject(failure(`no answer for ${request._}`))
    return Promise.resolve(answer(request))
  }

  listen(
    update: (update: tl.TypeUpdate, found: Found) => void,
    state: (state: ClientState) => void,
  ): () => void {
    this.hearUpdate = update
    this.hearState = state
    return () => {
      this.hearUpdate = null
      this.hearState = null
    }
  }

  push(update: tl.TypeUpdate, found: Partial<Found> = {}): void {
    this.hearUpdate?.(update, { users: found.users ?? [], chats: found.chats ?? [] })
  }

  state(state: ClientState): void {
    this.hearState?.(state)
  }

  sendCode(phone: string): Promise<SentCode | tl.RawUser> {
    if (phone === '+0') return Promise.reject(failure('PHONE_NUMBER_INVALID'))
    return Promise.resolve({ hash: `hash-${phone}`, via: 'app' })
  }

  signIn(phone: string, hash: string, code: string): Promise<tl.RawUser> {
    if (hash !== `hash-${phone}`) return Promise.reject(failure('PHONE_CODE_HASH_EMPTY'))
    if (this.expireOnce) {
      this.expireOnce = false
      return Promise.reject(failure('PHONE_CODE_EXPIRED'))
    }
    if (code !== this.code) return Promise.reject(failure('PHONE_CODE_INVALID'))
    if (this.password !== null) return Promise.reject(failure('SESSION_PASSWORD_NEEDED'))
    return Promise.resolve(this.me)
  }

  checkPassword(password: string): Promise<tl.RawUser> {
    if (password !== this.password) return Promise.reject(failure('PASSWORD_HASH_INVALID'))
    return Promise.resolve(this.me)
  }

  hint(): Promise<string | null> {
    return Promise.resolve(this.password ? 'the usual' : null)
  }

  async signInQr(
    show: (url: string, expires: number) => void,
    password: () => Promise<string>,
    wrong: () => void,
  ): Promise<tl.RawUser> {
    for (const url of this.qrUrls) show(url, Date.now() + 30_000)
    if (this.password === null) return this.me
    for (;;) {
      if ((await password()) === this.password) return this.me
      wrong()
    }
  }

  ready(): Promise<void> {
    this.readied = true
    return Promise.resolve()
  }

  session(): Promise<string> {
    return Promise.resolve(this.sessionText)
  }

  download(location: tl.TypeInputFileLocation, dc: number): Promise<Uint8Array> {
    this.downloads.push({ location, dc })
    const key =
      location._ === 'inputPhotoFileLocation' || location._ === 'inputDocumentFileLocation'
        ? `${location.id.toString()}:${location.thumbSize}:${new TextDecoder().decode(location.fileReference)}`
        : location._ === 'inputPeerPhotoFileLocation'
          ? `peer:${location.photoId.toString()}`
          : location._
    const found = this.files.get(key)
    return found ? Promise.resolve(found) : Promise.reject(failure('FILE_REFERENCE_EXPIRED'))
  }

  upload(bytes: Uint8Array, name: string, type: string): Promise<tl.TypeInputFile> {
    this.uploads.push({ name, type, bytes })
    return Promise.resolve({
      _: 'inputFile',
      id: Long.fromNumber(this.uploads.length),
      parts: 1,
      name,
      md5Checksum: '',
    })
  }

  logOut(): Promise<void> {
    this.loggedOut = true
    return Promise.resolve()
  }

  close(): Promise<void> {
    this.closed = true
    return Promise.resolve()
  }
}

export class FakeHost implements Host {
  readonly secrets = new Map<string, string>()
  readonly bigs = new Map<string, Uint8Array>()
  readonly asked: Prompt[] = []
  readonly shown: (Screen | null)[] = []
  replies: string[] = []
  fetch = (() => Promise.reject(new Error('no network'))) as unknown as typeof fetch
  clock = 1_800_000_000_000

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

  ask = (prompt: Prompt): Promise<string> => {
    this.asked.push(prompt)
    const reply = this.replies.shift()
    return reply === undefined
      ? Promise.reject(new Error('nobody answered'))
      : Promise.resolve(reply)
  }

  show = (screen: Screen | null): void => {
    this.shown.push(screen)
  }

  sealed = {
    read: (name: string) => Promise.resolve(this.bigs.get(name) ?? null),
    write: (name: string, bytes: Uint8Array | null) => {
      if (bytes === null) this.bigs.delete(name)
      else this.bigs.set(name, bytes)
      return Promise.resolve()
    },
  }
}
