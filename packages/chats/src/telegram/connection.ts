import type { tl } from '@mtcute/core'
import Long from 'long'
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
  Sticker,
  StickerSet,
} from '../provider'
import { secretName } from '../provider'
import {
  errorText,
  signedOut,
  type Client,
  type ClientState,
  type Dial,
  type Found,
} from './client'
import { entitiesOf, withMentions } from './entities'
import { signIn } from './login'
import {
  chosenOf,
  documentAttachment,
  messageOf,
  photoSize,
  thumbOf,
  whereOfMessage,
  type Context,
} from './messages'
import { fullName, idOf, Peers, peerId, personOf, whereOf, type Where } from './peers'
import { MOST_TEXT, piecesOf } from './pieces'
import { oggOf, packedOf } from './voice'

const TELEGRAM = 'telegram'

const SESSION = 'session'
const SEALED = 'sealed:'
const MOST_IN_VAULT = 2000
const PAGE = 100
const MOST_DIALOGS = 500
const MOST_KEPT = 5000
const TYPING_FOR = 6000
const MOST_REACTIONS = 3
const MOST_CAPTION = 1024
const FOREVER = 2147483647
const GENERAL = 1

const WORDS = {
  signedOut: 'Signed out of Telegram. Connect again.',
  saved: 'Saved Messages',
  notHere: 'Telegram cannot do that in this conversation',
  forMe: 'Telegram removes messages in groups and channels for everyone',
  owner: 'Telegram hands a group to a new owner only from its own app',
  unknownSticker: 'That sticker is no longer available',
} as const

export interface Keys {
  apiId: number
  apiHash: string
}

const live = new Map<string, TelegramConnection>()

function nameOf(account: string): string {
  return secretName(TELEGRAM, account, SESSION)
}

async function readSession(host: Host, account: string): Promise<string | null> {
  const kept = await host.secret(nameOf(account))
  if (!kept) return null
  if (!kept.startsWith(SEALED)) return kept
  const bytes = await host.sealed?.read(nameOf(account))
  return bytes ? new TextDecoder().decode(bytes) : null
}

async function keepSession(host: Host, account: string, session: string | null): Promise<void> {
  const name = nameOf(account)
  if (session === null) {
    await host.keepSecret(name, null)
    await host.sealed?.write(name, null)
    return
  }
  if (session.length <= MOST_IN_VAULT || !host.sealed) {
    await host.keepSecret(name, session)
    return
  }
  await host.sealed.write(name, new TextEncoder().encode(session))
  await host.keepSecret(name, `${SEALED}${session.length}`)
}

export async function forget(
  dial: Dial,
  keys: Keys | null,
  account: string,
  host: Host,
): Promise<void> {
  const one = live.get(account)
  live.delete(account)
  if (one) await one.logOut().catch(() => undefined)
  else {
    const session = await readSession(host, account).catch(() => null)
    if (session && keys) {
      const client = await dial({ ...keys, session }).catch(() => null)
      await client?.logOut().catch(() => undefined)
      await client?.close().catch(() => undefined)
    }
  }
  await keepSession(host, account, null)
}

async function selfOf(client: Client): Promise<tl.RawUser> {
  const users = await client.call({ _: 'users.getUsers', id: [{ _: 'inputUserSelf' }] })
  const me = users.find((one): one is tl.RawUser => one._ === 'user')
  if (!me) throw new Error(WORDS.signedOut)
  return me
}

export async function open(
  dial: Dial,
  keys: Keys,
  config: Readonly<Record<string, string>>,
  host: Host,
  known?: string,
): Promise<Connection> {
  if (known !== undefined) {
    const session = await readSession(host, known)
    if (!session) throw new Error(WORDS.signedOut)
    const client = await dial({ ...keys, session })
    try {
      return await begin(client, await selfOf(client), host)
    } catch (error) {
      await client.close().catch(() => undefined)
      if (signedOut(error)) {
        await keepSession(host, known, null)
        throw new Error(WORDS.signedOut, { cause: error })
      }
      throw error
    }
  }
  const client = await dial({ ...keys, session: null })
  try {
    return await begin(client, await signIn(client, config, host), host)
  } catch (error) {
    await client.close().catch(() => undefined)
    throw error
  }
}

async function begin(client: Client, me: tl.RawUser, host: Host): Promise<Connection> {
  await client.ready(me)
  const connection = new TelegramConnection(client, me, host)
  await keepSession(host, connection.account.id, await client.session())
  live
    .get(connection.account.id)
    ?.close()
    .catch(() => undefined)
  live.set(connection.account.id, connection)
  return connection
}

function random(): Long {
  return Long.fromBits((Math.random() * 0x100000000) | 0, (Math.random() * 0x100000000) | 0)
}

function peerOf(where: Where): tl.TypePeer {
  return where.kind === 'u'
    ? { _: 'peerUser', userId: where.id }
    : where.kind === 'c'
      ? { _: 'peerChat', chatId: where.id }
      : { _: 'peerChannel', channelId: where.id }
}

function foundIn(value: unknown): Found | null {
  if (typeof value !== 'object' || value === null) return null
  const users = (value as { users?: unknown }).users
  const chats = (value as { chats?: unknown }).chats
  if (!Array.isArray(users) && !Array.isArray(chats)) return null
  return {
    users: Array.isArray(users) ? (users as tl.TypeUser[]) : [],
    chats: Array.isArray(chats) ? (chats as tl.TypeChat[]) : [],
  }
}

function messagesIn(result: tl.messages.TypeMessages): tl.TypeMessage[] {
  return result._ === 'messages.messagesNotModified' ? [] : result.messages
}

function updatesIn(result: tl.TypeUpdates): tl.TypeUpdate[] {
  if (result._ === 'updates' || result._ === 'updatesCombined') return result.updates
  if (result._ === 'updateShort') return [result.update]
  return []
}

function kindOf(file: OutgoingFile): NonNullable<OutgoingFile['kind']> {
  if (file.kind) return file.kind
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  return 'file'
}

const PHOTO = new Set(['image/jpeg', 'image/png', 'image/webp'])

type Hearer = (event: ProviderEvent) => void

type Handlers = { [K in tl.TypeUpdate['_']]?: (update: Extract<tl.TypeUpdate, { _: K }>) => void }

interface Inline {
  bot: tl.TypeInputUser
  queryId: Long
  id: string
}

class TelegramConnection implements Connection {
  readonly account: Account
  private readonly peers = new Peers()
  private readonly self: string
  private readonly premium: boolean
  private readonly known = new Map<string, Conversation>()
  private readonly outbox = new Map<string, number>()
  private readonly kept = new Map<string, tl.RawMessage>()
  private readonly stickerDocs = new Map<string, tl.RawDocument>()
  private readonly inline = new Map<string, Inline>()
  private readonly hearers = new Set<Hearer>()
  private readonly typists = new Map<string, ReturnType<typeof setTimeout>>()
  private stopListening: (() => void) | null = null
  private gone = false

  constructor(
    private readonly client: Client,
    me: tl.RawUser,
    private readonly host: Host,
  ) {
    this.peers.self = me.id
    this.peers.add({ users: [me], chats: [] })
    this.self = `u${me.id}`
    this.premium = !!me.premium
    this.account = { id: String(me.id), label: fullName(me), self: personOf(me) }
    this.stopListening = client.listen(
      (update, found) => this.heard(update, found),
      (state) => this.state(state),
    )
  }

