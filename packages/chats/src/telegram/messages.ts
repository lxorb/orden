import type { tl } from '@mtcute/core'
import type {
  AttachmentKind,
  AttachmentRef,
  LinkPreview,
  ProviderMessage,
  ProviderPoll,
} from '../provider'
import { markdownOf } from './entities'
import { fullName, idOf, peerId, type Peers, type Where } from './peers'
import { waveOf } from './voice'

export interface Context {
  peers: Peers
  self: string
  readOut(conversation: string): number
  thread?: string
  conversation?: string
  prefix?: string
}

const ANONYMOUS = 'anon:'

type Sayings = {
  [K in tl.TypeMessageAction['_']]?: (action: Extract<tl.TypeMessageAction, { _: K }>) => string
}

export function whereOfMessage(message: tl.TypeMessage, peers: Peers): Where | null {
  if (message._ === 'messageEmpty') return null
  const peer = message.peerId
  if (peer._ === 'peerUser') return { kind: 'u', id: peer.userId }
  if (peer._ === 'peerChat') return { kind: 'c', id: peer.chatId }
  const where: Where = { kind: 's', id: peer.channelId }
  if (peers.forum(peer.channelId)) where.topic = topicOf(message)
  return where
}

function topicOf(message: tl.RawMessage | tl.RawMessageService): number {
  const reply = message.replyTo
  if (reply?._ !== 'messageReplyHeader' || !reply.forumTopic) return 1
  return reply.replyToTopId ?? reply.replyToMsgId ?? 1
}

function replyOf(
  message: tl.RawMessage | tl.RawMessageService,
  forum: boolean,
): string | undefined {
  const reply = message.replyTo
  if (reply?._ !== 'messageReplyHeader' || reply.replyToMsgId === undefined) return undefined
  if (reply.replyToPeerId) return undefined
  if (forum && reply.forumTopic && reply.replyToTopId === undefined) return undefined
  return String(reply.replyToMsgId)
}

function reactionKey(reaction: tl.TypeReaction): string | null {
  return reaction._ === 'reactionEmoji' ? reaction.emoticon : null
}

export function reactionsOf(
  reactions: tl.TypeMessageReactions | undefined,
  self: string,
): Record<string, string[]> | undefined {
  if (!reactions?.results.length) return undefined
  const out: Record<string, string[]> = {}
  for (const result of reactions.results) {
    const key = reactionKey(result.reaction)
    if (key === null) continue
    const who: string[] = []
    if (result.chosenOrder !== undefined) who.push(self)
    for (const recent of reactions.recentReactions ?? []) {
      if (reactionKey(recent.reaction) !== key) continue
      const id = recent.my ? self : peerId(recent.peerId)
      if (!who.includes(id)) who.push(id)
    }
    for (let at = 0; who.length < result.count; at++) who.push(`${ANONYMOUS}${key}${at}`)
    out[key] = who
  }
  return out
}

export function chosenOf(reactions: tl.TypeMessageReactions | undefined): string[] {
  return (reactions?.results ?? [])
    .filter((one) => one.chosenOrder !== undefined)
    .sort((a, b) => (a.chosenOrder ?? 0) - (b.chosenOrder ?? 0))
    .flatMap((one) => {
      const key = reactionKey(one.reaction)
      return key === null ? [] : [key]
    })
}

function largest(
  sizes: readonly tl.TypePhotoSize[],
): { type: string; w: number; h: number; size: number } | null {
  let best: { type: string; w: number; h: number; size: number } | null = null
  for (const size of sizes) {
    if (
      size._ === 'photoSize' ||
      size._ === 'photoCachedSize' ||
      size._ === 'photoSizeProgressive'
    ) {
      const bytes =
        size._ === 'photoSize'
          ? size.size
          : size._ === 'photoCachedSize'
            ? size.bytes.length
            : Math.max(0, ...size.sizes)
      if (!best || size.w * size.h > best.w * best.h)
        best = { type: size.type, w: size.w, h: size.h, size: bytes }
    }
  }
  return best
}

export function photoSize(
  photo: tl.RawPhoto,
): { type: string; w: number; h: number; size: number } | null {
  return largest(photo.sizes)
}

export function thumbOf(
  document: tl.RawDocument,
): { type: string; w: number; h: number; size: number } | null {
  return largest(document.thumbs ?? [])
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'application/x-tgsticker': 'tgs',
}

