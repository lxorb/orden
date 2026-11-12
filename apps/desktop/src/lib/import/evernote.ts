import { fromBase64 } from '../bytes'
import { htmlToMarkdown } from '@orden/markdown/from-html'

import { dayOf, noteText, type Meta } from './meta'
import { md5 } from './md5'
import { Names, safeName, titleFrom } from './names'
import type { ImportPlan, Planned } from './plan'
import { encodeTarget } from './rewrite'
import type { Source } from './sources'
import { closingOf, element, elements, plainText, textOf, textsOf } from './xml'

const ASSETS = 'assets'

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'video/mp4': 'mp4',
  'text/plain': 'txt',
}

interface Attachment {
  path: string
  mime: string
}

export async function readEvernote(sources: readonly Source[]): Promise<ImportPlan> {
  const files = sources.filter((one) => /\.enex$/i.test(one.path))
  const names = new Names()
  const written: Planned[] = []
  const lost: string[] = []
  let encrypted = 0
  let reminders = 0
  let missing = 0

  const stored = new Map<string, string>()

  const perNotebook = files.length > 1

  for (const source of files) {
    const xml = await source.text()
    const notebook = perNotebook
      ? safeName((source.path.split('/').pop() ?? '').replace(/\.enex$/i, ''))
      : ''

    for (const note of elements(xml, 'note')) {
      const content = textOf(note.inner, 'content') ?? ''
      const attachments = new Map<string, Attachment>()
      let unreadable = 0

      for (const resource of elements(note.inner, 'resource')) {
        const bytes = bytesOf(element(resource.inner, 'data')?.inner ?? '')
        if (!bytes?.length) {
          unreadable += 1
          continue
        }

        const mime = (textOf(resource.inner, 'mime') ?? '').trim().toLowerCase()
        const hash = md5(bytes)
        let path = stored.get(hash)
        if (!path) {
          const said = textOf(resource.inner, 'file-name')
          path = names.free(`${ASSETS}/${fileName(said, mime, hash)}`)
          stored.set(hash, path)
          written.push({ kind: 'file', path, bytes })
        }

        attachments.set(hash, { path, mime })
      }

      const enml = withoutEvernote(content, attachments, !!notebook)
      encrypted += enml.encrypted

      missing += Math.max(unreadable, enml.missing)

      const attributes = element(note.inner, 'note-attributes')?.inner ?? ''
      if (hadReminder(attributes)) reminders += 1

      const words = htmlToMarkdown(enml.html, {
        fileTargets: true,
        appTargets: true,
        mediaLinks: true,
        plainTasks: true,
      })
      const said = textOf(note.inner, 'title')?.trim()
      const title = (said ? safeName(said) : titleFrom(words)) ?? 'Untitled'
      const path = names.free(`${notebook ? `${notebook}/` : ''}${title}.md`)

      const meta: Meta = { tags: textsOf(note.inner, 'tag') }
      const made = dayOf(textOf(note.inner, 'created')?.trim())
      const changed = dayOf(textOf(note.inner, 'updated')?.trim())
      if (made) meta.date = made
      if (changed) meta.updated = changed

      const extra: [string, string][] = []
      const origin = textOf(attributes, 'source-url')?.trim()
      if (origin) extra.push(['source', origin])
      const author = textOf(attributes, 'author')?.trim()
      if (author) extra.push(['author', author])
      if (extra.length) meta.extra = extra

      written.push({ kind: 'note', path, text: noteText(title, words, meta) })
    }
  }

  if (encrypted) {
    lost.push(`${encrypted} passages are encrypted, and nothing can read them without Evernote`)
  }

  if (reminders) {
    lost.push(`${reminders} notes had a reminder, which the export does not carry`)
  }

  if (missing) {
    lost.push(
      missing === 1
        ? '1 attachment was missing from the export or could not be read'
        : `${missing} attachments were missing from the export or could not be read`,
    )
  }

  return { format: 'evernote', files: written, lost }
}

function bytesOf(inner: string): Uint8Array | null {
  try {
    return fromBase64(plainText(inner))
  } catch {
    return null
  }
}

function hadReminder(attributes: string): boolean {
  if (textOf(attributes, 'reminder-time')?.trim()) return true
  const order = textOf(attributes, 'reminder-order')?.trim() ?? ''
  return order !== '' && !/^0+$/.test(order)
}

function fileName(said: string | null, mime: string, hash: string): string {
  const whole = said?.trim() ?? ''
  const own = /^(?:[A-Za-z]:)?[\\/]/.test(whole) ? (whole.split(/[\\/]/).pop() ?? '') : whole
  const named = own ? safeName(own) : ''
  if (named && /\.[A-Za-z0-9]{1,5}$/.test(named)) return named

  const extension = EXTENSIONS[mime] ?? mime.split('/')[1]?.replace(/[^a-z0-9]/g, '') ?? 'bin'
  return named ? `${named}.${extension}` : `${hash.slice(0, 16)}.${extension}`
}

const VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i

