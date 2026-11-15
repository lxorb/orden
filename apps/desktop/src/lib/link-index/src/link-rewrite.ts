import {
  embedSize,
  encodeTarget,
  findLinks,
  type FoundLink,
  wikilinkCannotName,
} from '@orden/markdown/links'
import { frontMatterBlock } from '@orden/markdown/front-matter'
import { formatLink } from '../../link-format/src/api'
import { shownName, folderOf, nameOf, relativePath } from '../../platform/src/api'

export interface Placed {
  path: string
  reaches: (written: string) => boolean
  shown?: string
}

export interface Move {
  from: string
  to: string
}

export function rewriteLinks(
  text: string,
  source: string,
  move: Move,
  points: (link: FoundLink) => boolean,
): string | null {
  return retargetLinks(text, source, (link) => (points(link) ? move.to : null))
}

export function retargetLinks(
  text: string,
  source: string,
  to: (link: FoundLink) => string | Placed | null,
): string | null {
  const edits: Edit[] = []

  for (const link of findLinks(text)) {
    const there = to(link)
    if (there === null) continue
    const written = targetFor(link, source, there)
    if (link.kind === 'wikilink' && wikilinkCannotName(written)) {
      edits.push({ from: link.from, to: link.to, insert: asMarkdown(link, source, there) })
      continue
    }
    edits.push({ from: link.targetFrom, to: link.targetTo, insert: written })
    const shown = typeof there === 'string' ? undefined : there.shown
    if (shown !== undefined && link.kind === 'wikilink' && !link.embed && link.alias === null) {
      const at = link.to - 2
      const barred = text.slice(link.targetTo, at).includes('|')
      const bar = barred ? '' : inTableRow(text, link.from, link.to) ? '\\|' : '|'
      edits.push({ from: at, to: at, insert: `${bar}${shown}` })
    }
  }

  if (!edits.length) return null
  return applied(text, quotedInMatter(text, plainInMatter(text, edits)))
}

const OTHER_WIKILINKS = /\[\[[^\]\n]*\]\]/g

function inTableRow(text: string, from: number, to: number): boolean {
  const start = text.lastIndexOf('\n', from - 1) + 1
  const end = text.indexOf('\n', to)
  const around = text.slice(start, from) + text.slice(to, end === -1 ? undefined : end)
  return around.replace(OTHER_WIKILINKS, '').includes('|')
}

interface Edit {
  from: number
  to: number
  insert: string
}

function applied(text: string, edits: readonly Edit[]): string {
  let out = ''
  let at = 0
  for (const edit of edits) {
    out += text.slice(at, edit.from) + edit.insert
    at = edit.to
  }
  return out + text.slice(at)
}

interface Scalar {
  open: number
  close: number
  quote: "'" | '"'
}

function quotedInMatter(text: string, edits: readonly Edit[]): Edit[] {
  const matter = frontMatterBlock(text)
  if (!matter) return [...edits]

  const out: Edit[] = []
  let at = 0
  while (at < edits.length) {
    const edit = edits[at]
    if (edit === undefined) break
    const scalar = edit.from < matter.close ? scalarAround(text, edit.from) : null
    if (!scalar || edit.to > scalar.close) {
      out.push(edit)
      at++
      continue
    }
    let last = at
    while ((edits[last + 1]?.to ?? Infinity) <= scalar.close) last++
    out.push(...requoted(text, scalar, edits.slice(at, last + 1)))
    at = last + 1
  }
  return out
}