export function documentAttachment(document: tl.RawDocument, ref: string): AttachmentRef {
  let kind: AttachmentKind = 'file'
  let name: string | null = null
  const out: AttachmentRef = { ref, name: '', type: document.mimeType, size: document.size, kind }
  let animated = false
  for (const attribute of document.attributes) {
    if (attribute._ === 'documentAttributeFilename') name = attribute.fileName
    else if (attribute._ === 'documentAttributeSticker') kind = 'sticker'
    else if (attribute._ === 'documentAttributeAnimated') animated = true
    else if (attribute._ === 'documentAttributeImageSize') {
      out.width = attribute.w
      out.height = attribute.h
    } else if (attribute._ === 'documentAttributeVideo') {
      out.width = attribute.w
      out.height = attribute.h
      out.seconds = attribute.duration
      if (kind === 'file') kind = 'video'
    } else if (attribute._ === 'documentAttributeAudio') {
      out.seconds = attribute.duration
      kind = attribute.voice ? 'voice' : 'audio'
      const wave = waveOf(attribute.waveform)
      if (wave) out.wave = wave
    }
  }
  if (animated && kind !== 'sticker') kind = 'gif'
  if (kind === 'file' && document.mimeType.startsWith('image/')) kind = 'image'
  if (kind === 'sticker' && document.mimeType === 'application/x-tgsticker') {
    const thumb = thumbOf(document)
    if (thumb) {
      out.ref = `${ref}:${thumb.type}`
      out.type = 'image/webp'
      out.size = thumb.size
      out.width = thumb.w
      out.height = thumb.h
    }
  }
  out.kind = kind
  out.name = name ?? `${kind}-${document.id.toString()}.${EXTENSIONS[out.type] ?? 'bin'}`
  return out
}

export function attachmentsOf(media: tl.TypeMessageMedia | undefined): AttachmentRef[] {
  if (!media) return []
  if (media._ === 'messageMediaPhoto' && media.photo?._ === 'photo') {
    const size = photoSize(media.photo)
    if (!size) return []
    return [
      {
        ref: 'm',
        name: `photo-${media.photo.id.toString()}.jpg`,
        type: 'image/jpeg',
        size: size.size,
        kind: 'image',
        width: size.w,
        height: size.h,
      },
    ]
  }
  if (media._ === 'messageMediaDocument' && media.document?._ === 'document') {
    const attachment = documentAttachment(media.document, 'm')
    if (media.round) attachment.kind = 'video'
    return [attachment]
  }
  return []
}

function previewOf(media: tl.TypeMessageMedia | undefined): LinkPreview | undefined {
  if (media?._ !== 'messageMediaWebPage' || media.webpage._ !== 'webPage') return undefined
  const page = media.webpage
  const preview: LinkPreview = {
    url: page.url,
    title: page.title ?? page.siteName ?? page.displayUrl,
  }
  if (page.siteName) preview.site = page.siteName
  if (page.description) preview.text = page.description
  return preview
}

export function pollOf(media: tl.RawMessageMediaPoll): ProviderPoll {
  const poll = media.poll
  const results = media.results.results ?? []
  const options = poll.answers.map((answer) => (answer._ === 'pollAnswer' ? answer.option : null))
  const same = (a: Uint8Array | null, b: Uint8Array) =>
    !!a && a.length === b.length && a.every((byte, index) => byte === b[index])
  const counts = options.map(
    (option) => results.find((one) => same(option, one.option))?.voters ?? 0,
  )
  const mine = options.flatMap((option, index) =>
    results.some((one) => one.chosen && same(option, one.option)) ? [index] : [],
  )
  const out: ProviderPoll = {
    question: poll.question.text,
    answers: poll.answers.map((answer) => answer.text.text),
    several: !!poll.multipleChoice,
    counts,
    mine,
  }
  if (poll.closed) out.closed = true
  if (poll.closeDate) out.ends = poll.closeDate * 1000
  return out
}

function extraText(media: tl.TypeMessageMedia | undefined): string {
  if (!media) return ''
  if (
    media._ === 'messageMediaGeo' ||
    media._ === 'messageMediaGeoLive' ||
    media._ === 'messageMediaVenue'
  ) {
    const point = media.geo
    if (point._ !== 'geoPoint') return ''
    const title = media._ === 'messageMediaVenue' ? `${media.title} ` : ''
    return `📍 ${title}https://www.openstreetmap.org/?mlat=${point.lat}&mlon=${point.long}`
  }
  if (media._ === 'messageMediaContact')
    return `👤 ${[media.firstName, media.lastName].filter(Boolean).join(' ')} +${media.phoneNumber}`
  if (media._ === 'messageMediaDice') return `${media.emoticon} ${media.value}`
  return ''
}

