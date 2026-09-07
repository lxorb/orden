import { flushTableEdits, type NoteJump } from '@nib/editor'
import { account } from './account.svelte'
import { blockIds, slugify } from '@nib/markdown/links'
import { extracted, merged, splitAt } from './composer'
import { links } from './link-index.svelte'
import { noteId } from './note-id'
import { folderOf as folderIn, insideSpace, noteName, relativeTo } from './space-paths'
import { key, t } from './i18n.svelte'
import { nameFromContent } from './note-name'
import { scanHeadings } from './outline'
import { without } from './records'
import { isRecord, stored } from './stored'
import { type Draft, readSession, type Session, writeSession } from './workspace/session'
import { DeviceView } from './workspace/device.svelte'
import { Positions } from './workspace/positions'
import { type FileAction, FileActions } from './workspace/undo.svelte'
import { outermost, Selection } from './workspace/selection.svelte'
import { entryAt, withEntry, withMove, withoutEntry } from './tree-edits'
import { folderOf, invoke, isDesktop, joinPath } from './tauri'
import { viewport } from './viewport.svelte'

export interface Entry {
  name: string
  path: string
  is_dir: boolean
  modified: number
  created: number
  children: Entry[]
}

export type SortKey = 'name' | 'modified' | 'created'

export interface TreeOptions {
  showHidden: boolean
  sort: SortKey
  descending: boolean
}

/** A space is a folder today and a synced collection once accounts land. */
export interface Space {
  id: string
  name: string
  root: string
}

/** What a tab holds. Almost always a note; the graph of the space is the one
 *  surface that is a tab without holding one, because a picture of the notes
 *  belongs beside them rather than in a panel. */
export type TabKind = 'note' | 'graph'

export interface Tab {
  id: string
  kind: TabKind
  path: string | null
  name: string
  doc: string
  dirty: boolean
  /** Offset of the caret, pixels scrolled, and the position of the line at the
   *  top, so a note reopens where it was left rather than at the top. The
   *  line is what is put back; the pixels serve sessions from older builds. */
  cursor?: number | undefined
  scroll?: number | undefined
  anchor?: number | undefined
  /** Which line the caret is on. The editor knows it without counting, and the
   *  outline would otherwise walk the note's newlines to work it out again. */
  line?: number | undefined
  /** Bumped whenever the text is replaced from outside the editor: a note
   *  loaded from disk, a version restored, a rename that rewrote the title.
   *  Typing never bumps it, which is what keeps the view from comparing the
   *  whole document against itself on every keystroke. */
  pushed?: number
}

/** As much of CodeMirror's rope as the workspace needs. A plain string is one
 *  too, which is what the tests and every other caller hand over. */
export interface DocText {
  readonly length: number
  toString(): string
}

export type Panel = 'tree' | 'outline' | 'search' | 'links'

export interface Hit {
  path: string
  name: string
  line: number
  text: string
}

export interface Tag {
  tag: string
  count: number
}

export type { Heading } from './outline'

const STORAGE_KEY = 'nib:workspace'
const AUTO_SAVE_KEY = 'nib:autosave'
const TREE_KEY = 'nib:tree'
const AUTO_SAVE_DELAY = 1200
/** How long the dot stays as a tick once the note is down, in milliseconds. */
const SAVED_SHOWN = 1400
const AUTO_SAVE_DELAY_KEY = 'nib:autosave-delay'
// Short enough that a crash costs a moment's typing, long enough that the strip
// is not serialised on every keystroke.
const SESSION_DELAY = 400
const UNTITLED = 'Untitled'
const MARKDOWN = /\.(md|markdown|mdown|mkd)$/i

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/** Which line of a note a followed link lands on: the heading it names, or the
 *  line the block name sits on. Null when the note holds neither, which leaves
 *  the note opened where it was left rather than somewhere arbitrary.
 *
 *  A heading is matched by its own words and by the anchor it becomes, so
 *  `[[Note#Some Heading]]` and `[x](Note.md#some-heading)` reach the same one. */
function lineOfTarget(doc: string, jump: NoteJump): number | null {
  if (jump.block !== null) {
    return blockIds(doc).find((one) => one.id === jump.block)?.line ?? null
  }
  if (jump.heading === null) return null

  const wanted = jump.heading.trim().toLowerCase()
  const anchor = slugify(jump.heading)

  return (
    scanHeadings(doc).find(
      (heading) => heading.text.toLowerCase() === wanted || slugify(heading.text) === anchor,
    )?.line ?? null
  )
}

/** Ids handed out within one run of the app: tabs, and the spaces the rail
 *  keeps its order by. The counter is what makes them unique - eight random
 *  characters collide rarely, and rarely is not never, and two tabs sharing an
 *  id would share their saving mark and take each other's place in the strip.
 *  The random part keeps two windows from agreeing on the same id for
 *  different things. */
let handed = 0

