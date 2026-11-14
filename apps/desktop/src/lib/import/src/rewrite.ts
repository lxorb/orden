import { frontMatterBlock } from '@orden/markdown/front-matter'
import { foldName } from '@orden/markdown/links'

import { linkTo } from '../../composer'
import { folderOf, isMarkdownPath, relativePath } from '../../platform/src/api'

export interface Found {
  path: string
  name: string
}

export type Resolver = (target: string, from: string) => Found | null

export type Reaching = (found: Found, from: string) => boolean

const LINK =
  /(!?)(?<!\\)\[((?!\[)(?:[^[\]\\\n]|\n(?![ \t>]*\n)|\\.|\[(?:[^[\]\\\n]|\n(?![ \t>]*\n)|\\.)*\])*)\]\(((?:[^()\n]|\([^()\n]*\))*)\)/g

const WIKILINK = /(?<!\\)!?\[\[([^\]\n|]+)(\|[^\]\n]*)?\]\]/g

const DEFINITION =
  /^( {0,3}\[(?!\^)(?:[^[\]\\\n]|\\.)+\]:[ \t]*)(<[^<>\n]*>|[^\s<]\S*)((?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?[ \t]*\r?)$/gm

const UNLINKABLE = /[[\]|]/

const SIZE = /^\d+(?:x\d+)?$/

const DIVIDER = /^ {0,3}\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/

const QUOTED = /^(?: {0,3}>[ \t]?)*/

const INDENTED = /^(?: {4}| {0,3}\t)/

const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/

const LISTED_FENCE = /^[ \t]*(`{3,}|~{3,})(.*)$/

const LIST_ITEM = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/

export interface Rewriting {
  was: string
  now: string
}

export function rewriteLinks(
  text: string,
  at: Rewriting,
  find: Resolver,
  reaches: Reaching = () => true,
): string {
  const folder = folderOf(at.now)
  const code = withMath(text, codeRanges(text))
  const tables = tableRanges(text)

  function markdownLink(
    whole: string,
    bang: string,
    label: string,
    inside: string,
    offset: number,
  ): string {
    if (inCode(code, offset)) return whole

    const words = label.replace(LINK, (one, inner: string, said: string, held: string) =>
      markdownLink(one, inner, said, held, offset),
    )
    const kept = words === label ? whole : `${bang}[${words}](${inside})`

    const { target, title } = splitTarget(inside)
    if (!target || isAddress(target)) return kept

    const { path: written, fragment } = splitFragment(target)
    const found = find(decoded(written), at.was)
    if (!found) return kept

    if (
      isMarkdownPath(found.path) &&
      !UNLINKABLE.test(found.name) &&
      !/[[\]\n]/.test(words) &&
      reaches(found, at.now)
    ) {
      const link = linkTo(found.name, words, {
        path: found.path,
        from: at.now,
        embed: bang === '!',
        fragment: fragment === null ? null : decoded(fragment),
      })
      return inCode(tables, offset) ? inCell(link) : link
    }

    const path = relativePath(folder, found.path)
    const anchor = fragment === null ? '' : `#${fragment}`
    return `${bang}[${words}](${encodeTarget(path)}${anchor}${title})`
  }

  const rewritten: [number, number][] = []
  let moved = 0

  const linked = text.replace(
    LINK,
    (whole, bang: string, label: string, inside: string, offset: number) => {
      const link = markdownLink(whole, bang, label, inside, offset)
      if (link !== whole) rewritten.push([offset + moved, offset + moved + link.length])
      moved += link.length - whole.length
      return link
    },
  )

  const stillCode = withMath(linked, codeRanges(linked))
  const stillTables = tableRanges(linked)
  const properties = propertiesTo(linked)
  const wikilinked = linked.replace(
    WIKILINK,
    (whole, target: string, shown: string | undefined, offset: number) => {
      if (inCode(stillCode, offset) || inCode(rewritten, offset)) return whole

      const named = shown === undefined ? target : target.replace(/\\$/, '')
      const { path, fragment } = splitFragment(named.trim())
      const found = find(path, at.was)
      if (!found) return whole

      const name = foldName(found.name) === foldName(path) ? path : found.name
      const words = shown?.slice(1) ?? null
      const embed = whole.startsWith('!')
      const sized = embed && !isMarkdownPath(found.path) && SIZE.test(words?.trim() ?? '')
      const property = offset < properties
      const elsewhere = !property && isMarkdownPath(found.path) && !reaches(found, at.now)
      const atTop = { ...found, name: withoutExtension(found.path) }
      const pathed = elsewhere && found.path.includes('/') && reaches(atTop, at.now)
      const written = pathed
        ? linkTo(atTop.name, words ?? (embed || fragment ? null : path), {
            path: found.path,
            from: at.now,
            embed,
            fragment,
          })
        : linkTo(
            name,
            words,
            { path: found.path, from: at.now, embed, fragment },
            sized || property ? 'wikilink' : elsewhere ? 'relative' : undefined,
          )
      return inCode(stillTables, offset) ? inCell(written) : written
    },
  )

  return definitionsFollowed(wikilinked, (path) => {
    const found = find(path, at.was)
    return found ? relativePath(folder, found.path) : null
  })
}