function mentionsOf(message: tl.RawMessage, context: Context): string[] {
  const out: string[] = []
  if (message.mentioned) out.push(context.self)
  for (const entity of message.entities ?? []) {
    if (entity._ === 'messageEntityMentionName') out.push(`u${entity.userId}`)
    else if (entity._ === 'messageEntityMention') {
      const handle = message.message.slice(entity.offset + 1, entity.offset + entity.length)
      const user = context.peers.byHandle(handle)
      if (user) out.push(`u${user.id}`)
    }
  }
  return [...new Set(out)]
}

function systemText(message: tl.RawMessageService, peers: Peers): string {
  const actor = peerId(message.fromId ?? message.peerId)
  const who = peers.person(message.fromId ?? message.peerId).name
  const names = (ids: readonly number[]) =>
    ids
      .map((id) => {
        const user = peers.users.get(id)
        return user ? fullName(user) : String(id)
      })
      .join(', ')
  const action = message.action
  const said: Sayings = {
    messageActionChatCreate: (one) => `${who} created the group “${one.title}”`,
    messageActionChannelCreate: (one) => `${who} created “${one.title}”`,
    messageActionChatEditTitle: (one) => `${who} renamed the group to “${one.title}”`,
    messageActionChatEditPhoto: () => `${who} changed the group photo`,
    messageActionChatDeletePhoto: () => `${who} removed the group photo`,
    messageActionChatAddUser: (one) =>
      one.users.length === 1 && `u${one.users[0]}` === actor
        ? `${who} joined`
        : `${who} added ${names(one.users)}`,
    messageActionChatDeleteUser: (one) =>
      `u${one.userId}` === actor ? `${who} left` : `${who} removed ${names([one.userId])}`,
    messageActionChatJoinedByLink: () => `${who} joined`,
    messageActionChatJoinedByRequest: () => `${who} joined`,
    messageActionPinMessage: () => `${who} pinned a message`,
    messageActionTopicCreate: (one) => `${who} created the topic “${one.title}”`,
    messageActionChatMigrateTo: () => 'The group became a supergroup',
    messageActionChannelMigrateFrom: () => 'The group became a supergroup',
    messageActionHistoryClear: () => 'History cleared',
    messageActionPhoneCall: () => `${who} called`,
    messageActionScreenshotTaken: () => `${who} took a screenshot`,
  }
  const say = said[action._] as ((one: tl.TypeMessageAction) => string) | undefined
  return say
    ? say(action)
    : action._.replace(/^messageAction/, '').replace(/([a-z])([A-Z])/g, '$1 $2')
}

export function messageOf(message: tl.TypeMessage, context: Context): ProviderMessage | null {
  if (message._ === 'messageEmpty') return null
  const where = whereOfMessage(message, context.peers)
  if (!where) return null
  const conversation = context.conversation ?? idOf(where)
  const forum = where.topic !== undefined
  const author = context.peers.person(message.fromId ?? message.peerId)
  const out: ProviderMessage = {
    id: `${context.prefix ?? ''}${message.id}`,
    conversation,
    author,
    at: message.date * 1000,
    text: '',
    attachments: [],
    mine: !!message.out || author.id === context.self,
  }
  const reply = replyOf(message, forum)
  if (reply !== undefined) out.replyTo = `${context.prefix ?? ''}${reply}`
  if (context.thread !== undefined) out.thread = context.thread
  const reactions = reactionsOf(message.reactions, context.self)
  if (reactions) out.reactions = reactions
  if (message.ttlPeriod) out.expiresAt = (message.date + message.ttlPeriod) * 1000
  if (message._ === 'messageService') {
    out.text = systemText(message, context.peers)
    out.system = true
    return out
  }
  const extra = extraText(message.media)
  out.text = [markdownOf(message.message, message.entities), extra].filter(Boolean).join('\n')
  out.attachments = attachmentsOf(message.media)
  if (message.media?._ === 'messageMediaPoll') out.poll = pollOf(message.media)
  const preview = previewOf(message.media)
  if (preview) out.preview = preview
  if (message.editDate && !message.editHide) out.editedAt = message.editDate * 1000
  if (message.pinned) out.pinned = true
  if (message.fwdFrom) out.forwarded = true
  if (message.replies?.comments) {
    out.replies = message.replies.replies
  }
  const mentions = mentionsOf(message, context)
  if (mentions.length) out.mentions = mentions
  if (out.mine) out.delivery = message.id <= context.readOut(conversation) ? 'read' : 'sent'
  return out
}