function identifier(): string {
  return `${(handed++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

const SORT_KEYS: readonly SortKey[] = ['name', 'modified', 'created']

function readTreeOptions(): TreeOptions {
  const saved = stored(TREE_KEY)
  if (!isRecord(saved)) return { showHidden: false, sort: 'name', descending: false }

  // Each field on its own, because a stored view is worth reading as far as it
  // makes sense: an unknown sort key should not cost the reader their choice
  // about hidden files.
  const sort = SORT_KEYS.find((key) => key === saved.sort)
  return {
    showHidden: saved.showHidden === true,
    sort: sort ?? 'name',
    descending: saved.descending === true,
  }
}

/** Where a note that has never been saved should go. The desktop asks the
 *  system; the browser has no file dialog, so it asks for a name and puts the
 *  note in the space that is open. A note that came in with a name of its own
 *  - a file opened in the browser - keeps it as the suggestion; otherwise the
 *  first line is. */
async function pickSavePath(
  spaces: Space[],
  activeId: string | null,
  doc = '',
  name = UNTITLED,
): Promise<string | null> {
  const [first] = spaces
  if (!first) return null

  const { prompt } = await import('./prompt.svelte')
  const answer = await prompt.askName({
    title: t('Name the note'),
    value: (name !== UNTITLED ? name : null) ?? nameFromContent(doc) ?? UNTITLED,
    placeholder: t('Untitled'),
    confirmLabel: key('Save'),
    spaces: spaces.map((space) => ({ id: space.id, name: space.name })),
    space: activeId,
  })

  if (!answer?.name) return null

  const target = spaces.find((space) => space.id === answer.space) ?? first
  const clean = answer.name.replace(/[\\/]/g, ' ').trim()

  return joinPath(target.root, MARKDOWN.test(clean) ? clean : `${clean}.md`)
}

class Workspace {
  spaces = $state<Space[]>([])
  activeSpaceId = $state<string | null>(null)
  tree = $state<Entry | null>(null)
  tabs = $state<Tab[]>([])
  activeTabId = $state<string | null>(null)
  // Hidden until asked for, the way Typora starts.
  panel = $state<Panel | null>(null)
  /** The one tab holding a note that is only being looked at. */
  previewTabId = $state<string | null>(null)
  /** The tree row being named in place, and whether the name it starts with is
   *  something to add to rather than to replace: a note that was just made with
   *  a name of its own - a unique note's timestamp - is waiting for a title
   *  after it, not instead of it. */
  renaming = $state<{ path: string; appending: boolean } | null>(null)
  autoSave = $state(localStorage.getItem(AUTO_SAVE_KEY) !== 'false')
  /** How long to wait after the last keystroke before writing. */
  autoSaveDelay = $state(Number(localStorage.getItem(AUTO_SAVE_DELAY_KEY)) || AUTO_SAVE_DELAY)
  treeOptions = $state<TreeOptions>(readTreeOptions())
  /** The last handful of file operations; see workspace/undo. */
  readonly undone = new FileActions()
  tags = $state<Tag[]>([])
  /** What this machine remembers about the list: which folders are open,
   *  which rows are pinned, what was opened lately, the icon each space
   *  wears. See workspace/device. */
  readonly device = new DeviceView()
  /** Rows picked in the tree with Ctrl or Shift; see workspace/selection. */
  private readonly picked = new Selection()
  /** Which tabs are being written, and which have just been. The dot beside a
   *  note's name is the whole report on saving, so it has three things to say:
   *  there is something unwritten, it is going down now, it is down. Held by id
   *  rather than on the tab, because "just saved" is about this moment and not
   *  about the note. */
  saveState = $state<Record<string, 'saving' | 'saved'>>({})
  private savedTimers: Record<string, ReturnType<typeof setTimeout>> = {}

  private saveTimer: ReturnType<typeof setTimeout> | undefined
  private sessionTimer: ReturnType<typeof setTimeout> | undefined

  /** Where each note was last being read; see workspace/positions.ts. */
  private positions = new Positions()

  /** The text the editor holds for the note being typed in, before anything
   *  has turned it into a string. Turning half a megabyte of rope into a
   *  string costs the same on every keystroke however small the keystroke is,
   *  and that alone made a large note feel heavy. So `tab.doc` is allowed to
   *  lag behind by one pause in the typing: `flush` brings it forward, and
   *  everything that reads the text - saving, the session, an export - goes
   *  through it first. */
  private live: { id: string; text: DocText } | null = null

  readonly activeSpace = $derived(
    this.spaces.find((space) => space.id === this.activeSpaceId) ?? null,
  )
  readonly active = $derived(this.tabs.find((tab) => tab.id === this.activeTabId) ?? null)

  /** The note being read, named the way a link names it: relative to the space.
   *  Falls back to the last note that was read, so a tab holding no note - the
   *  graph of the space - still knows which note it was opened from and can mark
   *  it. Null when there is no space, or nothing has been read in it. */
  readonly relativeNote = $derived.by((): string | null => {
    const root = this.activeSpace?.root
    const path = this.active?.path ?? this.recent[0] ?? null
    if (root === undefined || path === null) return null

    return path.startsWith(root) ? relativeTo(root, path) : null
  })

  /** Reading it walks the whole note, so it deliberately follows `tab.doc` and
   *  not the editor: that one only catches up when the typing pauses, which is
   *  as often as an outline needs to move. Lazy as every derived is, so a
   *  closed outline panel costs nothing at all. */
  readonly headings = $derived.by(() => scanHeadings(this.active?.doc ?? ''))

  /** Every note in the space, flattened - the Articles panel and quick open. */
  readonly notes = $derived.by((): Entry[] => {
    const out: Entry[] = []
    const walk = (entry: Entry) => {
      for (const child of entry.children) {
        if (child.is_dir) walk(child)
        else out.push(child)
      }
    }
    if (this.tree) walk(this.tree)
    return out
  })

  async restore() {
    // The browser build starts empty, so give a first visit something to read.
    if (!isDesktop) {
      const { seed } = await import('./web/commands')
      await seed()
    }

    const state = readSession(stored(STORAGE_KEY))

    if (!state) {
      await this.loadSpaces()
      if (this.activeSpaceId) await this.loadTree()

      // A first visit opens what it was given rather than a blank page.
      const first = this.notes[0]
      if (first) await this.open(first.path)
      if (!this.tabs.length) this.openBlank()
      return
    }

    this.spaces = state.spaces
    this.positions = new Positions(state.positions ?? {})
    // The sidebar comes back the way it was left.
    this.panel = state.panel
    this.activeSpaceId = state.activeSpace ?? this.spaces[0]?.id ?? null

    // The folder wins over what was remembered, so the two cannot drift apart.
    await this.loadSpaces()

    if (this.activeSpaceId) await this.loadTree()

    if (state.tabs?.length) await this.restoreTabs(state.tabs, state.active ?? 0)
    else {
      for (const path of state.openPaths ?? []) {
        await this.open(path, { activate: path === state.activePath })
      }
    }

    if (!this.tabs.length) this.openBlank()
  }

  /** Puts the strip back as it was. A note that was clean is re-read from disk,
   *  so an edit made elsewhere shows up; a note that was not is restored from
   *  its draft and stays dirty. Replacing someone's unsaved work with what
   *  happens to be on disk is the one thing this must never do. */
  private async restoreTabs(drafts: Draft[], active: number) {
    const restored: Tab[] = []

    for (const draft of drafts) {
      let doc = draft.doc

      if (draft.kind === 'note' && draft.path && !draft.dirty) {
        try {
          doc = await invoke<string>('read_note', { path: draft.path })
        } catch {
          // Deleted or moved while Nib was away, and nothing unsaved to keep.
          continue
        }
      }

      restored.push({
        id: identifier(),
        kind: draft.kind,
        path: draft.path,
        name: draft.name,
        doc,
        dirty: draft.dirty,
        cursor: draft.cursor,
        scroll: draft.scroll,
        anchor: draft.anchor,
      })
    }

    this.tabs = restored
    this.activeTabId = (restored[active] ?? restored[0])?.id ?? null
  }

  private persist() {
    clearTimeout(this.sessionTimer)
    this.flush()

    const state: Session = {
      spaces: this.spaces,
      activeSpace: this.activeSpaceId,
      tabs: this.tabs.map((tab) => ({
        kind: tab.kind,
        path: tab.path,
        name: tab.name,
        // Only unsaved words are worth writing down: a note that is on disk is
        // re-read from there on the way back in (see `restoreTabs`), so its
        // copy here would never be looked at, and copying a large one every
        // time the typing pauses is not free.
        doc: tab.dirty ? tab.doc : '',
        dirty: tab.dirty,
        cursor: tab.cursor ?? 0,
        scroll: tab.scroll ?? 0,
        anchor: tab.anchor,
      })),
      active: Math.max(
        0,
        this.tabs.findIndex((tab) => tab.id === this.activeTabId),
      ),
      panel: this.panel,
      positions: this.positions.all,
    }

    writeSession(STORAGE_KEY, state)
  }

  /** Writes the session soon rather than now, so a burst of typing costs one
   *  write instead of one per keystroke. */
  private scheduleSession() {
    clearTimeout(this.sessionTimer)
    this.sessionTimer = setTimeout(() => this.persist(), SESSION_DELAY)
  }

  /** Where the caret and the scroll are. Recorded as they move, because after
   *  a crash there is no chance to write them down on the way out. */
  noteView(id: string, cursor: number, scroll: number, anchor?: number, line?: number) {
    const tab = this.tabs.find((one) => one.id === id)
    if (!tab) return
    if (tab.line !== line) tab.line = line
    if (tab.cursor === cursor && tab.scroll === scroll && tab.anchor === anchor) return

    tab.cursor = cursor
    tab.scroll = scroll
    tab.anchor = anchor
    if (tab.path) this.positions.remember(tab.path, cursor, scroll, anchor)
    this.scheduleSession()
  }

  openBlank(name = UNTITLED, doc = '') {
    const tab: Tab = { id: identifier(), kind: 'note', path: null, name, doc, dirty: !!doc }
    this.tabs = [...this.tabs, tab]
    this.activeTabId = tab.id
  }

  /** The graph of the whole space, as a tab of its own. One at a time: a second
   *  picture of the same space says the same thing, so asking again brings the
   *  one already there forward. */
  openGraph() {
    const existing = this.tabs.find((tab) => tab.kind === 'graph')

    if (existing) this.activeTabId = existing.id
    else {
      const tab: Tab = {
        id: identifier(),
        kind: 'graph',
        path: null,
        name: t('Graph'),
        doc: '',
        dirty: false,
      }
      this.tabs = [...this.tabs, tab]
      this.activeTabId = tab.id
    }

    this.persist()
  }

  /** Drops the blank untitled tab a window starts with, now that something real
   *  is open. Compared by id, because `this.tabs` holds reactive proxies and
   *  `=== tab` on the object just pushed is never true.
   *
   *  A tab that is not a note is never scaffolding: the graph of the space has no
   *  path and nothing unsaved either, and closing it behind the reader's back
   *  because they opened a note would be a surprise. */
  private dropScaffolding(kept: string) {
    this.tabs = this.tabs.filter(
      (other) => other.id === kept || other.kind !== 'note' || other.path !== null || other.dirty,
    )
  }

  /** Reads the spaces folder. It is the source of truth, so a space added or
   *  removed outside the app simply shows up that way. */
  async loadSpaces() {
    const found = await invoke<{ name: string; path: string }[]>('list_spaces').catch(() => [])

    // Ids are kept across a reload so the selected space survives one.
    const byRoot = new Map(this.spaces.map((space) => [space.root, space]))

    // The folder decides which spaces exist; the rail decides the order they
    // appear in. Without this, a listing that comes back alphabetical would
    // undo every drag on the next reload.
    const rank = new Map(this.spaces.map((space, index) => [space.root, index]))
    const at = (root: string) => rank.get(root) ?? Number.MAX_SAFE_INTEGER

    this.spaces = found
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => at(a.entry.path) - at(b.entry.path) || a.index - b.index)
      .map(
        ({ entry }) =>
          byRoot.get(entry.path) ?? { id: identifier(), name: entry.name, root: entry.path },
      )

    if (!this.spaces.some((space) => space.id === this.activeSpaceId)) {
      this.activeSpaceId = this.spaces[0]?.id ?? null
    }
  }

  /** Creates a space folder under the one the app owns. The name is the only
   *  thing asked for; where it lives is not a decision worth making. */
  /** A space the account has that this machine does not. Makes the folder and
   *  lists it, but does not switch to it: adopting someone else's space in the
   *  background should not move what is on screen out from under the writer.
   *  Unless nothing is on screen - a machine that has just erased its notes,
   *  or never had any, would otherwise list the account's spaces and show
   *  none of them. */
  async adoptSpace(name: string): Promise<string | null> {
    const existing = this.spaces.find((space) => space.name === name)
    if (existing) return existing.root

    const created = await invoke<{ name: string; path: string }>('create_space', {
      name: name.trim(),
    }).catch(() => null)

    if (!created) return null

    if (!this.spaces.some((space) => space.root === created.path)) {
      const space: Space = { id: identifier(), name: created.name, root: created.path }
      this.spaces = [...this.spaces, space]

      if (this.activeSpaceId) this.persist()
      else await this.selectSpace(space.id)
    }

    return created.path
  }

  async addSpace(name: string) {
    if (!name.trim()) return

    const created = await invoke<{ name: string; path: string }>('create_space', {
      name: name.trim(),
    }).catch(() => null)

    if (!created) return

    const space: Space = { id: identifier(), name: created.name, root: created.path }
    this.spaces = [...this.spaces, space]
    await this.selectSpace(space.id)
    return space
  }

  async renameSpace(id: string, name: string) {
    const space = this.spaces.find((entry) => entry.id === id)
    if (!space || !name.trim()) return

    const renamed = await invoke<{ name: string; path: string }>('rename_space', {
      from: space.root,
      name: name.trim(),
    }).catch(() => null)

    if (!renamed) return

    // Open notes point into the old folder, so move them with it.
    for (const tab of this.tabs) {
      if (tab.path?.startsWith(space.root)) {
        tab.path = renamed.path + tab.path.slice(space.root.length)
      }
    }

    // The icon is keyed by folder, so it has to follow the folder.
    this.device.moveIcon(space.root, renamed.path)

    space.name = renamed.name
    space.root = renamed.path
    if (this.activeSpaceId === id) await this.loadTree()
    this.persist()
  }

  /** Drops the dragged space in front of `beforeId`, or at the end for null.
   *  Returns whether anything actually moved, so a drag onto itself is quiet. */
  moveSpace(id: string, beforeId: string | null): boolean {
    const moving = this.spaces.find((space) => space.id === id)
    if (!moving || id === beforeId) return false

    const rest = this.spaces.filter((space) => space.id !== id)
    const at = beforeId ? rest.findIndex((space) => space.id === beforeId) : rest.length
    if (at < 0) return false

    const next = [...rest.slice(0, at), moving, ...rest.slice(at)]
    if (this.sameOrder(next)) return false

    this.spaces = next
    this.persist()
    return true
  }

  /** Whether a proposed order is the one already on show, so a drag that ends
   *  where it started, or an account order that matches, stays quiet. */
  private sameOrder(next: readonly Space[]): boolean {
    return next.every((space, index) => space.id === this.spaces[index]?.id)
  }

  /** Takes the account's order, which is the one the other machines see.
   *  A space this machine has but the account does not keeps its place. */
  applySpaceOrder(names: string[]): boolean {
    const rank = new Map(names.map((name, index) => [name, index]))
    const at = (name: string) => rank.get(name) ?? Number.MAX_SAFE_INTEGER

    const next = this.spaces
      .map((space, index) => ({ space, index }))
      .sort((a, b) => at(a.space.name) - at(b.space.name) || a.index - b.index)
      .map((entry) => entry.space)

    if (this.sameOrder(next)) return false

    this.spaces = next
    this.persist()
    return true
  }

  async selectSpace(id: string) {
    this.activeSpaceId = id
    this.clearSelection()
    await this.loadTree()
    this.persist()
  }

  /** The rail's way in. Picking a space with the sidebar closed showed
   *  nothing, so the sidebar comes up with the tree, as Ctrl+Shift+L opens it. */
  async showSpace(id: string) {
    this.panel ??= 'tree'
    await this.selectSpace(id)
  }

  /** True as soon as one note on this machine has something written in it.
   *  Stops at the first, so a large space costs no more than a small one. */
  async hasLocalContent(): Promise<boolean> {
    for (const note of this.notes) {
      const doc = await invoke<string>('read_note', { path: note.path }).catch(() => '')
      if (doc.trim()) return true
    }

    return false
  }

  /** Removes every space on this machine. Only ever called with an explicit
   *  yes, since nothing here can be undone. */
  async eraseLocalSpaces() {
    for (const space of [...this.spaces]) {
      await invoke('delete_space', { path: space.root }).catch(() => undefined)
    }

    for (const tab of [...this.tabs]) this.close(tab.id)

    this.tree = null
    // `loadSpaces` settles which space is open from what the folder still
    // holds: none, once they have all gone, or one another window made
    // meanwhile. It does not need to be cleared here first.
    await this.loadSpaces()
    if (this.activeSpaceId) await this.loadTree()

    // What the account holds lands in the tree, so the tree is brought up to
    // show it arriving. A blank page with no sign of anything on its way
    // reads as the notes being gone for good.
    this.panel = 'tree'
    this.persist()
  }

  /** Deletes the space's folder. The app owns that folder, so dropping it from
   *  the list alone would only bring it back on the next launch. */
  async deleteSpace(id: string) {
    const space = this.spaces.find((entry) => entry.id === id)
    if (!space) return

    {
      // The account keeps a deleted space for 14 days; signed out, this device
      // keeps it in its trash folder instead (see trash.svelte.ts).
      const gone = await (
        account.signedIn
          ? invoke('delete_space', { path: space.root })
          : invoke('trash_item', { path: space.root, kind: 'space' })
      )
        .then(() => true)
        .catch(() => false)

      if (!gone) return
    }

    for (const tab of this.tabs.filter((tab) => tab.path?.startsWith(space.root))) {
      this.close(tab.id)
    }

    this.spaces = this.spaces.filter((entry) => entry.id !== id)
    if (this.activeSpaceId !== id) {
      this.persist()
      return
    }

    this.activeSpaceId = this.spaces[0]?.id ?? null
    this.tree = null
    if (this.activeSpaceId) await this.selectSpace(this.activeSpaceId)
    else this.persist()
  }

  async loadTree() {
    const root = this.activeSpace?.root
    if (!root) return

    // The link index is of a space, so it is built when the space's tree is.
    // Not awaited: the tree is what is on screen, and a scan of a few thousand
    // notes must not hold it up.
    if (links.rootOf() !== root) void links.build(root)

    try {
      this.tree = await invoke<Entry>('read_tree', { root, options: this.treeOptions })
    } catch {
      this.tree = null
    }

    // Rows that went away take themselves out of the selection.
    this.picked.keepOnly((path) => !!this.entryAt(path))
  }

  setSort(sort: SortKey) {
    // Choosing the same key again flips the direction, as a file list should.
    const descending = this.treeOptions.sort === sort ? !this.treeOptions.descending : false
    this.treeOptions = { ...this.treeOptions, sort, descending }
    this.persistTreeOptions()
  }

  toggleHidden() {
    this.treeOptions = { ...this.treeOptions, showHidden: !this.treeOptions.showHidden }
    this.persistTreeOptions()
  }

  private persistTreeOptions() {
    localStorage.setItem(TREE_KEY, JSON.stringify(this.treeOptions))
    void this.loadTree()
  }

  /** Moves a note or folder into another folder. */
  async move(from: string, intoFolder: string) {
    const name = basename(from)
    const target = joinPath(intoFolder, name)

    if (target === from || intoFolder.startsWith(from)) return

    // The row is in its new folder as soon as the drop lands.
    this.showMove(from, target)

    await invoke('rename_note', { from, to: target })
    this.positions.move(from, target)

    // A note that moved is a note every link to it has to be pointed at again;
    // see `rename` below, including why this comes before the index is told.
    const rewrote = (await this.retarget(from, target)) > 0
    links.notesMoved(from, target)
    this.undone.record({ kind: 'move', from, to: target, ...(rewrote ? { rewrote } : {}) })

    for (const tab of this.tabs.filter((entry) => entry.path === from)) {
      tab.path = target
      tab.name = name
    }

    await this.loadTree()
    this.persist()
  }

  /** `preview` opens the way a single click in the file list does: one tab,
   *  reused by the next preview, and kept only until something is typed in it. */
  /** On a phone the drawer covers the note, so choosing one means wanting to
   *  see it: the drawer goes. A desktop shows both and leaves it be. */
  private showNote() {
    if (!viewport.phone || !this.panel) return

    this.panel = null
    this.persist()
  }

  async open(path: string, options: { activate?: boolean; preview?: boolean } = {}) {
    const existing = this.tabs.find((tab) => tab.path === path)
    if (existing) {
      // Opening for real what was only being looked at makes it stay.
      if (!options.preview) this.keep(existing.id)
      if (options.activate !== false) {
        this.activeTabId = existing.id
        this.showNote()
      }
      return
    }

    const doc = await invoke<string>('read_note', { path }).catch(() => null)
    // Gone, or unreadable: nothing to open, and no tab that pretends otherwise.
    if (doc === null) return

    // A preview reuses the one preview tab rather than opening another.
    const reusable =
      options.preview &&
      this.tabs.find((tab) => tab.id === this.previewTabId && tab.kind === 'note' && !tab.dirty)

    if (reusable) {
      const place = this.positions.of(path)
      reusable.path = path
      reusable.name = basename(path)
      reusable.doc = doc
      // The tab stays, but the note in it is another one: the view has to be
      // told, since nothing was typed.
      reusable.pushed = (reusable.pushed ?? 0) + 1
      reusable.dirty = false
      reusable.cursor = place.cursor
      reusable.scroll = place.scroll
      reusable.anchor = place.anchor

      if (options.activate !== false) {
        this.activeTabId = reusable.id
        this.showNote()
      }
      this.remember(path)
      this.persist()
      return
    }

    const tab: Tab = {
      id: identifier(),
      kind: 'note',
      path,
      name: basename(path),
      doc,
      dirty: false,
      ...this.positions.of(path),
    }
    this.tabs = [...this.tabs, tab]
    if (options.activate !== false) {
      this.activeTabId = tab.id
      this.showNote()
    }
    this.previewTabId = options.preview ? tab.id : this.previewTabId
    this.remember(path)

    this.dropScaffolding(tab.id)
    this.persist()
  }

  /** A note named the way the space speaks of it, which is how the link index and
   *  the graph name them, opened the way a row in the file list opens: a look on
   *  one click, a tab of its own on two. */
  openRelative(relative: string, keep: boolean) {
    const root = this.activeSpace?.root
    if (!root) return

    void this.open(insideSpace(root, relative), keep ? {} : { preview: true })
  }

  activate(id: string) {
    this.activeTabId = id
    this.persist()
  }

  /** Makes a tab that was only previewing its note stay: the italic goes, and
   *  the next single click in the file list gets a tab of its own instead of
   *  taking this one over. Every way of keeping a preview ends up here -
   *  typing in it, opening the note for real from the list, a double click or
   *  "Keep open" on the tab itself - so they cannot drift apart. Asking about
   *  a tab that is not the preview changes nothing. */
  keep(id: string) {
    if (this.previewTabId === id) this.previewTabId = null
  }

  close(id: string) {
    const index = this.tabs.findIndex((tab) => tab.id === id)
    if (index < 0) return

    this.tabs = this.tabs.filter((tab) => tab.id !== id)

    if (this.activeTabId === id) {
      this.activeTabId = (this.tabs[index] ?? this.tabs[index - 1])?.id ?? null
    }
    if (!this.tabs.length) this.openBlank()
    this.persist()
  }

  /** What the editor reports on every keystroke. Nothing here touches the text:
   *  the rope is held onto as it is and `flush` turns it into a string later,
   *  so the cost of a keystroke does not grow with the size of the note. What
   *  does happen at once is the dirty mark, because that is what the writer
   *  is looking at. */
  edit(text: DocText) {
    const tab = this.active
    if (!tab) return

    this.live = { id: tab.id, text }
    tab.dirty = true

    // Typing in a note you were only previewing is what makes it yours.
    this.keep(tab.id)

    this.scheduleSave()
    // Auto-save may be off, or the note may have nowhere to be saved to yet.
    // Either way the words themselves are written down.
    this.scheduleSession()
  }

  /** Brings `tab.doc` up to what the editor holds. Everything that reads the
   *  text of a note calls this first; it costs one pass over the note, and
   *  nothing at all when there is nothing waiting. */
  flush() {
    const live = this.live
    if (!live) return

    this.live = null
    const tab = this.tabs.find((one) => one.id === live.id)
    if (!tab) return

    const text = live.text.toString()
    if (tab.doc !== text) tab.doc = text
  }

  /** Text put into a note from somewhere other than the editor: a version
   *  restored from the history, a note pulled in by a sync. `pushed` is what
   *  tells the view to take it, so this is the only way text arrives without
   *  the writer having typed it. */
  replace(text: string, target?: Tab) {
    const tab = target ?? this.active
    if (!tab) return

    // Whatever the editor was holding is what this replaces.
    if (this.live?.id === tab.id) this.live = null

    tab.doc = text
    tab.dirty = true
    tab.pushed = (tab.pushed ?? 0) + 1
    this.scheduleSave()
    this.scheduleSession()
  }

  /** Typora saves as you pause; so does this, but only for notes that already
   *  live somewhere. An untitled note waits for you to choose a home. */
  private scheduleSave() {
    if (!this.autoSave || !this.active?.path) return

    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void this.save(), this.autoSaveDelay)
  }

  /** The dot's three states. `saved` stands for a moment and then goes: it is
   *  a confirmation, not a status, and a note with nothing to write should not
   *  wear a mark forever. */
  private markSaving(id: string) {
    this.forgetSavedTimer(id)
    this.saveState = { ...this.saveState, [id]: 'saving' }
  }

  private markSaved(id: string) {
    this.saveState = { ...this.saveState, [id]: 'saved' }
    this.savedTimers[id] = setTimeout(() => this.clearSaveState(id), SAVED_SHOWN)
  }

  private clearSaveState(id: string) {
    this.forgetSavedTimer(id)
    this.saveState = without(this.saveState, id)
  }

  private forgetSavedTimer(id: string) {
    clearTimeout(this.savedTimers[id])
    this.savedTimers = without(this.savedTimers, id)
  }

  setAutoSaveDelay(ms: number) {
    this.autoSaveDelay = ms
    localStorage.setItem(AUTO_SAVE_DELAY_KEY, String(ms))
  }

  setAutoSave(on: boolean) {
    this.autoSave = on
    localStorage.setItem(AUTO_SAVE_KEY, String(on))
    if (!on) clearTimeout(this.saveTimer)
  }

  /** Notes holding work that is not on disk. Whitespace-only scratch does not
   *  count - nobody wants to be asked about an empty note. */
  get unsaved(): Tab[] {
    this.flush()
    return this.tabs.filter((tab) => tab.dirty && tab.doc.trim().length > 0)
  }

  async saveAll() {
    for (const tab of this.unsaved) await this.save(tab)
  }

  async save(target?: Tab) {
    // A table cell holds its text until it loses focus; make sure it landed.
    flushTableEdits()
    // And the keystrokes since the last pause, which are still only a rope.
    this.flush()

    const tab = target ?? this.active
    if (tab?.kind !== 'note') return

    // Saving is as deliberate as it gets: a note that was only being looked
    // at is one to stay from here on, whether or not there was anything to
    // write.
    this.keep(tab.id)

    let path = tab.path
    if (!path) {
      const picked = await pickSavePath(this.spaces, this.activeSpaceId, tab.doc, tab.name)
      if (!picked) return
      path = picked
    }

    this.markSaving(tab.id)

    try {
      // Keep the version that is about to be replaced, before replacing it.
      if (tab.path) {
        await invoke('snapshot_note', { path, content: tab.doc }).catch(() => undefined)
      }

      await invoke('write_note', { path, content: tab.doc })
    } catch (error) {
      this.clearSaveState(tab.id)
      throw error
    }

    tab.path = path
    tab.name = basename(path)
    tab.dirty = false
    this.markSaved(tab.id)

    // The one note that changed, read again from what was written. This is the
    // whole of keeping the index up to date after the first scan of a space.
    links.noteSaved(path, tab.doc)

    // Editing the config files in Nib should take effect on save.
    if (/custom\.css$|snippets\.json$/.test(path)) {
      const { settings } = await import('./settings.svelte')
      const { theme } = await import('./theme.svelte')
      await Promise.all([settings.loadSnippets(), theme.reload()])
    }

    await this.loadTree()
    this.persist()

    // Imported here rather than at the top: syncing reads the workspace, and
    // the two would import each other.
    const { sync } = await import('./sync.svelte')
    sync.nudge()
  }

  /** Notes opened lately, for the palette. The taskbar keeps a list of its
   *  own, which is what the second call puts a note into. */
  get recent(): string[] {
    return this.device.recent
  }

  private remember(path: string) {
    this.device.remember(path)
    if (isDesktop) void invoke('remember_recent', { path }).catch(() => undefined)
  }

  forgetRecent() {
    this.device.forgetRecent()
  }

  /** The icon a space shows in the rail, if it has been given one. Keyed by
   *  folder rather than id, so it survives the ids being handed out again. */
  iconFor(spaceId: string | null): string | null {
    const space = this.spaces.find((entry) => entry.id === spaceId)
    return space ? this.device.iconOf(space.root) : null
  }

  /** An icon that came from the account rather than from this machine. */
  applyIcon(root: string, name: string | null) {
    if (this.device.iconOf(root) === name) return
    this.device.setIcon(root, name)
  }

  setIcon(spaceId: string, name: string | null) {
    const space = this.spaces.find((entry) => entry.id === spaceId)
    if (!space) return

    this.device.setIcon(space.root, name)

    // Imported here rather than at the top: syncing reads the workspace, and
    // the two would import each other.
    void import('./sync.svelte').then(({ sync }) => sync.pushIcon(space.root, name))
  }

  /** The picked rows. The tree reads it; every change to it goes through the
   *  four calls below, so the anchor a Shift range counts from stays right. */
  get selection(): string[] {
    return this.picked.paths
  }

  isSelected(path: string): boolean {
    return this.picked.has(path)
  }

  /** A plain click: that row alone. */
  select(path: string) {
    this.picked.select(path)
  }

  /** Ctrl-click: in or out, leaving the rest as it is. */
  toggleSelect(path: string) {
    this.picked.toggle(path)
  }

  /** Shift-click: from the anchor to here, in the order the rows are shown. */
  selectRange(path: string) {
    this.picked.range(path, this.visibleRows())
  }

  selectAll() {
    this.picked.all(this.visibleRows())
  }

  clearSelection() {
    this.picked.clear()
  }

  /** Every row the tree shows, top to bottom: a folder's children only while
   *  it is open, which is what Shift-click and Ctrl+A mean by "between". */
  visibleRows(): string[] {
    const out: string[] = []
    const walk = (entry: Entry) => {
      for (const child of entry.children) {
        out.push(child.path)
        if (child.is_dir && this.isExpanded(child.path)) walk(child)
      }
    }
    if (this.tree) walk(this.tree)
    return out
  }

  /** What a drag from `path` carries: the whole selection when the row is part
   *  of it, the row alone otherwise. */
  dragPayload(path: string): string[] {
    return this.picked.dragging(path)
  }

  async moveMany(paths: string[], intoFolder: string) {
    for (const path of outermost(paths)) await this.move(path, intoFolder)
    this.clearSelection()
  }

  async removeMany(paths: string[]) {
    for (const path of outermost(paths)) {
      const entry = this.entryAt(path)
      if (entry) await this.remove(path, entry.is_dir)
    }
    this.clearSelection()
  }

  private entryAt(path: string): Entry | null {
    const found = entryAt(this.tree, path)
    return found && found.path !== this.tree?.path ? found : null
  }

  /** A row put into the tree, taken out of it, or moved within it, before the
   *  filesystem has been asked. The listing that follows every one of these
   *  operations is what the tree really is; this is so the click is answered in
   *  the same frame it happened, rather than after a round trip and a re-read
   *  of the whole folder. An operation that fails undoes itself when the
   *  listing arrives. */
  private showEntry(entry: Entry) {
    if (this.tree) this.tree = withEntry(this.tree, entry, this.treeOptions)
  }

  private hideEntry(path: string) {
    if (this.tree) this.tree = withoutEntry(this.tree, path)
  }

  private showMove(from: string, to: string) {
    if (this.tree) this.tree = withMove(this.tree, from, to, this.treeOptions)
  }

  /** A row for something that is about to exist. The times are now, which is
   *  what sorting by "created" or "modified" would put it under anyway. */
  private freshEntry(path: string, isFolder: boolean): Entry {
    const at = Date.now()
    return {
      name: basename(path),
      path,
      is_dir: isFolder,
      modified: at,
      created: at,
      children: [],
    }
  }

  get pinned(): string[] {
    return this.device.pinned
  }

  isExpanded(path: string): boolean {
    return this.device.isExpanded(path)
  }

  toggleFolder(path: string) {
    this.device.toggleFolder(path)
  }

  isPinned(path: string): boolean {
    return this.device.isPinned(path)
  }

  /** Pinned notes and folders sit above the tree, whatever their depth. */
  togglePin(path: string) {
    this.device.togglePin(path)
  }

  /** Every `#tag` in the space, most used first. */
  async loadTags() {
    const root = this.activeSpace?.root
    if (!root) return

    this.tags = await invoke<Tag[]>('space_tags', { root }).catch(() => [])
  }

  /** Searches every note in the space and returns the matching lines. */
  async search(query: string): Promise<Hit[]> {
    const root = this.activeSpace?.root
    if (!root || query.trim().length < 2) return []

    return invoke<Hit[]>('search_space', { root, query, limit: 200 }).catch(() => [])
  }

  /** Creates `Untitled.md` in a folder, stepping the name until it is free. */
  async createNote(folder?: string) {
    const dir = folder ?? this.activeSpace?.root
    if (!dir) return

    const taken = new Set(this.notes.map((note) => note.path))
    let name = 'Untitled.md'
    let counter = 2
    while (taken.has(joinPath(dir, name))) name = `Untitled ${counter++}.md`

    // Opens with its own name as the title, so there is something to write
    // under rather than an empty page.
    const path = joinPath(dir, name)
    const content = `# ${name.replace(MARKDOWN, '')}\n\n`

    // The row, the tab and the caret are all there before the file is. Making
    // a note is the one thing that should never feel like waiting for a disk,
    // and everything below knows what the note will say.
    this.showEntry(this.freshEntry(path, false))
    if (dir !== this.activeSpace?.root) this.device.expand(dir)

    const tab: Tab = {
      id: identifier(),
      kind: 'note',
      path,
      name: basename(path),
      doc: content,
      dirty: false,
    }
    this.tabs = [...this.tabs, tab]
    this.activeTabId = tab.id
    this.showNote()
    this.remember(path)
    this.dropScaffolding(tab.id)
    this.startRenaming(path)

    await invoke('write_note', { path, content })
    links.noteSaved(path, content)
    await this.loadTree()
    this.persist()
  }

  async createFolder(parent?: string) {
    const dir = parent ?? this.activeSpace?.root
    if (!dir) return

    // Stepped like a note's, so a second folder does not collide with the first.
    const taken = this.everyPath()
    let name = 'New folder'
    let counter = 2
    while (taken.has(joinPath(dir, name))) name = `New folder ${counter++}`

    const path = joinPath(dir, name)
    this.showEntry(this.freshEntry(path, true))
    this.startRenaming(path)

    await invoke('create_folder', { path })
    await this.loadTree()
  }

  /** Every path in the open space. `notes` holds only files; this counts the
   *  folders between them too. */
  private everyPath(): Set<string> {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- thrown away by the caller; nothing renders from it
    const out = new Set<string>()
    const walk = (entry: Entry) => {
      for (const child of entry.children) {
        out.add(child.path)
        if (child.is_dir) walk(child)
      }
    }

    if (this.tree) walk(this.tree)
    return out
  }

  /** Opens the name field on a row, so naming a note is part of making it.
   *  Pointless while the tree is not the panel on show. */
  startRenaming(path: string, appending = false) {
    if (this.panel === 'tree') this.renaming = { path, appending }
  }

  stopRenaming() {
    this.renaming = null
  }

  async rename(path: string, name: string) {
    const clean = name.trim()
    if (!clean || clean.includes('/') || clean.includes('\\')) return

    const target = joinPath(folderOf(path), clean)
    if (target === path) return

    // The new name is on the row before the rename has happened; the listing
    // that follows is what settles it.
    this.showMove(path, target)
    this.renaming = null

    await invoke('rename_note', { from: path, to: target })
    this.positions.move(path, target)

    // Every link to the note now points at a name nothing answers to, so they
    // are rewritten, silently, as Obsidian does. Recorded on the action so that
    // undoing the rename undoes the rewrite with it.
    //
    // Before the index is told the note moved, not after: finding the links that
    // pointed at the old name means resolving them against the space as it was.
    const rewrote = (await this.retarget(path, target)) > 0
    links.notesMoved(path, target)
    this.undone.record({ kind: 'rename', from: path, to: target, ...(rewrote ? { rewrote } : {}) })

    const tab = this.tabs.find((entry) => entry.path === path)
    if (tab) {
      this.flush()
      // A new note is written with its own name as the heading, so renaming it
      // straight afterwards would otherwise leave `# Untitled` at the top. Only
      // while the heading still is the old name; an edited one is the author's.
      const was = `# ${basename(path).replace(MARKDOWN, '')}`
      if (tab.doc === was || tab.doc.startsWith(was + '\n')) {
        tab.doc = `# ${clean.replace(MARKDOWN, '')}${tab.doc.slice(was.length)}`
        // Nobody typed this, so the view has to be told to take it.
        tab.pushed = (tab.pushed ?? 0) + 1
      }

      tab.path = target
      tab.name = basename(target)
    }

    await this.loadTree()
    this.persist()
  }

  async remove(path: string, isFolder: boolean) {
    // Gone from the tree before the snapshot has been taken and the file has
    // been moved: three round trips is a long time for a row to sit there
    // looking as though the delete had not registered.
    this.hideEntry(path)

    // A deleted note keeps one last snapshot, so the delete is recoverable.
    if (!isFolder) {
      const content = await invoke<string>('read_note', { path }).catch(() => '')
      if (content) await invoke('snapshot_note', { path, content }).catch(() => undefined)
      this.undone.record({ kind: 'delete', path, content })
    }

    try {
      // Signed in, the account keeps a copy for 14 days; signed out, this
      // device does, in its own trash folder (see trash.svelte.ts).
      if (account.signedIn) {
        await invoke(isFolder ? 'delete_folder' : 'delete_note', { path })
      } else {
        const entry = await invoke<{ id: string }>('trash_item', {
          path,
          kind: isFolder ? 'folder' : 'note',
        })
        this.undone.trashed(path, entry.id)
      }
    } catch (error) {
      // The row was hidden before the file was asked to go, so a delete that
      // did not happen has to put it back: the listing is what the tree really
      // is, and until it is read again the row is simply missing.
      await this.loadTree()
      throw error
    }

    for (const tab of this.tabs.filter((entry) => entry.path?.startsWith(path))) {
      this.close(tab.id)
    }

    links.noteGone(path)
    await this.loadTree()
  }

  /** Puts the last file operation back; see workspace/undo. */
  async undoFileAction() {
    const action = this.undone.last
    if (!action) return

    try {
      switch (action.kind) {
        case 'delete':
          await this.putBack(action)
          break
        case 'merge':
          await this.unmerge(action)
          break
        case 'split':
        case 'extract':
          await this.uncarve(action)
          break
        case 'move':
        case 'rename':
          await this.putName(action)
          break
      }
    } catch {
      // Something else has since changed the file; leave what is there alone.
      // The action stays on the stack, so the same undo can be tried again
      // once whatever is in the way has been dealt with.
      return
    }

    this.undone.drop()
    await this.loadTree()
    this.persist()
  }

  /** A deleted note back where it was. Out of the device's trash when it went
   *  there, and from the snapshot taken on the way out otherwise.
   *
   *  The trash can refuse: the sweep runs daily and clears anything past its
   *  fourteen days, and Recently deleted can purge an entry by hand. The
   *  snapshot is still here either way, so it stands in rather than leaving
   *  the note gone with nothing said. */
  private async putBack(action: Extract<FileAction, { kind: 'delete' }>) {
    if (!action.trashId) {
      await invoke('write_note', { path: action.path, content: action.content })
      return
    }

    const restored = await invoke('restore_trash', { id: action.trashId })
      .then(() => true)
      .catch(() => false)

    if (restored) return
    if (!action.content) throw new Error('the deleted note is no longer in the trash')

    await invoke('write_note', { path: action.path, content: action.content })
  }

  /** Puts a rename or a move back: the file where it was, and the links that
   *  followed it pointed at the old name again. */
  private async putName(action: Extract<FileAction, { kind: 'move' | 'rename' }>) {
    await invoke('rename_note', { from: action.to, to: action.from })
    this.positions.move(action.to, action.from)

    for (const tab of this.tabs.filter((entry) => entry.path === action.to)) {
      tab.path = action.from
      tab.name = basename(action.from)
    }

    // The rename rewrote every link that pointed at the note; putting the name
    // back has to put those back too, which is the same rewrite the other way
    // round - and, again, before the index is told the note moved.
    if (action.rewrote) await this.retarget(action.to, action.from)
    links.notesMoved(action.to, action.from)
  }

  /** Puts a merge back: both notes as they were, and the note that was folded
   *  in written again where it was. */
  private async unmerge(action: Extract<FileAction, { kind: 'merge' }>) {
    await invoke('write_note', { path: action.into, content: action.intoContent })
    await invoke('write_note', { path: action.from, content: action.fromContent })

    links.noteSaved(action.into, action.intoContent)
    links.noteSaved(action.from, action.fromContent)
    this.reload(action.into, action.intoContent)

    // Links to the note that went away were pointed at the note it went into.
    await this.retarget(action.into, action.from)
  }

  /** Puts a split or an extraction back: the note whole again, and the note that
   *  was carved out of it gone. */
  private async uncarve(action: Extract<FileAction, { kind: 'split' | 'extract' }>) {
    await invoke('write_note', { path: action.from, content: action.fromContent })
    await invoke('delete_note', { path: action.created }).catch(() => undefined)

    links.noteSaved(action.from, action.fromContent)
    links.noteGone(action.created)

    for (const tab of this.tabs.filter((one) => one.path === action.created)) this.close(tab.id)
    this.reload(action.from, action.fromContent)
  }

  /** Text written to a note from outside the editor, put into the tab holding it
   *  if one is open. `pushed` is what tells the view to take it. */
  private reload(path: string, content: string) {
    const tab = this.tabs.find((one) => one.path === path)
    if (!tab) return

    if (this.live?.id === tab.id) this.live = null
    tab.doc = content
    tab.dirty = false
    tab.pushed = (tab.pushed ?? 0) + 1
  }

  /** Rewrites every link in the space that points at `from` so it points at `to`.
   *  Answers how many notes were touched, so a caller can record whether there is
   *  anything to put back. */
  private async retarget(from: string, to: string): Promise<number> {
    const root = this.activeSpace?.root
    if (!root) return 0

    const touched = await links.retarget(from, to, root)

    // A note on screen may be one of the notes that was rewritten.
    for (const tab of this.tabs) {
      if (!tab.path || tab.dirty) continue
      const fresh = await invoke<string>('read_note', { path: tab.path }).catch(() => null)
      if (fresh !== null && fresh !== tab.doc) this.reload(tab.path, fresh)
    }

    return touched
  }

  /** Follows a link between notes: opens the note, goes to the heading or the
   *  block it names, and makes the note when the space has none.
   *
   *  Where the caret ends up is worked out from the note that has just been
   *  loaded rather than from the index, because the index knows a heading's words
   *  and not which line they are on - and the note on disk is the authority. */
  async followLink(jump: NoteJump) {
    const root = this.activeSpace?.root
    if (!root) return

    const path = jump.path ? insideSpace(root, jump.path) : await this.makeLinked(jump.target, root)
    if (!path) return

    await this.open(path)
    if (jump.heading === null && jump.block === null) return

    const doc = this.tabs.find((tab) => tab.path === path)?.doc ?? ''
    const line = lineOfTarget(doc, jump)
    if (line !== null) this.goto = { path, line }
  }

  /** Where a followed link asked to land: which note, and which line of it. Read
   *  and cleared by the app, which is what owns the editor's scroll. */
  goto = $state<{ path: string; line: number } | null>(null)

  /** The note a link names but the space has not got. Made where a link would
   *  look for it: in the folder the link says, or beside the note that links to
   *  it when it says none. */
  private async makeLinked(target: string, root: string): Promise<string | null> {
    const clean = target.replace(/[\\]/g, '/').replace(/^\/+|\/+$/g, '')
    if (!clean) return null

    const here = this.active?.path ? folderIn(relativeTo(root, this.active.path)) : ''
    const relative = clean.includes('/') || !here ? clean : `${here}/${clean}`
    const path = insideSpace(root, MARKDOWN.test(relative) ? relative : `${relative}.md`)

    const content = `# ${noteName(relative)}\n\n`
    await invoke('write_note', { path, content })
    links.noteSaved(path, content)
    await this.loadTree()

    return path
  }

  /** Appends this note into another, deletes it, and points every link that came
   *  here at the note it went into. */
  async mergeInto(from: string, into: string) {
    if (from === into) return

    const [fromContent, intoContent] = await Promise.all([
      invoke<string>('read_note', { path: from }).catch(() => null),
      invoke<string>('read_note', { path: into }).catch(() => null),
    ])
    if (fromContent === null || intoContent === null) return

    const joined = merged(intoContent, fromContent)

    await invoke('snapshot_note', { path: into, content: intoContent }).catch(() => undefined)
    await invoke('write_note', { path: into, content: joined })
    links.noteSaved(into, joined)
    this.reload(into, joined)

    // Before the note goes, so the links that pointed at it can still be found.
    await this.retarget(from, into)

    await invoke('snapshot_note', { path: from, content: fromContent }).catch(() => undefined)
    await invoke('delete_note', { path: from })
    links.noteGone(from)

    for (const tab of this.tabs.filter((one) => one.path === from)) this.close(tab.id)

    this.undone.record({ kind: 'merge', from, fromContent, into, intoContent })
    await this.loadTree()
    await this.open(into)
  }

  /** Everything from the caret on becomes a note of its own, with a link left in
   *  its place. */
  async splitAtCaret(at: number) {
    const tab = this.active
    if (!tab?.path) return
    this.flush()

    const carved = splitAt(tab.doc, at, UNTITLED)
    if (!carved) return

    await this.carve(tab.path, tab.doc, carved, 'split')
  }

  /** The selection becomes a note of its own, with a link in its place. */
  async extractSelection(from: number, to: number) {
    const tab = this.active
    if (!tab?.path) return
    this.flush()

    const carved = extracted(tab.doc, from, to, UNTITLED)
    if (!carved) return

    await this.carve(tab.path, tab.doc, carved, 'extract')
  }

  /** What a split and an extraction both do: write the new note, write what is
   *  left of this one, and remember enough to undo both. */
  private async carve(
    path: string,
    before: string,
    carved: { kept: string; taken: string; name: string },
    kind: 'split' | 'extract',
  ) {
    const folder = folderOf(path)
    const taken = new Set(this.notes.map((note) => note.path))

    let name = `${carved.name}.md`
    let counter = 2
    while (taken.has(joinPath(folder, name))) name = `${carved.name} ${counter++}.md`
    const created = joinPath(folder, name)

    await invoke('write_note', { path: created, content: carved.taken })
    links.noteSaved(created, carved.taken)

    await invoke('snapshot_note', { path, content: before }).catch(() => undefined)
    await invoke('write_note', { path, content: carved.kept })
    links.noteSaved(path, carved.kept)
    this.reload(path, carved.kept)

    this.undone.record({ kind, from: path, fromContent: before, created })
    await this.loadTree()
    this.persist()
  }

  /** A note whose name is the moment it was made, so nothing ever collides with
   *  it and no link to it ever has to be rewritten. The format is the reader's;
   *  see note-id.ts and the Editor settings. */
  async createUniqueNote(format: string, folder?: string) {
    const dir = folder ?? this.activeSpace?.root
    if (!dir) return

    const taken = new Set(this.notes.map((note) => note.path))
    const stem = noteId(format)
    let name = `${stem}.md`
    let counter = 2
    while (taken.has(joinPath(dir, name))) name = `${stem}-${counter++}.md`

    // Opens with an empty heading and the caret in it: the name is settled, so
    // the only thing left to do is say what the note is about.
    const path = joinPath(dir, name)
    const content = '# '

    this.showEntry(this.freshEntry(path, false))
    if (dir !== this.activeSpace?.root) this.device.expand(dir)

    const tab: Tab = {
      id: identifier(),
      kind: 'note',
      path,
      name: basename(path),
      doc: content,
      dirty: false,
      cursor: content.length,
    }
    this.tabs = [...this.tabs, tab]
    this.activeTabId = tab.id
    this.showNote()
    this.remember(path)
    this.dropScaffolding(tab.id)
    // The name is settled and the row is waiting for a title after it; typing
    // one leaves `202609070155 Some title.md`, and pressing Enter with nothing
    // typed leaves the timestamp alone.
    this.startRenaming(path, true)

    await invoke('write_note', { path, content })
    links.noteSaved(path, content)
    await this.loadTree()
    this.persist()
  }

  /** What undoing would do, phrased for a menu. Null when there is nothing. */
  get undoLabel(): string | null {
    return this.undone.label
  }

  async duplicate(path: string) {
    const content = await invoke<string>('read_note', { path })
    const name = basename(path).replace(/(\.[^.]+)$/, ' copy$1')

    await invoke('write_note', { path: joinPath(folderOf(path), name), content })
    await this.loadTree()
  }

  async reveal(path: string) {
    if (!isDesktop) return
    const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
    await revealItemInDir(path)
  }

  showPanel(next: Panel) {
    this.panel = this.panel === next ? null : next
    this.persist()
  }

  /** Shuts the sidebar whichever panel is in it. Its own method because every
   *  caller had to name the panel it was closing, and `showPanel(panel)` only
   *  closes it by happening to be the one already open. */
  closePanel() {
    if (!this.panel) return

    this.panel = null
    this.persist()
  }

  toggleSidebar() {
    this.panel = this.panel ? null : 'tree'
    this.persist()
  }
}

export const workspace = new Workspace()