function definitionsFollowed(text: string, follow: (path: string) => string | null): string {
  const code = withMath(text, codeRanges(text))
  const properties = propertiesTo(text)

  return text.replace(
    DEFINITION,
    (whole, label: string, said: string, title: string, offset: number) => {
      if (offset < properties || inCode(code, offset)) return whole
      const target = said.replace(/^<|>$/g, '')
      if (!target || isAddress(target)) return whole

      const { path, fragment } = splitFragment(target)
      const now = follow(decoded(path))
      if (now === null) return whole
      const anchor = fragment === null ? '' : `#${fragment}`
      return `${label}${encodeTarget(now)}${anchor}${title}`
    },
  )
}

export function canvasFollowed(bytes: Uint8Array, moved: ReadonlyMap<string, string>): Uint8Array {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    return bytes
  }

  const followed = text.replace(
    /("(?:file|background)"\s*:\s*)("(?:[^"\\]|\\.)*")/g,
    (whole, key: string, said: string) => {
      const now = moved.get(jsonString(said) ?? '')
      return now === undefined ? whole : `${key}${JSON.stringify(now)}`
    },
  )
  return followed === text ? bytes : new TextEncoder().encode(followed)
}

export function linksFollowed(
  text: string,
  was: string,
  moved: ReadonlyMap<string, string>,
  paths: readonly string[],
): string {
  const here = folderOf(was)
  const movedFolded = new Map([...moved].map(([from, to]) => [foldName(from), to] as const))
  const called = calledBy(paths)
  const code = withMath(text, codeRanges(text))

  function markdownLink(
    whole: string,
    bang: string,
    label: string,
    inside: string,
    offset: number,
  ): string {
    if (inCode(code, offset)) return whole

    const words = label.replace(LINK, (one, inner: string, said: string, held: string) =>
      markdownLink(one, inner, said, held, offset),
    )
    const kept = words === label ? whole : `${bang}[${words}](${inside})`

    const { target, title } = splitTarget(inside)
    if (!target || isAddress(target)) return kept
    const { path: written, fragment } = splitFragment(target)
    const path = decoded(written)
    const meant = path.startsWith('/') ? path.replace(/^\/+/, '') : joined(here, path)
    const now = moved.get(meant) ?? movedFolded.get(foldName(meant))
    if (now === undefined) return kept

    const anchor = fragment === null ? '' : `#${fragment}`
    return `${bang}[${words}](${encodeTarget(relativePath(here, now))}${anchor}${title})`
  }

  const linked = text.replace(LINK, markdownLink)
  const stillCode = withMath(linked, codeRanges(linked))

  const wikilinked = linked.replace(
    WIKILINK,
    (whole, target: string, shown: string | undefined, offset: number) => {
      if (inCode(stillCode, offset)) return whole

      const cell = shown !== undefined && target.endsWith('\\')
      const named = cell ? target.slice(0, -1) : target
      const { path, fragment } = splitFragment(named)
      const said = path.trim()
      const meant = nearest(said, was, called)
      const now = meant === undefined ? undefined : moved.get(meant)
      if (meant === undefined || now === undefined) return whole

      const renamed = respelled(said, meant, now)
      if (renamed === null) return whole
      const bang = whole.startsWith('!') ? '!' : ''
      const anchor = fragment === null ? '' : `#${fragment}`
      return `${bang}[[${path.replace(said, renamed)}${anchor}${cell ? '\\' : ''}${shown ?? ''}]]`
    },
  )

  return definitionsFollowed(wikilinked, (path) => {
    const meant = path.startsWith('/') ? path.replace(/^\/+/, '') : joined(here, path)
    const now = moved.get(meant) ?? movedFolded.get(foldName(meant))
    return now === undefined ? null : relativePath(here, now)
  })
}