  private emit(event: ProviderEvent): void {
    for (const hear of this.hearers) hear(event)
  }

  private async call<T extends tl.RpcMethod>(request: T): Promise<tl.RpcCallReturn[T['_']]> {
    try {
      const result = await this.client.call(request)
      const found = foundIn(result)
      if (found) this.peers.add(found)
      this.ownUpdates(result)
      return result
    } catch (error) {
      if (signedOut(error)) await this.lost()
      throw error
    }
  }

  private ownUpdates(result: unknown): void {
    if (typeof result !== 'object' || result === null || !('_' in result)) return
    const kind = result._
    if (kind !== 'updates' && kind !== 'updatesCombined' && kind !== 'updateShort') return
    for (const update of updatesIn(result as tl.TypeUpdates)) {
      if (update._ === 'updateNewMessage' || update._ === 'updateNewChannelMessage') {
        const where = whereOfMessage(update.message, this.peers)
        if (!where || !this.known.has(idOf(where))) continue
      }
      this.heard(update, { users: [], chats: [] })
    }
  }

  private async lost(): Promise<void> {
    if (this.gone) return
    this.gone = true
    this.emit({ t: 'status', status: 'signed-out', reason: WORDS.signedOut })
    await keepSession(this.host, this.account.id, null).catch(() => undefined)
  }

  private state(state: ClientState): void {
    if (state === 'signed-out') {
      void this.lost()
      return
    }
    this.emit({
      t: 'status',
      status: state === 'online' ? 'online' : state === 'connecting' ? 'connecting' : 'offline',
    })
  }

  private context(extra: Partial<Context> = {}): Context {
    return {
      peers: this.peers,
      self: this.self,
      readOut: (conversation) =>
        this.outbox.get(conversation) ?? this.outbox.get(conversation.replace(/t\d+$/, '')) ?? 0,
      ...extra,
    }
  }

  private keep(message: tl.TypeMessage, conversation: string, prefix = ''): void {
    if (message._ !== 'message') return
    const key = `${conversation}\n${prefix}${message.id}`
    this.kept.delete(key)
    this.kept.set(key, message)
    if (this.kept.size > MOST_KEPT) {
      const oldest = this.kept.keys().next().value
      if (oldest !== undefined) this.kept.delete(oldest)
    }
  }

  private mapped(message: tl.TypeMessage, extra: Partial<Context> = {}): ProviderMessage | null {
    const mapped = messageOf(message, this.context(extra))
    if (mapped) this.keep(message, mapped.conversation, extra.prefix)
    return mapped
  }

  private target(
    conversation: string,
    message: string,
  ): { where: Where; peer: tl.TypeInputPeer; id: number } {
    const split = /^s(\d+):(\d+)$/.exec(message)
    if (split) {
      const where: Where = { kind: 's', id: Number(split[1]) }
      return { where, peer: this.peers.input(where), id: Number(split[2]) }
    }
    const where = whereOf(conversation)
    return { where, peer: this.peers.input(where), id: Number(message) }
  }

  private conversationOf(
    dialog: tl.RawDialog,
    top: tl.TypeMessage | undefined,
  ): Conversation | null {
    const id = peerId(dialog.peer)
    const where = whereOf(id)
    const conversation: Conversation = {
      id,
      title: null,
      kind: 'direct',
      people: [],
      lastAt: top && top._ !== 'messageEmpty' ? top.date * 1000 : null,
      unread: dialog.unreadMark ? Math.max(1, dialog.unreadCount) : dialog.unreadCount,
    }
    if (dialog.unreadMentionsCount) conversation.mentions = dialog.unreadMentionsCount
    const mute = dialog.notifySettings.muteUntil
    if (mute && mute * 1000 > this.host.now()) conversation.mutedUntil = mute * 1000
    if (dialog.pinned) conversation.pinned = true
    if (dialog.folderId === 1) conversation.archived = true
    if (top) {
      const mapped = this.mapped(top)
      if (mapped) conversation.snippet = mapped.text.split('\n', 1)[0] ?? ''
    }
    if (where.kind === 'u') {
      const user = this.peers.users.get(where.id)
      if (where.id === this.peers.self) conversation.title = WORDS.saved
      else if (user) {
        const person = personOf(user)
        conversation.title = person.name
        conversation.people = [person]
        if (person.picture) conversation.picture = person.picture
      }
      return conversation
    }
    const group = this.peers.group(where)
    if (!group) return null
    conversation.title = group.title
    conversation.kind = group._ === 'channel' && !group.megagroup ? 'channel' : 'group'
    conversation.role = this.peers.role(where)
    if (group.photo._ === 'chatPhoto') conversation.picture = id
    const count = group.participantsCount
    if (count !== undefined) conversation.members = count
    if (group._ === 'chat' && (group.left || group.deactivated)) conversation.readOnly = true
    if (
      group._ === 'channel' &&
      !group.megagroup &&
      !group.creator &&
      !group.adminRights?.postMessages
    )
      conversation.readOnly = true
    return conversation
  }

  private topicConversation(
    channel: tl.RawChannel,
    topic: tl.RawForumTopic,
    top: tl.TypeMessage | undefined,
  ): Conversation {
    const id = idOf({ kind: 's', id: channel.id, topic: topic.id })
    const conversation: Conversation = {
      id,
      title: `${channel.title} / ${topic.title}`,
      kind: 'group',
      people: [],
      lastAt: top && top._ !== 'messageEmpty' ? top.date * 1000 : null,
      unread: topic.unreadCount,
      role: this.peers.role({ kind: 's', id: channel.id }),
    }
    if (topic.unreadMentionsCount) conversation.mentions = topic.unreadMentionsCount
    if (topic.pinned) conversation.pinned = true
    if (topic.closed) conversation.readOnly = true
    if (channel.photo._ === 'chatPhoto') conversation.picture = `s${channel.id}`
    const mute = topic.notifySettings.muteUntil
    if (mute && mute * 1000 > this.host.now()) conversation.mutedUntil = mute * 1000
    if (top) {
      const mapped = this.mapped(top)
      if (mapped) conversation.snippet = mapped.text.split('\n', 1)[0] ?? ''
    }
    this.outbox.set(id, topic.readOutboxMaxId)
    return conversation
  }

  private async topics(channel: tl.RawChannel): Promise<Conversation[]> {
    const result = await this.call({
      _: 'messages.getForumTopics',
      peer: this.peers.input({ kind: 's', id: channel.id }),
      offsetDate: 0,
      offsetId: 0,
      offsetTopic: 0,
      limit: PAGE,
    })
    return result.topics.flatMap((topic) => {
      if (topic._ !== 'forumTopic') return []
      const top = result.messages.find((one) => one.id === topic.topMessage)
      return [this.topicConversation(channel, topic, top)]
    })
  }

