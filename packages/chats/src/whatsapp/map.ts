import type { WAMessage, proto } from '@whiskeysockets/baileys'
import type {
  AttachmentKind,
  AttachmentRef,
  Delivery,
  LinkPreview,
  Person,
  ProviderMessage,
  ProviderPoll,
} from '../provider'
import { atOf, secondsOf } from './cache'
import { markdownOf } from './format'
import type { MediaKind } from './media'

export const MEDIA_REF = 'media'

export function firstOf(...values: (string | null | undefined)[]): string {
  return values.find((one) => !!one) ?? ''
}

export interface Context {
  self: Person
  person(jid: string, pushName?: string | null): Person
  poll(message: WAMessage): ProviderPoll | undefined
  reactions(message: WAMessage): Record<string, string[]> | undefined
  pinned(message: WAMessage): boolean
}

export function contentOf(message: proto.IMessage | null | undefined): proto.IMessage | undefined {
  let inner = message ?? undefined
  for (let depth = 0; inner && depth < 6; depth++) {
    const next =
      inner.ephemeralMessage?.message ??
      inner.viewOnceMessage?.message ??
      inner.viewOnceMessageV2?.message ??
      inner.viewOnceMessageV2Extension?.message ??
      inner.documentWithCaptionMessage?.message ??
      inner.editedMessage?.message ??
      inner.protocolMessage?.editedMessage ??
      null
    if (!next) break
    inner = next
  }
  return inner
}

function wasEdited(message: proto.IMessage | null | undefined): boolean {
  let inner = message ?? undefined
  for (let depth = 0; inner && depth < 6; depth++) {
    if (inner.editedMessage?.message) return true
    inner = inner.ephemeralMessage?.message ?? inner.viewOnceMessageV2?.message ?? undefined
  }
  return false
}

type MediaField =
  | proto.Message.IImageMessage
  | proto.Message.IVideoMessage
  | proto.Message.IAudioMessage
  | proto.Message.IDocumentMessage
  | proto.Message.IStickerMessage

export interface Media {
  kind: MediaKind
  attachment: AttachmentKind
  field: MediaField
  name: string
}

const EXTENSION: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'audio/ogg': 'ogg',
  'audio/ogg; codecs=opus': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'application/pdf': 'pdf',
}

function nameOf(prefix: string, type: string | null | undefined): string {
  const extension = EXTENSION[type ?? ''] ?? type?.split('/')[1]?.split(';')[0] ?? 'bin'
  return `${prefix}.${extension}`
}

export function mediaOf(content: proto.IMessage | undefined): Media | null {
  if (!content) return null
  if (content.imageMessage)
    return {
      kind: 'image',
      attachment: 'image',
      field: content.imageMessage,
      name: nameOf('photo', content.imageMessage.mimetype),
    }
  if (content.videoMessage)
    return {
      kind: 'video',
      attachment: content.videoMessage.gifPlayback ? 'gif' : 'video',
      field: content.videoMessage,
      name: nameOf('video', content.videoMessage.mimetype),
    }
  if (content.audioMessage)
    return {
      kind: 'audio',
      attachment: content.audioMessage.ptt ? 'voice' : 'audio',
      field: content.audioMessage,
      name: nameOf(content.audioMessage.ptt ? 'voice' : 'audio', content.audioMessage.mimetype),
    }
  if (content.stickerMessage)
    return {
      kind: 'sticker',
      attachment: 'sticker',
      field: content.stickerMessage,
      name: nameOf('sticker', content.stickerMessage.mimetype),
    }
  if (content.documentMessage)
    return {
      kind: 'document',
      attachment: 'file',
      field: content.documentMessage,
      name: firstOf(
        content.documentMessage.fileName,
        content.documentMessage.title,
        nameOf('file', content.documentMessage.mimetype),
      ),
    }
  return null
}

function base64(bytes: Uint8Array): string {
  let text = ''
  for (const one of bytes) text += String.fromCharCode(one)
  return btoa(text)
}

