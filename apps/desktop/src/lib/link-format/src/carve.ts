import { encodeTarget, findLinks, isTabFile, sectionOf, wikilinkCannotName } from '@orden/markdown/links'
import { nameFromContent } from '../../platform/src/api'
import { linkTo } from './composer'

export interface Split {
  kept: string
  taken: string
  name: string
}
export function splitAt(text: string, at: number, fallback: string, named?: string, source?: string): Split | null {
  const start = lineStart(text, Math.max(0, Math.min(at, text.length)))
  const taken = text.slice(start).trim()
  if (!taken) return null
  const name = named ?? nameFromContent(taken) ?? fallback
  const kept = `${text.slice(0, start).replace(/\s+$/, '')}\n\n${linkTo(noteNamed(name))}\n`
  return across({ kept, taken: `${taken}\n`, name }, source)
}
export function extracted(
  text: string,
  from: number,
  to: number,
  fallback: string,
  named?: string,
  source?: string,
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
  return across({ kept, taken: `${taken}\n`, name }, source)
}
function across(split: Split, source: string | undefined): Split {
  const kept = pointedOut(split.kept, split.taken, split.name)
  const taken = source === undefined ? split.taken : pointedOut(split.taken, split.kept, source)
  return { ...split, kept, taken }
}
function pointedOut(text: string, other: string, name: string): string {
  if (wikilinkCannotName(name)) return text
  let out = text
  for (const link of findLinks(text).reverse()) {
    if (link.target !== '' || (link.heading === null && link.block === null)) continue
    if (sectionOf(text, link) !== null || sectionOf(other, link) === null) continue
    const target = link.kind === 'wikilink' ? noteNamed(name) : encodeTarget(`${name}.md`)
    out = out.slice(0, link.targetFrom) + target + out.slice(link.targetTo)
  }
  return out
}
const MARKDOWN = /\.(md|markdown|mdown|mkd)$/i
const noteNamed = (name: string): string => (isTabFile(name) || MARKDOWN.test(name) ? `${name}.md` : name)
const SENTENCE_END = /[.!?。！？]+$/u
function oneLine(text: string): string {
  const first = text.split('\n')[0] ?? ''
  const words = first.replace(/^\s*>?\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+)?/, '').trim()
  return words.length > 0 && words.length <= 60 ? words : ''
}
const lineStart = (text: string, at: number): number => text.lastIndexOf('\n', Math.max(0, at - 1)) + 1
