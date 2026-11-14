import {
  type FileDrawing,
  type NoteIndex,
  type NoteRef,
  resolveFile,
  resolveNote,
  resolveRelative,
  type SpaceBlock,
  type SpaceTag,
} from '@orden/editor'
import type { EmbeddedNote } from '@orden/markdown'
import { oneEdit } from '@orden/markdown/edits'
import {
  blockIdOf,
  blockIds,
  foldName,
  type FoundLink,
  freeBlockId,
  isCanvasTarget,
  isChatTarget,
  isPagesTarget,
  isTabFile,
  isTermTarget,
  isWebTarget,
  type LinkKind,
  withoutBlockIds,
} from '@orden/markdown/links'
import { breathe } from './breathe'
import { buildGraph, type NoteGraph } from './graph'
import { type Placed, retargetLinks } from './link-rewrite'
import { AGENTS_NAME, shownName } from './note-name'
import type { Hit } from '@orden/scan/search/match'
import { parseQuery } from '@orden/scan/search/query'
import { searchSpace } from './search/space'
import { type ScannedNote, scanNote, scanShortcut, type SpaceLinks } from '@orden/scan/note'
import { startup } from './startup.svelte'
import { mark } from './trace'
import {
  folderOf,
  insideSpace,
  isHiddenPath,
  isMarkdownPath,
  nameOf,
  noteName,
  relativePath,
  samePath,
  within,
} from './space-paths'
import { elsewhere } from './marks-elsewhere.svelte'
import { invoke } from './tauri'
import { coveredBy } from './workspace/archive.svelte'
import type { NoteDoc } from './workspace/documents.svelte'
import type { FileOp } from './workspace/file-ops'
import { inFileTurn, keepVersion, readText, writeEdited, writeInTurn } from './workspace/in-turn'
import { log } from './log'

export interface Reference {
  path: string
  name: string
  line: number
  text: string
}

export interface Outgoing extends Reference {
  target: string
  to: string | null
}

const MOST_MENTIONS = 200

const NOTHING: ReadonlySet<string> = new Set()

const CACHED = 24

const OWN = /\.(md|markdown|mdown|mkd|url|webloc)$/i

export function readsWords(path: string): boolean {
  return isMarkdownPath(path) || isCanvasTarget(path) || isPagesTarget(path) || isWebTarget(path)
}

function comparable(path: string): string {
  return foldName(path.replace(/\\/g, '/').replace(OWN, ''))
}

function namesOf(note: { path: string; aliases: readonly string[] }): ReadonlySet<string> {
  const folded = note.aliases.map((alias) => comparable(alias.trim())).filter(Boolean)
  return new Set([comparable(nameOf(note.path)), ...folded])
}

interface Held {
  notes: ScannedNote[]
  files: readonly string[]
}

let queryBlock: typeof import('./query-block') | null = null

// eslint-disable-next-line svelte/prefer-svelte-reactivity -- listeners, never rendered
const hearing = new Set<(path: string, content: string, arrived: boolean) => void>()

// eslint-disable-next-line svelte/prefer-svelte-reactivity -- listeners, never rendered
const indexing = new Set<(root: string, scans: readonly ScannedNote[]) => void>()

export interface Retargeting {
  moved?: boolean
  only?: readonly string[]
  touched?: string[]
}

interface OtherSpace {
  refs: NoteRef[]
  files: readonly string[]
}

function resolvedIn(index: NoteIndex, link: { kind: LinkKind; target: string }): string | null {
  if (!link.target) return null
  if (isTabFile(link.target)) return resolveFile(index, link.target, link.kind)
  const found =
    link.kind === 'markdown' ? resolveRelative(index, link.target) : resolveNote(index, link.target)
  return found?.path ?? null
}

function stillReaches(
  source: string,
  link: { kind: LinkKind; target: string },
  found: string,
  there: string,
  loose: boolean,
  folded: boolean,
): boolean {
  const spelled = (path: string) => {
    const plain = path.replace(/\\/g, '/').normalize('NFC')
    return folded ? foldName(plain) : plain
  }
  const ends = (path: string, written: string) => path === written || path.endsWith(`/${written}`)
  const at = spelled(there)

  if (link.kind === 'markdown') {
    const target = spelled(link.target)
    const parts = target.startsWith('/') ? [] : spelled(folderOf(source)).split('/').filter(Boolean)
    for (const part of target.split('/')) {
      if (part === '' || part === '.') continue
      if (part === '..' && !parts.pop()) return false
      if (part !== '..') parts.push(part)
    }
    const written = parts.join('/')
    const whole = !loose || target.startsWith('/') || comparable(found) === comparable(written)
    return !whole && isMarkdownPath(at) ? ends(at, written) : at === written
  }

  const written = spelled(link.target)
  if (written.startsWith('/')) {
    const whole = written.slice(1)
    return at === whole || shownName(at) === whole
  }
  return ends(at, written) || ends(shownName(at), written)
}

const BREATHE_EVERY = 500

interface FilesNamed {
  whole: ReadonlyMap<string, readonly string[]>
  last: ReadonlyMap<string, readonly string[]>
}

function filesByName(files: readonly string[]): FilesNamed {
  const whole = new Map<string, string[]>()
  const last = new Map<string, string[]>()
  const add = (map: Map<string, string[]>, key: string, path: string) => {
    const held = map.get(key)
    if (held) held.push(path)
    else map.set(key, [path])
  }
  for (const path of files) {
    add(whole, foldName(path), path)
    add(last, foldName(nameOf(path)), path)
  }
  return { whole, last }
}