function calledBy(paths: readonly string[]): Map<string, string[]> {
  const called = new Map<string, string[]>()
  for (const path of paths) {
    const name = path.split('/').pop() ?? path
    const names = isMarkdownPath(path) ? [name, withoutExtension(name)] : [name]
    for (const one of names) {
      const key = foldName(one)
      const gathered = called.get(key)
      if (gathered) gathered.push(path)
      else called.set(key, [path])
    }
  }
  return called
}

function nearest(
  said: string,
  from: string,
  called: ReadonlyMap<string, string[]>,
): string | undefined {
  const wanted = foldName(said.replace(/^\/+/, ''))
  const fits = (called.get(wanted.split('/').pop() ?? '') ?? []).filter((path) => {
    const whole = foldName(path)
    const bare = isMarkdownPath(path) ? foldName(withoutExtension(path)) : whole
    return [whole, bare].some((one) => one === wanted || one.endsWith(`/${wanted}`))
  })

  const here = folderOf(from)
  const depth = (path: string) => path.split('/').length
  const beside = (path: string) => (folderOf(path) === here ? 0 : 1)
  return [...fits].sort(
    (one, other) =>
      beside(one) - beside(other) || depth(one) - depth(other) || (one < other ? -1 : 1),
  )[0]
}

function respelled(said: string, from: string, to: string): string | null {
  const parts = said.split('/')
  const last = parts.pop() ?? said
  const whole = from.split('/').pop() ?? from
  const name = [whole, withoutExtension(whole)].find((one) => foldName(one) === foldName(last))
  if (name === undefined) return null

  const fresh = to.split('/').pop() ?? to
  const after = name === whole ? fresh : withoutExtension(fresh)
  const spelled = after.startsWith(name) ? last + after.slice(name.length) : after
  return [...parts, spelled].join('/')
}

function jsonString(said: string): string | null {
  try {
    const value: unknown = JSON.parse(said)
    return typeof value === 'string' ? value : null
  } catch {
    return null
  }
}

export function isCanvas(path: string): boolean {
  return /\.canvas$/i.test(path)
}

const NEW_BLOCK =
  /^(?:[-+*][ \t]|\d{1,9}[.)][ \t]|#{1,6}(?:[ \t]|$)|`{3}|~{3}|([-*_])(?:[ \t]*\1){2,}[ \t]*$)/

function tableRanges(text: string): [number, number][] {
  const ranges: [number, number][] = []
  const raw = text.split('\n')
  const lines = raw.map((line) => line.replace(QUOTED, '').replace(/^[ \t]+/, ''))
  const depth = (one: number) => ((QUOTED.exec(raw[one] ?? '') ?? [''])[0].match(/>/g) ?? []).length
  const starts: number[] = []
  let at = 0
  for (const line of raw) {
    starts.push(at)
    at += line.length + 1
  }

  for (let one = 1; one < lines.length; one++) {
    const head = lines[one - 1] ?? ''
    const divider = lines[one] ?? ''
    if (!DIVIDER.test(divider) || !divider.includes('|') || !head.includes('|')) continue

    let last = one
    const row = (line: number) =>
      (lines[line] ?? '').trim() !== '' &&
      !NEW_BLOCK.test(lines[line] ?? '') &&
      depth(line) === depth(one)
    while (row(last + 1)) last += 1
    ranges.push([starts[one - 1] ?? 0, (starts[last + 1] ?? text.length + 1) - 1])
    one = last
  }

  return ranges
}

function inCell(link: string): string {
  return link.replace(/(?<!\\)\|/g, '\\|')
}

