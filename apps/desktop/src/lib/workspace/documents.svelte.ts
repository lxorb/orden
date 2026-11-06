import { type FoldLines, SharedDoc } from '@orden/editor'
import type { Camera } from '../camera'
import { identifier } from '../identifier'
import { t } from '../i18n.svelte'
import { draftName, shownName, TITLE_CHARS } from '../note-name'
import { oneEdit } from '@orden/markdown/edits'
import { applied, appliedToFile, type Edit, flatEdits } from '../search/replace'
import { samePath } from '../space-paths'
import { type TabKind, TAB_KINDS } from './tab-kinds'

export const UNTITLED = 'Untitled'

export const opening = { source: false }

export type { TabKind }

export function holdsWords(kind: TabKind): boolean {
  return TAB_KINDS[kind].words
}

export function unixLines(text: string): string {
  return text.includes('\r') ? text.replace(/\r\n?/g, '\n') : text
}

function inEditorCount(before: string, edits: readonly Edit[]): { words: string; edits: Edit[] } {
  if (before.includes('\r') || !edits.some((one) => one.insert.includes('\r'))) {
    return flatEdits(before, edits)
  }
  const one = oneEdit(before, unixLines(applied(before, edits)))
  return { words: before, edits: one ? [one] : [] }
}

export interface DocumentStart {
  kind: TabKind
  path: string | null
  name: string
  text: string
  dirty: boolean
  shared?: string | null
  home?: string | null
}

export class NoteDoc {
  readonly key = identifier()
  readonly kind: TabKind

  path = $state<string | null>(null)
  name = $state('')
  dirty = $state(false)

  readonly shared: string | null

  readonly live: SharedDoc

  private words = $state('')
  private behind = false

  revision = $state(0)
  restoredAt: number | null = null
  private quiet = false

  home = $state<string | null>(null)

  private before: string | null

  get onDisk(): string | null {
    return this.knownOnDisk
  }

  set onDisk(to: string | null) {
    this.knownOnDisk = to === null ? null : unixLines(to)
  }

  private knownOnDisk: string | null = null

  constructor(start: DocumentStart, edited: (doc: NoteDoc) => void) {
    this.kind = start.kind
    this.shared = start.shared ?? null
    this.home = start.home ?? null
    this.path = start.path
    this.name = start.name
    this.dirty = start.dirty
    this.words = unixLines(start.text)
    this.before = start.path !== null && !start.dirty ? start.text : null
    this.onDisk = this.before === null ? null : this.words
    this.live = new SharedDoc(start.text)
    this.retitle()

    this.live.onChange = () => {
      this.behind = true
      this.revision++
      this.retitle()
      if (this.quiet) return

      this.dirty = true
      edited(this)
    }
  }

  get text(): string {
    return this.words
  }

  get latest(): string {
    return this.behind ? this.live.text.toString() : this.words
  }

  pasted = $state(false)

  private get unnamed(): boolean {
    return this.path === null && this.name === UNTITLED
  }

  private firstWords = $state<string | null>(null)

  private get titleWords(): string | null {
    return this.kind === 'note' ? this.firstWords : null
  }

  readonly shown = $derived(
    this.unnamed ? (this.titleWords ?? t('Untitled')) : shownName(this.name),
  )

  get blank(): boolean {
    const text = this.live.text
    if (text.length > TITLE_CHARS) return false

    return text.sliceString(0, TITLE_CHARS).trim().length === 0
  }

  firstVersion(): string | null {
    const before = this.before
    this.before = null
    return before
  }

  private retitle() {
    if (!this.unnamed) return

    this.firstWords = draftName(this.live.text.sliceString(0, TITLE_CHARS).split('\n'))
  }

  flush() {
    if (!this.behind) return

    this.behind = false
    const text = this.live.text.toString()
    if (this.words !== text) this.words = text
  }

  private quietly(change: () => void) {
    this.quiet = true
    try {
      change()
    } finally {
      this.quiet = false
    }
  }

  replace(
    written: string,
    dirty = true,
    changed?: { from: string; changes: readonly { from: number; to: number; insert: string }[] },
  ) {
    const text = unixLines(written)
    const known = changed && !this.behind && this.words === changed.from
    const put = () => this.live.replace(text, dirty, known ? changed.changes : undefined)
    if (dirty) put()
    else this.quietly(put)

    this.words = text
    this.behind = false
    this.dirty = dirty
    if (!dirty) this.onDisk = text
    if (!dirty && this.before !== null) this.before = written
  }