function fileNamed(
  named: FilesNamed,
  source: string,
  link: { kind: LinkKind; target: string },
): string | null {
  let files: readonly string[] | undefined
  if (link.kind === 'markdown') {
    const target = link.target.replace(/\\/g, '/')
    const parts = target.startsWith('/') ? [] : folderOf(source).split('/').filter(Boolean)
    for (const part of target.split('/')) {
      if (part === '' || part === '.') continue
      if (part === '..') parts.pop()
      else parts.push(part)
    }
    files = named.whole.get(foldName(parts.join('/')))
  } else {
    const last = link.target.trim().replace(/\\/g, '/').split('/').pop() ?? ''
    files = named.last.get(foldName(last))
  }
  if (!files) return null
  return resolveFile({ notes: [], files, path: source, read: nothing }, link.target, link.kind)
}

function refOf(note: ScannedNote): NoteRef {
  return {
    path: note.path,
    name: note.name,
    headings: note.headings,
    blocks: note.blocks,
    aliases: note.aliases,
  }
}

class Links {
  private notes = $state.raw<ScannedNote[]>([])
  private files = $state.raw<readonly string[]>([])
  private root: string | null = null
  private vault = false
  version = $state(0)
  scanning = $state(false)

  private read = new Map<string, string>()

  archivedIn: (root: string) => ReadonlySet<string> = () => NOTHING

  spaceOf: (path: string) => string | null = () => null
  lockedAt: (path: string) => boolean = () => false
  locksSeen: () => string = () => ''

  private others = new Map<string, OtherSpace | 'reading'>()

  private isInstructions(relative: string): boolean {
    return samePath(relative, AGENTS_NAME, this.root ?? undefined)
  }

  private get archived(): ReadonlySet<string> {
    return this.root === null ? NOTHING : this.archivedIn(this.root)
  }

  private readonly refs = $derived.by((): NoteRef[] => {
    const archived = this.archived

    return this.notes.map((note) => ({
      path: note.path,
      name: note.name,
      headings: note.headings,
      blocks: note.blocks,
      aliases: note.aliases,
      ...(coveredBy(archived, note.path) === null && !this.isInstructions(note.path)
        ? {}
        : { archived: true }),
    }))
  })

  private readonly seen = $derived.by((): ScannedNote[] => {
    this.locksSeen()
    const root = this.root
    if (root === null) return this.notes
    return this.notes.map((note) =>
      this.lockedAt(insideSpace(root, note.path))
        ? { ...note, headings: [], blocks: [], aliases: [], tags: [], links: [] }
        : note,
    )
  })