const VALUE_OPENS = /^(?:[ \t]*-[ \t]+|[ \t]*[^\s#-][^:]*?[ \t]*:[ \t]+)/

const INDICATOR = /^(?:[-?:](?:\s|$)|[,[\]{}#&*!|>'"%@`])/

const SIMPLE_LINE = /^[ \t]*(?:#.*|-(?:[ \t]+\S.*)?|[^\s#:-][^:]*:(?:[ \t]+(?![|>])\S.*)?)?$/

function simpleMatter(body: string): boolean {
  return body.split('\n').every((line) => SIMPLE_LINE.test(line.replace(/\r$/, '')))
}

function plainHolds(value: string): boolean {
  const link = /^\[\[([^\]]*)\]\]$/.exec(value)
  if (value.startsWith('[') && !link) return false
  const inner = link ? (link[1] ?? '') : value
  if (inner === '' || INDICATOR.test(inner) || /:(?:\s|$)|\s#/.test(inner)) return false
  return !link || !/[,[\]{}]|:$/.test(inner)
}

function quotedValue(value: string): string {
  if (!/["\\]/.test(value)) return `"${value}"`
  return `'${value.replace(/'/g, "''")}'`
}

function plainInMatter(text: string, edits: readonly Edit[]): Edit[] {
  const matter = frontMatterBlock(text)
  if (!matter || !simpleMatter(text.slice(matter.body.from, matter.body.to))) return [...edits]

  const out: Edit[] = []
  let at = 0
  while (at < edits.length) {
    const edit = edits[at]
    if (edit === undefined) break
    const start = text.lastIndexOf('\n', edit.from - 1) + 1
    const lineEnd = text.indexOf('\n', edit.from)
    const end = lineEnd === -1 ? text.length : lineEnd
    let last = at
    while ((edits[last + 1]?.to ?? Infinity) <= end) last++
    const line = edits.slice(at, last + 1)
    at = last + 1

    const opens = edit.from < matter.close ? VALUE_OPENS.exec(text.slice(start, end)) : null
    const from = start + (opens?.[0].length ?? 0)
    const to = start + text.slice(start, end).trimEnd().length
    const inValue = line.every((one) => one.from >= from && one.to <= to)
    if (!opens || !inValue || line.some((one) => scalarAround(text, one.from))) {
      out.push(...line)
      continue
    }

    const before = text.slice(from, to)
    const after = applied(
      before,
      line.map((one) => ({ ...one, from: one.from - from, to: one.to - from })),
    )
    if (plainHolds(before) && !plainHolds(after)) {
      out.push({ from, to, insert: quotedValue(after) })
    } else {
      out.push(...line)
    }
  }
  return out
}

const SCALAR_OPENS = /(?:^\s*(?:-\s+)?|[:[,]\s*)$/

function scalarAround(text: string, offset: number): Scalar | null {
  const start = text.lastIndexOf('\n', offset - 1) + 1
  const lineEnd = text.indexOf('\n', offset)
  const end = lineEnd === -1 ? text.length : lineEnd
  let open = -1
  let quote: "'" | '"' | null = null

  for (let at = start; at < end; at++) {
    const character = text[at]
    if (quote === null) {
      if (character === '#' && (at === start || /\s/.test(text[at - 1] ?? ''))) return null
      if ((character === "'" || character === '"') && SCALAR_OPENS.test(text.slice(start, at))) {
        quote = character
        open = at
      }
      continue
    }
    if (quote === '"' && character === '\\') {
      at++
      continue
    }
    if (character !== quote) continue
    if (quote === "'" && text[at + 1] === "'") {
      at++
      continue
    }
    if (open < offset && offset < at) return { open, close: at, quote }
    if (at > offset) return null
    quote = null
  }
  return null
}

function requoted(text: string, scalar: Scalar, edits: readonly Edit[]): Edit[] {
  const inserted = edits.map((edit) => edit.insert).join('')
  const kept = keptPieces(text, scalar, edits)

  if (scalar.quote === "'") {
    if (!inserted.includes("'")) return [...edits]
    const plain = kept.map((piece) => piece.replace(/''/g, "'"))
    const whole = plain.join('') + inserted
    if (!whole.includes('"') && !whole.includes('\\')) {
      return [{ from: scalar.open, to: scalar.close + 1, insert: `"${interleaved(plain, edits)}"` }]
    }
    return edits.map((edit) => ({ ...edit, insert: edit.insert.replace(/'/g, "''") }))
  }

  if (!/["\\]/.test(inserted)) return [...edits]
  const whole = kept.join('') + inserted
  if (!whole.includes("'") && !kept.join('').includes('\\')) {
    return [{ from: scalar.open, to: scalar.close + 1, insert: `'${interleaved(kept, edits)}'` }]
  }
  return edits.map((edit) => ({
    ...edit,
    insert: edit.insert.replace(/["\\]/g, (mark) => `\\${mark}`),
  }))
}

function keptPieces(text: string, scalar: Scalar, edits: readonly Edit[]): string[] {
  const pieces: string[] = []
  let at = scalar.open + 1
  for (const edit of edits) {
    pieces.push(text.slice(at, edit.from))
    at = edit.to
  }
  pieces.push(text.slice(at, scalar.close))
  return pieces
}

function interleaved(pieces: readonly string[], edits: readonly Edit[]): string {
  return pieces.map((piece, index) => piece + (edits[index]?.insert ?? '')).join('')
}

function asMarkdown(link: FoundLink, source: string, placed: string | Placed): string {
  const path = typeof placed === 'string' ? placed : placed.path
  const fragment = link.block === null ? link.heading : `^${link.block}`
  const words = link.alias?.replace(/\\\|/g, '|') ?? null
  const shown = link.embed && embedSize(words) ? `|${words ?? ''}` : words
  return formatLink(
    {
      name: shownName(nameOf(path)),
      path,
      from: source,
      fragment,
      shown,
      embed: link.embed,
    },
    'relative',
  )
}

function targetFor(link: FoundLink, source: string, placed: string | Placed): string {
  const to = typeof placed === 'string' ? placed : placed.path
  if (link.kind === 'markdown') {
    if (link.target.startsWith('/')) return encodeTarget(`/${to}`)
    return encodeTarget(relativePath(folderOf(source), to))
  }

  const spelled = (path: string) =>
    shownName(link.target) === link.target ? shownName(path) : path
  const fromTop = spelled(`/${to}`)
  const reaches = (written: string) => typeof placed === 'string' || placed.reaches(written)

  if (link.target.startsWith('/')) return fromTop

  const parts = to.split('/')
  const first = link.target.includes('/') ? 0 : parts.length - 1
  for (let from = first; from >= 0; from--) {
    const written = spelled(parts.slice(from).join('/'))
    if (reaches(written)) return written
  }
  return fromTop
}
