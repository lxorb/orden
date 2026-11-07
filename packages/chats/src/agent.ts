import type { Message, Who } from './types'

const TAG = 'untrusted'

export function untrusted(source: string, words: string): string {
  return `<${TAG} source="${attribute(source)}">\n${inert(words)}\n</${TAG}>`
}

function inert(words: string): string {
  return words.replace(/<(?=\s*\/?\s*untrusted)/gi, '&lt;')
}

function attribute(source: string): string {
  return Array.from(source)
    .slice(0, 300)
    .map((one) => {
      if (one === '&') return '&amp;'
      if (one === '"') return '&quot;'
      if (one === '<') return '&lt;'
      if (one === '>') return '&gt;'
      return /\p{Cc}/u.test(one) ? ' ' : one
    })
    .join('')
}

export function momentOf(at: number): string {
  return `${new Date(at).toISOString().slice(0, 16)}Z`
}

export interface Reading {
  me: Who | null
  nameOf: (who: Who) => string
}

export interface Listed {
  id: string
  name: string
  space: string
  members: number
  unread: number | 'some'
  mentions: number
  lastAt: number | null
}

export function chatsText(chats: readonly Listed[]): string {
  if (!chats.length) return 'No chats.'
  return chats
    .map((one) =>
      [
        `#${one.name}`,
        one.id,
        one.space,
        `${String(one.members)} people`,
        ...(one.unread === 'some'
          ? ['unread']
          : one.unread
            ? [`${String(one.unread)} unread`]
            : []),
        ...(one.mentions ? [`${String(one.mentions)} mentions`] : []),
        ...(one.lastAt ? [`last ${momentOf(one.lastAt)}`] : []),
      ].join(' · '),
    )
    .join('\n')
}

function messageText(chat: string, message: Message, reading: Reading): string {
  const mine = message.author === reading.me
  const name = reading.nameOf(message.author)
  const reactions = Object.entries(message.reactions)
    .filter(([, who]) => who.length)
    .map(([emoji, who]) => `${emoji} ${String(who.length)}`)
  const head = [
    message.id,
    momentOf(message.at),
    mine ? `${name} (you)` : name,
    ...(message.via ? [`via ${message.via.agent}`] : []),
    ...(message.parent ? [`reply to ${message.parent}`] : []),
    ...(message.quote ? [`quoting ${message.quote}`] : []),
    ...(message.replies ? [`${String(message.replies)} replies`] : []),
    ...(message.pinned ? ['pinned'] : []),
    ...(message.editedAt ? ['edited'] : []),
    ...reactions,
    ...(message.deleted ? ['deleted'] : []),
  ].join(' · ')
  if (message.deleted) return `- ${head}`

  const words = [
    message.body,
    ...(message.files.length
      ? [`[files: ${message.files.map((one) => one.name).join(', ')}]`]
      : []),
    ...(message.poll
      ? [`[poll: ${message.poll.question} | ${message.poll.answers.join(' | ')}]`]
      : []),
    ...(message.preview ? [`[link: ${message.preview.title} ${message.preview.url}]`] : []),
  ]
    .filter(Boolean)
    .join('\n')
  if (mine) return `- ${head}\n${words}`
  return `- ${head}\n${untrusted(`chat:${chat} from:${name}`, words)}`
}

export function messagesText(chat: string, messages: readonly Message[], reading: Reading): string {
  if (!messages.length) return `#${chat} has no messages here.`
  return [`#${chat}`, ...messages.map((one) => messageText(chat, one, reading))].join('\n')
}

export function hitsText(
  hits: readonly { chat: string; message: Message }[],
  reading: Reading,
): string {
  if (!hits.length) return 'Nothing found.'
  return hits
    .map((one) => `- #${one.chat} · ${messageText(one.chat, one.message, reading).slice(2)}`)
    .join('\n')
}
