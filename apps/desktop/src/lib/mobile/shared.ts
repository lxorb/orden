import { escapeText, plainWords } from '@orden/markdown/escapes'
import { plainTaskWords, taskWords } from '@orden/markdown/task-line'
import { asWords, OPENS_MARKUP } from '@orden/markdown/words'

import { dayOf, noteText } from '../import/meta'
import { safeName, titleFrom } from '../import/names'
import { isPicturePath } from '../platform/src/api'
import type { ImportPlan, Planned } from '../import/plan'

export interface SharedItem {
  name: string
  mime: string
  size: number
  text: string | null
}

export interface Arrived {
  action: string
  subject: string
  items: SharedItem[]
}

const NOTES = /\.(md|markdown|mdown|mkd|txt|text)$/i

const ADDRESS = /https?:\/\/[^\s<>"')]+/

export function arrivedFrom(json: string): Arrived | null {
  if (!json) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) return null
  const held = parsed as Record<string, unknown>
  const listed = Array.isArray(held.items) ? held.items : []

  const items: SharedItem[] = []
  for (const one of listed) {
    if (typeof one !== 'object' || one === null) continue
    const item = one as Record<string, unknown>
    const text = typeof item.text === 'string' ? item.text : null
    const size = typeof item.size === 'number' && Number.isFinite(item.size) ? item.size : 0
    if (text === null && size <= 0) continue

    items.push({
      name: typeof item.name === 'string' ? item.name : '',
      mime: typeof item.mime === 'string' ? item.mime : '',
      size,
      text,
    })
  }

  if (!items.length) return null

  return {
    action: typeof held.action === 'string' ? held.action : '',
    subject: typeof held.subject === 'string' ? held.subject : '',
    items,
  }
}

export function isPicture(item: SharedItem): boolean {
  if (item.text !== null) return false
  return item.mime.startsWith('image/') || isPicturePath(item.name)
}

function isPaper(item: SharedItem): boolean {
  if (item.text !== null) return false
  return item.mime === 'application/pdf' || /\.pdf$/i.test(item.name)
}

export function isNote(item: SharedItem): boolean {
  if (item.text !== null) return false
  return item.mime.includes('markdown') || NOTES.test(item.name)
}

export function sharedWords(arrived: Arrived): string {
  return arrived.items
    .map((one) => one.text)
    .filter((one): one is string => one !== null)
    .join('\n\n')
    .trim()
}

function saysMarkdown(item: SharedItem): boolean {
  return item.mime.includes('markdown') || /\.(md|markdown|mdown|mkd)$/i.test(item.name)
}

export function sharedMarkdown(arrived: Arrived): string {
  return arrived.items
    .flatMap((one) =>
      one.text === null ? [] : [saysMarkdown(one) ? one.text : plainWords(one.text)],
    )
    .join('\n\n')
    .trim()
}

export function sharedTitle(arrived: Arrived): string {
  const subject = arrived.subject.trim()
  if (subject) return safeName(subject)

  const words = sharedWords(arrived)
  const address = ADDRESS.exec(words)?.[0]
  if (words && words !== address) {
    const found = titleFrom(words)
    if (found) return found
  }

  const first = arrived.items.find((one) => one.text === null)
  if (first?.name) return safeName(first.name.replace(/\.[^.]+$/, ''))
  if (address) return safeName(hostOf(address))

  return 'Shared'
}

export function sharedTask(arrived: Arrived): string {
  const words = sharedWords(arrived)
  const address = ADDRESS.exec(words)?.[0]
  const title = sharedTitle(arrived).replace(/[[\]]/g, '').replace(/\s+/g, ' ').trim()
  return address
    ? `[${taskWords(escapeText(title, { addresses: false }))}](${address})`
    : plainTaskWords(title)
}

function hostOf(address: string): string {
  const found = /^https?:\/\/([^/?#]+)/.exec(address)
  return found?.[1]?.replace(/^www\./, '') ?? 'Shared'
}

export function embedFor(item: SharedItem, src: string): string {
  const at = encodeURI(src)
  if (isPicture(item)) return `![](${at})`

  return `[${asWords(item.name.replace(LITERAL, (one) => `\\${one}`))}](${at})`
}

const LITERAL = new RegExp(`\\\\(?!\\\\*${OPENS_MARKUP.source})|[[\\]]`, 'g')

export function sharedPlan(
  arrived: Arrived,
  bytes: ReadonlyMap<number, Uint8Array>,
  on: Date,
  folder: string,
): ImportPlan {
  const words = sharedWords(arrived)
  const address = ADDRESS.exec(words)?.[0] ?? null

  const [only] = arrived.items
  const paper = bytes.get(0)
  if (arrived.items.length === 1 && only && isPaper(only) && paper?.length && !words) {
    const name = safeName(only.name.replace(/\.pdf$/i, '')) || 'Shared'
    return {
      format: 'pdf-pages',
      files: [{ kind: 'file', path: `${name}.pdf`, bytes: paper, pages: true }],
      lost: [],
    }
  }

  const about: Planned[] = []
  const embeds: string[] = []
  const notes: Planned[] = []
  const beside: Planned[] = []
  const under = folder.replace(/^\/+|\/+$/g, '')

  arrived.items.forEach((item, at) => {
    const held = bytes.get(at)
    if (item.text !== null || !held?.length) return

    if (isNote(item)) {
      const name = `${safeName(item.name.replace(/\.[^.]+$/, ''))}.md`
      notes.push({ kind: 'note', path: name, text: new TextDecoder().decode(held) })
      return
    }

    const name = safeName(item.name) || 'shared'
    const path = under ? `${under}/${name}` : name
    beside.push({ kind: 'file', path, bytes: held })
    embeds.push(embedFor(item, path))
  })

  const body = [sharedMarkdown(arrived), ...embeds].filter(Boolean).join('\n\n')
  if (body) {
    const title = sharedTitle(arrived)
    about.push({
      kind: 'note',
      path: `${title}.md`,
      text: noteText(title, body, {
        date: dayOf(on.getTime()),
        ...(address ? { extra: [['source', address]] as const } : {}),
      }),
    })
  }

  return { format: 'markdown', files: [...about, ...notes, ...beside], lost: [] }
}
