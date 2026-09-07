/** Every link in the open space, and what the app does with them.
 *
 *  One index, three readers. The editor asks it which notes exist, so `[[` can
 *  offer them and a link can be drawn as resolved or not. The Links panel asks it
 *  what points at the open note and what it points at. A rename asks it which
 *  notes have to be rewritten.
 *
 *  Built once per space by one command that reads every note in a single pass -
 *  `scan_links`, in Rust on the desktop and over IndexedDB in the browser - and
 *  kept up to date from then on by re-reading only the note that was just saved.
 *  A space of a few thousand notes is scanned in one call and off the main
 *  thread; nothing here walks a space again.
 *
 *  Paths are relative to the space and `/`-separated throughout, because that is
 *  what a link says. `space-paths.ts` is the only place that converts. */

import {
  type NoteIndex,
  type NoteRef,
  resolveFile,
  resolveNote,
  resolveRelative,
} from '@nib/editor'
import {
  blockIdOf,
  blockIds,
  type FoundLink,
  isPdfTarget,
  type LinkKind,
} from '@nib/markdown/links'
import { buildGraph, type NoteGraph } from './graph'
import { rewriteLinks } from './link-rewrite'
import { type ScannedNote, scanNote, type SpaceLinks } from './scan-note'
import { folderOf, insideSpace, isMarkdownPath, nameOf, noteName, relativeTo } from './space-paths'
import { invoke } from './tauri'

/** One place a link was found, as a row in the panel. */
export interface Reference {
  /** The note it is in, relative to the space. */
  path: string
  /** That note's name, for the row. */
  name: string
  line: number
  /** The line, as the context the row is read in. */
  text: string
}

/** A link out of the open note: the same, plus where it goes. */
export interface Outgoing extends Reference {
  /** What the link says, for a row that has nowhere to point. */
  target: string
  /** The note it resolves to, or null when the space holds none. */
  to: string | null
}

/** How many mentions are worth looking for. The same ceiling the search field
 *  uses, and for the same reason. */
const MOST_MENTIONS = 200

/** How many notes a read-through keeps in hand for the embeds and previews on
 *  screen. A handful is all a screenful of embeds can ask for. */
const CACHED = 24

const MARKDOWN = /\.(md|markdown|mdown|mkd)$/i

/** A path as something to compare: no extension, folded case. The same reading
 *  `resolveNote` does, so a candidate here is a candidate there. */
function comparable(path: string): string {
  return path.replace(/\\/g, '/').replace(MARKDOWN, '').toLowerCase()
}

class Links {
  private notes = $state<ScannedNote[]>([])
  private files = $state<string[]>([])
  /** Which space the index is of, so a listing for another one is dropped. */
  private root: string | null = null
  /** Bumped whenever the index changed. The editor is handed a new object only
   *  when this moves, so a keystroke does not redraw every link on screen. */
  version = $state(0)
  /** True while the first scan of a space is in flight, so the panel can say
   *  so rather than showing an empty list that is not the answer. */
  scanning = $state(false)

  /** Notes read for an embed or a preview, newest last. Cleared whenever the
   *  index changes, so a frame never shows a note as it was two saves ago. */
  private read = new Map<string, string>()

  /** Every note as the editor needs to see it. Derived once per change rather
   *  than per link drawn, since resolving a name walks it. */
  private readonly refs = $derived.by((): NoteRef[] =>
    this.notes.map((note) => ({
      path: note.path,
      name: note.name,
      headings: note.headings,
      blocks: note.blocks,
    })),
  )

  /** The whole space as a graph: a node per note, an edge per pair of notes that
   *  link to each other. The graph view reads this one, so there is no second
   *  index of the space anywhere.
   *
   *  Derived, which makes it two things at once: nothing at all until a graph is
   *  asked for, and built again only when the index has actually changed. It
   *  walks every link once and resolves each through the cache above, which is
   *  what makes a space of two thousand notes a few milliseconds rather than a
   *  second. */
  readonly graph = $derived.by((): NoteGraph =>
    buildGraph(this.notes, (from, link) => this.resolveFrom(from, link)),
  )

  /** Reads a whole space. Called when a space opens; everything after that is
   *  `noteSaved`. */
  async build(root: string) {
    this.root = root
    this.scanning = true

    const found = await invoke<SpaceLinks>('scan_links', { root }).catch(() => null)

    // Another space may have opened while this one was being read.
    if (this.root !== root) return

    this.scanning = false
    this.notes = found?.notes ?? []
    this.files = found?.files ?? []
    this.changed()
  }