  async conversations(): Promise<Conversation[]> {
    const out: Conversation[] = []
    const forums: tl.RawChannel[] = []
    for (const folder of [0, 1]) {
      let offsetDate = 0
      let offsetId = 0
      let offsetPeer: tl.TypeInputPeer = { _: 'inputPeerEmpty' }
      let seen = 0
      for (;;) {
        const result = await this.call({
          _: 'messages.getDialogs',
          folderId: folder,
          offsetDate,
          offsetId,
          offsetPeer,
          limit: PAGE,
          hash: Long.ZERO,
        })
        if (result._ === 'messages.dialogsNotModified') break
        let last: tl.RawDialog | null = null
        for (const dialog of result.dialogs) {
          if (dialog._ !== 'dialog') continue
          last = dialog
          seen++
          const id = peerId(dialog.peer)
          this.outbox.set(id, dialog.readOutboxMaxId)
          if (dialog.peer._ === 'peerChannel') {
            const channel = this.peers.channels.get(dialog.peer.channelId)
            if (channel?.forum) {
              forums.push(channel)
              continue
            }
          }
          const top = result.messages.find(
            (one) =>
              one.id === dialog.topMessage && one._ !== 'messageEmpty' && peerId(one.peerId) === id,
          )
          const conversation = this.conversationOf(dialog, top)
          if (conversation) out.push(conversation)
        }
        if (
          result._ === 'messages.dialogs' ||
          result.dialogs.length < PAGE ||
          !last ||
          seen >= MOST_DIALOGS
        )
          break
        const lastId = peerId(last.peer)
        const top = result.messages.find(
          (one) =>
            one._ !== 'messageEmpty' && one.id === last.topMessage && peerId(one.peerId) === lastId,
        )
        if (!top || top._ === 'messageEmpty') break
        offsetDate = top.date
        offsetId = top.id
        try {
          offsetPeer = this.peers.input(whereOf(lastId))
        } catch {
          break
        }
      }
    }
    const topics = await Promise.all(forums.map((one) => this.topics(one).catch(() => [])))
    out.push(...topics.flat())
    for (const one of out) this.known.set(one.id, one)
    return out
  }

  async history(conversation: string, ask: HistoryAsk): Promise<Page> {
    const where = whereOf(conversation)
    const peer = this.peers.input(where)
    const offsetId = ask.around ? Number(ask.around) + 1 : ask.before ? Number(ask.before) : 0
    const addOffset = ask.around ? -Math.floor(ask.limit / 2) : 0
    const common = {
      peer,
      offsetId,
      offsetDate: 0,
      addOffset,
      limit: ask.limit,
      maxId: 0,
      minId: 0,
      hash: Long.ZERO,
    }
    const result =
      where.topic !== undefined && where.topic !== GENERAL
        ? await this.call({ _: 'messages.getReplies', msgId: where.topic, ...common })
        : await this.call({ _: 'messages.getHistory', ...common })
    const raw = messagesIn(result)
    const messages = raw
      .flatMap((one) => {
        const mapped = this.mapped(one)
        return mapped?.conversation === conversation ? [mapped] : []
      })
      .sort((a, b) => Number(a.id) - Number(b.id))
    const oldest = raw.reduce((least, one) => Math.min(least, one.id), Infinity)
    const more = raw.length >= ask.limit || (ask.around !== undefined && raw.length > 0)
    return { messages, before: more && Number.isFinite(oldest) ? String(oldest) : null }
  }

  async thread(conversation: string, parent: string, ask: HistoryAsk): Promise<Page> {
    const { peer, id, where } = this.target(conversation, parent)
    const result = await this.call({
      _: 'messages.getReplies',
      peer,
      msgId: id,
      offsetId: ask.before ? Number(ask.before.replace(/^s\d+:/, '')) : 0,
      offsetDate: 0,
      addOffset: 0,
      limit: ask.limit,
      maxId: 0,
      minId: 0,
      hash: Long.ZERO,
    })
    const raw = messagesIn(result)
    const elsewhere = (one: tl.TypeMessage) =>
      one._ !== 'messageEmpty' &&
      one.peerId._ === 'peerChannel' &&
      one.peerId.channelId !== where.id
        ? `s${one.peerId.channelId}:`
        : ''
    const messages = raw
      .flatMap((one) => {
        const mapped = this.mapped(one, { conversation, thread: parent, prefix: elsewhere(one) })
        return mapped ? [mapped] : []
      })
      .reverse()
    const oldest = raw.at(-1)
    return {
      messages,
      before: raw.length >= ask.limit && oldest ? `${elsewhere(oldest)}${oldest.id}` : null,
    }
  }

  private replyTo(where: Where, draft: Outgoing): tl.TypeInputReplyTo | undefined {
    const reply =
      draft.replyTo === undefined ? undefined : Number(draft.replyTo.replace(/^s\d+:/, ''))
    if (where.topic !== undefined && where.topic !== GENERAL)
      return { _: 'inputReplyToMessage', replyToMsgId: reply ?? where.topic, topMsgId: where.topic }
    if (reply !== undefined) return { _: 'inputReplyToMessage', replyToMsgId: reply }
    return undefined
  }

  private async destination(
    conversation: string,
    draft: Outgoing,
  ): Promise<{
    where: Where
    peer: tl.TypeInputPeer
    replyTo?: tl.TypeInputReplyTo
    conversation: string
    prefix: string
    thread?: string
  }> {
    const where = whereOf(conversation)
    const peer = this.peers.input(where)
    if (draft.thread === undefined) {
      const replyTo = this.replyTo(where, draft)
      return { where, peer, conversation, prefix: '', ...(replyTo ? { replyTo } : {}) }
    }
    const group = this.peers.group(where)
    const thread = draft.thread
    if (group?._ === 'channel' && !group.megagroup) {
      const found = await this.call({
        _: 'messages.getDiscussionMessage',
        peer,
        msgId: Number(thread),
      })
      const root = found.messages.find((one) => one._ === 'message')
      const home = root?.peerId
      if (!root || home?._ !== 'peerChannel') throw new Error(WORDS.notHere)
      const discussion: Where = { kind: 's', id: home.channelId }
      const reply =
        draft.replyTo === undefined ? root.id : Number(draft.replyTo.replace(/^s\d+:/, ''))
      return {
        where: discussion,
        peer: this.peers.input(discussion),
        replyTo: { _: 'inputReplyToMessage', replyToMsgId: reply, topMsgId: root.id },
        conversation,
        prefix: `s${discussion.id}:`,
        thread,
      }
    }
    const reply = draft.replyTo === undefined ? Number(thread) : Number(draft.replyTo)
    return {
      where,
      peer,
      replyTo: { _: 'inputReplyToMessage', replyToMsgId: reply, topMsgId: Number(thread) },
      conversation,
      prefix: '',
      thread,
    }
  }

  private text(draft: Outgoing): { message: string; entities: tl.TypeMessageEntity[] } {
    const parsed = entitiesOf(draft.text)
    const people = (draft.mentions ?? []).flatMap((id) => {
      try {
        const user = this.peers.users.get(whereOf(id).id)
        if (!user) return []
        const person = personOf(user)
        return [
          {
            name: person.name,
            user: this.peers.inputUser(id),
            ...(person.handle ? { handle: person.handle } : {}),
          },
        ]
      } catch {
        return []
      }
    })
    const done = withMentions(parsed, people)
    return { message: done.text, entities: done.entities }
  }