function attachmentOf(media: Media): AttachmentRef {
  const field = media.field as MediaField & {
    width?: number | null
    height?: number | null
    seconds?: number | null
    waveform?: Uint8Array | null
    jpegThumbnail?: Uint8Array | null
    pngThumbnail?: Uint8Array | null
  }
  const ref: AttachmentRef = {
    ref: MEDIA_REF,
    name: media.name,
    type: field.mimetype?.split(';')[0] ?? 'application/octet-stream',
    size: secondsOf(field.fileLength),
    kind: media.attachment,
  }
  if (field.width) ref.width = field.width
  if (field.height) ref.height = field.height
  if (field.seconds) ref.seconds = field.seconds
  if (field.waveform?.length) ref.wave = [...field.waveform].map((one) => one / 100)
  const thumb = field.jpegThumbnail ?? null
  if (thumb?.length) ref.preview = `data:image/jpeg;base64,${base64(thumb)}`
  return ref
}

export function contextInfoOf(content: proto.IMessage | undefined): proto.IContextInfo | undefined {
  if (!content) return undefined
  for (const value of Object.values(content)) {
    if (typeof value === 'object' && value !== null && 'contextInfo' in value) {
      const info = (value as { contextInfo?: proto.IContextInfo | null }).contextInfo
      if (info) return info
    }
  }
  return undefined
}

function pollQuestionOf(
  content: proto.IMessage | undefined,
): proto.Message.IPollCreationMessage | undefined {
  const all = [
    content?.pollCreationMessage,
    content?.pollCreationMessageV2,
    content?.pollCreationMessageV3,
  ] as (proto.Message.IPollCreationMessage | null | undefined)[]
  return all.find((one) => !!one) ?? undefined
}

export function isPoll(content: proto.IMessage | undefined): boolean {
  return !!pollQuestionOf(content)
}

export function pollOf(content: proto.IMessage | undefined) {
  const poll = pollQuestionOf(content)
  if (!poll) return null
  return {
    question: poll.name ?? '',
    answers: (poll.options ?? []).map((one) => one.optionName ?? ''),
    several: (poll.selectableOptionsCount ?? 0) !== 1,
  }
}

function textOf(content: proto.IMessage | undefined): string {
  if (!content) return ''
  if (content.conversation) return content.conversation
  if (content.extendedTextMessage?.text) return content.extendedTextMessage.text
  const media = mediaOf(content)
  if (media) {
    const caption = (media.field as { caption?: string | null }).caption
    return caption ?? ''
  }
  if (content.locationMessage || content.liveLocationMessage) {
    const place = content.locationMessage ?? content.liveLocationMessage
    const lat = place?.degreesLatitude ?? 0
    const lng = place?.degreesLongitude ?? 0
    const label = content.locationMessage?.name ?? content.locationMessage?.address ?? ''
    return `📍 ${label ? `${label} ` : ''}https://maps.google.com/?q=${lat},${lng}`
  }
  if (content.contactMessage) return `👤 ${content.contactMessage.displayName ?? ''}`
  if (content.contactsArrayMessage)
    return (content.contactsArrayMessage.contacts ?? [])
      .map((one) => `👤 ${one.displayName ?? ''}`)
      .join('\n')
  if (content.eventMessage) return `📅 ${content.eventMessage.name ?? ''}`
  if (content.buttonsMessage?.contentText) return content.buttonsMessage.contentText
  if (content.templateMessage?.hydratedTemplate?.hydratedContentText)
    return content.templateMessage.hydratedTemplate.hydratedContentText
  if (content.listMessage?.description) return content.listMessage.description
  if (content.interactiveMessage?.body?.text) return content.interactiveMessage.body.text
  if (content.buttonsResponseMessage?.selectedDisplayText)
    return content.buttonsResponseMessage.selectedDisplayText
  if (content.listResponseMessage?.title) return content.listResponseMessage.title
  return ''
}