  /** Which space the index is of, so the caller can tell whether it is the one
   *  now open without holding a copy of the answer. */
  rootOf(): string | null {
    return this.root
  }

  /** Forgets everything, for a window with no space open. */
  clear() {
    this.root = null
    this.notes = []
    this.files = []
    this.changed()
  }

  private changed() {
    this.read.clear()
    this.resolved.clear()
    this.version++
  }

  /** The note that has just been written, read again from the text that was
   *  written. One note rather than the space: this runs on every save. */
  noteSaved(path: string, content: string) {
    const relative = this.relative(path)
    if (!relative || !isMarkdownPath(relative)) return

    const scanned = scanNote(relative, content)
    const at = this.notes.findIndex((note) => note.path === relative)

    this.notes =
      at === -1
        ? [...this.notes, scanned]
        : [...this.notes.slice(0, at), scanned, ...this.notes.slice(at + 1)]

    this.changed()
    // What was written is what the note says, so an embed of it needs no read.
    this.read.set(relative, content)
  }

  /** A note that has gone. */
  noteGone(path: string) {
    const relative = this.relative(path)
    if (!relative) return

    const kept = this.notes.filter(
      (note) => note.path !== relative && !note.path.startsWith(`${relative}/`),
    )
    if (kept.length === this.notes.length) return

    this.notes = kept
    this.changed()
  }

  /** A note or a folder that has moved. The links inside the notes that moved
   *  are unchanged; only where they live is. */
  notesMoved(from: string, to: string) {
    const was = this.relative(from)
    const now = this.relative(to)
    if (!was || !now) return

    this.notes = this.notes.map((note) => {
      if (note.path !== was && !note.path.startsWith(`${was}/`)) return note
      const path = now + note.path.slice(was.length)
      return { ...note, path, name: noteName(path) }
    })
    this.changed()
  }

  /** A path the app holds as one the index speaks in, or null for a note that
   *  lives outside the open space - a file opened from elsewhere, which has no
   *  place in a space's links. */
  private relative(path: string): string | null {
    const root = this.root
    return root && path.startsWith(root) ? relativeTo(root, path) : null
  }

  /** What the editor is handed: the notes, which one is open, and a way to read
   *  one. A fresh object each time the index changes and the same one otherwise,
   *  which is what decides whether every link on screen is redrawn. */
  index(openPath: string | null): NoteIndex {
    const path = openPath === null ? null : this.relative(openPath)

    // One object per open note rather than one in all. A pane going back to a
    // note it was on a moment ago is handed the same object it had before, so
    // switching between two tabs does not redraw every link in either of them.
    if (this.handedAt !== this.version) {
      this.handedAt = this.version
      this.handed.clear()
    }

    const key = path ?? ''
    const known = this.handed.get(key)
    if (known) return known

    const made: NoteIndex = {
      notes: this.refs,
      files: this.files,
      path,
      read: (wanted) => this.readNote(wanted),
    }
    this.handed.set(key, made)
    return made
  }

  private readonly handed = new Map<string, NoteIndex>()
  /** Which version of the space the objects above describe. */
  private handedAt = -1

  /** One note's text, for an embed or a hover preview. Kept for a moment after
   *  it arrives, because a screen of embeds asks for the same few notes. */
  private async readNote(relative: string): Promise<string | null> {
    const held = this.read.get(relative)
    if (held !== undefined) return held

    const root = this.root
    if (!root) return null

    const text = await invoke<string>('read_note', {
      path: insideSpace(root, relative),
    }).catch(() => null)
    if (text === null) return null

    // Oldest out first, so a long session does not hold a whole space in hand.
    if (this.read.size >= CACHED) {
      const oldest = this.read.keys().next().value
      if (oldest !== undefined) this.read.delete(oldest)
    }
    this.read.set(relative, text)

    return text
  }

  /** What each target has already been found to mean, keyed by the folder it was
   *  written in - which is the only thing about the source note that decides the
   *  answer. Cleared whenever the space changes.
   *
   *  Resolving a name walks every note, and a space where four hundred notes link
   *  to the same one asks the same question four hundred times: with this it is
   *  asked once per folder, which is what makes opening the panel a few
   *  milliseconds rather than a fifth of a second. */
  private resolved = new Map<string, string | null>()

