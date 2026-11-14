import {
  embedKind,
  embedSize,
  findLinks,
  type FoundLink,
  lines,
  shownText,
} from '@orden/markdown/links'
import { stripFrontMatter } from '@orden/markdown/front-matter'
import { codeSpans, inCode } from '@orden/markdown/tags'
import { encodeTarget } from '../../link-rewrite'

interface Edit {
  from: number
  to: number
  text: string
}

export interface MarkdownOptions {
  link?: (link: FoundLink) => string | null
  picture?: (src: string) => string | null
}

const BARE = String.raw`(?:[^\s()\\]|\\.|\((?:[^\s()\\]|\\.|\([^\s()]*\))*\))*`

const TITLE = String.raw`(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?`

const PICTURE = new RegExp(String.raw`!\[([^\]]*)\]\(\s*(<[^>]*>|${BARE})(${TITLE})\s*\)`, 'g')

const DEFINITION = new RegExp(
  String.raw`^([ >]*\[(?!\^)[^\]]+\]:[ \t]*)(<[^>]*>|[^\s<]\S*)(${TITLE})[ \t]*$`,
)

const STANDS_ALONE = /^(?:#{1,6}(?:\s|$)|(?:-[ \t]*){3,}$|(?:\*[ \t]*){3,}$|(?:_[ \t]*){3,}$)/

function asLink(link: FoundLink, target: string): string {
  const anchor = link.heading ? `#${link.heading}` : ''
  const fragment = anchor ? encodeTarget(anchor) : ''

  return `[${shownText(link)}](${encodeTarget(target)}${fragment})`
}

function asSource(path: string, written: string): string {
  return written.startsWith('<') || path.includes(' ') || !balanced(path) ? `<${path}>` : path
}

function balanced(path: string): boolean {
  let open = 0
  for (const one of path) {
    if (one === '(') open++
    if (one === ')' && --open < 0) return false
  }
  return open === 0
}

function unescaped(written: string): string {
  return written.replace(/\\([!-/:-@[-`{-~])/g, '$1')
}

function sourceEdit(
  written: string,
  from: number,
  rename: (src: string) => string | null,
): Edit | null {
  const bare = unescaped(written.startsWith('<') ? written.slice(1, -1) : written)
  const wanted = rename(bare)
  if (wanted === null || wanted === bare) return null
  return { from, to: from + written.length, text: asSource(wanted, written) }
}

const bodyStart = (source: string) => source.length - stripFrontMatter(source).length

function spansByBlock(
  source: string,
  all: readonly { text: string; from: number; code: boolean }[],
): [number, number][] {
  const spans: [number, number][] = []
  let start = -1
  let stop = -1
  const end = () => {
    if (start < 0) return
    for (const [a, b] of codeSpans(source.slice(start, stop))) {
      spans.push([start + a, start + b])
    }
    start = -1
  }
  for (const { text, from, code } of all) {
    if (code || !text.trim()) {
      end()
    } else {
      if (start < 0) start = from
      stop = from + text.length
    }
  }
  end()
  return spans
}

function pictureEdits(source: string, rename: (src: string) => string | null): Edit[] {
  const edits: Edit[] = []
  const body = bodyStart(source)
  let paragraph = false
  const all = [...lines(source)]
  const spans = spansByBlock(source, all)

  for (const { text: line, from: at, code } of all) {
    if (code || at < body) {
      paragraph = false
      continue
    }

    for (const match of line.matchAll(PICTURE)) {
      if (inCode(spans, at + match.index)) continue
      const written = match[2] ?? ''
      const past = (match[1]?.length ?? 0) + 4
      const from = at + match.index + match[0].indexOf(written, past)
      const edit = sourceEdit(written, from, rename)
      if (edit) edits.push(edit)
    }

    const definition: RegExpExecArray | null = paragraph ? null : DEFINITION.exec(line)
    if (definition) {
      const from = at + (definition[1]?.length ?? 0)
      const edit = sourceEdit(definition[2] ?? '', from, rename)
      if (edit) edits.push(edit)
    }

    const words = line.replace(/^[ >]*/, '')
    paragraph = !definition && words !== '' && !STANDS_ALONE.test(words)
  }

  return edits
}

function pictureEmbed(link: FoundLink, rename: (src: string) => string | null): string | null {
  if (!link.embed || embedKind(link.target) !== 'image') return null

  const wanted = rename(link.target)
  if (wanted === null) return null

  const words = embedSize(link.alias) === null ? (link.alias ?? '') : ''
  return `![${words}](${asSource(wanted, '')})`
}

export function toMarkdown(source: string, options: MarkdownOptions = {}): string {
  const edits: Edit[] = []

  if (options.link || options.picture) {
    const body = bodyStart(source)
    for (const found of findLinks(source)) {
      if (found.kind !== 'wikilink') continue

      const inBody = found.from >= body
      const picture = options.picture && inBody ? pictureEmbed(found, options.picture) : null
      if (picture !== null) {
        edits.push({ from: found.from, to: found.to, text: picture })
        continue
      }
      if (!options.link) continue

      const target = options.link(found)
      edits.push({
        from: found.from,
        to: found.to,
        text: target === null ? shownText(found) : asLink(found, target),
      })
    }
  }

  if (options.picture) edits.push(...pictureEdits(source, options.picture))

  let out = source
  for (const edit of edits.sort((one, other) => other.from - one.from)) {
    out = out.slice(0, edit.from) + edit.text + out.slice(edit.to)
  }

  return out
}
