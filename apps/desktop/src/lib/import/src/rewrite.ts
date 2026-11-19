import { baseUnder } from '@orden/bases'
import { frontMatterBlock } from '@orden/markdown/front-matter'
import { encodeTarget, findLinks, foldName, type FoundLink, isWebTarget } from '@orden/markdown/links'
import { linkTo } from '../../link-format/src/api'
import { folderOf, isMarkdownPath, relativePath } from '../../platform/src/api'

export interface Found {
  path: string
  name: string
}
export type Resolver = (target: string, from: string) => Found | null
export type Reaching = (found: Found, from: string) => boolean
const UNLINKABLE = /[[\]|]/
const SIZE = /^\d+(?:x\d+)?$/
const DIVIDER = /^ {0,3}\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/
const QUOTED = /^(?: {0,3}>[ \t]?)*/
export interface Rewriting {
  was: string
  now: string
}
export function rewriteLinks(text: string, at: Rewriting, find: Resolver, reaches: Reaching = () => true): string {
  const folder = folderOf(at.now)
  const tables = tableRanges(text)
  const properties = propertiesTo(text)
  const follow = (path: string) => {
    const found = find(path, at.was)
    return found ? relativePath(folder, found.path) : null
  }
  return linksWritten(text, (link, words, spot) => {
    const whole = text.slice(link.from, link.to)
    if (spot.defined) return definitionFollowed(text, link, properties, follow)
    if (link.kind === 'markdown') {
      const bang = link.embed ? '!' : ''
      const label = text.slice(spot.labelFrom, spot.labelTo)
      const inside = text.slice(spot.labelTo + 2, link.to - 1)
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
        const made = linkTo(found.name, words, {
          path: found.path,
          from: at.now,
          embed: link.embed,
          fragment: fragment === null ? null : decoded(fragment),
        })
        return inCode(tables, link.from) ? inCell(made) : made
      }
      const path = relativePath(folder, found.path)
      const anchor = fragment === null ? '' : `#${fragment}`
      return `${bang}[${words}](${encodeTarget(path)}${anchor}${title})`
    }
    const { target, shown } = wikilinkParts(whole)
    const named = shown === undefined ? target : target.replace(/\\$/, '')
    const { path, fragment } = splitFragment(named.trim())
    const found = find(path, at.was)
    if (!found) return whole
    const name = foldName(found.name) === foldName(path) ? path : found.name
    const said = shown?.slice(1) ?? null
    const embed = link.embed
    const sized = embed && !isMarkdownPath(found.path) && SIZE.test(said?.trim() ?? '')
    const property = link.from < properties
    const elsewhere = !property && isMarkdownPath(found.path) && !reaches(found, at.now)
    const atTop = { ...found, name: withoutExtension(found.path) }
    const pathed = elsewhere && found.path.includes('/') && reaches(atTop, at.now)
    const written = pathed
      ? linkTo(atTop.name, said ?? (embed || fragment ? null : path), {
          path: found.path,
          from: at.now,
          embed,
          fragment,
        })
      : linkTo(
          name,
          said,
          { path: found.path, from: at.now, embed, fragment },
          sized || property ? 'wikilink' : elsewhere ? 'relative' : undefined,
        )
    return inCode(tables, link.from) ? inCell(written) : written
  })
}
interface Spot {
  labelFrom: number
  labelTo: number
  defined: boolean
}
type Write = (link: FoundLink, words: string, spot: Spot) => string
function spotOf(text: string, link: FoundLink): Spot {
  const labelFrom = link.from + (link.embed ? 2 : 1)
  if (link.kind === 'wikilink') return { labelFrom, labelTo: labelFrom, defined: false }
  const inline = text.lastIndexOf('](', link.targetFrom)
  const defined = text.lastIndexOf(']:', link.targetFrom)
  return defined > inline && defined >= labelFrom
    ? { labelFrom, labelTo: defined, defined: true }
    : { labelFrom, labelTo: Math.max(inline, labelFrom), defined: false }
}
const linksWritten = (text: string, write: Write): string => written(text, findLinks(text, true), 0, text.length, write)
function written(text: string, links: readonly FoundLink[], from: number, to: number, write: Write): string {
  let out = ''
  let at = from
  for (const link of links) {
    if (link.from < at || link.to > to) continue
    const spot = spotOf(text, link)
    const inner = links.filter((one) => one !== link && one.from >= spot.labelFrom && one.to <= spot.labelTo)
    const words = inner.length
      ? written(text, inner, spot.labelFrom, spot.labelTo, write)
      : text.slice(spot.labelFrom, spot.labelTo)
    out += text.slice(at, link.from) + write(link, words, spot)
    at = link.to
  }
  return out + text.slice(at, to)
}
function wikilinkParts(whole: string): { target: string; shown: string | undefined } {
  const inner = whole.replace(/^!?\[\[/, '').replace(/\]\]$/, '')
  const bar = inner.indexOf('|')
  return bar === -1 ? { target: inner, shown: undefined } : { target: inner.slice(0, bar), shown: inner.slice(bar) }
}
function definitionFollowed(
  text: string,
  link: FoundLink,
  properties: number,
  follow: (path: string) => string | null,
): string {
  const whole = text.slice(link.from, link.to)
  if (link.from < properties) return whole
  const angled = text[link.targetFrom - 1] === '<'
  const saidFrom = angled ? link.targetFrom - 1 : link.targetFrom
  const rest = text.slice(saidFrom, link.to)
  const said = angled ? rest.slice(0, rest.indexOf('>') + 1) : (/^\S*/.exec(rest)?.[0] ?? '')
  const target = said.replace(/^<|>$/g, '')
  if (!target || isAddress(target)) return whole
  const { path, fragment } = splitFragment(target)
  const now = follow(decoded(path))
  if (now === null) return whole
  const anchor = fragment === null ? '' : `#${fragment}`
  const head = text.slice(link.from, saidFrom)
  return `${head}${encodeTarget(now)}${anchor}${text.slice(saidFrom + said.length, link.to)}`
}
export function canvasFollowed(bytes: Uint8Array, moved: ReadonlyMap<string, string>, under = ''): Uint8Array {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    return bytes
  }
  const followed = text.replace(
    /("(?:file|background)"\s*:\s*)("(?:[^"\\]|\\.)*")/g,
    (whole, key: string, said: string) => {
      const was = jsonString(said) ?? ''
      const now = moved.get(was) ?? (under && isSpacePath(was) ? was : undefined)
      return now === undefined ? whole : `${key}${JSON.stringify(under ? `${under}/${now}` : now)}`
    },
  )
  return followed === text ? bytes : new TextEncoder().encode(followed)
}
export function linksFollowed(
  text: string,
  was: string,
  moved: ReadonlyMap<string, string>,
  paths: readonly string[],
  under = '',
  space: ReadonlyMap<string, string[]> = new Map(),
): string {
  const here = folderOf(was)
  const movedFolded = new Map([...moved].map(([from, to]) => [foldName(from), to] as const))
  const called = calledBy(paths)
  const known = new Set(paths.map(foldName))
  const movedTo = (path: string) => moved.get(path) ?? movedFolded.get(foldName(path))
  const landed = (path: string) => `${under ? `${under}/` : ''}${movedTo(path) ?? path}`
  let notesCalled: ReadonlyMap<string, string[]> | null = null
  const alongFolder = (said: string) => {
    notesCalled ??= calledBy(paths.filter(namesNote))
    return nearest(joined(here, said), was, notesCalled)
  }
  const byName = (said: string): string | null => {
    const meant = alongFolder(said) ?? nearest(said, was, called)
    if (meant === undefined) return null
    const landing = landed(meant)
    const from = landed(was)
    const held = (path: string) => path !== landing && holds(path, space)
    const along = fitting(joined(folderOf(from), said), space)
    const reachedAlong = namesNote(landing) && along.includes(landing)
    const taken =
      movedTo(meant) !== undefined ||
      along.some((path) => path !== landing) ||
      held(said) ||
      (!reachedAlong && captured(said, landing, from, space))
    return taken ? relativePath(folderOf(from), landing) : null
  }
  const follow = (path: string): string | null => {
    const top = path.replace(/^\/+/, '')
    const beside = joined(here, path)
    const dotted = /^\.{1,2}(\/|$)/.test(path)
    const fromTop = path.startsWith('/') || (!dotted && !known.has(foldName(beside)) && known.has(foldName(top)))
    if (!fromTop) {
      const now = movedTo(beside)
      if (now !== undefined) return relativePath(here, now)
      return dotted || known.has(foldName(beside)) ? null : byName(path)
    }
    if (!path.startsWith('/')) {
      const landing = landed(top)
      const from = folderOf(landed(was))
      const near = joined(from, landing)
      if (near !== landing && holds(near, space)) return relativePath(from, landing)
    }
    const now = movedTo(top) ?? (under && known.has(foldName(top)) ? top : undefined)
    if (now === undefined) return null
    if (path.startsWith('/') && !under) return relativePath(here, now)
    return `${path.startsWith('/') ? '/' : ''}${under ? `${under}/` : ''}${now}`
  }
  const tables = tableRanges(text)
  const properties = propertiesTo(text)
  return linksWritten(text, (link, words, spot) => {
    const whole = text.slice(link.from, link.to)
    if (spot.defined) return definitionFollowed(text, link, properties, follow)
    if (link.kind === 'markdown') {
      const bang = link.embed ? '!' : ''
      const label = text.slice(spot.labelFrom, spot.labelTo)
      const inside = text.slice(spot.labelTo + 2, link.to - 1)
      const kept = words === label ? whole : `${bang}[${words}](${inside})`
      const { target, title } = splitTarget(inside)
      if (!target || isAddress(target)) return kept
      const { path: written, fragment } = splitFragment(target)
      const now = follow(decoded(written))
      if (now === null) return kept
      const anchor = fragment === null ? '' : `#${fragment}`
      return `${bang}[${words}](${encodeTarget(now)}${anchor}${title})`
    }
    const { target, shown } = wikilinkParts(whole)
    const cell = shown !== undefined && target.endsWith('\\')
    const named = cell ? target.slice(0, -1) : target
    const { path, fragment } = splitFragment(named)
    const said = path.trim()
    const meant = nearest(said, was, called)
    if (meant === undefined) return whole
    const now = moved.get(meant)
    const respelt = now === undefined ? said : respelled(said, meant, now)
    if (respelt === null) return whole
    const renamed = under && said.startsWith('/') ? `/${under}/${respelt.replace(/^\/+/, '')}` : respelt
    const landing = landed(meant)
    const top = isMarkdownPath(landing) ? withoutExtension(landing) : landing
    const from = landed(was)
    const reached = !captured(renamed, landing, from, space)
      ? renamed
      : captured(top, landing, from, space)
        ? `/${top}`
        : top
    if (reached === said) return whole
    const bang = link.embed ? '!' : ''
    const anchor = fragment === null ? '' : `#${fragment}`
    const pipe = inCode(tables, link.from) ? '\\|' : '|'
    const shownWords = shown ?? (reached === renamed || bang || fragment !== null ? '' : `${pipe}${renamed}`)
    return `${bang}[[${path.replace(said, () => reached)}${anchor}${cell ? '\\' : ''}${shownWords}]]`
  })
}
export function calledBy(paths: readonly string[]): Map<string, string[]> {
  const called = new Map<string, string[]>()
  for (const path of paths) {
    const name = path.split('/').pop() ?? path
    const names = namesNote(path) ? [name, withoutExtension(name)] : [name]
    for (const one of names) {
      const key = foldName(one)
      const gathered = called.get(key)
      if (gathered) gathered.push(path)
      else called.set(key, [path])
    }
  }
  return called
}
function fitting(said: string, called: ReadonlyMap<string, string[]>): string[] {
  const wanted = foldName(said.replace(/^\/+/, ''))
  return (called.get(wanted.split('/').pop() ?? '') ?? []).filter((path) => {
    const whole = foldName(path)
    const bare = namesNote(path) ? foldName(withoutExtension(path)) : whole
    return [whole, bare].some((one) => one === wanted || one.endsWith(`/${wanted}`))
  })
}
function holds(path: string, space: ReadonlyMap<string, string[]>): boolean {
  const wanted = foldName(path)
  return fitting(path, space).some(
    (one) => foldName(namesNote(one) ? withoutExtension(one) : one) === wanted || foldName(one) === wanted,
  )
}
function captured(said: string, meant: string, from: string, space: ReadonlyMap<string, string[]>): boolean {
  if (said.startsWith('/')) return false
  const note = namesNote(meant)
  const here = foldName(folderOf(from))
  const depth = (path: string) => path.split('/').length
  const beside = (path: string) => (foldName(folderOf(path)) === here ? 0 : 1)
  return fitting(said, space).some(
    (path) =>
      namesNote(path) === note &&
      (beside(path) - beside(meant) || depth(path) - depth(meant) || (path < meant ? -1 : 1)) < 0,
  )
}
const namesNote = (path: string): boolean => isMarkdownPath(path) || isWebTarget(path)
function nearest(said: string, from: string, called: ReadonlyMap<string, string[]>): string | undefined {
  const fits = fitting(said, called)
  const here = folderOf(from)
  const depth = (path: string) => path.split('/').length
  const beside = (path: string) => (folderOf(path) === here ? 0 : 1)
  return [...fits].sort(
    (one, other) => beside(one) - beside(other) || depth(one) - depth(other) || (one < other ? -1 : 1),
  )[0]
}
function respelled(said: string, from: string, to: string): string | null {
  const lead = /^\/*/.exec(said)?.[0] ?? ''
  const parts = said.slice(lead.length).split('/')
  const last = parts.pop() ?? said
  const whole = from.split('/').pop() ?? from
  const name = [whole, withoutExtension(whole)].find((one) => foldName(one) === foldName(last))
  if (name === undefined) return null
  const fresh = to.split('/').pop() ?? to
  const after = name === whole ? fresh : withoutExtension(fresh)
  const spelled = after.startsWith(name) ? last + after.slice(name.length) : after
  const was = from.split('/').slice(0, -1)
  const now = to.split('/').slice(0, -1)
  const folders = parts.map((part, at) => {
    const back = parts.length - at
    const before = was[was.length - back]
    const moved = now[now.length - back]
    return moved === undefined || foldName(before ?? '') === foldName(moved) ? part : moved
  })
  return `${lead}${[...folders, spelled].join('/')}`
}
export function baseFollowed(bytes: Uint8Array, under: string, moved?: (path: string) => string): Uint8Array {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    return bytes
  }
  const followed = baseUnder(text, under, moved)
  return followed === text ? bytes : new TextEncoder().encode(followed)
}
const BASE_FENCE = /^(`{3,}|~{3,})[ \t]*base(?:[ \t][^\r\n]*)?\r?\n([\s\S]*?)^\1[`~]*[ \t]*\r?$/gm
export function basesFollowed(text: string, under: string, moved?: (path: string) => string): string {
  return text.replace(BASE_FENCE, (whole, _fence: string, yaml: string) => {
    const lines = yaml.replace(/\r\n/g, '\n')
    const followed = baseUnder(lines, under, moved)
    if (followed === lines) return whole
    return whole.replace(yaml, () => (lines === yaml ? followed : followed.replace(/\n/g, '\r\n')))
  })
}
export function isBase(path: string): boolean {
  return /\.base$/i.test(path)
}
function isSpacePath(path: string): boolean {
  return path !== '' && !/^[/\\]/.test(path) && !/^[a-z][a-z0-9+.-]*:/i.test(path)
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
const NEW_BLOCK = /^(?:[-+*][ \t]|\d{1,9}[.)][ \t]|#{1,6}(?:[ \t]|$)|`{3}|~{3}|([-*_])(?:[ \t]*\1){2,}[ \t]*$)/
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
      (lines[line] ?? '').trim() !== '' && !NEW_BLOCK.test(lines[line] ?? '') && depth(line) === depth(one)
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
function propertiesEnd(lines: readonly string[]): number {
  const text = lines.join('\n')
  const block = frontMatterBlock(text)
  return block ? text.slice(0, block.close).split('\n').length : 0
}
function propertiesTo(text: string): number {
  const lines = text.split('\n')
  return lines.slice(0, propertiesEnd(lines)).join('\n').length
}
const inCode = (ranges: readonly [number, number][], offset: number): boolean =>
  ranges.some(([from, to]) => offset >= from && offset < to)
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
      (one, other) => beside(one) - beside(other) || depth(one) - depth(other) || (one < other ? -1 : 1),
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
    const tries = (rooted ? [cleaned] : [joined(here, cleaned), cleaned]).flatMap((one) => [one, `${one}.md`])
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
      ([one], [other]) => beside(one) - beside(other) || depth(one) - depth(other) || (one < other ? -1 : 1),
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