function splitFragment(target: string): { path: string; fragment: string | null } {
  const at = target.indexOf('#')
  if (at < 0) return { path: target, fragment: null }
  return { path: target.slice(0, at), fragment: target.slice(at + 1) }
}

function codeRanges(text: string): [number, number][] {
  const code = codeOnly(text)
  return [...code, ...htmlRanges(text, code)]
}

const HTML_BLOCK = /^ {0,3}<(pre|script|style|textarea)(?=[\s>]|$)/gim

function htmlRanges(text: string, code: readonly [number, number][]): [number, number][] {
  const ranges: [number, number][] = []
  const outside = (at: number) =>
    !inCode(code, at) && !ranges.some(([from, to]) => at >= from && at < to)

  for (const opened of text.matchAll(HTML_BLOCK)) {
    if (!outside(opened.index)) continue
    const close = new RegExp(`</${opened[1] ?? 'pre'}>`, 'i').exec(text.slice(opened.index))
    ranges.push([opened.index, close ? opened.index + close.index + close[0].length : text.length])
  }

  for (let at = text.indexOf('<!--'); at >= 0; at = text.indexOf('<!--', at + 4)) {
    if (!outside(at)) continue
    const close = text.indexOf('-->', at + 4)
    if (close >= 0) ranges.push([at, close + 3])
    else if (/(?:^|\n) {0,3}$/.test(text.slice(0, at))) ranges.push([at, text.length])
  }

  return ranges
}

function codeOnly(text: string): [number, number][] {
  const ranges: [number, number][] = []
  const lines = text.split('\n')
  const properties = propertiesEnd(lines)
  let fence: { mark: string; from: number; loose: boolean; depth: number } | null = null
  let indented: { from: number; to: number } | null = null
  let blank = true
  let listed = false
  let prose = 0
  let at = 0

  for (const [index, whole] of lines.entries()) {
    const quoted = QUOTED.exec(whole)?.[0] ?? ''
    const depth = quoted.split('>').length - 1
    const line = whole.slice(quoted.length).replace(/\r$/, '')
    const empty = !line.trim()

    if (fence && depth < fence.depth) {
      ranges.push([fence.from, at])
      fence = null
      prose = at
    }

    const item: RegExpExecArray | null = fence ? null : LIST_ITEM.exec(line)
    const loose: boolean = fence ? fence.loose : listed || item !== null
    const marked: RegExpExecArray | null = (loose ? LISTED_FENCE : FENCE).exec(
      item ? line.slice(item[0].length) : line,
    )
    const mark: string = marked?.[1] ?? ''
    const rest: string = marked?.[2] ?? ''

    if (index < properties) {
      prose = at + whole.length + 1
    } else if (fence) {
      if (
        mark &&
        mark.startsWith(fence.mark.charAt(0)) &&
        mark.length >= fence.mark.length &&
        !rest.trim()
      ) {
        ranges.push([fence.from, at + whole.length])
        fence = null
        prose = at + whole.length
      }
    } else {
      if (indented && !empty && INDENTED.test(line)) indented.to = at + whole.length
      else if (indented && !empty) {
        ranges.push([indented.from, indented.to])
        prose = indented.to
        indented = null
      }

      if (indented) {
        // Still in the block.
      } else if (mark && !(mark.startsWith('`') && rest.includes('`'))) {
        spans(text, prose, at, ranges)
        fence = { mark, from: at, loose, depth }
        if (!INDENTED.test(line)) listed = item !== null
      } else if (!empty && INDENTED.test(line) && blank && !listed) {
        spans(text, prose, at, ranges)
        indented = { from: at, to: at + whole.length }
      } else if (!empty && !INDENTED.test(line)) {
        listed = LIST_ITEM.test(line)
      }
    }

    blank = empty
    at += whole.length + 1
  }

  if (fence) {
    ranges.push([fence.from, text.length])
    return ranges
  }

  if (indented) {
    ranges.push([indented.from, indented.to])
    prose = indented.to
  }
  spans(text, prose, text.length, ranges)
  return ranges
}

const MATH =
  /(?<!\\)\$\$(?:[^$\\]|\\[\s\S]|\$(?!\$))*\$\$|(?<![\\$])\$(?![\s$])(?:[^$\n\\]|\\.|\n(?![ \t>]*\n))*?(?<![\s\\])\$(?!\d)/g