  private async mediaOf(file: OutgoingFile): Promise<tl.TypeInputMedia> {
    const kind = kindOf(file)
    const named: tl.TypeDocumentAttribute = { _: 'documentAttributeFilename', fileName: file.name }
    if (kind === 'voice') {
      const ogg = oggOf(file.bytes, file.type)
      const waveform = packedOf(file.wave)
      const audio: tl.RawDocumentAttributeAudio = {
        _: 'documentAttributeAudio',
        duration: Math.round(file.seconds ?? 0),
        ...(ogg ? { voice: true } : {}),
        ...(ogg && waveform ? { waveform } : {}),
      }
      const name = ogg ? file.name.replace(/\.[^.]*$/, '') + '.ogg' : file.name
      const type = ogg ? 'audio/ogg' : file.type
      return {
        _: 'inputMediaUploadedDocument',
        file: await this.client.upload(ogg ?? file.bytes, name, type),
        mimeType: type,
        attributes: [audio, { _: 'documentAttributeFilename', fileName: name }],
      }
    }
    const uploaded = await this.client.upload(file.bytes, file.name, file.type)
    if (kind === 'image' && PHOTO.has(file.type))
      return { _: 'inputMediaUploadedPhoto', file: uploaded }
    const attributes: tl.TypeDocumentAttribute[] = [named]
    if (kind === 'video' || kind === 'gif') {
      attributes.push({
        _: 'documentAttributeVideo',
        duration: file.seconds ?? 0,
        w: file.width ?? 0,
        h: file.height ?? 0,
        supportsStreaming: true,
      })
    }
    if (kind === 'gif') attributes.push({ _: 'documentAttributeAnimated' })
    if (kind === 'audio')
      attributes.push({ _: 'documentAttributeAudio', duration: Math.round(file.seconds ?? 0) })
    if ((kind === 'image' || kind === 'sticker') && file.width && file.height)
      attributes.push({ _: 'documentAttributeImageSize', w: file.width, h: file.height })
    return {
      _: 'inputMediaUploadedDocument',
      file: uploaded,
      mimeType: file.type || 'application/octet-stream',
      attributes,
      ...(kind === 'file' ? { forceFile: true } : {}),
    }
  }

  private sentFrom(
    result: tl.TypeUpdates,
    randomId: Long,
    where: Where,
    message: string,
    entities: tl.TypeMessageEntity[],
  ): tl.RawMessage | null {
    if (result._ === 'updateShortSentMessage') {
      const sent: tl.RawMessage = {
        _: 'message',
        id: result.id,
        out: true,
        peerId: peerOf(where),
        fromId: { _: 'peerUser', userId: this.peers.self },
        date: result.date,
        message,
        entities: result.entities ?? entities,
      }
      if (result.media) sent.media = result.media
      if (result.ttlPeriod) sent.ttlPeriod = result.ttlPeriod
      return sent
    }
    const updates = updatesIn(result)
    const found = foundIn(result)
    if (found) this.peers.add(found)
    const assigned = updates.find(
      (one): one is tl.RawUpdateMessageID =>
        one._ === 'updateMessageID' && one.randomId.equals(randomId),
    )
    const news = updates.flatMap((one) =>
      (one._ === 'updateNewMessage' || one._ === 'updateNewChannelMessage') &&
      one.message._ === 'message'
        ? [one.message]
        : [],
    )
    return news.find((one) => !assigned || one.id === assigned.id) ?? null
  }

  private async deliver(
    to: Awaited<ReturnType<TelegramConnection['destination']>>,
    request: (randomId: Long) => tl.RpcMethod,
    message: string,
    entities: tl.TypeMessageEntity[],
  ): Promise<ProviderMessage> {
    const randomId = random()
    const result = await this.call(request(randomId) as tl.messages.RawSendMessageRequest)
    const sent = this.sentFrom(result, randomId, to.where, message, entities)
    if (!sent) throw new Error(WORDS.notHere)
    const mapped = this.mapped(sent, {
      conversation: to.conversation,
      prefix: to.prefix,
      ...(to.thread !== undefined ? { thread: to.thread } : {}),
    })
    if (!mapped) throw new Error(WORDS.notHere)
    return mapped
  }

  async send(conversation: string, draft: Outgoing): Promise<ProviderMessage> {
    const to = await this.destination(conversation, draft)
    const { message, entities } = this.text(draft)
    const base = { peer: to.peer, ...(to.replyTo ? { replyTo: to.replyTo } : {}) }
    if (draft.sticker !== undefined) {
      const inline = this.inline.get(draft.sticker)
      if (inline) {
        return this.deliver(
          to,
          (randomId) => ({
            _: 'messages.sendInlineBotResult',
            ...base,
            randomId,
            queryId: inline.queryId,
            id: inline.id,
          }),
          '',
          [],
        )
      }
      const document = this.stickerDocs.get(draft.sticker)
      if (!document) throw new Error(WORDS.unknownSticker)
      return this.deliver(
        to,
        (randomId) => ({
          _: 'messages.sendMedia',
          ...base,
          randomId,
          message: '',
          media: {
            _: 'inputMediaDocument',
            id: {
              _: 'inputDocument',
              id: document.id,
              accessHash: document.accessHash,
              fileReference: document.fileReference,
            },
          },
        }),
        '',
        [],
      )
    }
    if (draft.poll) {
      const poll = draft.poll
      const media: tl.RawInputMediaPoll = {
        _: 'inputMediaPoll',
        poll: {
          _: 'poll',
          id: Long.ZERO,
          hash: Long.ZERO,
          question: { _: 'textWithEntities', text: poll.question, entities: [] },
          answers: poll.answers.map((text) => ({
            _: 'inputPollAnswer',
            text: { _: 'textWithEntities', text, entities: [] },
          })),
          ...(poll.several ? { multipleChoice: true } : {}),
        },
      }
      return this.deliver(
        to,
        (randomId) => ({ _: 'messages.sendMedia', ...base, randomId, message: '', media }),
        '',
        [],
      )
    }
    const files = draft.attachments ?? []
    const top =
      to.replyTo?._ === 'inputReplyToMessage' && to.replyTo.topMsgId !== undefined
        ? to.replyTo.topMsgId
        : undefined
    const later = {
      peer: to.peer,
      ...(top !== undefined
        ? { replyTo: { _: 'inputReplyToMessage', replyToMsgId: top, topMsgId: top } as const }
        : {}),
    }
    let first: ProviderMessage | null = null
    const medias: tl.TypeInputMedia[] = []
    for (const file of files) medias.push(await this.mediaOf(file))
    const captioned = !!medias.length && message.length <= (this.premium ? MOST_TEXT : MOST_CAPTION)
    if (!captioned) {
      for (const piece of piecesOf(message, entities)) {
        const head = first ? later : base
        const sent = await this.deliver(
          to,
          (randomId) => ({ _: 'messages.sendMessage', ...head, randomId, ...piece }),
          piece.message,
          piece.entities,
        )
        first ??= sent
      }
    }
    for (const [index, media] of medias.entries()) {
      const caption = captioned && index === 0 ? message : ''
      const marks = captioned && index === 0 ? entities : []
      const head = first ? later : base
      const sent = await this.deliver(
        to,
        (randomId) => ({
          _: 'messages.sendMedia',
          ...head,
          randomId,
          media,
          message: caption,
          entities: marks,
        }),
        caption,
        marks,
      )
      first ??= sent
    }
    if (!first) throw new Error(WORDS.notHere)
    return first
  }

  async edit(conversation: string, message: string, draft: Outgoing): Promise<void> {
    const { peer, id } = this.target(conversation, message)
    const text = this.text(draft)
    await this.call({
      _: 'messages.editMessage',
      peer,
      id,
      message: text.message,
      entities: text.entities,
    })
  }

  async remove(conversation: string, message: string, everyone: boolean): Promise<void> {
    const { where, id } = this.target(conversation, message)
    if (where.kind === 's') {
      if (!everyone) throw new Error(WORDS.forMe)
      await this.call({
        _: 'channels.deleteMessages',
        channel: this.peers.inputChannel(where),
        id: [id],
      })
      return
    }
    await this.call({
      _: 'messages.deleteMessages',
      id: [id],
      ...(everyone ? { revoke: true } : {}),
    })
  }

