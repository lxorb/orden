import type { LinkWrite } from '@orden/editor'
import { formatLink, type LinkFormat, type LinkTarget, linkWriting } from './link-format'
import { nameFromContent } from './platform/src/api'

const SEAM = '\n\n---\n\n'

export function merged(into: string, from: string): string {
  const head = into.replace(/\s+$/, '')
  const tail = from.replace(/^\s+/, '').replace(/\s+$/, '')

  if (!head) return tail
  if (!tail) return head
  return `${head}${SEAM}${tail}\n`
}

export function linkTo(
  name: string,
  shown?: string | null,
  about: Omit<LinkTarget, 'name' | 'shown'> = {},
  format: LinkFormat = linkWriting(),
): string {
  return formatLink({ ...about, name, ...(shown ? { shown } : {}) }, format)
}

export function pickedLink(target: LinkWrite): string {
  return linkTo(target.name, null, {
    path: target.path ?? null,
    from: target.from ?? null,
    fragment: target.fragment ?? null,
  })
}

export interface Split {
  kept: string
  taken: string
  name: string
}

export function splitAt(text: string, at: number, fallback: string, named?: string): Split | null {
  const start = lineStart(text, Math.max(0, Math.min(at, text.length)))
  const taken = text.slice(start).trim()
  if (!taken) return null

  const name = named ?? nameFromContent(taken) ?? fallback
  const kept = `${text.slice(0, start).replace(/\s+$/, '')}\n\n${linkTo(name)}\n`

  return { kept, taken: `${taken}\n`, name }
}

export function extracted(
  text: string,
  from: number,
  to: number,
  fallback: string,
  named?: string,
): Split | null {
  const taken = text.slice(from, to).trim()
  if (!taken) return null

  const name = named ?? nameFromContent(taken) ?? fallback
  const shown = oneLine(taken)
  const alias = shown.replace(SENTENCE_END, '') === name ? '' : shown
  const kept = text.slice(0, from) + linkTo(name, alias) + text.slice(to)

  return { kept, taken: `${taken}\n`, name }
}

const SENTENCE_END = /[.!?。！？]+$/u

function oneLine(text: string): string {
  const first = text.split('\n')[0] ?? ''
  const words = first.replace(/^\s*>?\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)?/, '').trim()
  return words.length > 0 && words.length <= 60 ? words : ''
}

function lineStart(text: string, at: number): number {
  return text.lastIndexOf('\n', Math.max(0, at - 1)) + 1
}
