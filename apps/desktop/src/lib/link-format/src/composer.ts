import type { LinkWrite } from '@orden/editor'
import { formatLink, type LinkFormat, type LinkTarget, linkWriting } from './link-format'
import {
  frontMatterBlock,
  frontMatterEdit,
  frontMatterEntry,
  frontMatterKeys,
  frontMatterList,
  stripFrontMatter,
} from '@orden/markdown/front-matter'
import { isTabFile } from '@orden/markdown/links'
import { flowItem } from '@orden/markdown/yaml'
import { nameFromContent } from '../../platform/src/api'

const SEAM = '\n\n---\n\n'

const LISTED = new Set(['aliases', 'alias', 'tags', 'tag', 'cssclasses'])

function edited(text: string, edit: { from: number; to: number; insert: string } | null): string {
  return edit ? text.slice(0, edit.from) + edit.insert + text.slice(edit.to) : text
}

function lineEnded(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`
}

function withMatterOf(into: string, from: string): string {
  const block = frontMatterBlock(from)
  if (!block) return into
  if (!frontMatterBlock(into)) return `${lineEnded(from.slice(block.from, block.to))}${into}`

  let out = into
  for (const key of frontMatterKeys(from)) {
    const held = frontMatterKeys(out).find((one) => one.toLowerCase() === key.toLowerCase())
    if (held === undefined) {
      const said = frontMatterEntry(from, key)
      const close = frontMatterBlock(out)?.close ?? 0
      if (said) out = `${out.slice(0, close)}${lineEnded(said)}${out.slice(close)}`
      continue
    }
    if (!LISTED.has(key.toLowerCase())) continue
    const ours = frontMatterList(out, held)
    const both = [...new Set([...ours, ...frontMatterList(from, key)])]
    if (both.length === ours.length) continue
    out = edited(out, frontMatterEdit(out, held, null))
    out = edited(out, frontMatterEdit(out, held, `[${both.map(flowItem).join(', ')}]`))
  }
  return out
}

export function merged(into: string, from: string): string {
  const head = withMatterOf(into, from).replace(/\s+$/, '')
  const tail = stripFrontMatter(from).replace(/^\s+/, '').replace(/\s+$/, '')

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
    markdown: target.markdown ?? null,
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
  const kept = `${text.slice(0, start).replace(/\s+$/, '')}\n\n${linkTo(noteNamed(name))}\n`

  return { kept, taken: `${taken}\n`, name }
}

export function extracted(
  text: string,
  from: number,
  to: number,
  fallback: string,
  named?: string,
): Split | null {
  const chosen = text.slice(from, to)
  const taken = chosen.trim()
  if (!taken) return null

  const start = from + chosen.length - chosen.trimStart().length
  const end = to - (chosen.length - chosen.trimEnd().length)
  const name = named ?? nameFromContent(taken) ?? fallback
  const shown = oneLine(taken)
  const alias = shown.replace(SENTENCE_END, '') === name ? '' : shown
  const kept = text.slice(0, start) + linkTo(noteNamed(name), alias) + text.slice(end)

  return { kept, taken: `${taken}\n`, name }
}

const MARKDOWN = /\.(md|markdown|mdown|mkd)$/i

function noteNamed(name: string): string {
  return isTabFile(name) || MARKDOWN.test(name) ? `${name}.md` : name
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
