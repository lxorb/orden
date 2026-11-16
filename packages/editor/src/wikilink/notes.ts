import { type Extension, Facet, StateEffect, StateField } from '@codemirror/state'
import type { TextEdit } from '@orden/markdown/edits'
import type { TaskChange } from '@orden/markdown/task-edits'
import type { TaskFields } from '@orden/markdown/task-line'
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
  tasks?: TaskHelp | undefined
  mountBase?: ((host: HTMLElement, ask: BaseAsk) => () => void) | undefined
}

export interface DayTyped {
  from: number
  due: string
  time?: string
  label: string
}

export interface TaskHelp {
  tick(note: string, line: number): Promise<readonly TextEdit[]>
  pick(
    field: string,
    fields: TaskFields,
    at: DOMRect,
    due: 'start' | 'deadline',
    change: (change: TaskChange) => void,
  ): void
  dayAtEnd(text: string): DayTyped | null
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
    for (const effect of transaction.effects) {
      if (effect.is(setIndex)) return effect.value
    }
    return value
  },
  provide: (field) => noteIndex.from(field),
})

export function noteIndexExtension(index: NoteIndex | undefined): Extension {
  return indexField.init(() => index ?? EMPTY)
}

export function noteIndexEffect(index: NoteIndex): StateEffect<unknown> {
  return setIndex.of(index)
}

export function setNoteIndex(view: EditorView, index: NoteIndex) {
  view.dispatch({ effects: setIndex.of(index) })
}

export interface NoteJump {
  path: string | null
  target: string
  heading: string | null
  block: string | null
  page: number | null
}

export type NoteOpener = (jump: NoteJump, press?: LinkPress) => void

export const noteOpener = Facet.define<NoteOpener, NoteOpener>({
  combine: (values) => values[0] ?? (() => undefined),
})

export interface LinkWrite {
  name: string
  path?: string | null
  from?: string | null
  fragment?: string | null
}

export const linkWriter = Facet.define<
  (target: LinkWrite) => string,
  (target: LinkWrite) => string
>({ combine: (values) => values[0] ?? wikilinkFor })

function wikilinkFor(target: LinkWrite): string {
  return `[[${target.fragment ? `${target.name}#${target.fragment}` : target.name}]]`
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

function comparable(path: string): string {
  return foldName(path.replace(/\\/g, '/').replace(OWN, ''))
}

function folderOf(path: string): string {
  const at = path.replace(/\\/g, '/').lastIndexOf('/')
  return at === -1 ? '' : path.slice(0, at)
}

function targetOf(folded: string): { wanted: string; anchored: boolean } {
  const anchored = folded.startsWith('/')
  return { wanted: anchored ? folded.slice(1) : folded, anchored }
}

function nearest(candidates: readonly NoteRef[], from: string | null): NoteRef | null {
  const here = from === null ? null : folderOf(from)
  const depth = (path: string) => path.split('/').length
  const beside = (note: NoteRef) => (folderOf(note.path) === here ? 0 : 1)

  return (
    [...candidates].sort(
      (one, other) =>
        beside(one) - beside(other) ||
        depth(one.path) - depth(other.path) ||
        (one.path < other.path ? -1 : 1),
    )[0] ?? null
  )
}

interface Lookup {
  whole: Map<string, NoteRef[]>
  ending: Map<string, NoteRef[]>
  aliased: Map<string, NoteRef[]>
}

const lookups = new WeakMap<readonly NoteRef[], Lookup>()

function filed(into: Map<string, NoteRef[]>, key: string, note: NoteRef) {
  const known = into.get(key)
  if (known) known.push(note)
  else into.set(key, [note])
}

function lookupOf(notes: readonly NoteRef[]): Lookup {
  const known = lookups.get(notes)
  if (known) return known

  const lookup: Lookup = { whole: new Map(), ending: new Map(), aliased: new Map() }
  for (const note of notes) {
    const path = comparable(note.path)
    filed(lookup.whole, path, note)
    filed(lookup.ending, path, note)
    for (let at = path.indexOf('/'); at !== -1; at = path.indexOf('/', at + 1)) {
      filed(lookup.ending, path.slice(at + 1), note)
    }
    for (const alias of new Set(note.aliases.map(comparable))) filed(lookup.aliased, alias, note)
  }
  lookups.set(notes, lookup)
  return lookup
}

export function resolveNote(index: NoteIndex, target: string): NoteRef | null {
  const { wanted, anchored } = targetOf(comparable(target.trim()))
  if (!wanted) return null

  const lookup = lookupOf(index.notes)
  const found = (anchored ? lookup.whole : lookup.ending).get(wanted)
  if (found?.length) return nearest(found, index.path)
  if (anchored) return null

  const named = lookup.aliased.get(wanted)
  return named?.length ? nearest(named, index.path) : null
}

export function resolveRelative(index: NoteIndex, target: string): NoteRef | null {
  const parts = relativeParts(index, target)
  if (!parts.length) return null
  const whole = resolveNote(index, `/${parts.join('/')}`)
  if (whole || target.replace(/\\/g, '/').startsWith('/')) return whole
  return resolveNote(index, parts.join('/'))
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

function relativeParts(index: NoteIndex, target: string): string[] {
  const written = target.replace(/\\/g, '/')
  const parts =
    index.path === null || written.startsWith('/')
      ? []
      : folderOf(index.path).split('/').filter(Boolean)

  for (const part of written.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }

  return parts
}

export function resolveFile(index: NoteIndex, target: string, kind: LinkKind): string | null {
  const { wanted, anchored } = targetOf(
    foldName(
      kind === 'markdown'
        ? relativeParts(index, target).join('/')
        : target.trim().replace(/\\/g, '/'),
    ),
  )
  if (!wanted) return null

  const whole = kind === 'markdown' || anchored
  const found = index.files.filter((path) => {
    const held = foldName(path)
    return held === wanted || (!whole && held.endsWith(`/${wanted}`))
  })

  return (
    [...found].sort(
      (one, other) => one.split('/').length - other.split('/').length || (one < other ? -1 : 1),
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
    }
  }

  return {
    path: link.target ? (resolveLink(index, link, kind)?.path ?? null) : index.path,
    target: link.target,
    heading: link.heading,
    block: link.block,
    page: null,
  }
}

export function jumpForHref(index: NoteIndex, href: string, wiki: boolean): NoteJump | null {
  const hash = href.indexOf('#')
  const target = decodeTarget(hash === -1 ? href : href.slice(0, hash))
  const said = hash === -1 ? null : decodeFragment(href.slice(hash + 1)) || null
  if (!target) return null

  if (isTabFile(target)) {
    const path = wiki ? target : resolveFile(index, target, 'markdown')
    return path === null
      ? null
      : { path, target, heading: null, block: null, page: pageFragment(said) }
  }

  const found = wiki
    ? { path: target }
    : (resolveRelative(index, target) ?? resolveNote(index, target))
  if (!found) return null

  const block = said?.startsWith('^') ? said.slice(1) : null
  return { path: found.path, target, heading: block === null ? said : null, block, page: null }
}