  wroteAs(written: string) {
    const text = unixLines(written)
    if (this.behind || this.words !== text) return
    this.dirty = false
    this.onDisk = text
    if (this.before !== null) this.before = written
  }

  edited(changes: readonly { from: number; to: number; insert: string }[], text: string) {
    const from = text.includes('\r') ? this.asFile() : this.words
    this.applyLive(inEditorCount(from, changes).edits, text)
  }

  take(edits: readonly Edit[], before: string): { text: string; edits: Edit[]; flat: string } {
    this.flush()
    const flat = this.words
    const worked = inEditorCount(before, edits)
    const file = this.asFile(before)
    const carried = this.live.carried(worked.edits, worked.words, true) ?? worked.edits
    const text = file === flat ? applied(flat, carried) : appliedToFile(file, carried)
    this.applyLive(carried, text)
    return { text, edits: carried, flat }
  }

  private asFile(read?: string): string {
    for (const file of [this.before, read]) {
      if (file?.includes('\r') && unixLines(file) === this.words) return file
    }
    return this.words
  }

  private applyLive(changes: readonly Edit[], text: string) {
    this.quietly(() => this.live.edit(changes))

    this.words = unixLines(text)
    this.behind = false
    this.dirty = false
    this.onDisk = text
    if (this.before !== null) this.before = text
  }

  took(change: { from: number; to: number; insert: string } | null, to: string) {
    if (!change) return
    this.quietly(() => this.live.arrived([change]))
    this.behind = this.live.text.toString() !== to
    if (!this.behind) this.words = to
  }

  tookWhole(to: string) {
    this.quietly(() => this.live.replace(to, false))
    this.words = to
    this.behind = false
  }

  adopt(note: { path: string; name: string; text: string }) {
    const text = unixLines(note.text)
    this.path = note.path
    this.name = note.name
    this.before = note.text
    this.onDisk = text
    this.arrivals++

    this.quietly(() => this.live.takeOn(text))

    this.words = text
    this.behind = false
    this.dirty = false
  }

  arrivals = $state(0)

  written(path: string, name: string, revision: number) {
    const moved = !samePath(this.path, path)
    if (!moved) this.name = name
    this.dirty = moved || this.revision !== revision
    this.before = null
  }
}

export class Tab {
  readonly id = identifier()

  note: NoteDoc

  paneId = $state('')

  cursor = $state<number | undefined>(undefined)
  scroll = $state<number | undefined>(undefined)
  anchor = $state<number | undefined>(undefined)
  line = $state<number | undefined>(undefined)
  folds = $state<readonly FoldLines[] | undefined>(undefined)

  trail = $state<readonly string[]>([])
  at = $state(0)

  get canGoBack(): boolean {
    return this.at > 0
  }

  get canGoForward(): boolean {
    return this.at < this.trail.length - 1
  }

  essential = $state<string | null>(null)

  reading = $state(false)

  source = $state(opening.source)

  coming = $state(false)

  camera = $state<Camera | undefined>(undefined)

  zoomChosen = false

  address = $state<string | undefined>(undefined)

  apart = $state<string | null>(null)

  inPrivate = false

  page = $state<number | undefined>(undefined)
  zoom = $state<number | undefined>(undefined)

  running = $state<{
    name: string | null
    program: string | null
    host: string | null
    colour: string | null
  } | null>(null)

  unloaded = $state(false)

  naming = $state(false)

  constructor(note: NoteDoc, paneId: string) {
    this.note = $state(note)
    this.paneId = paneId
  }

  get kind(): TabKind {
    return this.note.kind
  }

  get path(): string | null {
    return this.note.path
  }

  set path(to: string | null) {
    this.note.path = to
  }

  get name(): string {
    return this.note.name
  }

  set name(to: string) {
    this.note.name = to
  }

  get nowhere(): boolean {
    return this.kind === 'web' && this.path === null && !this.address
  }

  get shown(): string {
    if (this.nowhere) return t('New tab')
    return this.running?.name ?? this.note.shown
  }

  get doc(): string {
    return this.note.text
  }

  get dirty(): boolean {
    return this.note.dirty
  }

  set dirty(to: boolean) {
    this.note.dirty = to
  }
}