  /** Every note by the last part of its path, folded. Only a note whose own name
   *  is the last thing a target says can be what that target means, whichever way
   *  it is spelled: `[[Plan]]`, `[[ideas/Plan]]` and `[x](../ideas/Plan.md)` all
   *  end in the note's name. So resolving asks this for the handful of candidates
   *  rather than walking the space for each link.
   *
   *  What that is worth: the graph of a space of two thousand notes resolves four
   *  thousand links, and walking every note for each of them took a second and a
   *  half. */
  private readonly byName = $derived.by(() => {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- built and thrown away inside the derived
    const map = new Map<string, NoteRef[]>()

    for (const ref of this.refs) {
      const key = comparable(nameOf(ref.path))
      const held = map.get(key)
      if (held) held.push(ref)
      else map.set(key, [ref])
    }

    return map
  })

  /** Which note, or which PDF, a link in `source` points at.
   *
   *  A PDF resolves through the files rather than the notes: it is the one thing
   *  beside a note that a link can open, so a note that links a paper is a note
   *  that links somewhere. Anything else beside the notes stays unresolved. */
  private resolveFrom(source: string, link: { kind: LinkKind; target: string }): string | null {
    if (!link.target) return null

    const key = `${folderOf(source)} ${link.kind} ${link.target}`
    const held = this.resolved.get(key)
    if (held !== undefined) return held

    const found = isPdfTarget(link.target)
      ? resolveFile(this.spaceFiles(source), link.target, link.kind)
      : this.noteFrom(source, link)

    this.resolved.set(key, found)
    return found
  }

