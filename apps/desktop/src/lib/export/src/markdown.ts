import { embedKind, embedSize, findLinks, type FoundLink, lines, shownText, encodeTarget } from '@orden/markdown/links'
import { frontMatterBlock, stripFrontMatter } from '@orden/markdown/front-matter'
import { codeSpans, inCode } from '@orden/markdown/tags'

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

const DEFINITION = new RegExp(String.raw`^([ >]*\[(?!\^)[^\]]+\]:[ \t]*)(<[^>]*>|[^\s<]\S*)(${TITLE})[ \t]*$`)

const IMG_SOURCE = /<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/gi

const STANDS_ALONE = /^(?:#{1,6}(?:\s|$)|(?:-[ \t]*){3,}$|(?:\*[ \t]*){3,}$|(?:_[ \t]*){3,}$)/

function asLink(link: FoundLink, target: string): string {
  const fragment =
    link.block !== null ? `#^${encodeTarget(link.block)}` : link.heading ? `#${encodeTarget(link.heading)}` : ''

  return `[${shownText(link)}](${encodeTarget(target).replace(/'/g, '%27')}${fragment})`
}

const VALUE_OPENS = /^[ \t]*(?:-[ \t]+|[^\s#:-][^:]*:[ \t]+)/

function inMatter(source: string, link: FoundLink, text: string): string | null {
  const start = source.lastIndexOf('\n', link.from - 1) + 1
  const lineEnd = source.indexOf('\n', link.to)
  const line = source.slice(start, lineEnd === -1 ? undefined : lineEnd).replace(/\r$/, '')
  const before = line.slice(0, link.from - start)
  const after = line.slice(link.to - start)

  const opens = VALUE_OPENS.exec(before)?.[0]
  if (opens === undefined) return null
  if (opens === before) return /^[ \t]*(?:#.*)?$/.test(after) ? quotedValue(text) : null

  const quote = before.slice(opens.length, opens.length + 1)
  if (quote === "'" && after.includes(quote)) return text.replace(/'/g, "''")
  if (quote === '"' && after.includes(quote)) return text.replace(/["\\]/g, (mark) => `\\${mark}`)
  return null
}

function quotedValue(value: string): string {
  if (!/["\\]/.test(value)) return `"${value}"`
  return `'${value.replace(/'/g, "''")}'`
}

const asSource = (path: string, written: string): string =>
  written.startsWith('<') || path.includes(' ') || !balanced(path) ? `<${path}>` : path

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

function sourceEdit(written: string, from: number, rename: (src: string) => string | null): Edit | null {
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

    for (const match of line.matchAll(IMG_SOURCE)) {
      if (inCode(spans, at + match.index)) continue
      const written = match[1] ?? match[2] ?? ''
      const name = written.replaceAll('&quot;', '"').replaceAll('&amp;', '&')
      const wanted = rename(name)
      if (wanted === null || wanted === name) continue
      const from = at + match.index + match[0].length - written.length - 1
      const text = wanted.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
      edits.push({ from, to: from + written.length, text })
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

function mediaEmbed(link: FoundLink, target: string): string | null {
  const kind = embedKind(link.target)
  if (!link.embed || (kind !== 'image' && kind !== 'audio' && kind !== 'video')) return null
  const words = embedSize(link.alias) === null ? (link.alias ?? '') : ''
  return `![${words}](${asSource(target, '')})`
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
    const matter = frontMatterBlock(source)
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
      if (target === null && found.embed && embedKind(found.target) !== null) continue
      const within = found.target === '' && (found.heading !== null || found.block !== null)
      const written =
        target !== null
          ? ((options.picture ? null : mediaEmbed(found, target)) ?? asLink(found, target))
          : within
            ? asLink(found, '')
            : shownText(found)
      const text = matter && found.from < matter.close ? inMatter(source, found, written) : written
      if (text !== null) edits.push({ from: found.from, to: found.to, text })
    }
  }

  if (options.picture) edits.push(...pictureEdits(source, options.picture))

  let out = source
  for (const edit of edits.sort((one, other) => other.from - one.from)) {
    out = out.slice(0, edit.from) + edit.text + out.slice(edit.to)
  }

  return out
}
