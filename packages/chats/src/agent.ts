import type { Message, Who } from './types'

const TAG = 'untrusted'

export function untrusted(source: string, words: string): string {
  return `<${TAG} source="${attribute(source)}">\n${inert(words)}\n</${TAG}>`
}

const HIDDEN = /^[\p{Cf}\u034F\uFE00-\uFE0F\u{E0100}-\u{E01EF}]$/u

const LATIN: Record<string, string> = {
  '\u0430': 'a',
  '\u03b1': 'a',
  '\u0441': 'c',
  '\u03f2': 'c',
  '\u0501': 'd',
  '\u0435': 'e',
  '\u0450': 'e',
  '\u04bb': 'h',
  '\u0456': 'i',
  '\u03b9': 'i',
  '\u0131': 'i',
  '\u04cf': 'l',
  '\u0458': 'j',
  '\u03f3': 'j',
  '\u03ba': 'k',
  '\u043e': 'o',
  '\u03bf': 'o',
  '\u0440': 'p',
  '\u03c1': 'p',
  '\u051b': 'q',
  '\u0455': 's',
  '\u03c5': 'u',
  '\u03bd': 'v',
  '\u0475': 'v',
  '\u051d': 'w',
  '\u0445': 'x',
  '\u03c7': 'x',
  '\u0443': 'y',
}

const LOOKED_AT = 64

function seenAfter(words: string, from: number): string {
  let out = ''
  let kept = 0
  for (let at = from; at < words.length && kept < LOOKED_AT;) {
    const one = String.fromCodePoint(words.codePointAt(at) ?? 0)
    at += one.length
    if (HIDDEN.test(one)) continue
    out += one
    kept++
  }
  return Array.from(out.normalize('NFKC').toLowerCase(), (one) => LATIN[one] ?? one).join('')
}

function inert(words: string): string {
  return words.replace(/[<\uFF1C\uFE64]/g, (one, at: number) =>
    /^\s*[/\u2215\u2044]?\s*untrusted/.test(seenAfter(words, at + 1)) ? '&lt;' : one,
  )
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