function isQuiet(message: WAMessage): boolean {
  const content = contentOf(message.message)
  if (!content) return false
  const alone = Object.keys(content).length === 1
  return [
    content.reactionMessage,
    content.pollUpdateMessage,
    content.encReactionMessage,
    content.pinInChatMessage,
    content.keepInChatMessage,
    content.protocolMessage,
    alone ? content.senderKeyDistributionMessage : null,
    alone ? content.messageContextInfo : null,
  ].some((one) => !!one)
}

const STUBS: Readonly<Record<number, string>> = {
  20: 'created the group',
  21: 'changed the group name',
  22: 'changed the group picture',
  24: 'changed the group description',
  26: 'changed who can send messages',
  27: 'added',
  28: 'removed',
  29: 'made admin',
  30: 'is no longer admin',
  31: 'joined by invite',
  32: 'left',
  40: 'Missed voice call',
  41: 'Missed video call',
}

function mentioned(text: string, jids: readonly string[], ctx: Context): string {
  let out = text
  for (const jid of jids) {
    const user = jid.split('@')[0]?.split(':')[0]
    if (!user) continue
    out = out.replaceAll(`@${user}`, `@${ctx.person(jid).name}`)
  }
  return out
}

function authorOf(message: WAMessage, ctx: Context): Person {
  if (message.key.fromMe) return ctx.self
  const jid = firstOf(message.key.participant, message.participant, message.key.remoteJid)
  return ctx.person(jid, message.pushName)
}

export const WAITING = 'Waiting for this message. This may take a while.'

const DELIVERY: readonly Delivery[] = ['failed', 'sending', 'sent', 'delivered', 'read', 'read']

export function messageOf(message: WAMessage, ctx: Context): ProviderMessage | null {
  const id = message.key.id
  const conversation = message.key.remoteJid
  if (!id || !conversation || isQuiet(message)) return null
  const author = authorOf(message, ctx)
  const at = atOf(message)
  const base: ProviderMessage = {
    id,
    conversation,
    author,
    at,
    text: '',
    attachments: [],
    mine: !!message.key.fromMe,
  }
  const stub: number = message.messageStubType ?? 0
  if (stub === 1) return { ...base, deleted: true }
  if (!message.message) {
    if (stub === 2) return { ...base, text: WAITING, system: true }
    const saying = STUBS[stub]
    if (!saying) return null
    const names = (message.messageStubParameters ?? [])
      .filter((one: string) => one.includes('@'))
      .map((one: string) => ctx.person(one).name)
    return {
      ...base,
      system: true,
      text: stub >= 40 ? saying : [author.name, saying, ...names].join(' '),
    }
  }
  const content = contentOf(message.message)
  const info = contextInfoOf(content)
  const mentions = [...(info?.mentionedJid ?? [])]
  const out: ProviderMessage = {
    ...base,
    text: mentioned(markdownOf(textOf(content)), mentions, ctx),
  }
  const media = mediaOf(content)
  if (media) out.attachments = [attachmentOf(media)]
  if (info?.stanzaId) out.replyTo = info.stanzaId
  if (mentions.length) out.mentions = mentions
  if (info?.isForwarded) out.forwarded = true
  if (info?.expiration) out.expiresAt = at + info.expiration * 1000
  if (wasEdited(message.message)) out.editedAt = at
  if (message.key.fromMe) {
    const delivery = DELIVERY[message.status ?? 2]
    if (delivery) out.delivery = delivery
  }
  const ext = content?.extendedTextMessage
  if (ext?.matchedText && ext.title) {
    const preview: LinkPreview = { url: ext.matchedText, title: ext.title }
    if (ext.description) preview.text = ext.description
    if (ext.jpegThumbnail?.length)
      preview.picture = `data:image/jpeg;base64,${base64(ext.jpegThumbnail)}`
    out.preview = preview
  }
  const poll = isPoll(content) ? ctx.poll(message) : undefined
  if (poll) {
    out.poll = poll
    out.text = ''
  }
  if (ctx.pinned(message)) out.pinned = true
  const reactions = ctx.reactions(message)
  if (reactions && Object.keys(reactions).length) out.reactions = reactions
  return out
}