  async react(conversation: string, message: string, emoji: string, on: boolean): Promise<void> {
    const { peer, id } = this.target(conversation, message)
    const kept = this.kept.get(`${conversation}\n${message}`)
    const chosen = chosenOf(kept?.reactions).filter((one) => one !== emoji)
    const next = on ? (this.premium ? [...chosen, emoji].slice(-MOST_REACTIONS) : [emoji]) : chosen
    await this.call({
      _: 'messages.sendReaction',
      peer,
      msgId: id,
      reaction: next.map((emoticon) => ({ _: 'reactionEmoji', emoticon })),
    })
  }

  async pin(conversation: string, message: string, on: boolean): Promise<void> {
    const { peer, id } = this.target(conversation, message)
    await this.call({ _: 'messages.updatePinnedMessage', peer, id, ...(on ? {} : { unpin: true }) })
  }

  async vote(conversation: string, message: string, answers: readonly number[]): Promise<void> {
    const { peer, id } = this.target(conversation, message)
    let kept = this.kept.get(`${conversation}\n${message}`)
    if (kept?.media?._ !== 'messageMediaPoll') {
      await this.refetch(conversation, message)
      kept = this.kept.get(`${conversation}\n${message}`)
    }
    const media = kept?.media
    if (media?._ !== 'messageMediaPoll') throw new Error(WORDS.notHere)
    const options = answers.flatMap((index) => {
      const answer = media.poll.answers[index]
      return answer?._ === 'pollAnswer' ? [answer.option] : []
    })
    await this.call({ _: 'messages.sendVote', peer, msgId: id, options })
  }

  async typing(conversation: string, on: boolean): Promise<void> {
    const where = whereOf(conversation)
    await this.call({
      _: 'messages.setTyping',
      peer: this.peers.input(where),
      action: on ? { _: 'sendMessageTypingAction' } : { _: 'sendMessageCancelAction' },
      ...(where.topic !== undefined && where.topic !== GENERAL ? { topMsgId: where.topic } : {}),
    })
  }

  async markRead(conversation: string, upTo: string): Promise<void> {
    const where = whereOf(conversation)
    const maxId = Number(upTo.replace(/^s\d+:/, '')) || 0
    if (where.topic !== undefined && where.topic !== GENERAL) {
      await this.call({
        _: 'messages.readDiscussion',
        peer: this.peers.input(where),
        msgId: where.topic,
        readMaxId: maxId,
      })
    } else if (where.kind === 's') {
      await this.call({ _: 'channels.readHistory', channel: this.peers.inputChannel(where), maxId })
    } else {
      await this.call({ _: 'messages.readHistory', peer: this.peers.input(where), maxId })
    }
    this.changeConversation(conversation, { unread: 0 })
  }

  private dialogPeer(conversation: string): tl.TypeInputDialogPeer {
    const where = whereOf(conversation)
    return { _: 'inputDialogPeer', peer: this.peers.input({ kind: where.kind, id: where.id }) }
  }

  async markUnread(conversation: string): Promise<void> {
    await this.call({
      _: 'messages.markDialogUnread',
      unread: true,
      peer: this.dialogPeer(conversation),
    })
  }

  private searched(result: tl.messages.TypeMessages): ProviderMessage[] {
    return messagesIn(result).flatMap((one) => {
      const mapped = this.mapped(one)
      return mapped ? [mapped] : []
    })
  }

  async search(query: string, conversation?: string): Promise<ProviderMessage[]> {
    const filter: tl.TypeMessagesFilter = { _: 'inputMessagesFilterEmpty' }
    if (conversation === undefined) {
      return this.searched(
        await this.call({
          _: 'messages.searchGlobal',
          q: query,
          filter,
          minDate: 0,
          maxDate: 0,
          offsetRate: 0,
          offsetPeer: { _: 'inputPeerEmpty' },
          offsetId: 0,
          limit: PAGE,
        }),
      )
    }
    const where = whereOf(conversation)
    return this.searched(
      await this.call({
        _: 'messages.search',
        peer: this.peers.input(where),
        q: query,
        filter,
        minDate: 0,
        maxDate: 0,
        offsetId: 0,
        addOffset: 0,
        limit: PAGE,
        maxId: 0,
        minId: 0,
        hash: Long.ZERO,
        ...(where.topic !== undefined && where.topic !== GENERAL ? { topMsgId: where.topic } : {}),
      }),
    ).filter((one) => one.conversation === conversation)
  }

  private member(userId: number, role: ConversationRole): Member | null {
    const user = this.peers.users.get(userId)
    if (!user) return null
    const member: Member = { ...personOf(user), role }
    const status = user.status
    if (status?._ === 'userStatusOnline') member.online = true
    if (status?._ === 'userStatusOffline') {
      member.online = false
      member.lastSeen = status.wasOnline * 1000
    }
    return member
  }

  async members(conversation: string): Promise<Member[]> {
    const where = whereOf(conversation)
    if (where.kind === 'u') {
      return [this.member(this.peers.self, 'member'), this.member(where.id, 'member')].filter(
        (one): one is Member => one !== null,
      )
    }
    if (where.kind === 'c') {
      const full = await this.call({ _: 'messages.getFullChat', chatId: where.id })
      const chat = full.fullChat
      if (chat._ !== 'chatFull' || chat.participants._ !== 'chatParticipants') return []
      return chat.participants.participants.flatMap((one) => {
        const role: ConversationRole =
          one._ === 'chatParticipantCreator'
            ? 'owner'
            : one._ === 'chatParticipantAdmin'
              ? 'admin'
              : 'member'
        const member = this.member(one.userId, role)
        return member ? [member] : []
      })
    }
    const result = await this.call({
      _: 'channels.getParticipants',
      channel: this.peers.inputChannel(where),
      filter: { _: 'channelParticipantsRecent' },
      offset: 0,
      limit: 200,
      hash: Long.ZERO,
    })
    if (result._ !== 'channels.channelParticipants') return []
    return result.participants.flatMap((one) => {
      if (one._ === 'channelParticipantBanned' || one._ === 'channelParticipantLeft') return []
      const role: ConversationRole =
        one._ === 'channelParticipantCreator'
          ? 'owner'
          : one._ === 'channelParticipantAdmin'
            ? 'admin'
            : 'member'
      const member = this.member(one.userId, role)
      return member ? [member] : []
    })
  }

  async people(query: string): Promise<Person[]> {
    const result = await this.call({ _: 'contacts.search', q: query, limit: 20 })
    return [...result.myResults, ...result.results]
      .flatMap((peer) => {
        if (peer._ !== 'peerUser') return []
        const user = this.peers.users.get(peer.userId)
        return user && user.id !== this.peers.self ? [personOf(user)] : []
      })
      .filter((one, index, all) => all.findIndex((it) => it.id === one.id) === index)
  }

  private conversationFor(where: Where): Conversation {
    const id = idOf(where)
    const known = this.known.get(id)
    if (known) return known
    const dialog: tl.RawDialog = {
      _: 'dialog',
      peer: peerOf(where),
      topMessage: 0,
      readInboxMaxId: 0,
      readOutboxMaxId: 0,
      unreadCount: 0,
      unreadMentionsCount: 0,
      unreadReactionsCount: 0,
      unreadPollVotesCount: 0,
      notifySettings: { _: 'peerNotifySettings' },
    }
    const made = this.conversationOf(dialog, undefined) ?? {
      id,
      title: null,
      kind: where.kind === 'u' ? 'direct' : 'group',
      people: [],
      lastAt: null,
      unread: 0,
    }
    this.known.set(id, made)
    return made
  }