function withMath(text: string, code: [number, number][]): [number, number][] {
  if (!text.includes('$')) return code

  const parts: string[] = []
  let at = 0
  for (const [from, to] of [...code].sort((one, other) => one[0] - other[0])) {
    if (to <= at) continue
    const start = Math.max(from, at)
    parts.push(text.slice(at, start), text.slice(start, to).replace(/[^\n]/g, ' '))
    at = to
  }
  const plain = parts.join('') + text.slice(at)

  const math = [...plain.matchAll(MATH)].map((one): [number, number] => [
    one.index,
    one.index + one[0].length,
  ])
  return [...code, ...math]
}

function propertiesEnd(lines: readonly string[]): number {
  const text = lines.join('\n')
  const block = frontMatterBlock(text)
  return block ? text.slice(0, block.close).split('\n').length : 0
}

function propertiesTo(text: string): number {
  const lines = text.split('\n')
  return lines.slice(0, propertiesEnd(lines)).join('\n').length
}

function spans(text: string, from: number, to: number, ranges: [number, number][]) {
  let paragraph = from
  let at = from
  for (const line of text.slice(from, to).split('\n')) {
    if (!line.replace(QUOTED, '').trim()) {
      paired(text, paragraph, at, ranges)
      paragraph = at + line.length + 1
    }
    at += line.length + 1
  }
  paired(text, paragraph, to, ranges)
}