  readonly spaceTags = $derived.by((): SpaceTag[] => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and thrown away inside the derived
    const counts = new Map<string, number>()
    const archived = this.archived

    for (const note of this.seen) {
      if (coveredBy(archived, note.path) !== null || this.isInstructions(note.path)) continue

      const under: string[] = []

      for (const tag of note.tags) {
        const parts = tag.split('/').filter(Boolean)
        for (let depth = 1; depth <= parts.length; depth++) {
          const path = parts.slice(0, depth).join('/')
          if (!under.includes(path)) under.push(path)
        }
      }

      for (const path of under) counts.set(path, (counts.get(path) ?? 0) + 1)
    }

    return [...counts]
      .map(([tag, notes]) => ({ tag, notes }))
      .sort((one, other) => other.notes - one.notes || (one.tag < other.tag ? -1 : 1))
  })

  readonly graph = $derived.by((): NoteGraph =>
    buildGraph(this.seen, (from, link) => this.resolveFrom(from, link)),
  )

  readonly graphWithFiles = $derived.by((): NoteGraph =>
    buildGraph(this.seen, (from, link) => this.resolveFrom(from, link), { attachments: true }),
  )

  pictureOf(attachments: boolean): NoteGraph {
    return attachments ? this.graphWithFiles : this.graph
  }

  async build(root: string) {
    const mine = ++this.scans
    this.root = root
    this.vault = false
    elsewhere.clear()
    this.others.clear()
    this.scanning = true
    this.notes = []
    this.files = []
    this.since = []
    this.changed()

    let landed: () => void = () => undefined
    this.landing = new Promise<void>((go) => (landed = go))

    await startup.turn('index')
    if (this.scans !== mine) {
      landed()
      return
    }

    mark('scan_links asked')
    void import('./rows/vault').then(async ({ isVault }) => {
      if ((await isVault(root)) && this.scans === mine) {
        this.vault = true
        this.changed()
      }
    })
    const found = await invoke<SpaceLinks>('scan_links', { root }).catch(() => null)
    mark('scan_links answered')

    if (this.scans !== mine) {
      landed()
      return
    }

    this.scanning = false
    const held = this.since.reduce<Held>((now, again) => again(now), {
      notes: found?.notes ?? [],
      files: found?.files ?? [],
    })
    this.notes = held.notes
    this.files = held.files
    this.since = []
    this.changed()
    landed()
  }

  private landing: Promise<void> = Promise.resolve()

  private scans = 0

  private since: ((held: Held) => Held)[] = []

  private edit(change: (notes: readonly ScannedNote[]) => ScannedNote[]) {
    if (this.scanning) this.since.push((held) => ({ ...held, notes: change(held.notes) }))

    this.notes = change(this.notes)
    this.changed()
  }

  private editFiles(change: (files: readonly string[]) => readonly string[]) {
    if (this.scanning) this.since.push((held) => ({ ...held, files: change(held.files) }))

    const files = change(this.files)
    if (files === this.files) return

    this.files = files
    this.changed()
  }

  scanned(): Promise<void> {
    return this.scanning ? this.landing : Promise.resolve()
  }

  rootOf(): string | null {
    return this.root
  }

  private readonly icons = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and thrown away inside the derived
    const map = new Map<string, string>()

    for (const note of this.notes) {
      if (note.icon) map.set(note.path, note.icon)
    }

    return map
  })

  private readonly tints = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and thrown away inside the derived
    const map = new Map<string, string>()

    for (const note of this.notes) {
      if (note.icon && note.iconColor) map.set(note.path, note.iconColor)
    }

    return map
  })

  private readonly addresses = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and thrown away inside the derived
    const map = new Map<string, string>()

    for (const note of this.notes) {
      if (note.url) map.set(note.path, note.url)
    }

    return map
  })

  private readonly websites = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and thrown away inside the derived
    const map = new Map<string, { address: string | null; favicon: string | null }>()

    for (const note of this.notes) {
      if (note.favicon || note.address) {
        map.set(note.path, { address: note.address, favicon: note.favicon })
      }
    }

    return map
  })

  private readonly covers = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and thrown away inside the derived
    const map = new Map<string, string>()

    for (const note of this.notes) {
      if (note.cover) map.set(note.path, note.cover)
    }

    return map
  })

  private readonly bare = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and thrown away inside the derived
    const set = new Set<string>()

    for (const note of this.notes) {
      if (note.bare) set.add(note.path)
    }

    return set
  })

  saysNothing(path: string): boolean {
    const relative = this.relative(path) ?? path.replace(/\\/g, '/')
    return this.bare.has(relative)
  }

  iconOf(path: string): string | null {
    const relative = this.relative(path) ?? path.replace(/\\/g, '/')
    return this.icons.get(relative) ?? null
  }

  coverOf(path: string): string | null {
    const relative = this.relative(path) ?? path.replace(/\\/g, '/')
    return this.covers.get(relative) ?? null
  }

  tintOf(path: string): string | null {
    const relative = this.relative(path) ?? path.replace(/\\/g, '/')
    return this.tints.get(relative) ?? null
  }

  urlOf(path: string): string | null {
    const relative = this.relative(path) ?? path.replace(/\\/g, '/')
    return this.addresses.get(relative) ?? null
  }

  faviconOf(path: string): string | null {
    const relative = this.relative(path) ?? path.replace(/\\/g, '/')
    return this.websites.get(relative)?.favicon ?? null
  }

  shortcutOf(path: string): string | null {
    const relative = this.relative(path) ?? path.replace(/\\/g, '/')
    return this.websites.get(relative)?.address ?? null
  }

  get websitesHere(): ReadonlyMap<string, { address: string | null; favicon: string | null }> {
    return this.websites
  }

  get websiteNotes(): boolean {
    return this.addresses.size > 0
  }

  clear() {
    this.scans++
    this.root = null
    this.others.clear()
    this.scanning = false
    this.notes = []
    this.files = []
    this.since = []
    this.changed()
  }

  private changed() {
    this.read.clear()
    this.resolved.clear()
    this.version++
  }

  noteSaved(path: string, content: string, arrived = false) {
    if (this === links) for (const hear of hearing) hear(path, content, arrived)
    const relative = this.relative(path)
    if (!relative) {
      this.otherSaved(path, content)
      elsewhere.saved(path, content)
      return
    }

    if (isHiddenPath(relative)) return

    if (!isMarkdownPath(relative)) this.fileAdded(relative)

    if (isChatTarget(relative) || isTermTarget(relative)) {
      elsewhere.saved(path, content)
      return
    }

    if (isCanvasTarget(relative) || isPagesTarget(relative)) {
      this.putCanvas(relative, content)
      return
    }

    if (isWebTarget(relative)) {
      this.put(scanShortcut(relative, content))
      return
    }

    if (!isMarkdownPath(relative)) return

    this.put(scanNote(relative, content))
    this.read.set(relative, content)
  }

  hearSaves(hear: (path: string, content: string, arrived: boolean) => void): () => void {
    hearing.add(hear)
    return () => hearing.delete(hear)
  }

  indexed(root: string, scans: readonly ScannedNote[]) {
    if (!scans.length) return
    if (this === links) for (const hear of indexing) hear(root, scans)
    if (this.root !== null && samePath(root, this.root)) this.put(...scans)
  }

  hearIndexed(hear: (root: string, scans: readonly ScannedNote[]) => void): () => void {
    indexing.add(hear)
    return () => indexing.delete(hear)
  }

  held(): readonly ScannedNote[] {
    return this.notes
  }

  canvasRead(path: string, content: string) {
    const relative = this.relative(path)
    if (
      !relative ||
      isHiddenPath(relative) ||
      !(isCanvasTarget(relative) || isPagesTarget(relative))
    )
      return

    this.putCanvas(relative, content)
  }

  private putCanvas(relative: string, content: string) {
    const mine = this.scans
    void import('@orden/scan/canvas').then(({ scanCanvas }) => {
      if (this.scans !== mine) return

      const read = scanCanvas(relative, content)
      const held = this.notes.find((note) => note.path === relative)
      if (!held || JSON.stringify(held) !== JSON.stringify(read)) this.put(read)
    })
  }

  private put(...scanned: ScannedNote[]) {
    this.edit((notes) =>
      scanned.reduce<ScannedNote[]>((held, one) => {
        const at = held.findIndex((note) => note.path === one.path)
        return at === -1 ? [...held, one] : [...held.slice(0, at), one, ...held.slice(at + 1)]
      }, notes.slice()),
    )
  }

  noteGone(path: string) {
    const relative = this.relative(path)
    if (!relative) return

    const inside = (one: string) => one === relative || one.startsWith(`${relative}/`)
    const gone = (notes: readonly ScannedNote[]) => notes.filter((note) => !inside(note.path))

    this.editFiles((files) => (files.some(inside) ? files.filter((one) => !inside(one)) : files))

    if (!this.scanning && gone(this.notes).length === this.notes.length) return

    this.edit(gone)
  }

  async cameBack(path: string, folder: boolean) {
    const relative = this.relative(path)
    if (!relative || isHiddenPath(relative)) return

    const mine = this.scans

    if (!folder) {
      if (!readsWords(relative)) {
        this.fileAdded(relative)
        return
      }

      const content = await invoke<string>('read_note', { path }).catch(() => null)
      if (content !== null && this.scans === mine) this.noteSaved(path, content)
      return
    }

    const found = await invoke<SpaceLinks>('scan_links', { root: path }).catch(() => null)
    if (!found || this.scans !== mine) return

    const within = (one: string) => `${relative}/${one}`
    this.fileAdded(...found.files.map(within))
    this.put(...found.notes.map((note) => ({ ...note, path: within(note.path) })))
  }

  notesMoved(from: string, to: string) {
    const was = this.relative(from)
    const now = this.relative(to)
    if (!was || !now) return
    if (isHiddenPath(now)) {
      this.noteGone(from)
      return
    }

    const moved = (path: string) =>
      path === was || path.startsWith(`${was}/`) ? now + path.slice(was.length) : path

    this.editFiles((files) =>
      files.some((path) => moved(path) !== path) ? files.map(moved).sort() : files,
    )

    this.edit((notes) =>
      notes.map((note) => {
        const path = moved(note.path)
        return path === note.path ? note : { ...note, path, name: noteName(path) }
      }),
    )
  }

  private cameOut(from: string, to: string): boolean {
    const was = this.relative(from)
    const now = this.relative(to)
    return !!was && !!now && isHiddenPath(was) && !isHiddenPath(now)
  }

  private relative(path: string): string | null {
    const root = this.root
    return root ? within(root, path) : null
  }

  follow(op: FileOp): Promise<void> | undefined {
    elsewhere.forget(op.op === 'moved' ? op.from : op.path)
    if (op.op === 'moved') elsewhere.forget(op.to)
    const other = this.otherHolding(op.op === 'moved' ? op.from : op.path)
    if (other !== null && this.others.delete(other)) this.changed()
    if (op.kind === 'space') return undefined
    if (op.op === 'moved' && this.cameOut(op.from, op.to)) {
      return this.cameBack(op.to, op.kind === 'folder')
    }
    if (op.op === 'moved') this.notesMoved(op.from, op.to)
    else if (op.op === 'removed') this.noteGone(op.path)
    else return this.cameBack(op.path, op.kind === 'folder')

    return undefined
  }

  index(openPath: string | null, stranger = false): NoteIndex {
    const other = openPath === null ? null : this.otherHolding(openPath)
    if (openPath !== null && other !== null) return this.otherIndex(other, openPath)

    const path = openPath === null ? null : this.relative(openPath)

    const locks = this.locksSeen()
    if (
      this.handedAt !== this.version ||
      this.handedArchived !== this.archived ||
      this.handedLocks !== locks
    ) {
      if (this.handedLocks !== locks) this.read.clear()
      this.handedAt = this.version
      this.handedArchived = this.archived
      this.handedLocks = locks
      this.handed.clear()
    }

    const key = stranger ? 'stranger\n' : (path ?? '')
    const known = this.handed.get(key)
    if (known) return known

    const made: NoteIndex = {
      notes: this.offered(this.refs, this.root, locks),
      files: this.files,
      path,
      read: (wanted) => this.readNote(wanted),
      locked: (wanted) => !!this.root && this.lockedAt(insideSpace(this.root, wanted)),
      ...(this.vault ? { dueReads: 'deadline' as const } : {}),
      tags: this.spaceTags,
      searchBlocks: (text, most) => this.searchBlocks(text, most),
      query: async (code) => {
        queryBlock ??= await import('./query-block')
        return queryBlock.queryRowsHtml(code, 'Nothing found')
      },
      pressRow: (target) => queryBlock?.pressRow(target) ?? false,
      render: (source, from) => this.shownHtml(source, from),
      drawFile: (card, file) => this.drawnFile(card, file),
      mountBase: (host, ask) => this.mountedBase(host, ask, path, stranger),
    }
    this.handed.set(key, made)
    return made
  }

  private offeredHeld = new WeakMap<NoteRef[], { locks: string; offered: NoteRef[] }>()

  private offered(refs: NoteRef[], root: string | null, locks: string): NoteRef[] {
    const held = this.offeredHeld.get(refs)
    if (held?.locks === locks) return held.offered
    const shut = (ref: NoteRef) => root !== null && this.lockedAt(insideSpace(root, ref.path))
    const offered = refs.some(shut)
      ? refs.map((ref) => (shut(ref) ? { ...ref, headings: [], blocks: [], aliases: [] } : ref))
      : refs
    this.offeredHeld.set(refs, { locks, offered })
    return offered
  }

  private otherHolding(path: string): string | null {
    if (this.relative(path) !== null) return null
    const root = this.spaceOf(path)
    if (root === null || within(root, path) === null) return null
    return this.root !== null && samePath(root, this.root) ? null : root
  }

  private otherIndex(root: string, openPath: string): NoteIndex {
    const locks = this.locksSeen()
    if (this.handedAt !== this.version || this.handedLocks !== locks) {
      if (this.handedLocks !== locks) this.read.clear()
      this.handedAt = this.version
      this.handedLocks = locks
      this.handed.clear()
    }

    const path = within(root, openPath)
    const key = `${root}\n${path ?? ''}`
    const known = this.handed.get(key)
    if (known) return known

    const held = this.others.get(root)
    if (held === undefined) void this.readOther(root)
    const space = typeof held === 'object' ? held : { refs: [], files: [] }

    const made: NoteIndex = {
      notes: this.offered(space.refs, root, locks),
      files: space.files,
      path,
      locked: (wanted) => this.lockedAt(insideSpace(root, wanted)),
      read: (wanted) =>
        this.lockedAt(insideSpace(root, wanted))
          ? Promise.resolve(null)
          : invoke<string>('read_note', { path: insideSpace(root, wanted) }),
      searchBlocks: (text, most) => this.searchBlocks(text, most, root),
      render: (source, from) => this.shownHtml(source, from, root),
    }
    this.handed.set(key, made)
    return made
  }

  private readingOther = new Map<string, Promise<void>>()

  private readOther(root: string): Promise<void> {
    const reading = this.readOtherNow(root).finally(() => this.readingOther.delete(root))
    this.readingOther.set(root, reading)
    return reading
  }

  private async readOtherNow(root: string) {
    this.others.set(root, 'reading')
    const found = await invoke<SpaceLinks>('scan_links', { root }).catch(() => null)
    if (this.others.get(root) !== 'reading') return
    this.others.set(root, {
      refs: (found?.notes ?? []).map(refOf),
      files: found?.files ?? [],
    })
    this.changed()
  }

  private otherSaved(path: string, content: string) {
    const root = this.otherHolding(path)
    const space = root === null ? undefined : this.others.get(root)
    const relative = root === null ? null : within(root, path)
    if (
      root === null ||
      typeof space !== 'object' ||
      !relative ||
      isHiddenPath(relative) ||
      !isMarkdownPath(relative)
    )
      return

    const ref = refOf(scanNote(relative, content))
    const rest = space.refs.filter((one) => !samePath(one.path, relative))
    this.others.set(root, { ...space, refs: [...rest, ref] })
    this.changed()
  }

  private mountedBase(
    host: HTMLElement,
    ask: { code: string } | { target: string; view: string | null },
    path: string | null,
    stranger: boolean,
  ): () => void {
    if (__EVEN_PLUGIN__) return () => undefined
    const root = this.root
    const from = path === null || root === null ? null : insideSpace(root, path)
    let stop: (() => void) | null = null
    let stopped = false
    void import('./views/mount').then(({ mountBase }) => {
      if (!stopped) stop = mountBase(host, ask, from, stranger)
    })
    return () => {
      stopped = true
      stop?.()
    }
  }

  private drawnFile(card: HTMLElement, file: FileDrawing): () => void {
    const root = this.root
    if (root === null) return () => undefined

    let stop: (() => void) | null = null
    let stopped = false
    void import('./reading/drawn').then(({ drawFile }) => {
      if (!stopped) stop = drawFile(card, { ...file, root })
    })

    return () => {
      stopped = true
      stop?.()
    }
  }

  private async shownHtml(source: string, from: string | null, root = this.root): Promise<string> {
    const [{ readingHtml }, { theme }, { trustsHtmlAt }] = await Promise.all([
      import('./reading/render'),
      import('./theme/src/api'),
      import('./sharing.svelte'),
    ])

    const path = from === null || root === null ? null : insideSpace(root, from)

    return readingHtml({ text: source, path }, theme.current, trustsHtmlAt(path))
  }

  private readonly handed = new Map<string, NoteIndex>()
  private handedAt = -1
  private handedArchived: ReadonlySet<string> = NOTHING
  private handedLocks = ''

  private async readNote(relative: string): Promise<string | null> {
    const root = this.root
    if (!root || this.lockedAt(insideSpace(root, relative))) return null

    const held = this.read.get(relative)
    if (held !== undefined) return held

    const text = await readText(insideSpace(root, relative))
    if (text === null) return null

    if (this.read.size >= CACHED) {
      const oldest = this.read.keys().next().value
      if (oldest !== undefined) this.read.delete(oldest)
    }
    this.read.set(relative, text)

    return text
  }

  private resolved = new Map<string, string | null>()

  private readonly byName = $derived.by(() => {
    this.namesBuilt++
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and thrown away inside the derived
    const map = new Map<string, NoteRef[]>()

    for (const ref of this.refs) {
      for (const key of namesOf(ref)) {
        const held = map.get(key)
        if (held) held.push(ref)
        else map.set(key, [ref])
      }
    }

    return map
  })

  private readonly notesByPath = $derived.by(
    () => new Map(this.notes.map((one) => [one.path, one])),
  )

  private readonly filesNamed = $derived.by(() => filesByName(this.files))

  targetOf(from: string | null, link: { kind: LinkKind; target: string }): string | null {
    const other = from === null ? null : this.otherHolding(from)
    if (from !== null && other !== null) return this.otherTarget(other, from, link)

    return this.resolveFrom(from === null ? null : this.relative(from), link)
  }

  async targetWhenRead(
    from: string | null,
    link: { kind: LinkKind; target: string },
  ): Promise<string | null> {
    const other = from === null ? null : this.otherHolding(from)
    if (from === null || other === null) return null
    await this.otherRead(other)
    return this.otherTarget(other, from, link)
  }

  async spaceRead(path: string | null): Promise<void> {
    const other = path === null ? null : this.otherHolding(path)
    if (other !== null) await this.otherRead(other)
  }

  private async otherRead(root: string): Promise<void> {
    if (!this.others.has(root)) void this.readOther(root)
    await this.readingOther.get(root)
  }

  private otherTarget(
    root: string,
    from: string,
    link: { kind: LinkKind; target: string },
  ): string | null {
    return resolvedIn(this.otherIndex(root, from), link)
  }

  examined = 0

  namesBuilt = 0

  private resolveFrom(
    source: string | null,
    link: { kind: LinkKind; target: string },
  ): string | null {
    if (!link.target) return null

    const where = source === null ? '\0nowhere' : folderOf(source)
    const key = `${where}\0${link.kind}\0${link.target}`
    const held = this.resolved.get(key)
    if (held !== undefined) return held

    const found = isTabFile(link.target)
      ? resolveFile(this.spaceFiles(source), link.target, link.kind)
      : this.noteFrom(source, link)

    this.resolved.set(key, found)
    return found
  }

  private noteFrom(source: string | null, link: { kind: LinkKind; target: string }): string | null {
    const last = comparable(link.target).split('/').pop() ?? ''
    const candidates = this.byName.get(last) ?? []
    this.examined += candidates.length

    const index: NoteIndex = {
      notes: candidates,
      files: [],
      path: source,
      read: nothing,
    }
    const found =
      link.kind === 'markdown'
        ? resolveRelative(index, link.target)
        : resolveNote(index, link.target)

    return found?.path ?? null
  }

  private spaceFiles(source: string | null): NoteIndex {
    return { notes: [], files: this.files, path: source, read: nothing }
  }

  private couldName(link: { target: string }, names: ReadonlySet<string>): boolean {
    if (!link.target) return false
    const last = comparable(link.target).split('/').pop() ?? ''
    return names.has(last)
  }

  private namesFor(relative: string): ReadonlySet<string> {
    const note = this.notes.find((one) => one.path === relative)
    return namesOf(note ?? { path: relative, aliases: [] })
  }

  backlinks(path: string): Reference[] {
    const relative = this.relative(path)
    if (!relative) return []

    const names = this.namesFor(relative)
    const out: Reference[] = []

    for (const note of this.notes) {
      if (note.path === relative) continue

      for (const link of note.links) {
        if (!this.couldName(link, names)) continue
        if (this.resolveFrom(note.path, link) !== relative) continue
        if (this.root && this.lockedAt(insideSpace(this.root, note.path))) continue
        out.push({ path: note.path, name: nameOf(note.path), line: link.line, text: link.text })
      }
    }

    return out
  }

  outgoing(path: string): Outgoing[] {
    const relative = this.relative(path)
    const note = this.notes.find((one) => one.path === relative)
    if (!relative || !note) return []
    if (this.root && this.lockedAt(insideSpace(this.root, relative))) return []

    return note.links
      .filter((link) => link.target)
      .map((link) => {
        const to = this.resolveFrom(relative, link)
        return {
          path: relative,
          name: nameOf(to ?? link.target),
          line: link.line,
          text: link.text,
          target: link.target,
          to,
        }
      })
  }

  async unlinked(path: string, root: string): Promise<Reference[]> {
    const relative = this.relative(path)
    if (!relative) return []

    const note = this.notes.find((one) => one.path === relative)
    const written = [shownName(nameOf(relative)), ...(note?.aliases ?? [])]
      .map((one) => one.trim())
      .filter((one) => one.length >= 2)
    if (!written.length) return []

    const found: Hit[] = []
    const left = await this.leftOut(root)
    await Promise.all(
      written.map((one) =>
        searchSpace(
          root,
          parseQuery(`"${one.replace(/(["\\])/g, '\\$1')}"`),
          [],
          MOST_MENTIONS,
          (batch) => found.push(...batch.hits),
          left,
        ).catch(() => undefined),
      ),
    )

    const linked = new Set(
      this.backlinks(path).map((reference) => `${reference.path}\0${reference.line}`),
    )
    const needles = written.map(foldName)
    const seen: string[] = []

    return found
      .map((hit) => ({
        path: this.relative(hit.path) ?? hit.path,
        name: hit.name,
        line: hit.line,
        text: hit.text,
      }))
      .filter((hit) => hit.path !== relative)
      .filter((hit) => !linked.has(`${hit.path}\0${hit.line}`))
      .filter((hit) => needles.some((needle) => standsAlone(foldName(hit.text), needle)))
      .filter((hit) => {
        const key = `${hit.path}\0${hit.line}`
        if (seen.includes(key)) return false
        seen.push(key)
        return true
      })
  }

  async retarget(
    from: string,
    to: string,
    root: string,
    open: (path: string) => NoteDoc | null = () => null,
    how: Retargeting = {},
  ): Promise<number> {
    const was = within(root, from)
    const now = within(root, to)
    if (!was || !now || was === now) return 0

    if (this.root !== null && samePath(root, this.root)) {
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- one pass's notes, thrown away after it
      const rescanned = new Map<string, { from: ScannedNote; after: string }>()
      const touched = await this.retargetIn(
        this.notes,
        (source, link) =>
          this.resolveFrom(source, link) ?? fileNamed(this.filesNamed, source, link),
        (note, after) => rescanned.set(note.path, { from: note, after }),
        {
          was,
          now,
          root,
          open,
          how,
          files: this.files,
          listed: (path) => this.notesByPath.get(path),
        },
      )
      if (rescanned.size) {
        this.notes = this.notes.map((one) => {
          const held = rescanned.get(one.path)
          return held?.from === one ? scanNote(one.path, held.after) : one
        })
      }
      if (touched) this.changed()
      return touched
    }

    const found = await invoke<SpaceLinks>('scan_links', { root }).catch(() => null)
    if (!found) return 0
    const back = (path: string) =>
      path === now ? was : path.startsWith(`${now}/`) ? `${was}${path.slice(now.length)}` : path
    const notes = found.notes.map((note) => {
      const path = back(note.path)
      return path === note.path ? note : { ...note, path, name: noteName(path) }
    })
    const index: NoteIndex = {
      notes: notes.map(refOf),
      files: found.files.map(back),
      path: null,
      read: nothing,
    }
    const named = filesByName(index.files)
    const touched = await this.retargetIn(
      notes,
      (source, link) =>
        resolvedIn({ ...index, path: source }, link) ?? fileNamed(named, source, link),
      () => undefined,
      { was, now, root, open, how, files: index.files },
    )
    if (touched && this.others.delete(root)) this.changed()
    return touched
  }

  private async retargetIn(
    notes: readonly ScannedNote[],
    resolve: (source: string, link: { kind: LinkKind; target: string }) => string | null,
    rewritten: (note: ScannedNote, after: string) => void,
    asked: {
      was: string
      now: string
      root: string
      open: (path: string) => NoteDoc | null
      how: Retargeting
      files: readonly string[]
      listed?: (path: string) => ScannedNote | undefined
    },
  ): Promise<number> {
    const { was, now, root, open, how, files, listed } = asked
    const { moved = false, only, touched: told } = how

    const name = comparable(nameOf(was))
    const named = (link: { target: string }) =>
      !!link.target && comparable(link.target).split('/').includes(name)
    const moving = (path: string) =>
      path === was ? now : path.startsWith(`${was}/`) ? `${now}${path.slice(was.length)}` : null
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- one pass's answers, thrown away after it
    const calledAfter = new Map<string, { notes: NoteRef[]; files: string[] }>()
    const reaching =
      (source: string, there: string) =>
      (written: string): boolean => {
        const key = comparable(nameOf(there))
        let called = calledAfter.get(key)
        if (!called) {
          called = {
            notes: notes.flatMap((one) => {
              const path = moving(one.path) ?? one.path
              return comparable(nameOf(path)) === key ? [{ ...refOf(one), path }] : []
            }),
            files: files
              .map((path) => moving(path) ?? path)
              .filter((path) => comparable(nameOf(path)) === key),
          }
          calledAfter.set(key, called)
        }
        const index: NoteIndex = { ...called, path: source, read: nothing }
        const found = isTabFile(written)
          ? resolveFile(index, written, 'wikilink')
          : (resolveNote(index, written)?.path ?? resolveFile(index, written, 'wikilink'))
        return found === there
      }
    let touched = 0
    let walked = 0

    for (const note of [...notes]) {
      if (++walked % BREATHE_EVERY === 0) await breathe()
      if (only && !only.some((path) => samePath(path, insideSpace(root, note.path)))) continue

      const went = moved ? moving(note.path) : null
      const source = went ?? note.path
      const shifted = went !== null && folderOf(went) !== folderOf(note.path)

      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- one note's answers, thrown away after it
      const answered = new Map<string, string | Placed | null>()
      const to = (link: { kind: LinkKind; target: string }): string | Placed | null => {
        const key = `${link.kind}\0${link.target}`
        const held = answered.get(key)
        if (held !== undefined) return held
        const there = whereNow(link)
        answered.set(key, there)
        return there
      }
      const whereNow = (link: { kind: LinkKind; target: string }): string | Placed | null => {
        const found = resolve(note.path, link)
        if (found === null) return null
        const last = link.target.replace(/\\/g, '/').split('/').pop() ?? ''
        if (link.kind === 'wikilink' && comparable(last) !== comparable(nameOf(found))) return null
        const there = moving(found) ?? found
        if (there === found && !(shifted && link.kind === 'markdown')) return null
        const kept = nameOf(there) === nameOf(found)
        if (stillReaches(source, link, found, there, !shifted, kept)) return null
        return link.kind === 'wikilink' ? { path: there, reaches: reaching(source, there) } : there
      }

      const plane = isCanvasTarget(note.path) || isPagesTarget(note.path)
      const rewrite = plane ? await import('./canvas-rewrite') : null
      const card = rewrite?.cardsMoving(note.path, moving) ?? null
      const worth = card
        ? note.links.some((link) => card(link.target) !== null)
        : note.links.some(
            (link) => (named(link) || (shifted && link.kind === 'markdown')) && to(link) !== null,
          )
      if (!worth) continue

      const absolute = insideSpace(root, note.path)
      const target = went === null ? absolute : insideSpace(root, went)
      const doc = open(absolute)
      const drawn =
        doc && rewrite && !isPagesTarget(note.path) ? await rewrite.drawnPlane(doc) : null
      let read = listed?.(note.path) ?? note
      const drawing = { relinked: false }

      const file = card ?? moving
      const fresh = async () => {
        const before = await this.wordsOf(absolute, target, open)
        if (before === null) return null
        read = listed?.(note.path) ?? note
        const words = rewrite
          ? rewrite.retargetCanvas(before, source, file, to)
          : retargetLinks(before, source, to)
        return words === null || words === before ? null : { before, words }
      }
      const keepIt = (before: string) => keepVersion(target, before)
      const refused = (error: unknown) => {
        log('warn', `a link in ${target} could not be rewritten: ${String(error)}`)
        return null
      }

      const after = doc
        ? await (async () => {
            const got = await fresh()
            if (!got) return null
            const { before } = got
            let { words } = got

            const knew = doc.onDisk
            drawing.relinked =
              drawn !== null &&
              rewrite !== null &&
              drawn.relinked((canvas) => rewrite.retargetPlane(canvas, source, file, to))
            if (drawing.relinked) words = doc.text
            else {
              const edit = oneEdit(before, words)
              if (edit) doc.edited([edit], words)
            }
            return writeEdited(doc, target, words, knew, () => keepIt(before))
          })().catch(refused)
        : await inFileTurn(target, async () => {
            const got = await fresh()
            if (!got) return null
            const { before, words } = got
            const late = open(absolute)
            const edit = oneEdit(before, words)
            if (late && edit) late.edited([edit], words)
            await keepIt(before)
            await writeInTurn(target, words, false)
            return words
          }).catch(refused)
      if (after === null) continue
      if (drawing.relinked) doc?.wroteAs(after)
      for (const hear of hearing) hear(target, after, false)
      told?.push(target)

      rewritten(read, after)
      touched++
    }

    return touched
  }

  private async wordsOf(
    path: string,
    file: string,
    open: (path: string) => NoteDoc | null,
  ): Promise<string | null> {
    const doc = open(path)
    if (doc) {
      doc.flush()
      return doc.text
    }
    return readText(file)
  }

  async searchBlocks(text: string, most: number, root = this.root): Promise<SpaceBlock[]> {
    const needle = text.trim()
    if (!root || needle.length < 2) return []

    const found: Hit[] = []

    await searchSpace(
      root,
      parseQuery(`"${needle.replace(/(["\\])/g, '\\$1')}"`),
      [],
      most,
      (batch) => found.push(...batch.hits),
      await this.leftOut(root),
    ).catch(() => undefined)

    return found
      .filter((hit) => hit.page === undefined && isMarkdownPath(hit.path))
      .slice(0, most)
      .map((hit) => ({
        path: within(root, hit.path) ?? hit.path,
        line: hit.line,
        text: withoutBlockIds(hit.text).trim(),
        id: blockIdOf(hit.text),
      }))
  }

  private async openDocument(): Promise<(path: string) => NoteDoc | null> {
    const { workspace } = await import('./workspace.svelte')
    return (path) => workspace.documentAt(path)
  }

  private async leftOut(root: string): Promise<string[]> {
    const { workspace } = await import('./workspace.svelte')
    return [...workspace.leftOutOf(root), workspace.instructionsName(root)]
  }

  async nameBlock(relative: string, line: number, from: string | null): Promise<string | null> {
    if (!isMarkdownPath(relative)) return null
    const root = (from === null ? null : this.spaceOf(from)) ?? this.root
    if (root === null) return null

    const absolute = insideSpace(root, relative)
    const { canWriteAt } = await import('./sharing.svelte')
    if (!canWriteAt(absolute)) return null

    const open = await this.openDocument()
    const { namedBlock } = await import('@orden/markdown/block-names')
    const doc = open(absolute)

    const name = async (): Promise<string | null> => {
      const before = await this.wordsOf(absolute, absolute, open)
      if (before === null) return null

      const named = namedBlock(before, line, () =>
        freeBlockId(new Set(blockIds(before).map((one) => one.id))),
      )
      if (!named) return null
      if (named.source === before) return named.id

      const id = named.id
      const after = named.source
      const keepIt = () => keepVersion(absolute, before)

      const edit = oneEdit(before, after)
      if (doc) {
        const knew = doc.onDisk
        if (edit) doc.edited([edit], after)
        await writeEdited(doc, absolute, after, knew, keepIt)
      } else {
        await keepIt()
        await writeInTurn(absolute, after, false)
      }

      this.noteSaved(absolute, after)
      return id
    }
    return doc ? name() : inFileTurn(absolute, name)
  }

  async embedSource(
    target: string,
    from: string | null,
    inSpaceOf: string | null = from,
  ): Promise<string | null> {
    return (await this.embedded(target, from, inSpaceOf))?.text ?? null
  }

  async embedNote(
    target: string,
    from: string | null,
    inSpaceOf: string | null = from,
  ): Promise<EmbeddedNote | null> {
    const [found, { trustsHtmlAt }] = await Promise.all([
      this.embedded(target, from, inSpaceOf),
      import('./sharing.svelte'),
    ])
    return found && { text: found.text, escapeHtml: !trustsHtmlAt(found.path) }
  }

  private async embedded(
    target: string,
    from: string | null,
    inSpaceOf: string | null,
  ): Promise<{ path: string; text: string } | null> {
    const other = inSpaceOf === null ? null : this.otherHolding(inSpaceOf)
    let root = this.root
    let found: string | null
    if (inSpaceOf !== null && other !== null) {
      await this.otherRead(other)
      const index = this.otherIndex(other, inSpaceOf)
      const at = from === null ? '' : (within(other, from) ?? '')
      found = resolvedIn({ ...index, path: at }, { kind: 'wikilink', target })
      root = other
    } else {
      const source = from === null ? null : this.relative(from)
      found = this.resolveFrom(source ?? '', { kind: 'wikilink', target })
    }
    if (found === null || root === null) return null

    const path = insideSpace(root, found)
    if (this.lockedAt(path)) return null
    const text =
      root === other
        ? await invoke<string>('read_note', { path }).catch(() => null)
        : await this.readNote(found)
    return text === null ? null : { path, text }
  }

  relativeTarget(link: FoundLink, from: string | null): string | null {
    const other = from === null ? null : this.otherHolding(from)
    const source = from === null ? null : other !== null ? within(other, from) : this.relative(from)
    if (source === null) return null

    const found =
      from !== null && other !== null
        ? this.otherTarget(other, from, link)
        : this.resolveFrom(source, link)
    return found === null ? null : relativePath(folderOf(source), found)
  }

  fileNamed(name: string): string | null {
    return resolveFile(this.spaceFiles(null), name, 'wikilink')
  }

  fileFor(name: string, notePath: string | null): string | null {
    const other = notePath === null ? null : this.otherHolding(notePath)
    const root = other ?? this.root
    if (root === null) return null
    const found =
      other !== null && notePath !== null
        ? resolveFile(this.otherIndex(other, notePath), name, 'wikilink')
        : this.fileNamed(name)
    return found === null ? null : insideSpace(root, found)
  }

  fileWritten(root: string, relative: string) {
    if (isHiddenPath(relative)) return
    if (this.root !== null && samePath(root, this.root)) {
      this.fileAdded(relative)
      return
    }
    const space = this.others.get(root)
    if (typeof space !== 'object' || space.files.includes(relative)) return
    this.others.set(root, { ...space, files: [...space.files, relative].sort() })
    this.changed()
  }

  fileAdded(...relative: string[]) {
    this.editFiles((files) => {
      const fresh = relative.filter((one) => one && !files.includes(one))
      return fresh.length ? [...files, ...fresh].sort() : files
    })
  }
}

const nothing = () => Promise.resolve(null)

function standsAlone(line: string, name: string): boolean {
  const word = /[\p{L}\p{N}]/u
  let at = line.indexOf(name)

  while (at !== -1) {
    const before = line[at - 1]
    const after = line[at + name.length]
    if (!(before && word.test(before)) && !(after && word.test(after))) return true
    at = line.indexOf(name, at + 1)
  }

  return false
}

export const links = new Links()

export const spaceLinks = (): Links => new Links()