  async begin(people: readonly string[], title?: string): Promise<Conversation> {
    if (people.length === 1 && !title) {
      const only = people[0] ?? ''
      this.peers.inputUser(only)
      return this.conversationFor(whereOf(only))
    }
    const users = people.map((one) => this.peers.inputUser(one))
    const name =
      title ??
      people
        .map((one) => {
          const user = this.peers.users.get(whereOf(one).id)
          return user ? fullName(user) : one
        })
        .join(', ')
    const result = await this.call({ _: 'messages.createChat', users, title: name })
    const found = foundIn(result.updates)
    if (found) this.peers.add(found)
    const chat = found?.chats.find((one) => one._ === 'chat')
    if (!chat) throw new Error(WORDS.notHere)
    const conversation = this.conversationFor({ kind: 'c', id: chat.id })
    this.emit({ t: 'conversation', conversation })
    return conversation
  }

  async invite(conversation: string, people: readonly string[]): Promise<void> {
    const where = whereOf(conversation)
    if (where.kind === 'u') throw new Error(WORDS.notHere)
    if (where.kind === 'c') {
      for (const one of people)
        await this.call({
          _: 'messages.addChatUser',
          chatId: where.id,
          userId: this.peers.inputUser(one),
          fwdLimit: 100,
        })
      return
    }
    await this.call({
      _: 'channels.inviteToChannel',
      channel: this.peers.inputChannel(where),
      users: people.map((one) => this.peers.inputUser(one)),
    })
  }

  async kick(conversation: string, person: string): Promise<void> {
    const where = whereOf(conversation)
    if (where.kind === 'u') throw new Error(WORDS.notHere)
    if (where.kind === 'c') {
      await this.call({
        _: 'messages.deleteChatUser',
        chatId: where.id,
        userId: this.peers.inputUser(person),
      })
      return
    }
    await this.call({
      _: 'channels.editBanned',
      channel: this.peers.inputChannel(where),
      participant: this.peers.input(whereOf(person)),
      bannedRights: { _: 'chatBannedRights', viewMessages: true, untilDate: 0 },
    })
  }

  async promote(conversation: string, person: string, role: ConversationRole): Promise<void> {
    const where = whereOf(conversation)
    if (role === 'owner') throw new Error(WORDS.owner)
    if (where.kind === 'u') throw new Error(WORDS.notHere)
    const userId = this.peers.inputUser(person)
    if (where.kind === 'c') {
      await this.call({
        _: 'messages.editChatAdmin',
        chatId: where.id,
        userId,
        isAdmin: role === 'admin',
      })
      return
    }
    const admin = role === 'admin'
    const broadcast = this.peers.channels.get(where.id)?.broadcast
    await this.call({
      _: 'channels.editAdmin',
      channel: this.peers.inputChannel(where),
      userId,
      adminRights: admin
        ? {
            _: 'chatAdminRights',
            changeInfo: true,
            deleteMessages: true,
            banUsers: true,
            inviteUsers: true,
            pinMessages: true,
            manageCall: true,
            other: true,
            ...(broadcast ? { postMessages: true, editMessages: true } : { manageTopics: true }),
          }
        : { _: 'chatAdminRights' },
      rank: '',
    })
  }

  async rename(conversation: string, title: string): Promise<void> {
    const where = whereOf(conversation)
    if (where.kind === 'c')
      await this.call({ _: 'messages.editChatTitle', chatId: where.id, title })
    else if (where.kind === 's')
      await this.call({ _: 'channels.editTitle', channel: this.peers.inputChannel(where), title })
    else throw new Error(WORDS.notHere)
    this.changeConversation(conversation, { title })
  }

  async describe(conversation: string, topic: string): Promise<void> {
    const where = whereOf(conversation)
    if (where.kind === 'u') throw new Error(WORDS.notHere)
    await this.call({
      _: 'messages.editChatAbout',
      peer: this.peers.input({ kind: where.kind, id: where.id }),
      about: topic,
    })
    this.changeConversation(conversation, { topic })
  }

  async leave(conversation: string): Promise<void> {
    const where = whereOf(conversation)
    if (where.kind === 'c')
      await this.call({
        _: 'messages.deleteChatUser',
        chatId: where.id,
        userId: { _: 'inputUserSelf' },
      })
    else if (where.kind === 's')
      await this.call({ _: 'channels.leaveChannel', channel: this.peers.inputChannel(where) })
    else throw new Error(WORDS.notHere)
    this.known.delete(conversation)
    this.emit({ t: 'gone', conversation })
  }

  async mute(conversation: string, until: number | null): Promise<void> {
    const where = whereOf(conversation)
    const muteUntil = until === null ? 0 : Math.min(FOREVER, Math.ceil(until / 1000))
    const peer = this.peers.input({ kind: where.kind, id: where.id })
    await this.call({
      _: 'account.updateNotifySettings',
      peer:
        where.topic !== undefined
          ? { _: 'inputNotifyForumTopic', peer, topMsgId: where.topic }
          : { _: 'inputNotifyPeer', peer },
      settings: { _: 'inputPeerNotifySettings', muteUntil },
    })
    this.changeConversation(conversation, { mutedUntil: until })
  }

  async archive(conversation: string, on: boolean): Promise<void> {
    const where = whereOf(conversation)
    await this.call({
      _: 'folders.editPeerFolders',
      folderPeers: [
        {
          _: 'inputFolderPeer',
          peer: this.peers.input({ kind: where.kind, id: where.id }),
          folderId: on ? 1 : 0,
        },
      ],
    })
    this.changeConversation(conversation, { archived: on })
  }

  async pinConversation(conversation: string, on: boolean): Promise<void> {
    await this.call({
      _: 'messages.toggleDialogPin',
      peer: this.dialogPeer(conversation),
      ...(on ? { pinned: true } : {}),
    })
    this.changeConversation(conversation, { pinned: on })
  }

  private stickerOf(document: tl.RawDocument): Sticker {
    const attachment = documentAttachment(document, document.id.toString())
    const ref = document.id.toString()
    this.stickerDocs.set(ref, document)
    const sticker: Sticker = { ref, name: attachment.name, type: attachment.type }
    const alt = document.attributes.find(
      (one): one is tl.RawDocumentAttributeSticker => one._ === 'documentAttributeSticker',
    )?.alt
    if (alt) sticker.emoji = alt
    if (attachment.width) sticker.width = attachment.width
    if (attachment.height) sticker.height = attachment.height
    return sticker
  }

  async stickers(): Promise<StickerSet[]> {
    const all = await this.call({ _: 'messages.getAllStickers', hash: Long.ZERO })
    if (all._ !== 'messages.allStickers') return []
    const sets = await Promise.all(
      all.sets.map(async (set): Promise<StickerSet | null> => {
        const full = await this.call({
          _: 'messages.getStickerSet',
          stickerset: { _: 'inputStickerSetID', id: set.id, accessHash: set.accessHash },
          hash: 0,
        }).catch(() => null)
        if (full?._ !== 'messages.stickerSet') return null
        const stickers = full.documents.flatMap((one) =>
          one._ === 'document' ? [this.stickerOf(one)] : [],
        )
        return { id: set.id.toString(), name: set.title, stickers }
      }),
    )
    return sets.filter((one): one is StickerSet => one !== null)
  }