  private noteFrom(source: string, link: { kind: LinkKind; target: string }): string | null {
    // Only the notes the target could name at all; see `byName`.
    const last = comparable(link.target).split('/').pop() ?? ''
    const index: NoteIndex = {
      notes: this.byName.get(last) ?? [],
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

  /** The space's files as a link resolver sees them, from one note's point of
   *  view: `source` is what a relative markdown target folds against. */
  private spaceFiles(source: string | null): NoteIndex {
    return { notes: [], files: this.files, path: source, read: nothing }
  }

  /** Whether a link could name the note at `path`, before anything is resolved.
   *  The last part of a target has to be the note's own name for either spelling
   *  to reach it, which turns twenty thousand links into twenty thousand string
   *  comparisons and a handful of lookups. */
  private couldName(link: { target: string }, name: string): boolean {
    if (!link.target) return false
    const last = comparable(link.target).split('/').pop()
    return last === name
  }

  /** Every link in the space that points at this note. */
  backlinks(path: string): Reference[] {
    const relative = this.relative(path)
    if (!relative) return []

    const name = comparable(nameOf(relative))
    const out: Reference[] = []

    for (const note of this.notes) {
      if (note.path === relative) continue

      for (const link of note.links) {
        if (!this.couldName(link, name)) continue
        if (this.resolveFrom(note.path, link) !== relative) continue
        out.push({ path: note.path, name: note.name, line: link.line, text: link.text })
      }
    }

    return out
  }

  /** Every link out of this note, resolved. */
  outgoing(path: string): Outgoing[] {
    const relative = this.relative(path)
    const note = this.notes.find((one) => one.path === relative)
    if (!relative || !note) return []

    return note.links
      .filter((link) => link.target)
      .map((link) => {
        const to = this.resolveFrom(relative, link)
        return {
          path: relative,
          name: to === null ? nameOf(link.target) : noteName(to),
          line: link.line,
          text: link.text,
          target: link.target,
          to,
        }
      })
  }

  /** Lines elsewhere in the space that write this note's name without linking to
   *  it. Asked of the search command rather than of the index: a mention is any
   *  text at all, and searching a space is what that command already is. */
  async unlinked(path: string, root: string): Promise<Reference[]> {
    const relative = this.relative(path)
    if (!relative) return []

    const name = noteName(relative)
    if (name.trim().length < 2) return []

    const hits = await invoke<{ path: string; name: string; line: number; text: string }[]>(
      'search_space',
      { root, query: name, limit: MOST_MENTIONS },
    ).catch(() => [])

    const linked = new Set(
      this.backlinks(path).map((reference) => `${reference.path} ${reference.line}`),
    )
    const needle = name.toLowerCase()

    return (
      hits
        .map((hit) => ({
          path: this.relative(hit.path) ?? hit.path,
          name: hit.name.replace(MARKDOWN, ''),
          line: hit.line,
          text: hit.text,
        }))
        .filter((hit) => hit.path !== relative)
        // A line that already links here is a backlink, not a mention of one.
        .filter((hit) => !linked.has(`${hit.path} ${hit.line}`))
        // And the name has to stand as a word rather than inside a longer one.
        .filter((hit) => standsAlone(hit.text.toLowerCase(), needle))
    )
  }

  /** Rewrites every link to `from` so it points at `to`, in every note of the
   *  space, and returns how many notes were touched.
   *
   *  Each note keeps one snapshot of what it said before, so the rewrite shows up
   *  in the version history of every note it touched and can be undone note by
   *  note there as well as through the file undo. */
  async retarget(from: string, to: string, root: string): Promise<number> {
    const was = this.relative(from)
    const now = this.relative(to)
    if (!was || !now || was === now) return 0

    const name = comparable(nameOf(was))
    const move = { from: was, to: now }
    let touched = 0

    for (const note of [...this.notes]) {
      // Whether this note is worth reading at all, decided from the index.
      const candidates = note.links.filter((link) => this.couldName(link, name))
      if (!candidates.length) continue
      if (!candidates.some((link) => this.resolveFrom(note.path, link) === was)) continue

      const absolute = insideSpace(root, note.path)
      const before = await invoke<string>('read_note', { path: absolute }).catch(() => null)
      if (before === null) continue

      const points = (link: FoundLink) => this.resolveFrom(note.path, link) === was
      const after = rewriteLinks(before, note.path, move, points)
      if (after === null || after === before) continue

      await invoke('snapshot_note', { path: absolute, content: before }).catch(() => undefined)
      await invoke('write_note', { path: absolute, content: after })

      this.notes = this.notes.map((one) =>
        one.path === note.path ? scanNote(note.path, after) : one,
      )
      touched++
    }

    if (touched) this.changed()
    return touched
  }

  /** Gives a block of another note a name, so a link can point at the block.
   *  Called by the editor's `[[…#^` completion, which has nowhere else to get
   *  one: the block is in a note that is not open. */
  async nameBlock(relative: string, line: number, root: string): Promise<string | null> {
    const absolute = insideSpace(root, relative)
    const before = await invoke<string>('read_note', { path: absolute }).catch(() => null)
    if (before === null) return null

    const lines = before.split('\n')
    // The name goes at the end of the block, which is the last line of the run
    // that starts at `line`.
    let end = line
    while (end + 1 < lines.length && (lines[end + 1] ?? '').trim()) end++

    const existing = blockIdOf(lines[end] ?? '')
    if (existing) return existing

    const taken = new Set(blockIds(before).map((one) => one.id))
    const id = freeBlockId(taken)

    lines[end] = `${(lines[end] ?? '').trimEnd()} ^${id}`
    const after = lines.join('\n')

    await invoke('snapshot_note', { path: absolute, content: before }).catch(() => undefined)
    await invoke('write_note', { path: absolute, content: after })

    this.noteSaved(absolute, after)
    return id
  }

  /** The note an embed names, for an export: the renderer cannot wait on a disk,
   *  so the notes a document embeds are read before it is rendered. */
  async embedSource(target: string, from: string | null): Promise<string | null> {
    const source = from === null ? null : this.relative(from)
    const found = this.resolveFrom(source ?? '', { kind: 'wikilink', target })

    return found === null ? null : this.readNote(found)
  }

  /** Where a picture named by `![[picture.png]]` lives, when the space holds one
   *  by that name. Obsidian finds an attachment wherever it is; without this the
   *  name would only work for a picture beside the note.
   *
   *  The same reading a link to a PDF gets, so a file is found one way whichever
   *  of the two named it. */
  fileNamed(name: string): string | null {
    return resolveFile(this.spaceFiles(null), name, 'wikilink')
  }
}

const nothing = () => Promise.resolve(null)

/** Whether a name stands as a word in a line rather than inside a longer one, so
 *  a note called `Plan` is not mentioned by the word `Planning`. */
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

/** A name no block in the note has yet. Six characters of base 36, which is two
 *  billion names: short enough to read in the middle of a sentence, and it is
 *  only ever compared against the names in one note. */
function freeBlockId(taken: ReadonlySet<string>): string {
  for (;;) {
    const id = Math.random().toString(36).slice(2, 8)
    if (id.length === 6 && !taken.has(id)) return id
  }
}

export const links = new Links()
