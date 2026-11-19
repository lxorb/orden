import { type EditorState, type Extension, Facet, StateEffect, StateField } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import {
  decodeFragment,
  decodeTarget,
  foldName,
  isTabFile,
  type LinkKind,
  pageFragment,
  type Wikilink,
} from '@orden/markdown/links'
import type { LinkPress } from '../links'

export interface NoteRef {
  path: string
  name: string
  headings: readonly string[]
  blocks: readonly string[]
  aliases: readonly string[]
  archived?: boolean
}
export interface SpaceTag {
  tag: string
  notes: number
}
export interface FileDrawing {
  kind: 'pdf' | 'canvas'
  path: string
  page: number | null
}
export interface SpaceBlock {
  path: string
  line: number
  text: string
  id: string | null
}
export interface NoteIndex {
  notes: readonly NoteRef[]
  files: readonly string[]
  path: string | null
  dueReads?: 'deadline'
  tags?: readonly SpaceTag[] | undefined
  searchBlocks?: ((text: string, most: number) => Promise<readonly SpaceBlock[]>) | undefined
  read: (path: string) => Promise<string | null>
  locked?: ((path: string) => boolean) | undefined
  query?: ((code: string, language?: string) => Promise<string | null>) | undefined
  pressRow?: ((target: EventTarget | null) => boolean) | undefined
  render?: ((source: string, path: string | null) => Promise<string>) | undefined
  drawFile?: ((card: HTMLElement, file: FileDrawing) => () => void) | undefined
  mountBase?: ((host: HTMLElement, ask: BaseAsk) => () => void) | undefined
}
export type BaseAsk = { code: string } | { target: string; view: string | null }
const EMPTY: NoteIndex = { notes: [], files: [], path: null, read: () => Promise.resolve(null) }
export const noteIndex = Facet.define<NoteIndex, NoteIndex>({
  combine: (values) => values[0] ?? EMPTY,
})
const setIndex = StateEffect.define<NoteIndex>()
const indexField = StateField.define<NoteIndex>({
  create: () => EMPTY,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setIndex)) return effect.value
    return value
  },
  provide: (field) => noteIndex.from(field),
})
export const noteIndexExtension = (index: NoteIndex | undefined): Extension => indexField.init(() => index ?? EMPTY)
export const noteIndexEffect = (index: NoteIndex): StateEffect<unknown> => setIndex.of(index)
export function setNoteIndex(view: EditorView, index: NoteIndex) {
  view.dispatch({ effects: setIndex.of(index) })
}
export interface NoteJump {
  path: string | null
  target: string
  heading: string | null
  block: string | null
  page: number | null
  kind?: LinkKind
}
export type NoteOpener = (jump: NoteJump, press?: LinkPress) => void
export const noteOpener = Facet.define<NoteOpener, NoteOpener>({
  combine: (values) => values[0] ?? (() => undefined),
})
export interface LinkWrite {
  name: string
  markdown?: string | null
  path?: string | null
  from?: string | null
  fragment?: string | null
  shown?: string | null
  file?: string | null
}
export const linkWriter = Facet.define<(target: LinkWrite) => string, (target: LinkWrite) => string>({
  combine: (values) => values[0] ?? wikilinkFor,
})
function wikilinkFor(target: LinkWrite): string {
  const inner = target.fragment ? `${target.name}#${target.fragment}` : target.name
  return `[[${inner}${target.shown ? `|${target.shown}` : ''}]]`
}
export function fuzzy(text: string, needle: string): boolean {
  if (!needle) return true
  const folded = foldName(text)
  let at = 0
  for (const character of needle) {
    at = folded.indexOf(character, at)
    if (at === -1) return false
    at++
  }
  return true
}
const OWN = /\.(md|markdown|mdown|mkd|url|webloc)$/i
const comparable = (path: string): string => foldName(path.replace(/\\/g, '/').replace(OWN, ''))
function folderOf(path: string): string {
  const at = path.replace(/\\/g, '/').lastIndexOf('/')
  return at === -1 ? '' : path.slice(0, at)
}
function targetOf(folded: string): { wanted: string; anchored: boolean } {
  const anchored = folded.startsWith('/')
  return { wanted: anchored ? folded.slice(1) : folded, anchored }
}
interface Lookup {
  size: number
  paths: Map<string, NoteRef[]>
  ends: Map<string, NoteRef[]>
  aliases: Map<string, NoteRef[]>
}
interface Order {
  top: NoteRef | null
  byFolder: Map<string, NoteRef>
}
const lookups = new WeakMap<readonly NoteRef[], Lookup>()
const orders = new WeakMap<readonly NoteRef[], Order>()
function filed(map: Map<string, NoteRef[]>, key: string, note: NoteRef) {
  const held = map.get(key)
  if (!held) map.set(key, [note])
  else if (held.at(-1) !== note) held.push(note)
}
function lookupOf(notes: readonly NoteRef[]): Lookup {
  const kept = lookups.get(notes)
  if (kept?.size === notes.length) return kept
  const made: Lookup = { size: notes.length, paths: new Map(), ends: new Map(), aliases: new Map() }
  for (const note of notes) {
    const path = comparable(note.path)
    filed(made.paths, path, note)
    filed(made.ends, path, note)
    for (let at = path.indexOf('/'); at !== -1; at = path.indexOf('/', at + 1))
      filed(made.ends, path.slice(at + 1), note)
    for (const alias of note.aliases) filed(made.aliases, comparable(alias), note)
  }
  lookups.set(notes, made)
  return made
}
function orderOf(candidates: readonly NoteRef[]): Order {
  const kept = orders.get(candidates)
  if (kept) return kept
  const depth = (path: string) => path.split('/').length
  const sorted = [...candidates].sort(
    (one, other) => depth(one.path) - depth(other.path) || (one.path < other.path ? -1 : 1),
  )
  const byFolder = new Map<string, NoteRef>()
  for (const note of sorted) {
    const folder = folderOf(note.path)
    if (!byFolder.has(folder)) byFolder.set(folder, note)
  }
  const made: Order = { top: sorted[0] ?? null, byFolder }
  orders.set(candidates, made)
  return made
}
function nearest(candidates: readonly NoteRef[], from: string | null): NoteRef | null {
  const order = orderOf(candidates)
  const beside = from === null ? undefined : order.byFolder.get(folderOf(from))
  return beside ?? order.top
}
export function resolveNote(index: NoteIndex, target: string): NoteRef | null {
  const { wanted, anchored } = targetOf(comparable(target.trim()))
  if (!wanted) return null
  const lookup = lookupOf(index.notes)
  const found = (anchored ? lookup.paths : lookup.ends).get(wanted)
  if (found) return nearest(found, index.path)
  if (anchored) return null
  const named = lookup.aliases.get(wanted)
  return named ? nearest(named, index.path) : null
}
export function shortestReaching(path: string, reaches: (written: string) => boolean): string {
  const parts = path.split('/')
  for (let from = parts.length - 1; from >= 0; from--) {
    const written = parts.slice(from).join('/')
    if (reaches(written)) return written
  }
  return `/${path}`
}
export function resolveRelative(index: NoteIndex, target: string): NoteRef | null {
  const parts = relativeParts(index, target)
  if (!parts.length) return null
  const whole = resolveNote(index, `/${parts.join('/')}`)
  if (whole || !freelyWritten(target)) return whole
  return resolveNote(index, `/${target}`) ?? resolveNote(index, target)
}
export function spacePathOf(index: NoteIndex, written: string): string {
  return relativeParts(index, written).join('/')
}
const LINK_MARKS = /[#|[\]^]/
const fileNameOf = (path: string) => path.slice(path.lastIndexOf('/') + 1)
export function fileLinkName(index: NoteIndex, path: string): string {
  const name = fileNameOf(path)
  const shared = index.files.some(
    (other) => foldName(other) !== foldName(path) && foldName(fileNameOf(other)) === foldName(name),
  )
  return shared && path && !LINK_MARKS.test(path) ? path : name
}
const freelyWritten = (target: string): boolean =>
  !/^\.{1,2}(?:[/\\]|$)/.test(target.trim()) && !/^[/\\]/.test(target.trim())
function relativeParts(index: NoteIndex, target: string): string[] {
  const written = target.replace(/\\/g, '/')
  const parts = index.path === null || written.startsWith('/') ? [] : folderOf(index.path).split('/').filter(Boolean)
  for (const part of written.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts
}
export function resolveFile(index: NoteIndex, target: string, kind: LinkKind): string | null {
  const written = target.trim().replace(/\\/g, '/')
  if (kind !== 'markdown') return fileAt(index, written)
  return (
    fileAt(index, `/${relativeParts(index, target).join('/')}`) ??
    (/^\.{0,2}\//.test(written) ? null : (fileAt(index, `/${written}`) ?? fileAt(index, written)))
  )
}
function fileAt(index: NoteIndex, target: string): string | null {
  const { wanted, anchored } = targetOf(foldName(target))
  if (!wanted) return null
  const here = index.path === null ? null : folderOf(index.path)
  const found = index.files.filter((path) => {
    const held = foldName(path)
    return held === wanted || (!anchored && held.endsWith(`/${wanted}`))
  })
  const beside = (path: string) => (folderOf(path) === here ? 0 : 1)
  return (
    [...found].sort(
      (one, other) =>
        beside(one) - beside(other) || one.split('/').length - other.split('/').length || (one < other ? -1 : 1),
    )[0] ?? null
  )
}
export function resolveLink(index: NoteIndex, link: Wikilink, kind: LinkKind): NoteRef | null {
  if (!link.target) return null
  return kind === 'markdown' ? resolveRelative(index, link.target) : resolveNote(index, link.target)
}
export function resolves(index: NoteIndex, link: Wikilink, kind: LinkKind): boolean {
  if (!link.target) return true
  if (isTabFile(link.target)) return resolveFile(index, link.target, kind) !== null
  return resolveLink(index, link, kind) !== null
}
export function archivedLink(index: NoteIndex, link: Wikilink, kind: LinkKind): boolean {
  if (!link.target || isTabFile(link.target)) return false
  return resolveLink(index, link, kind)?.archived === true
}
export function jumpFor(index: NoteIndex, link: Wikilink, kind: LinkKind): NoteJump {
  if (link.target && isTabFile(link.target)) {
    return {
      path: resolveFile(index, link.target, kind),
      target: link.target,
      heading: null,
      block: null,
      page: pageFragment(link.heading),
      kind,
    }
  }
  if (!link.target) {
    return {
      path: index.path,
      target: '',
      heading: link.heading,
      block: link.block,
      page: null,
      kind,
    }
  }
  const note = resolveLink(index, link, kind)?.path ?? null
  const file = note === null ? resolveFile(index, link.target, kind) : null
  return {
    path: note ?? file,
    target: link.target,
    heading: file === null ? link.heading : null,
    block: file === null ? link.block : null,
    page: null,
    kind,
  }
}
export function jumpForHref(index: NoteIndex, href: string, wiki: boolean): NoteJump | null {
  const hash = href.indexOf('#')
  const target = decodeTarget(hash === -1 ? href : href.slice(0, hash))
  const said = hash === -1 ? null : decodeFragment(href.slice(hash + 1)) || null
  if (!target) return null
  if (isTabFile(target)) {
    const path = wiki ? target : resolveFile(index, target, 'markdown')
    return path === null ? null : { path, target, heading: null, block: null, page: pageFragment(said) }
  }
  const found = wiki ? { path: target } : (resolveRelative(index, target) ?? resolveNote(index, target))
  if (!found) return null
  const block = said?.startsWith('^') ? said.slice(1) : null
  return { path: found.path, target, heading: block === null ? said : null, block, page: null }
}
const MARKDOWN_NAME = /\.(md|markdown|mdown|mkd)$/i
export function nameFor(index: NoteIndex, note: NoteRef): string {
  const own = MARKDOWN_NAME.exec(note.path)?.[0] ?? ''
  const spelled = (written: string) => (isTabFile(written) ? `${written}${own}` : written)
  const opened = index.files.includes(note.path)
  const reaches = (written: string) =>
    (opened && isTabFile(written) ? resolveFile(index, written, 'wikilink') : resolveNote(index, written)?.path) ===
    note.path
  const name = spelled(note.name)
  if (reaches(name)) return name.normalize('NFC')
  const parts = note.path.replace(MARKDOWN_NAME, '').split('/')
  for (let from = parts.length - 1; from >= 0; from--) {
    const written = spelled(parts.slice(from).join('/'))
    if (reaches(written)) return written.normalize('NFC')
  }
  const fromTop = spelled(`/${parts.join('/')}`)
  return (reaches(fromTop) ? fromTop : name).normalize('NFC')
}
export function linkNameAt(state: EditorState, path: string): string | null {
  const index = state.facet(noteIndex)
  const note = index.notes.find((one) => one.path === path)
  return note ? nameFor(index, note) : null
}