  async gifs(query: string): Promise<Sticker[]> {
    if (!query.trim()) {
      const saved = await this.call({ _: 'messages.getSavedGifs', hash: Long.ZERO })
      if (saved._ !== 'messages.savedGifs') return []
      return saved.gifs.flatMap((one) => (one._ === 'document' ? [this.stickerOf(one)] : []))
    }
    const resolved = await this.call({ _: 'contacts.resolveUsername', username: 'gif' })
    if (resolved.peer._ !== 'peerUser') return []
    const bot = this.peers.inputUser(`u${resolved.peer.userId}`)
    const results = await this.call({
      _: 'messages.getInlineBotResults',
      bot,
      peer: { _: 'inputPeerSelf' },
      query,
      offset: '',
    })
    this.peers.add({ users: results.users, chats: [] })
    return results.results.flatMap((one) => {
      if (one._ !== 'botInlineMediaResult' || one.document?._ !== 'document') return []
      const sticker = this.stickerOf(one.document)
      this.inline.set(sticker.ref, { bot, queryId: results.queryId, id: one.id })
      return [sticker]
    })
  }

  async stickerBytes(ref: string): Promise<Uint8Array> {
    const document = this.stickerDocs.get(ref)
    if (!document) throw new Error(WORDS.unknownSticker)
    const thumb = document.mimeType === 'application/x-tgsticker' ? thumbOf(document) : null
    return this.client.download(
      {
        _: 'inputDocumentFileLocation',
        id: document.id,
        accessHash: document.accessHash,
        fileReference: document.fileReference,
        thumbSize: thumb?.type ?? '',
      },
      document.dcId,
      thumb?.size ?? document.size,
    )
  }

  async picture(id: string): Promise<Uint8Array | null> {
    const where = whereOf(id.replace(/t\d+$/, ''))
    let photoId: Long | null = null
    let dc = 0
    if (where.kind === 'u') {
      const photo = this.peers.users.get(where.id)?.photo
      if (photo?._ === 'userProfilePhoto') {
        photoId = photo.photoId
        dc = photo.dcId
      }
    } else {
      const photo = this.peers.group(where)?.photo
      if (photo?._ === 'chatPhoto') {
        photoId = photo.photoId
        dc = photo.dcId
      }
    }
    if (!photoId) return null
    return this.client.download(
      { _: 'inputPeerPhotoFileLocation', peer: this.peers.input(where), photoId },
      dc,
    )
  }

  private async refetch(conversation: string, message: string): Promise<tl.RawMessage | null> {
    const { where, id } = this.target(conversation, message)
    const ids: tl.TypeInputMessage[] = [{ _: 'inputMessageID', id }]
    const result =
      where.kind === 's'
        ? await this.call({
            _: 'channels.getMessages',
            channel: this.peers.inputChannel(where),
            id: ids,
          })
        : await this.call({ _: 'messages.getMessages', id: ids })
    const found = messagesIn(result).find(
      (one): one is tl.RawMessage => one._ === 'message' && one.id === id,
    )
    if (!found) return null
    const split = /^(s\d+:)/.exec(message)
    this.keep(found, conversation, split?.[1] ?? '')
    return found
  }

  private location(
    message: tl.RawMessage,
    ref: string,
  ): { location: tl.TypeInputFileLocation; dc: number; size: number } | null {
    const media = message.media
    if (media?._ === 'messageMediaPhoto' && media.photo?._ === 'photo') {
      const size = photoSize(media.photo)
      if (!size) return null
      return {
        location: {
          _: 'inputPhotoFileLocation',
          id: media.photo.id,
          accessHash: media.photo.accessHash,
          fileReference: media.photo.fileReference,
          thumbSize: size.type,
        },
        dc: media.photo.dcId,
        size: size.size,
      }
    }
    if (media?._ === 'messageMediaDocument' && media.document?._ === 'document') {
      const document = media.document
      const thumb = ref.startsWith('m:') ? ref.slice(2) : ''
      const size = thumb ? (thumbOf(document)?.size ?? 0) : document.size
      return {
        location: {
          _: 'inputDocumentFileLocation',
          id: document.id,
          accessHash: document.accessHash,
          fileReference: document.fileReference,
          thumbSize: thumb,
        },
        dc: document.dcId,
        size,
      }
    }
    return null
  }

  async attachment(conversation: string, message: string, ref: string): Promise<Uint8Array> {
    const key = `${conversation}\n${message}`
    const kept = this.kept.get(key) ?? (await this.refetch(conversation, message))
    const first = kept ? this.location(kept, ref) : null
    if (!first) throw new Error(WORDS.notHere)
    try {
      return await this.client.download(first.location, first.dc, first.size)
    } catch (error) {
      if (!errorText(error).startsWith('FILE_REFERENCE_')) throw error
      const fresh = await this.refetch(conversation, message)
      const again = fresh ? this.location(fresh, ref) : null
      if (!again) throw error
      return this.client.download(again.location, again.dc, again.size)
    }
  }

  private changeConversation(conversation: string, change: Partial<Conversation>): void {
    const known = this.known.get(conversation)
    if (!known) return
    const next: Conversation = { ...known }
    for (const [key, value] of Object.entries(change)) {
      if (value === null && key === 'mutedUntil') delete next.mutedUntil
      else (next as unknown as Record<string, unknown>)[key] = value
    }
    this.known.set(conversation, next)
    this.emit({ t: 'conversation', conversation: next })
  }

  private typed(conversation: string, from: tl.TypePeer, action: tl.TypeSendMessageAction): void {
    const person = peerId(from)
    if (person === this.self) return
    const key = `${conversation}\n${person}`
    const timer = this.typists.get(key)
    if (timer) clearTimeout(timer)
    this.typists.delete(key)
    const on = action._ !== 'sendMessageCancelAction'
    this.emit({ t: 'typing', conversation, person, on })
    if (on) {
      this.typists.set(
        key,
        setTimeout(() => {
          this.typists.delete(key)
          this.emit({ t: 'typing', conversation, person, on: false })
        }, TYPING_FOR),
      )
    }
  }

  private keptWhere(
    match: (key: string, message: tl.RawMessage) => boolean,
  ): [string, tl.RawMessage][] {
    return [...this.kept.entries()].filter(([key, message]) => match(key, message))
  }

  private rekept(key: string, message: tl.RawMessage): void {
    const [conversation = '', id = ''] = key.split('\n')
    const prefix = /^(s\d+:)/.exec(id)?.[1] ?? ''
    const mapped = this.mapped(message, { conversation, prefix })
    if (mapped) this.emit({ t: 'changed', message: mapped })
  }

  private heard(update: tl.TypeUpdate, found: Found): void {
    this.peers.add(found)
    const handle = this.handlers[update._] as ((one: tl.TypeUpdate) => void) | undefined
    handle?.(update)
  }

  private arrived(message: tl.TypeMessage): void {
    const where = whereOfMessage(message, this.peers)
    if (!where) return
    const conversation = idOf(where)
    if (!this.known.has(conversation))
      this.emit({ t: 'conversation', conversation: this.conversationFor(where) })
    const mapped = this.mapped(message)
    if (mapped) this.emit({ t: 'message', message: mapped })
  }

  private edited(message: tl.TypeMessage): void {
    const mapped = this.mapped(message)
    if (mapped) this.emit({ t: 'changed', message: mapped })
  }