const CHECKED = /checked\s*=\s*["']?true/i

function box(checked: boolean): string {
  return `<input type="checkbox"${checked ? ' checked' : ''}>`
}

function withoutEvernote(
  enml: string,
  attachments: ReadonlyMap<string, Attachment>,
  inFolder: boolean,
): { html: string; encrypted: number; missing: number } {
  let encrypted = 0
  let missing = 0

  let html = enml.replace(
    /<([A-Za-z][\w:.-]*)(\s[^<>]*?)?\s*\/>/g,
    (whole, name: string, said: string | undefined) =>
      VOID.test(name) || /^en-/i.test(name) ? whole : `<${name}${said ?? ''}></${name}>`,
  )

  html = codeBlocks(html)
  html = nestedLists(html)

  html = html.replace(
    /<li(\s[^>]*)?>\s*<div\b[^>]*>((?:(?!<\/?div\b)[\s\S])*?)<\/div>/gi,
    (_whole, said: string | undefined, words: string) =>
      `<li${said ?? ''}>${words.replace(/(?:\s*<br\s*\/?>)+\s*$/i, '')}`,
  )

  html = html.replace(
    /<li\b([^>]*?--en-checked:\s*(true|false)[^>]*)>/gi,
    (_whole, said: string, checked: string) =>
      `<li${said}>${box(checked.toLowerCase() === 'true')}`,
  )

  html = html.replace(
    /<li(\s[^>]*)?>((?:\s*<(?:b|i|u|em|strong|span|font)\b[^>]*>)*)\s*<en-todo([^>]*?)\/?>(?:\s*<\/en-todo>)?/gi,
    (_whole, said: string | undefined, wrapped: string, todo: string) =>
      `<li${said ?? ''}>${box(CHECKED.test(todo))}${wrapped}`,
  )

  html = html
    .replace(
      /<div[^>]*>\s*<en-todo([^>]*?)\/?>(?:\s*<\/en-todo>)?\s*([\s\S]*?)<\/div>/gi,
      (_whole, said: string, rest: string) =>
        `<ul data-todo><li>${box(CHECKED.test(said))}${rest.replace(/(?:\s*<br\s*\/?>)+\s*$/i, '')}</li></ul>`,
    )
    .replace(/<\/ul>\s*<ul data-todo>/gi, '')

  html = html.replace(/<en-todo([^>]*?)\/?>(?:\s*<\/en-todo>)?/gi, (_whole, said: string) =>
    CHECKED.test(said) ? '[x] ' : '[ ] ',
  )

  html = html.replace(/<en-crypt[^>]*\/>|<en-crypt[\s\S]*?<\/en-crypt>/gi, () => {
    encrypted += 1
    return '…'
  })

  const folder = inFolder ? '../' : ''
  const shown = new Set<string>()

  const pointAt = (attachment: Attachment, type: string): string => {
    const address = `${folder}${encodeTarget(attachment.path)}`
    const name = attachment.path.split('/').pop() ?? attachment.path

    return type.startsWith('image/')
      ? `<img src="${address}" alt="">`
      : `<a href="${address}">${name}</a>`
  }

  html = html.replace(/<en-media([^>]*)\/?>(?:<\/en-media>)?/gi, (_whole, said: string) => {
    const hash = /\bhash\s*=\s*["']?([0-9a-f]+)/i.exec(said)?.[1]?.toLowerCase() ?? ''
    const attachment = attachments.get(hash)
    if (!attachment) {
      missing += 1
      return ''
    }

    shown.add(hash)
    const type = /\btype\s*=\s*["']([^"']+)/i.exec(said)?.[1]?.toLowerCase() ?? attachment.mime
    return pointAt(attachment, type)
  })

  const loose = [...attachments].filter(([hash]) => !shown.has(hash))
  for (const [, attachment] of loose) {
    html += `<div>${pointAt(attachment, attachment.mime)}</div>`
  }

  return { html, encrypted, missing }
}

function codeBlocks(html: string): string {
  const opens = /<div\b[^>]*-en-codeblock:\s*true[^>]*>/gi
  let out = ''
  let at = 0

  for (let found = opens.exec(html); found; found = opens.exec(html)) {
    if (found.index < at) continue

    const from = found.index + found[0].length
    const end = closingOf(html, 'div', from)
    const lines = html
      .slice(from, end)
      .replace(/<div\b[^>]*>\s*<br\s*\/?>\s*<\/div>/gi, '\uE000')
      .replace(/<br\s*\/?>\s*(?=<\/div>)/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/(?:<\/div>\s*)+/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/\uE000/g, '\n')
      .replace(/&nbsp;|&#160;|\u00A0/gi, ' ')
      .replace(/^\n+|\n+$/g, '')

    out += `${html.slice(at, found.index)}<pre><code>${lines}</code></pre>`
    at = html.startsWith('</div', end) ? html.indexOf('>', end) + 1 || html.length : end
    opens.lastIndex = at
  }

  return out + html.slice(at)
}

function nestedLists(html: string): string {
  const tags = /<(\/?)(ul|ol|li)\b[^>]*>/gi
  const list = /\s*<(?:ul|ol)\b/iy
  const listFollows = (at: number) => {
    list.lastIndex = at
    return list.test(html)
  }

  let out = ''
  let at = 0
  let depth = 0
  const held: number[] = []

  for (const found of html.matchAll(tags)) {
    const [whole, closing, name] = found
    out += html.slice(at, found.index)
    at = found.index + whole.length

    if (name?.toLowerCase() === 'li') {
      if (closing && listFollows(at)) held.push(depth)
      else out += whole
      continue
    }

    if (!closing) {
      depth += 1
      out += whole
      continue
    }

    depth -= 1
    out += whole
    while ((held.at(-1) ?? -1) > depth) held.pop()
    if (held.at(-1) === depth && !listFollows(at)) {
      held.pop()
      out += '</li>'
    }
  }

  return out + html.slice(at)
}
