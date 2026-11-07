const CODE = /(```[\s\S]*?```|`[^`\n]+`)/

const BROADCASTS: Readonly<Record<string, string>> = {
  here: 'here',
  channel: 'channel',
  everyone: 'everyone',
}

export interface Read {
  text: string
  mentions: string[]
  everyone: boolean
}

export type NameOf = (id: string) => string | undefined

const unescaped = (text: string) =>
  text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

const escaped = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function outsideCode(text: string, change: (part: string) => string): string {
  return text
    .split(CODE)
    .map((part, index) => (index % 2 === 1 ? part : change(part)))
    .join('')
}

const EDGE_BEFORE = `(^|[\\s(\\[{"'>])`
const EDGE_AFTER = `(?=$|[\\s.,!?;:)\\]}"'<])`

function wrapped(text: string, mark: string, open: string, close: string): string {
  const quoted = mark.replace(/[*~_]/g, '\\$&')
  return text.replace(
    new RegExp(
      `${EDGE_BEFORE}${quoted}([^\\s${quoted}](?:[^\\n]*?[^\\s])?)${quoted}${EDGE_AFTER}`,
      'g',
    ),
    (_, before: string, inner: string) => `${before}${open}${inner}${close}`,
  )
}

export function markdownOf(mrkdwn: string, nameOf: NameOf): Read {
  const mentions: string[] = []
  let everyone = false
  const linked = (inner: string): string => {
    const [target = '', label] = inner.split('|', 2)
    if (target.startsWith('@')) {
      const id = target.slice(1)
      if (!mentions.includes(id)) mentions.push(id)
      return `@${nameOf(id) ?? label ?? id}`
    }
    if (target.startsWith('#')) return `#${label ?? nameOf(target.slice(1)) ?? target.slice(1)}`
    if (target.startsWith('!')) {
      const word = target.slice(1).split('^')[0] ?? ''
      if (BROADCASTS[word]) {
        everyone = true
        return `@${word}`
      }
      return label ?? `@${word}`
    }
    const url = unescaped(target)
    if (target.startsWith('mailto:')) return unescaped(label ?? target.slice(7))
    return label && label !== url ? `[${unescaped(label)}](${url})` : url
  }
  const text = outsideCode(mrkdwn, (part) => {
    let out = part.replace(/<([^<>\n]+)>/g, (_, inner: string) => `\uE000${linked(inner)}\uE001`)
    out = wrapped(out, '*', '**', '**')
    out = wrapped(out, '~', '~~', '~~')
    return out
  })
  const finished = text
    .split(CODE)
    .map((part, index) => {
      if (index % 2 === 0) return part
      if (part.startsWith('```') && !part.startsWith('```\n'))
        return '```\n' + part.slice(3, -3).replace(/\n?$/, '\n') + '```'
      return part
    })
    .join('')
  const plain = finished.replace(/\uE000([^\uE001]*)\uE001|([^\uE000]+)/g, (_, kept, rest) =>
    typeof kept === 'string' ? kept : unescaped(rest as string),
  )
  return { text: plain, mentions, everyone }
}

export interface Mentioned {
  id: string
  name: string
  handle?: string
}

export function mrkdwnOf(markdown: string, people: readonly Mentioned[] = []): string {
  const names = [...people].sort((a, b) => b.name.length - a.name.length)
  const changed = markdown
    .split(CODE)
    .map((part, index) => {
      if (index % 2 === 1) {
        const plain = part.startsWith('```')
          ? '```' + part.slice(3, -3).replace(/^[\w+-]*\n/, '') + '```'
          : part
        return escaped(plain)
      }
      let out = escaped(part)
      out = out.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, '\uE000$2|$1\uE001')
      out = out.replace(/^#{1,6}\s+(.+)$/gm, '\uE002$1\uE002')
      out = out.replace(/(\*\*|__)(?=\S)([^\n]*?\S)\1/g, '\uE002$2\uE002')
      out = wrapped(out, '*', '_', '_')
      out = out.replace(/~~(?=\S)([^\n]*?\S)~~/g, '~$1~')
      out = out.replace(/\uE002/g, '*')
      for (const person of names) {
        for (const label of [person.handle, person.name]) {
          if (!label) continue
          out = out.replace(
            new RegExp(
              `(^|[^\\p{L}\\p{N}_@])@${escaped(label).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_])`,
              'gu',
            ),
            (_, before: string) => `${before}\uE000@${person.id}\uE001`,
          )
        }
      }
      out = out.replace(
        /(^|[^\p{L}\p{N}_@])@(here|channel|everyone)(?![\p{L}\p{N}_])/gu,
        (_, before: string, word: string) => `${before}\uE000!${word}\uE001`,
      )
      return out.replace(/\uE000/g, '<').replace(/\uE001/g, '>')
    })
    .join('')
  return changed
}