  private removed(owner: RegExp, ids: readonly number[], channel?: number): void {
    const wanted = new Set(ids.map(String))
    const told = new Set<string>()
    for (const [key] of this.keptWhere(
      (key) => owner.test(key) && wanted.has(key.split('\n')[1] ?? ''),
    )) {
      const [conversation = '', message = ''] = key.split('\n')
      this.kept.delete(key)
      told.add(message)
      this.emit({ t: 'deleted', conversation, message })
    }
    if (channel === undefined || this.peers.forum(channel)) return
    for (const message of wanted)
      if (!told.has(message)) this.emit({ t: 'deleted', conversation: `s${channel}`, message })
  }

  private home(channel: number): string {
    return idOf({
      kind: 's',
      id: channel,
      ...(this.peers.forum(channel) ? { topic: GENERAL } : {}),
    })
  }

  private readIn(conversation: string, maxId: number): void {
    const unread = this.keptWhere(
      (key, message) => key.startsWith(`${conversation}\n`) && !message.out && message.id > maxId,
    ).length
    this.changeConversation(conversation, {
      unread: Math.min(this.known.get(conversation)?.unread ?? 0, unread),
    })
  }

  private readOut(conversation: string, maxId: number): void {
    this.outbox.set(conversation, maxId)
    this.emit({ t: 'read', conversation, person: conversation, upTo: String(maxId) })
  }

  private changedWhere(
    owner: string,
    ids: ReadonlySet<number>,
    change: (message: tl.RawMessage) => tl.RawMessage,
  ): void {
    for (const [key, message] of this.keptWhere(
      (key, message) => key.replace(/t\d+\n/, '\n').startsWith(`${owner}\n`) && ids.has(message.id),
    ))
      this.rekept(key, change(message))
  }

  private left(channel: number): void {
    const known = this.peers.channels.get(channel)
    if (known && !known.left) return
    for (const id of [...this.known.keys()].filter(
      (one) => one === `s${channel}` || one.startsWith(`s${channel}t`),
    )) {
      this.known.delete(id)
      this.emit({ t: 'gone', conversation: id })
    }
  }

  private readonly handlers: Handlers = {
    updateNewMessage: (update) => this.arrived(update.message),
    updateNewChannelMessage: (update) => this.arrived(update.message),
    updateEditMessage: (update) => this.edited(update.message),
    updateEditChannelMessage: (update) => this.edited(update.message),
    updateDeleteMessages: (update) => this.removed(/^[uc]\d+\n\d+$/, update.messages),
    updateDeleteChannelMessages: (update) =>
      this.removed(
        new RegExp(`^s${update.channelId}(t\\d+)?\\n\\d+$`),
        update.messages,
        update.channelId,
      ),
    updateReadHistoryOutbox: (update) => this.readOut(peerId(update.peer), update.maxId),
    updateReadChannelOutbox: (update) => this.readOut(this.home(update.channelId), update.maxId),
    updateReadChannelDiscussionOutbox: (update) => {
      if (this.peers.forum(update.channelId))
        this.readOut(
          idOf({ kind: 's', id: update.channelId, topic: update.topMsgId }),
          update.readMaxId,
        )
    },
    updateReadChannelDiscussionInbox: (update) => {
      if (this.peers.forum(update.channelId))
        this.readIn(
          idOf({ kind: 's', id: update.channelId, topic: update.topMsgId }),
          update.readMaxId,
        )
    },
    updateReadHistoryInbox: (update) =>
      this.changeConversation(peerId(update.peer), { unread: update.stillUnreadCount }),
    updateReadChannelInbox: (update) => {
      if (this.peers.forum(update.channelId)) this.readIn(this.home(update.channelId), update.maxId)
      else this.changeConversation(`s${update.channelId}`, { unread: update.stillUnreadCount })
    },
    updateUserTyping: (update) =>
      this.typed(`u${update.userId}`, { _: 'peerUser', userId: update.userId }, update.action),
    updateChatUserTyping: (update) => this.typed(`c${update.chatId}`, update.fromId, update.action),
    updateChannelUserTyping: (update) => {
      const topic = this.peers.forum(update.channelId) ? (update.topMsgId ?? GENERAL) : undefined
      this.typed(
        idOf({ kind: 's', id: update.channelId, ...(topic !== undefined ? { topic } : {}) }),
        update.fromId,
        update.action,
      )
    },
    updateUserStatus: (update) => {
      const user = this.peers.users.get(update.userId)
      if (user) this.peers.users.set(user.id, { ...user, status: update.status })
      const status = update.status
      this.emit({
        t: 'presence',
        person: `u${update.userId}`,
        online: status._ === 'userStatusOnline',
        ...(status._ === 'userStatusOffline' ? { lastSeen: status.wasOnline * 1000 } : {}),
      })
    },
    updateMessagePoll: (update) => {
      for (const [key, message] of this.keptWhere(
        (_key, message) =>
          message.media?._ === 'messageMediaPoll' && message.media.poll.id.equals(update.pollId),
      )) {
        const media = message.media
        if (media?._ !== 'messageMediaPoll') continue
        this.rekept(key, {
          ...message,
          media: {
            ...media,
            results: update.results,
            ...(update.poll ? { poll: update.poll } : {}),
          },
        })
      }
    },
    updateMessageReactions: (update) =>
      this.changedWhere(peerId(update.peer), new Set([update.msgId]), (message) => ({
        ...message,
        reactions: update.reactions,
      })),
    updatePinnedMessages: (update) =>
      this.changedWhere(peerId(update.peer), new Set(update.messages), (message) => ({
        ...message,
        pinned: !!update.pinned,
      })),
    updatePinnedChannelMessages: (update) =>
      this.changedWhere(`s${update.channelId}`, new Set(update.messages), (message) => ({
        ...message,
        pinned: !!update.pinned,
      })),
    updateDialogPinned: (update) => {
      if (update.peer._ === 'dialogPeer')
        this.changeConversation(peerId(update.peer.peer), { pinned: !!update.pinned })
    },
    updateDialogUnreadMark: (update) => {
      if (update.peer._ !== 'dialogPeer' || !update.unread) return
      const conversation = peerId(update.peer.peer)
      this.changeConversation(conversation, {
        unread: Math.max(1, this.known.get(conversation)?.unread ?? 0),
      })
    },
    updateNotifySettings: (update) => {
      if (update.peer._ !== 'notifyPeer') return
      const until = update.notifySettings.muteUntil
      this.changeConversation(peerId(update.peer.peer), {
        mutedUntil: until && until * 1000 > this.host.now() ? until * 1000 : null,
      })
    },
    updateFolderPeers: (update) => {
      for (const one of update.folderPeers)
        this.changeConversation(peerId(one.peer), { archived: one.folderId === 1 })
    },
    updateChannel: (update) => this.left(update.channelId),
  }

  start(hear: (event: ProviderEvent) => void): () => void {
    this.hearers.add(hear)
    return () => this.hearers.delete(hear)
  }

  async logOut(): Promise<void> {
    this.gone = true
    await this.client.logOut().catch(() => undefined)
    await this.close()
  }

  async close(): Promise<void> {
    this.stopListening?.()
    this.stopListening = null
    for (const timer of this.typists.values()) clearTimeout(timer)
    this.typists.clear()
    this.hearers.clear()
    if (live.get(this.account.id) === this) live.delete(this.account.id)
    const session = await this.client.session().catch(() => null)
    if (session && !this.gone)
      await keepSession(this.host, this.account.id, session).catch(() => undefined)
    await this.client.close().catch(() => undefined)
  }
}