function paired(text: string, from: number, to: number, ranges: [number, number][]) {
  if (from >= to) return
  const runs = [...text.slice(from, to).matchAll(/`+/g)]

  for (let one = 0; one < runs.length; one++) {
    const open = runs[one]
    if (!open) continue
    const close = runs.findIndex((run, at) => at > one && run[0].length === open[0].length)
    if (close < 0) continue

    const shut = runs[close]
    if (!shut) continue
    ranges.push([from + open.index, from + shut.index + shut[0].length])
    one = close
  }
}

function inCode(ranges: readonly [number, number][], offset: number): boolean {
  return ranges.some(([from, to]) => offset >= from && offset < to)
}

function splitTarget(inside: string): { target: string; title: string } {
  const said = inside.trim()
  const quoted = /\s+("[^"]*"|'[^']*')$/.exec(said)
  const target = quoted ? said.slice(0, quoted.index).trim() : said
  const title = quoted ? ` ${quoted[1] ?? ''}` : ''

  return { target: target.replace(/^<|>$/g, ''), title }
}

function isAddress(target: string): boolean {
  if (/^file:/i.test(target)) return false

  return /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('//')
}

function decoded(target: string): string {
  try {
    return decodeURIComponent(target)
  } catch {
    return target
  }
}

export function encodeTarget(path: string): string {
  return path
    .replace(/%/g, '%25')
    .replace(/#/g, '%23')
    .replace(/ /g, '%20')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
}

export class ExportFiles {
  private readonly byPath = new Spellings()

  private readonly byName = new Map<string, [string, Found][]>()

  private readonly paths: [string, Found][] = []

  private readonly named = new Map<string, number>()

  private readonly called = new Map<string, number>()

  private readonly arriving = new Map<string, string[]>()

  add(was: string, found: Found) {
    this.byPath.add(was, found)
    this.paths.push([was, found])

    const name = was.split('/').pop() ?? was
    const stem = name.replace(/\.[^.]+$/, '')
    const names = stem !== name && isMarkdownPath(found.path) ? [name, stem] : [name]
    for (const one of names) {
      const key = one.toLowerCase()
      this.called.set(key, (this.called.get(key) ?? 0) + 1)
      const folded = foldName(one)
      const gathered = this.byName.get(folded)
      if (gathered) gathered.push([was, found])
      else this.byName.set(folded, [[was, found]])
    }

    const said = found.name.toLowerCase()
    this.named.set(said, (this.named.get(said) ?? 0) + 1)

    if (isMarkdownPath(found.path)) {
      const last = foldName(withoutExtension(found.path)).split('/').pop() ?? ''
      const gathered = this.arriving.get(last)
      if (gathered) gathered.push(found.path)
      else this.arriving.set(last, [found.path])
    }
  }

  readonly reaches: Reaching = (found, from) => {
    const wanted = foldName(found.name)
    const fits = (this.arriving.get(wanted.split('/').pop() ?? '') ?? []).filter((path) => {
      const said = foldName(withoutExtension(path))
      return said === wanted || said.endsWith(`/${wanted}`)
    })

    const here = folderOf(from)
    const depth = (path: string) => path.split('/').length
    const beside = (path: string) => (folderOf(path) === here ? 0 : 1)
    const nearest = [...fits].sort(
      (one, other) =>
        beside(one) - beside(other) || depth(one) - depth(other) || (one < other ? -1 : 1),
    )[0]
    return nearest === undefined || nearest === found.path
  }

  readonly find: Resolver = (target, from) => {
    const rooted = target.startsWith('/')
    const cleaned = target.replace(/^\.\//, '').replace(/^\/+|\/+$/g, '')
    if (!cleaned) return null

    if (!rooted && !cleaned.includes('/')) {
      const found = this.nearest(cleaned, from, true) ?? this.nearest(cleaned, from)
      return found ? this.byBareName(cleaned, found) : null
    }

    const here = folderOf(from)
    const tries = (rooted ? [cleaned] : [joined(here, cleaned), cleaned]).flatMap((one) => [
      one,
      `${one}.md`,
    ])
    for (const one of tries) {
      const found = this.byPath.exact(one)
      if (found) return this.told(found)
    }
    for (const one of tries) {
      const found = this.byPath.get(one)
      if (found) return this.told(found)
    }

    const said = cleaned.split('/').filter((part) => part && part !== '.' && part !== '..')
    if (said.length > 1) {
      const fits = this.paths.find(([was]) => endsTogether(was, said.join('/')))
      return fits ? this.told(fits[1]) : null
    }

    const name = cleaned.split('/').pop() ?? cleaned
    const found = this.nearest(name, from, true) ?? this.nearest(name, from)
    return found ? this.byBareName(name, found) : null
  }

  private byBareName(name: string, found: Found): Found {
    return (this.called.get(name.toLowerCase()) ?? 0) < 2 ? this.told(found) : found
  }

  private nearest(name: string, from: string, exact = false): Found | undefined {
    const spelled = name.normalize('NFC')
    const fits = (this.byName.get(foldName(name)) ?? []).filter(([was, found]) => {
      if (!exact) return true
      const last = (was.split('/').pop() ?? was).normalize('NFC')
      return last === spelled || (isMarkdownPath(found.path) && withoutExtension(last) === spelled)
    })

    const here = folderOf(from)
    const depth = (path: string) => path.split('/').length
    const beside = (path: string) => (folderOf(path) === here ? 0 : 1)
    return [...fits].sort(
      ([one], [other]) =>
        beside(one) - beside(other) || depth(one) - depth(other) || (one < other ? -1 : 1),
    )[0]?.[1]
  }

  private told(found: Found): Found {
    if ((this.named.get(found.name.toLowerCase()) ?? 0) < 2) return found
    return { ...found, name: found.path.replace(/\.md$/i, '') }
  }
}

class Spellings {
  private readonly exactly = new Map<string, Found>()
  private readonly folded = new Map<string, Found>()

  add(key: string, found: Found) {
    const composed = key.normalize('NFC')
    if (!this.exactly.has(composed)) this.exactly.set(composed, found)
    const lower = foldName(key)
    if (!this.folded.has(lower)) this.folded.set(lower, found)
  }

  get(key: string): Found | undefined {
    return this.exactly.get(key.normalize('NFC')) ?? this.folded.get(foldName(key))
  }

  exact(key: string): Found | undefined {
    return this.exactly.get(key.normalize('NFC'))
  }
}

function endsTogether(was: string, said: string): boolean {
  const one = foldName(was)
  const other = foldName(said)
  const ends = (path: string, end: string) => path === end || path.endsWith(`/${end}`)
  return [one, one.replace(/\.md$/, '')].some((path) => ends(path, other) || ends(other, path))
}

function withoutExtension(path: string): string {
  return path.replace(/\.[^./]+$/, '')
}

function joined(folder: string, relative: string): string {
  const parts = folder ? folder.split('/') : []

  for (const part of relative.split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }

  return parts.join('/')
}
