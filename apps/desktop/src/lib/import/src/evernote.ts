import { fromBase64, MIME_TYPES } from '../../platform/src/api'
import { htmlToMarkdown } from '@orden/markdown/from-html'
import { taskLine } from '@orden/markdown/task-edits'
import { NO_PRIORITY, plainTaskWords, type Remind } from '@orden/markdown/task-line'
import { dayOf, noteText, wallClock, type Meta } from './meta'
import { md5 } from './md5'
import { Names, safeName, titleFrom } from './names'
import type { ImportPlan, Planned } from './plan'
import { encodeTarget } from '@orden/markdown/links'
import type { Source } from './sources'
import { closingOf, element, elements, plainText, textOf, textsOf } from './xml'

const ASSETS = 'assets'

const EXTENSIONS: Readonly<Record<string, string>> = {
  ...Object.fromEntries(
    Object.entries(MIME_TYPES)
      .reverse()
      .map(([extension, mime]) => [mime, extension]),
  ),
  'audio/x-m4a': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/amr': 'amr',
  'text/plain': 'txt',
  'text/html': 'html',
  'text/csv': 'csv',
  'application/rtf': 'rtf',
  'application/zip': 'zip',
  'application/msword': 'doc',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
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
    const notebook = perNotebook ? safeName((source.path.split('/').pop() ?? '').replace(/\.enex$/i, '')) : ''

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

      const groups = tasksOf(note.inner)
      const enml = withoutEvernote(content, attachments, !!notebook)
      const placed = withTaskGroups(enml.html, groups)
      encrypted += enml.encrypted

      missing += Math.max(unreadable, enml.missing)

      const attributes = element(note.inner, 'note-attributes')?.inner ?? ''
      if (hadReminder(attributes)) reminders += 1

      const words = withTasks(
        htmlToMarkdown(placed.html, {
          fileTargets: true,
          appTargets: true,
          mediaLinks: true,
          plainTasks: true,
        }),
        placed.order,
        groups,
      )
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
  if (named && /\.[A-Za-z0-9]*[A-Za-z][A-Za-z0-9]*$/.test(named)) return named

  const subtype = mime.split('/')[1]?.replace(/^x-/, '') ?? ''
  const extension = EXTENSIONS[mime] ?? (/^[a-z0-9]{1,8}$/.test(subtype) ? subtype : 'bin')
  return named ? `${named}.${extension}` : `${hash.slice(0, 16)}.${extension}`
}

interface EvernoteTask {
  line: string
  weight: string
}

const TASK_GROUP = /<div\b([^>]*--en-task-group:\s*true[^>]*?)\s*(?:\/>|>\s*<\/div>)/gi
const PLACE = '\uE001'

function tasksOf(note: string): Map<string, string[]> {
  const groups = new Map<string, EvernoteTask[]>()
  for (const task of elements(note, 'task')) {
    const group = textOf(task.inner, 'taskGroupNoteLevelID')?.trim() ?? ''
    const held = groups.get(group) ?? []
    held.push(taskOf(task.inner))
    groups.set(group, held)
  }

  return new Map(
    [...groups].map(([group, tasks]) => [
      group,
      tasks
        .map((task, at) => ({ task, at }))
        .sort((one, other) =>
          one.task.weight === other.task.weight ? one.at - other.at : one.task.weight < other.task.weight ? -1 : 1,
        )
        .map(({ task }) => task.line),
    ]),
  )
}

function taskOf(inner: string): EvernoteTask {
  const own = inner.replace(/<reminder\b[\s\S]*?<\/reminder>/gi, '')
  const zone = zoneIn(own)
  const done = textOf(own, 'taskStatus')?.trim().toLowerCase() === 'completed'
  const due = momentOf(textOf(own, 'dueDate'))
  const local = due ? (wallClock(due, zone) ?? wallClock(due)) : null
  const time = textOf(own, 'dueDateUIOption')?.trim() === 'date_time' ? local?.time : undefined
  const completed = done ? dayOf(textOf(own, 'statusUpdated')?.trim()) : null

  const remind: Remind[] = []
  for (const reminder of elements(inner, 'reminder')) {
    const at = momentOf(textOf(reminder.inner, 'reminderDate'))
    const shown = at ? wallClock(at, zoneIn(reminder.inner) ?? zone) : null
    if (shown) remind.push({ at: shown.day, time: shown.time })
  }

  const line = taskLine({
    text: plainTaskWords((textOf(own, 'title') ?? '').replace(/\s+/g, ' ').trim()),
    status: done ? 'x' : ' ',
    done,
    cancelled: false,
    remind,
    priority: NO_PRIORITY,
    tags: [],
    dependsOn: [],
    fields: {},
    ...(local ? { start: local.day } : {}),
    ...(time ? { time } : {}),
    ...(time && zone ? { zone } : {}),
    ...(completed ? { completed } : {}),
  })

  return { line, weight: textOf(own, 'sortWeight')?.trim() ?? '' }
}

function zoneIn(xml: string): string | undefined {
  const said = textOf(xml, 'timeZone')?.trim()
  return said === '' ? undefined : said
}

function momentOf(said: string | null): Date | null {
  const found = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(said?.trim() ?? '')
  if (!found) return null
  const [, year, month, day, hour, minute, second] = found
  const moment = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`)
  return Number.isNaN(moment.getTime()) ? null : moment
}

function withTaskGroups(
  html: string,
  groups: ReadonlyMap<string, readonly string[]>,
): { html: string; order: string[] } {
  const order: string[] = []
  const placed = html.replace(TASK_GROUP, (_whole, said: string) => {
    const group = /--en-id:\s*([^;"']+)/i.exec(said)?.[1]?.trim() ?? ''
    if (!groups.has(group) || order.includes(group)) return ''
    order.push(group)
    return `<div>${PLACE}${order.length - 1}${PLACE}</div>`
  })
  return { html: placed, order }
}

function withTasks(words: string, order: readonly string[], groups: ReadonlyMap<string, readonly string[]>): string {
  const shown = new Set<string>()
  const placed = words.replace(new RegExp(`${PLACE}(\\d+)${PLACE}`, 'g'), (_whole, at: string) => {
    const group = order[Number(at)] ?? ''
    shown.add(group)
    return (groups.get(group) ?? []).join('\n')
  })

  const rest = [...groups].filter(([group]) => !shown.has(group)).flatMap(([, lines]) => lines)
  if (!rest.length) return placed
  return `${placed.trimEnd()}${placed.trim() ? '\n\n' : ''}${rest.join('\n')}`
}

const VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i
const CHECKED = /checked\s*=\s*["']?true/i
const box = (checked: boolean): string => `<input type="checkbox"${checked ? ' checked' : ''}>`

function withoutEvernote(
  enml: string,
  attachments: ReadonlyMap<string, Attachment>,
  inFolder: boolean,
): { html: string; encrypted: number; missing: number } {
  let encrypted = 0
  let missing = 0

  let html = enml.replace(/<([A-Za-z][\w:.-]*)(\s[^<>]*?)?\s*\/>/g, (whole, name: string, said: string | undefined) =>
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
    (_whole, said: string, checked: string) => `<li${said}>${box(checked.toLowerCase() === 'true')}`,
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

    return type.startsWith('image/') ? `<img src="${address}" alt="">` : `<a href="${address}">${name}</a>`
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
