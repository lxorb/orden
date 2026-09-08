import { flushTableEdits, type NoteJump } from '@nib/editor'
import { account } from './account.svelte'
import { blankCanvas } from './canvas/format'
import { blockIds, isCanvasTarget, isPdfTarget, isTabFile } from '@nib/markdown/links'
import { extracted, merged, splitAt } from './composer'
import { links } from './link-index.svelte'
import { noteId } from './note-id'
import { folderOf as folderIn, insideSpace, noteName, relativeTo } from './space-paths'
import { key, t } from './i18n.svelte'
import { identifier } from './identifier'
import { nameFromContent } from './note-name'
import { lineOfHeading, scanHeadings } from './outline'
import { without } from './records'
import type { Change } from './search/apply'
import { isRecord, stored } from './stored'
import {
  type Draft,
  frameDraft,
  frameOf,
  type Layout,
  panesOf,
  readSession,
  type Session,
  writeSession,
} from './workspace/session'
import { Bookmarks } from './workspace/bookmarks.svelte'
import { ClosedTabs } from './workspace/closed.svelte'
import { DeviceView } from './workspace/device.svelte'
import { type DocumentStart, NoteDoc, Tab } from './workspace/documents.svelte'
import { Layouts } from './workspace/layouts.svelte'
import { type Along, type Frame, panesIn, withoutPane } from './workspace/pane-tree'
import { type Landing, Panes } from './workspace/panes.svelte'
import { alongOf, madeFirst, type Side } from './workspace/zones'
import { Positions } from './workspace/positions'
import { type FileAction, FileActions } from './workspace/undo.svelte'
import { outermost, Selection } from './workspace/selection.svelte'
import { entryAt, withEntry, withMove, withoutEntry } from './tree-edits'
import { folderOf, invoke, isDesktop, isNative, joinPath } from './tauri'
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

/** A document is the words and a tab is one pane's view of them; both live in
 *  workspace/documents.svelte.ts, and are named here because half the app asks
 *  the workspace for a tab. */
export type { NoteDoc, Tab, TabKind } from './workspace/documents.svelte'

export type Panel = 'tree' | 'outline' | 'search' | 'links'

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

/** A file's name as the app writes it: without the extension, the way the tab
 *  strip and the file list show it. */
function shownName(name: string): string {
  return name.replace(MARKDOWN, '')
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

  return lineOfHeading(scanHeadings(doc), jump.heading)
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

/** A map read within one call and thrown away. Not one of Svelte's: nothing
 *  renders from these, and a reactive map would only cost the app the wrappers. */
function emptyMap<T>(): Map<string, T> {
  return new Map<string, T>()
}

function pathsTo(notes: NoteDoc[]): Map<string, NoteDoc> {
  const out = emptyMap<NoteDoc>()
  for (const note of notes) if (note.path) out.set(note.path, note)

  return out
}

/** The open documents by the key a draft names them with, so a tab reopened
 *  while another pane still shows the same note becomes a second view of that
 *  note rather than a second copy of it. */
function keysTo(notes: NoteDoc[]): Map<string, NoteDoc> {
  const out = emptyMap<NoteDoc>()
  for (const note of notes) out.set(note.key, note)

  return out
}

/** Whether a tab is worth remembering once it has been closed. A blank untitled
 *  note is not: it is the empty page a window starts with, and reopening it
 *  would put back something nobody ever wrote. */
function worthReopening(tab: Tab): boolean {
  return tab.kind !== 'note' || tab.path !== null || tab.doc.trim().length > 0
}

class Workspace {
  spaces = $state<Space[]>([])
  activeSpaceId = $state<string | null>(null)
  tree = $state<Entry | null>(null)
  /** Every tab in the window, whichever pane it sits in. One flat list, because
   *  half of what the app asks is "is this note open" rather than "where": a tab
   *  says which pane it is in, and a pane's strip is the tabs that name it. */
  tabs = $state<Tab[]>([])
  /** How the panes are arranged and which one has the focus; see
   *  workspace/panes.svelte.ts. */
  readonly panes = new Panes(() => this.scheduleSession())
  /** Arrangements someone has named; see workspace/layouts.svelte.ts. */
  readonly layouts = new Layouts()
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
  /** The tabs this window has closed, newest last; see workspace/closed. */
  readonly closed = new ClosedTabs()
  tags = $state<Tag[]>([])
  /** What this machine remembers about the list: which folders are open, what
   *  was opened lately, the icon each space wears. See workspace/device. */
  readonly device = new DeviceView()
  /** The notes, folders, headings and searches kept above the file list. Per
   *  space, and on the account when there is one; see workspace/bookmarks. */
  readonly bookmarks = new Bookmarks(() => this.activeSpace?.root ?? null)
  /** Rows picked in the tree with Ctrl or Shift; see workspace/selection. */
  private readonly picked = new Selection()
  /** Which notes are being written, and which have just been. The dot beside a
   *  note's name is the whole report on saving, so it has three things to say:
   *  there is something unwritten, it is going down now, it is down. Held apart
   *  from the note because "just saved" is about this moment and not about the
   *  note, and keyed by document rather than by tab so both panes showing one
   *  note show the same mark. */
  saveState = $state<Record<string, 'saving' | 'saved'>>({})
  private savedTimers: Record<string, ReturnType<typeof setTimeout>> = {}

  private saveTimer: ReturnType<typeof setTimeout> | undefined
  private sessionTimer: ReturnType<typeof setTimeout> | undefined
  /** Notes waiting to be written when the typing stops. A set rather than one
   *  note, because two panes may hold two different notes and both be edited
   *  between one pause and the next. */
  private readonly waiting = new Set<NoteDoc>()

  /** Where each note was last being read; see workspace/positions.ts. */
  private positions = new Positions()

  readonly activeSpace = $derived(
    this.spaces.find((space) => space.id === this.activeSpaceId) ?? null,
  )
  /** The tab showing in the pane that has the focus. Every key and every
   *  palette command means this one. */
  readonly active = $derived(this.tabs.find((tab) => tab.id === this.activeTabId) ?? null)

  /** Which tab that is. Setting it shows a tab and moves the focus to the pane
   *  it is in, which is what every caller means by it. */
  get activeTabId(): string | null {
    return this.panes.focused.activeTabId
  }

  set activeTabId(id: string | null) {
    const tab = id === null ? null : (this.tabs.find((one) => one.id === id) ?? null)
    if (id !== null && !tab) return

    const paneId = tab?.paneId ?? this.panes.focusedId
    this.panes.focus(paneId)
    this.panes.activate(paneId, tab?.id ?? null)
  }

  /** One pane's strip, in the order the tabs were opened. */
  tabsIn(paneId: string): Tab[] {
    return this.tabs.filter((tab) => tab.paneId === paneId)
  }

  /** Every open document, once each however many panes are showing it. */
  private get documents(): NoteDoc[] {
    const seen: NoteDoc[] = []
    for (const tab of this.tabs) if (!seen.includes(tab.note)) seen.push(tab.note)
    return seen
  }

  /** What the dot beside a name is saying, if anything. */
  savingOf(tab: Tab): 'saving' | 'saved' | undefined {
    return this.saveState[tab.note.key]
  }

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

  /** Every file in the space, flattened: the notes, and the PDFs and canvases
   *  beside them, which are the three things a tab can hold. What quick open
   *  lists. */
  readonly files = $derived.by((): Entry[] => {
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

  /** The notes among them. What everything that means words asks for: which note
   *  to merge into, which note a space is published as, which names a search
   *  completes. A PDF is a file to read and a canvas is a plane to arrange notes
   *  on; neither is a note to write in. */
  readonly notes = $derived(this.files.filter((one) => !isTabFile(one.name)))

  async restore() {
    // The browser build starts empty, so give a first visit something to read.
    if (!isNative) {
      const { seed } = await import('./web/commands')
      await seed()
    }

    const state = readSession(stored(STORAGE_KEY))
    this.layouts.restore()

    if (!state) {
      await this.loadSpaces()
      if (this.activeSpaceId) await this.loadTree()

      // A first visit opens what it was given rather than a blank page.
      const first = this.files[0]
      if (first) await this.openEntry(first.path)
      if (!this.tabs.length) this.openBlank()
      return
    }

    this.spaces = state.spaces
    this.positions = new Positions(state.positions ?? {})
    this.closed.restore(state.closed ?? [])
    // The sidebar comes back the way it was left.
    this.panel = state.panel
    this.activeSpaceId = state.activeSpace ?? this.spaces[0]?.id ?? null

    // The folder wins over what was remembered, so the two cannot drift apart.
    await this.loadSpaces()

    if (this.activeSpaceId) await this.loadTree()

    if (state.layout) await this.applyLayout(state.layout)
    else if (state.tabs?.length) await this.restoreStrip(state.tabs, state.active ?? 0)
    else {
      for (const path of state.openPaths ?? []) {
        await this.openEntry(path, { activate: path === state.activePath })
      }
    }

    // A note always opens for writing. Which face was up belongs to the sitting
    // that was, not to the note; a named layout is the one thing that says
    // otherwise, and that is chosen rather than restored. See `applyLayout`.
    for (const tab of this.tabs) tab.reading = false

    // A phone shows one note at a time, so an arrangement made on a desktop
    // arrives as the pane that had the focus, with everything in it.
    if (viewport.phone) this.collapsePanes()
    if (!this.tabs.length) this.openBlank()
  }

  /** Drafts as tabs. A note that was clean is re-read from disk, so an edit made
   *  elsewhere shows up; a note that was not is restored from its draft and stays
   *  dirty. Replacing someone's unsaved work with what happens to be on disk is
   *  the one thing this must never do.
   *
   *  `shared` is what makes two panes that were showing one note show one note
   *  again rather than two copies of it, and `open` is what keeps a note that is
   *  already open being the same note when an arrangement is applied over it. */
  private async tabsFrom(
    drafts: Draft[],
    paneId: string,
    shared: Map<string, NoteDoc>,
    open: Map<string, NoteDoc>,
  ): Promise<Tab[]> {
    const made: Tab[] = []

    for (const draft of drafts) {
      const already =
        (draft.share ? shared.get(draft.share) : undefined) ??
        (draft.path ? open.get(draft.path) : undefined)

      if (already) {
        made.push(this.viewOf(already, paneId, draft))
        continue
      }

      let text = draft.doc

      if (draft.kind === 'note' && draft.path && !draft.dirty) {
        try {
          text = await invoke<string>('read_note', { path: draft.path })
        } catch {
          // Deleted or moved while Nib was away, and nothing unsaved to keep.
          continue
        }
      }

      const note = this.document({
        kind: draft.kind,
        path: draft.path,
        name: draft.name,
        text,
        dirty: draft.dirty,
      })

      if (draft.share) shared.set(draft.share, note)
      if (draft.path) open.set(draft.path, note)
      made.push(this.viewOf(note, paneId, draft))
    }

    return made
  }

  private viewOf(note: NoteDoc, paneId: string, draft: Draft): Tab {
    const tab = new Tab(note, paneId)
    tab.cursor = draft.cursor
    tab.scroll = draft.scroll
    tab.anchor = draft.anchor
    tab.reading = draft.reading === true
    tab.page = draft.page
    tab.zoom = draft.zoom
    return tab
  }

  /** One flat strip of tabs, which is how a session written before there were
   *  panes reads. All of it goes into the one pane there is. */
  private async restoreStrip(drafts: Draft[], active: number) {
    const paneId = this.panes.focusedId
    const restored = await this.tabsFrom(drafts, paneId, emptyMap(), emptyMap())

    this.tabs = restored
    this.panes.activate(paneId, (restored[active] ?? restored[0])?.id ?? null)
  }

  /** Puts an arrangement in place: the panes, the notes in each of them, which
   *  one has the focus, and the sidebar. The session on the way in, and a named
   *  layout whenever one is chosen.
   *
   *  A note with unsaved words that the arrangement says nothing about is not
   *  thrown away: it lands in the pane that ends up with the focus. Arranging
   *  what is open is never a reason to lose what somebody wrote. */
  async applyLayout(layout: Layout) {
    const open = pathsTo(this.documents)
    const rescued = this.tabs.filter((tab) => tab.dirty)
    const shared = emptyMap<NoteDoc>()
    const showing = emptyMap<string | null>()
    const made: Tab[] = []

    for (const draft of panesOf(layout.frame)) {
      const tabs = await this.tabsFrom(draft.tabs, draft.id, shared, open)
      made.push(...tabs)
      showing.set(draft.id, (tabs[draft.active] ?? tabs[0])?.id ?? null)
    }

    let frame: Frame = frameOf(layout.frame, (draft) => showing.get(draft.id) ?? null)

    // A pane whose notes have all gone takes no room.
    for (const empty of panesIn(frame)) {
      if (!made.some((tab) => tab.paneId === empty.id)) frame = withoutPane(frame, empty.id)
    }

    this.tabs = made
    this.panes.restore(frame, layout.focused)
    this.panel = layout.panel

    for (const tab of rescued) {
      if (made.some((one) => one.note === tab.note)) continue

      tab.paneId = this.panes.focusedId
      this.tabs = [...this.tabs, tab]
    }

    if (!this.tabs.length) this.openBlank()
    else if (!this.active) this.activeTabId = this.tabsIn(this.panes.focusedId)[0]?.id ?? null

    // A phone shows one note at a time.
    if (viewport.phone) this.collapsePanes()
    this.persist()
  }

  /** The arrangement as it is written down. What the session holds, and what
   *  "Save layout" keeps a copy of under a name. */
  layout(): Layout {
    this.flush()

    return {
      frame: frameDraft(this.panes.frame, (pane) => {
        const tabs = this.tabsIn(pane.id)
        return {
          tabs: tabs.map((tab) => this.draftOf(tab)),
          active: Math.max(
            0,
            tabs.findIndex((tab) => tab.id === pane.activeTabId),
          ),
        }
      }),
      focused: this.panes.focusedId,
      panel: this.panel,
    }
  }

  private draftOf(tab: Tab): Draft {
    return {
      kind: tab.kind,
      path: tab.path,
      name: tab.name,
      // Only unsaved words are worth writing down: a note that is on disk is
      // re-read from there on the way back in (see `tabsFrom`), so its copy here
      // would never be looked at, and copying a large one every time the typing
      // pauses is not free.
      doc: tab.dirty ? tab.doc : '',
      dirty: tab.dirty,
      cursor: tab.cursor ?? 0,
      scroll: tab.scroll ?? 0,
      anchor: tab.anchor,
      // Which document this is a view of, so two panes on one note come back as
      // one note rather than as two copies of it.
      share: tab.note.key,
      ...(tab.reading ? { reading: true } : {}),
      ...(tab.page === undefined ? {} : { page: tab.page }),
      ...(tab.zoom === undefined ? {} : { zoom: tab.zoom }),
    }
  }

  private persist() {
    clearTimeout(this.sessionTimer)

    const state: Session = {
      spaces: this.spaces,
      activeSpace: this.activeSpaceId,
      layout: this.layout(),
      panel: this.panel,
      positions: this.positions.all,
      closed: this.closed.stack,
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

  /** Which page of a PDF is being read, and how far it is zoomed. What a note
   *  keeps in `noteView`, a PDF keeps here: it is where the tab reopens, and which
   *  page a link copied out of the document names. */
  notePdf(id: string, page: number, zoom: number) {
    const tab = this.tabs.find((one) => one.id === id)
    if (!tab || (tab.page === page && tab.zoom === zoom)) return

    tab.page = page
    tab.zoom = zoom
    this.scheduleSession()
  }

  /** Where a pane that is only reading has got to. The caret is not the reading
   *  view's to move, so the tab keeps the one it had; the place is what changes,
   *  and it is the same place the editor puts back when the note is written in
   *  again - which is what makes the switch read as one page changing its skin. */
  notePlace(id: string, scroll: number, anchor: number) {
    const tab = this.tabs.find((one) => one.id === id)
    if (!tab) return

    this.noteView(id, tab.cursor ?? 0, scroll, anchor, tab.line)
  }

  /** Turns a note tab between writing and reading. The focused tab unless one is
   *  named, since that is what every key and every menu row means by "this note".
   *  The graph is not a note and has no other face. */
  toggleReading(tabId: string = this.activeTabId ?? '') {
    const tab = this.tabs.find((one) => one.id === tabId)
    if (tab?.kind !== 'note') return

    tab.reading = !tab.reading
    // Reading a note is not writing in it, so a preview tab that is being read
    // is still only being previewed; nothing else about the tab changes.
    this.scheduleSession()
  }

  openBlank(name = UNTITLED, doc = '') {
    const note = this.document({ kind: 'note', path: null, name, text: doc, dirty: !!doc })
    this.add(new Tab(note, this.panes.focusedId))
  }

  /** A document, wired so that every change to it - a keystroke in any pane, an
   *  undo, a picture dropped in - reaches the app exactly once. */
  private document(start: DocumentStart): NoteDoc {
    return new NoteDoc(start, (note) => this.edited(note))
  }

  /** Puts a tab in its pane and shows it. */
  private add(tab: Tab, activate = true): Tab {
    this.tabs = [...this.tabs, tab]
    if (activate) this.panes.activate(tab.paneId, tab.id)

    return tab
  }

  /** The graph of the whole space, as a tab of its own. One at a time: a second
   *  picture of the same space says the same thing, so asking again brings the
   *  one already there forward. */
  openGraph() {
    const paneId = this.panes.focusedId
    const existing = this.tabs.find((tab) => tab.kind === 'graph' && tab.paneId === paneId)

    if (existing) this.panes.activate(paneId, existing.id)
    else {
      const note = this.document({
        kind: 'graph',
        path: null,
        name: t('Graph'),
        text: '',
        dirty: false,
      })
      this.add(new Tab(note, paneId))
    }

    this.persist()
  }

  /** A PDF in the space, in a tab of its own. One tab per PDF per pane, the way
   *  the graph is one: asking for a paper that is already open brings it forward
   *  and, when a link named a page, turns to it.
   *
   *  `page` counts from one, and null means wherever the tab was left. */
  openPdf(path: string, page: number | null = null) {
    const paneId = this.panes.focusedId
    const existing = this.tabs.find((tab) => tab.kind === 'pdf' && tab.path === path)

    if (existing) {
      this.activeTabId = existing.id
      if (page !== null) this.gotoPage = { path, page }
    } else {
      const file = this.document({
        kind: 'pdf',
        path,
        name: basename(path),
        text: '',
        dirty: false,
      })
      const tab = new Tab(file, paneId)
      if (page !== null) tab.page = page
      this.add(tab)
      this.dropScaffolding(tab)
    }

    this.showNote()
    this.remember(path)
    this.persist()
  }

  /** A canvas in the space, in a tab of its own. One tab per canvas, the way the
   *  graph is one: asking for a plane that is already open brings it forward.
   *
   *  Its words are the JSON in the file, so the tab holds a document exactly as a
   *  note's tab does and the dirty mark, Ctrl+S, the auto-save and the closing
   *  question all work here without knowing what a canvas is. What differs is the
   *  surface drawn on top of those words. */
  async openCanvas(path: string) {
    const existing = this.tabs.find((tab) => tab.kind === 'canvas' && tab.path === path)
    if (existing) {
      this.activeTabId = existing.id
      this.showNote()
      return
    }

    const text = await invoke<string>('read_note', { path }).catch(() => null)
    // Gone, or unreadable. A canvas that cannot be read is not a blank plane to
    // draw on: saving one over it would take the file with it.
    if (text === null) return

    const file = this.document({
      kind: 'canvas',
      path,
      name: basename(path),
      text,
      dirty: false,
    })
    const tab = new Tab(file, this.panes.focusedId)
    this.add(tab)
    this.dropScaffolding(tab)

    // The notes a canvas holds are links out of it, which is what the Links
    // panel shows while the canvas is the tab being looked at.
    links.canvasRead(path, text)

    this.showNote()
    this.remember(path)
    this.persist()
  }

  /** Which page of a PDF a followed link asked for. Read and taken down by the
   *  pane showing that PDF, the way `goto` is by the one showing a note. */
  gotoPage = $state<{ path: string; page: number } | null>(null)

  /** Opens whatever a row of the file list names: a PDF or a canvas in its own
   *  kind of tab, anything else as a note. Every way in from a listing goes
   *  through here - the tree, the palette, a bookmark, the Links panel, the graph
   *  - so none of them can open a paper or a plane as text.
   *
   *  `open` itself stays about notes: a note is what the caret, the preview tab
   *  and every unsaved word belong to. */
  /** Steps off the welcome note once the account has brought real notes down.
   *
   *  A browser build opens the welcome note because on a first visit there is
   *  nothing else to read. Signing in changes that, and nothing was watching:
   *  the workspace restores seconds before the account does, so somebody who
   *  signs in is left looking at "Welcome to Nib" with their own notes in the
   *  sidebar beside it.
   *
   *  Only when the welcome note is the only thing open and untouched. Somebody
   *  who has written in it, or opened something beside it, has said what they
   *  want on screen. */
  async leaveTheWelcomeNote(): Promise<void> {
    const { WELCOME_PATH } = await import('./web/commands')

    const only = this.tabs.length === 1 ? this.tabs[0] : null
    if (only?.path !== WELCOME_PATH || only.dirty) return

    // Where they were last, if that note is still there, and otherwise the first
    // note that is theirs.
    const mine = this.notes.filter((one) => one.path !== WELCOME_PATH)
    const back = this.recent.find((path) => mine.some((one) => one.path === path))
    const next = back ?? mine[0]?.path
    if (!next) return

    await this.openEntry(next, { activate: true })
    this.close(only.id)
  }

  async openEntry(path: string, options: { activate?: boolean; preview?: boolean } = {}) {
    if (isPdfTarget(path)) {
      this.openPdf(path)
      return
    }

    if (isCanvasTarget(path)) {
      await this.openCanvas(path)
      return
    }

    await this.open(path, options)
  }

  /** Drops the blank untitled tab a window starts with, now that something real
   *  is open. Compared by id, because `this.tabs` holds reactive proxies and
   *  `=== tab` on the object just pushed is never true.
   *
   *  A tab that is not a note is never scaffolding: the graph of the space has no
   *  path and nothing unsaved either, and closing it behind the reader's back
   *  because they opened a note would be a surprise. */
  private dropScaffolding(kept: Tab) {
    for (const other of this.tabsIn(kept.paneId)) {
      if (other.id === kept.id || other.kind !== 'note' || other.path !== null || other.dirty) {
        continue
      }

      this.close(other.id)
    }
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

    // Pins became bookmarks, and a pin is a path this machine wrote down, so
    // the spaces have to be known before it can be said which space it was in.
    // Runs itself once and then has nothing left to read.
    this.bookmarks.migrate(this.spaces.map((space) => space.root))
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
    for (const note of this.documents) {
      if (note.path?.startsWith(space.root)) {
        note.path = renamed.path + note.path.slice(space.root.length)
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

    for (const note of this.documents.filter((entry) => entry.path === from)) {
      note.path = target
      note.name = name
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

    // A preview reuses the one preview tab rather than opening another, and only
    // when that tab is in the pane being worked in: taking over a tab in another
    // pane would change a note nobody was looking at.
    const reusable =
      options.preview &&
      this.tabs.find(
        (tab) =>
          tab.id === this.previewTabId &&
          tab.kind === 'note' &&
          !tab.dirty &&
          tab.paneId === this.panes.focusedId,
      )

    if (reusable) {
      reusable.note.adopt({ path, name: basename(path), text: doc })
      this.placeAt(reusable, path)
      // A note arriving in the preview tab is a note opening, and a note opens
      // for writing however the tab was left.
      reusable.reading = false

      if (options.activate !== false) {
        this.activeTabId = reusable.id
        this.showNote()
      }
      this.remember(path)
      this.persist()
      return
    }

    const note = this.document({
      kind: 'note',
      path,
      name: basename(path),
      text: doc,
      dirty: false,
    })
    const tab = new Tab(note, this.panes.focusedId)
    this.placeAt(tab, path)
    this.add(tab, options.activate !== false)

    if (options.activate !== false) this.showNote()
    this.previewTabId = options.preview ? tab.id : this.previewTabId
    this.remember(path)

    this.dropScaffolding(tab)
    this.persist()
  }

  /** Where the note was last being read on this device. */
  private placeAt(tab: Tab, path: string) {
    const place = this.positions.of(path)
    tab.cursor = place.cursor
    tab.scroll = place.scroll
    tab.anchor = place.anchor
  }

  /** A note named the way the space speaks of it, which is how the link index and
   *  the graph name them, opened the way a row in the file list opens: a look on
   *  one click, a tab of its own on two. */
  openRelative(relative: string, keep: boolean) {
    const root = this.activeSpace?.root
    if (!root) return

    void this.openEntry(insideSpace(root, relative), keep ? {} : { preview: true })
  }

  activate(id: string) {
    this.activeTabId = id
    this.persist()
  }

  /** Which pane a key or a command is talking about. */
  focusPane(id: string) {
    this.panes.focus(id)
  }

  /** The tab a pane is showing, which is what the pane is about. */
  showing(paneId: string): Tab | null {
    const id = this.panes.at(paneId)?.activeTabId
    return (id ? this.tabs.find((tab) => tab.id === id) : null) ?? null
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

  /** Closes a tab, asking first when the note in it holds work that is not on
   *  disk. Every close somebody asked for goes through here: the cross on the
   *  tab, Ctrl+W, the menu row and the palette. `close` below stays the plain
   *  operation, which is what everything that closes a tab because the note has
   *  gone away needs.
   *
   *  Nothing is asked when the note stays open in another pane: closing one of
   *  two views of a note loses nothing at all. */
  async closeAsking(id: string) {
    const tab = this.tabs.find((one) => one.id === id)
    if (!tab) return
    if (await this.mayClose([tab])) this.close(id)
  }

  /** The tab being worked in, closed with the question. What Ctrl+W, the File
   *  menu, the palette and `:q` all mean by closing. */
  async closeActive() {
    const id = this.activeTabId
    if (id) await this.closeAsking(id)
  }

  /** Every other tab of one pane, asking about whatever is unsaved among them. */
  async closeOthers(keepId: string) {
    const tab = this.tabs.find((one) => one.id === keepId)
    if (!tab) return

    const others = this.tabsIn(tab.paneId).filter((one) => one.id !== keepId)
    if (!(await this.mayClose(others))) return

    for (const other of others) this.close(other.id)
  }

  /** Whether the window may go, which is the same question over every tab in it.
   *  See start.ts, which is what prevents the close until this answers. */
  async mayCloseWindow(): Promise<boolean> {
    return this.mayClose(this.tabs)
  }

  /** Whether a set of tabs may all go: the closing question once per note,
   *  however many of the tabs hold it, and nothing asked about a note that stays
   *  open outside the set. Cancel at any one of them stops the lot, because
   *  closing is one gesture and half of it done is worse than none.
   *
   *  Asked of documents rather than of tabs throughout: a note is the thing with
   *  words in it, and a tab is only a way of looking at one. */
  private async mayClose(closing: readonly Tab[]): Promise<boolean> {
    this.flush()

    const going = closing.map((tab) => tab.id)
    const asked: NoteDoc[] = []

    for (const tab of closing) {
      if (asked.includes(tab.note)) continue
      asked.push(tab.note)

      if (!tab.note.unsaved) continue
      // A note another pane keeps showing is not going anywhere.
      if (this.tabs.some((one) => one.note === tab.note && !going.includes(one.id))) continue
      if (!(await this.askToClose(tab.note))) return false
    }

    return true
  }

  /** The one question the app asks before words are lost, in three answers
   *  because there are three things a person can mean: write it down, let it go,
   *  or stay where they are.
   *
   *  Saving a note with no home yet goes through the name prompt, the way saving
   *  one always does. A name nobody gives leaves the note unsaved, and then the
   *  close does not happen either. */
  private async askToClose(note: NoteDoc): Promise<boolean> {
    const { prompt } = await import('./prompt.svelte')

    const answer = await prompt.choose({
      title: t('Save {name}?', { name: note.path ? shownName(note.name) : t('Untitled') }),
      options: [
        { id: 'save', label: key('Save'), primary: true },
        { id: 'discard', label: key('Don’t save'), danger: true },
        { id: 'cancel', label: key('Cancel') },
      ],
    })

    if (answer !== 'save') return answer === 'discard'

    await this.write(note)
    return !note.unsaved
  }

  close(id: string) {
    const tab = this.tabs.find((one) => one.id === id)
    if (!tab) return

    const paneId = tab.paneId
    const at = this.tabsIn(paneId).findIndex((one) => one.id === id)

    // The words as they stand, since a tab closed with something unsaved in it
    // has to bring that back with it.
    this.flush()
    if (worthReopening(tab)) {
      this.closed.record({ draft: this.draftOf(tab), paneId, at: Math.max(at, 0) })
    }

    this.tabs = this.tabs.filter((one) => one.id !== id)
    if (this.previewTabId === id) this.previewTabId = null

    const left = this.tabsIn(paneId)

    // The last tab of a pane takes the pane with it, and the pane beside it
    // takes the room. The last pane of all stays, with a blank note in it.
    if (!left.length) {
      if (!this.panes.close(paneId)) this.openBlank()
      this.persist()
      return
    }

    if (this.panes.at(paneId)?.activeTabId === id) {
      this.panes.activate(paneId, (left[at] ?? left[left.length - 1])?.id ?? null)
    }

    this.persist()
  }

  /** The tab that was closed last, back where it was: in the pane it was closed
   *  from while that pane is still there, at its own place in the strip, with
   *  whatever was unsaved in it.
   *
   *  A note that has since been deleted cannot come back, so the entry is spent
   *  and the one under it is tried: reaching past a note that is gone is what
   *  somebody pressing the key twice means.
   *
   *  Nothing is dropped to make room for it. Reopening is not opening a note in
   *  the usual sense, and closing the blank page somebody is looking at because
   *  they asked for a tab back would be a surprise. */
  async reopenClosed() {
    for (let closed = this.closed.take(); closed; closed = this.closed.take()) {
      const paneId = this.panes.at(closed.paneId) ? closed.paneId : this.panes.focusedId
      const [tab] = await this.tabsFrom(
        [closed.draft],
        paneId,
        keysTo(this.documents),
        pathsTo(this.documents),
      )
      if (!tab) continue

      this.tabs = this.placed(tab, paneId, closed.at)
      this.panes.activate(paneId, tab.id)
      this.panes.focus(paneId)
      this.persist()
      return
    }
  }

  /** The flat list with a tab put at a place in a pane's strip: `at` counts along
   *  that strip, so the place in the flat list is the one the tab that now holds
   *  the spot occupies. Past the end of the strip, or `null`, means last.
   *
   *  The tab itself is taken out first, so this both puts a new one in and moves
   *  one that is already open. */
  private placed(tab: Tab, paneId: string, at: number | null): Tab[] {
    const rest = this.tabs.filter((one) => one.id !== tab.id)
    const strip = at === null ? [] : rest.filter((one) => one.paneId === paneId)
    const after = at === null ? undefined : strip[at]
    const index = after ? rest.findIndex((one) => one.id === after.id) : -1
    if (index < 0) return [...rest, tab]

    return [...rest.slice(0, index), tab, ...rest.slice(index)]
  }

  /** What a document reports whenever it changes, wherever the change came from:
   *  a keystroke in either pane, an undo, a picture dropped in. Nothing here
   *  touches the text - the rope is left as it is and `flush` turns it into a
   *  string later, so the cost of a keystroke does not grow with the size of the
   *  note. What happens at once is the dirty mark, because that is what the
   *  writer is looking at, and the document has already set it. */
  private edited(note: NoteDoc) {
    // Typing in a note you were only previewing is what makes it yours.
    const preview = this.tabs.find((tab) => tab.id === this.previewTabId)
    if (preview?.note === note) this.keep(preview.id)

    this.scheduleSave(note)
    // Auto-save may be off, or the note may have nowhere to be saved to yet.
    // Either way the words themselves are written down.
    this.scheduleSession()
  }

  /** Brings every open note's words up to what its views hold. Everything that
   *  reads the text of a note calls this first; it costs one pass over the notes
   *  that have been typed in, and nothing at all when none have. */
  flush() {
    for (const note of this.documents) note.flush()
  }

  /** Text put into a note from somewhere other than the editor: a version
   *  restored from the history, a note pulled in by a sync. It reaches every pane
   *  showing that note, since they are all views of the one document. */
  replace(text: string, target?: Tab) {
    const note = (target ?? this.active)?.note
    note?.replace(text)
  }

  /** Typora saves as you pause; so does this, but only for notes that already
   *  live somewhere. An untitled note waits for you to choose a home. */
  private scheduleSave(note: NoteDoc) {
    if (!this.autoSave || !note.path) return

    this.waiting.add(note)
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void this.saveWaiting(), this.autoSaveDelay)
  }

  private async saveWaiting() {
    const notes = [...this.waiting]
    this.waiting.clear()

    for (const note of notes) await this.write(note)
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
    if (on) return

    clearTimeout(this.saveTimer)
    this.waiting.clear()
  }

  /** Notes holding work that is not on disk: notes and not tabs, so a note open
   *  in two panes is one thing to ask about. What counts is the document's own
   *  answer; see NoteDoc.unsaved. */
  get unsaved(): NoteDoc[] {
    this.flush()
    return this.documents.filter((note) => note.unsaved)
  }

  async save(target?: Tab) {
    // A table cell holds its text until it loses focus; make sure it landed.
    flushTableEdits()

    const tab = target ?? this.active
    if (tab?.kind !== 'note' && tab?.kind !== 'canvas') return

    // Saving is as deliberate as it gets: a note that was only being looked
    // at is one to stay from here on, whether or not there was anything to
    // write.
    this.keep(tab.id)
    await this.write(tab.note)
  }

  /** Writes one document down: a note, or a canvas, which are the two things a
   *  tab holds that have words of their own. Everything that saves comes through
   *  here, so a note open in two panes is written once however the saving was
   *  asked for. */
  private async write(note: NoteDoc) {
    // The keystrokes since the last pause, which are still only a rope.
    note.flush()
    if (note.kind !== 'note' && note.kind !== 'canvas') return

    let path = note.path
    if (!path) {
      // A canvas is only ever made with a name and a place of its own, so there
      // is no "save this canvas somewhere" to ask about; the name prompt would
      // offer to write it as markdown.
      if (note.kind === 'canvas') return

      const picked = await pickSavePath(this.spaces, this.activeSpaceId, note.text, note.name)
      if (!picked) return
      path = picked
    }

    this.markSaving(note.key)

    try {
      // Keep the version that is about to be replaced, before replacing it.
      if (note.path) {
        await invoke('snapshot_note', { path, content: note.text }).catch(() => undefined)
      }

      await invoke('write_note', { path, content: note.text })
    } catch (error) {
      this.clearSaveState(note.key)
      throw error
    }

    note.written(path, basename(path))
    this.markSaved(note.key)

    // The one file that changed, read again from what was written. This is the
    // whole of keeping the index up to date after the first scan of a space; it
    // knows a canvas from a note by its name.
    links.noteSaved(path, note.text)

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

  isExpanded(path: string): boolean {
    return this.device.isExpanded(path)
  }

  toggleFolder(path: string) {
    this.device.toggleFolder(path)
  }

  /** Opens a folder and every folder on the way down to it, so a bookmarked
   *  folder can be shown where it sits rather than only named. */
  revealFolder(path: string) {
    const root = this.activeSpace?.root
    if (root === undefined || !path.startsWith(root)) return

    // Each step down is a folder of its own, and its own row to open.
    let here = root
    for (const part of relativeTo(root, path).split('/')) {
      here = joinPath(here, part)
      this.device.expand(here)
    }
  }

  /** Opens a note and lands on one of its headings, the way a link into a
   *  heading does: the note that was just loaded says which line the words are
   *  on, because a bookmark keeps the words and not the line. */
  async openAtHeading(relative: string, heading: string) {
    const root = this.activeSpace?.root
    if (!root) return

    const path = insideSpace(root, relative)
    await this.open(path)

    const doc = this.tabs.find((tab) => tab.path === path)?.doc ?? ''
    const line = lineOfHeading(scanHeadings(doc), heading)
    if (line !== null) this.goto = { path, line }
  }

  /** Every `#tag` in the space, most used first. */
  async loadTags() {
    const root = this.activeSpace?.root
    if (!root) return

    this.tags = await invoke<Tag[]>('space_tags', { root }).catch(() => [])
  }

  /** A note's words as they stand: what is on screen when it is open, and what
   *  is on disk otherwise. A replacement reads through here so it never writes
   *  over work that has not been saved yet. */
  async noteText(path: string): Promise<string | null> {
    this.flush()

    const open = this.documents.find((one) => one.path === path)
    if (open) return open.text

    return invoke<string>('read_note', { path }).catch(() => null)
  }

  /** Writes a replacement across the space. Every note keeps a snapshot of
   *  what it said before it is written, a note open in a pane takes the change
   *  as the words that changed so no caret moves, and however many notes were
   *  touched it is one thing to undo. */
  async replaceInNotes(changes: readonly Change[]) {
    if (!changes.length) return

    const done: Extract<FileAction, { kind: 'replace' }>['notes'] = []

    for (const change of changes) {
      // Keeping the version about to be replaced, the same way saving does.
      await invoke('snapshot_note', {
        path: change.path,
        content: change.before,
      }).catch(() => undefined)

      await invoke('write_note', { path: change.path, content: change.after })

      done.push({ path: change.path, content: change.before, edits: change.back })
      links.noteSaved(change.path, change.after)
      this.documents.find((one) => one.path === change.path)?.edited(change.edits, change.after)
    }

    this.undone.record({ kind: 'replace', notes: done })
    await this.loadTree()
    this.persist()

    // Imported here rather than at the top: syncing reads the workspace, and
    // the two would import each other. Same as `write` above.
    const { sync } = await import('./sync.svelte')
    sync.nudge()
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

    const note = this.document({
      kind: 'note',
      path,
      name: basename(path),
      text: content,
      dirty: false,
    })
    const tab = this.add(new Tab(note, this.panes.focusedId))
    this.showNote()
    this.remember(path)
    this.dropScaffolding(tab)
    this.startRenaming(path)

    await invoke('write_note', { path, content })
    links.noteSaved(path, content)
    await this.loadTree()
    this.persist()
  }

  /** A note made out of words that were somewhere else: a canvas card that has
   *  outgrown its box. Answers the path it was written to, relative to nothing,
   *  or null when there is no space to write it in.
   *
   *  No tab and no renaming: the card it came from is still what the reader is
   *  looking at, and a note that opened over the plane would take them away from
   *  it. The name is stepped like every other new file's. */
  async noteFrom(text: string, folder?: string): Promise<string | null> {
    const dir = folder ?? this.activeSpace?.root
    if (!dir) return null

    const stem = nameFromContent(text) ?? 'Untitled'
    const taken = new Set(this.notes.map((note) => note.path))
    let name = `${stem}.md`
    let counter = 2
    while (taken.has(joinPath(dir, name))) name = `${stem} ${counter++}.md`

    const path = joinPath(dir, name)
    this.showEntry(this.freshEntry(path, false))

    await invoke('write_note', { path, content: text })
    links.noteSaved(path, text)
    await this.loadTree()
    this.persist()

    return path
  }

  /** Creates `Untitled.canvas` in a folder and opens it, stepping the name until
   *  it is free the way a new note's is. The file is written straight away, so
   *  the plane on screen and the file on disk say the same thing from the first
   *  frame; the row is waiting for a name. */
  async createCanvas(folder?: string) {
    const dir = folder ?? this.activeSpace?.root
    if (!dir) return

    const taken = new Set(this.files.map((one) => one.path))
    let name = 'Untitled.canvas'
    let counter = 2
    while (taken.has(joinPath(dir, name))) name = `Untitled ${counter++}.canvas`

    const path = joinPath(dir, name)
    const content = blankCanvas()

    this.showEntry(this.freshEntry(path, false))
    if (dir !== this.activeSpace?.root) this.device.expand(dir)

    const file = this.document({
      kind: 'canvas',
      path,
      name: basename(path),
      text: content,
      dirty: false,
    })
    const tab = this.add(new Tab(file, this.panes.focusedId))
    this.showNote()
    this.remember(path)
    this.dropScaffolding(tab)
    this.startRenaming(path)

    await invoke('write_note', { path, content })
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

    const note = this.documents.find((entry) => entry.path === path)
    if (note) {
      note.flush()
      // A new note is written with its own name as the heading, so renaming it
      // straight afterwards would otherwise leave `# Untitled` at the top. Only
      // while the heading still is the old name; an edited one is the author's.
      const was = `# ${basename(path).replace(MARKDOWN, '')}`
      if (note.text === was || note.text.startsWith(was + '\n')) {
        // Nobody typed this, so it goes in the way any other outside edit does.
        note.replace(`# ${clean.replace(MARKDOWN, '')}${note.text.slice(was.length)}`, note.dirty)
      }

      note.path = target
      note.name = basename(target)
    }

    await this.loadTree()
    this.persist()
  }

  async remove(path: string, isFolder: boolean) {
    // Gone from the tree before the snapshot has been taken and the file has
    // been moved: three round trips is a long time for a row to sit there
    // looking as though the delete had not registered.
    this.hideEntry(path)

    // A deleted note keeps one last snapshot, so the delete is recoverable. A PDF
    // is bytes and not words: there is no snapshot of one, so the only thing that
    // can put it back is the trash, and it is recorded once the trash has it.
    const words = !isFolder && !isPdfTarget(path)
    if (words) {
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
        if (words) this.undone.trashed(path, entry.id)
        else if (!isFolder) {
          this.undone.record({ kind: 'delete', path, content: '', trashId: entry.id })
        }
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
        case 'replace':
          await this.putWordsBack(action)
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
      // Nothing kept and nothing in the trash, which is what a PDF deleted while
      // signed in looks like. Writing nothing would leave an empty file where the
      // paper was, so this says so instead.
      if (!action.content) throw new Error('there is nothing to put back')

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

  /** Puts a replacement back: every note that was touched says what it said,
   *  and a note open in a pane takes its old words as the words that changed,
   *  so undoing costs nobody their caret either. */
  private async putWordsBack(action: Extract<FileAction, { kind: 'replace' }>) {
    for (const note of action.notes) {
      await invoke('write_note', { path: note.path, content: note.content })
      links.noteSaved(note.path, note.content)
      this.documents.find((one) => one.path === note.path)?.edited(note.edits, note.content)
    }
  }

  /** Puts a rename or a move back: the file where it was, and the links that
   *  followed it pointed at the old name again. */
  private async putName(action: Extract<FileAction, { kind: 'move' | 'rename' }>) {
    await invoke('rename_note', { from: action.to, to: action.from })
    this.positions.move(action.to, action.from)

    for (const note of this.documents.filter((entry) => entry.path === action.to)) {
      note.path = action.from
      note.name = basename(action.from)
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

  /** Text written to a note from outside the editor, put into the document if it
   *  is open, which puts it into every pane showing it. */
  private reload(path: string, content: string) {
    this.documents.find((one) => one.path === path)?.replace(content, false)
  }

  /** Rewrites every link in the space that points at `from` so it points at `to`.
   *  Answers how many notes were touched, so a caller can record whether there is
   *  anything to put back. */
  private async retarget(from: string, to: string): Promise<number> {
    const root = this.activeSpace?.root
    if (!root) return 0

    const touched = await links.retarget(from, to, root)

    // A note on screen may be one of the notes that was rewritten.
    this.flush()
    for (const note of this.documents) {
      if (!note.path || note.dirty) continue
      const fresh = await invoke<string>('read_note', { path: note.path }).catch(() => null)
      if (fresh !== null && fresh !== note.text) note.replace(fresh, false)
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

    // A PDF and a canvas are files: a link to one the space does not hold is a
    // link to nothing, never a reason to make a note under that name.
    if (isPdfTarget(jump.target)) {
      if (jump.path) this.openPdf(insideSpace(root, jump.path), jump.page)
      return
    }

    if (isCanvasTarget(jump.target)) {
      if (jump.path) await this.openCanvas(insideSpace(root, jump.path))
      return
    }

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

    const note = this.document({
      kind: 'note',
      path,
      name: basename(path),
      text: content,
      dirty: false,
    })
    const tab = new Tab(note, this.panes.focusedId)
    tab.cursor = content.length
    this.add(tab)
    this.showNote()
    this.remember(path)
    this.dropScaffolding(tab)
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

  /** The note beside itself, or below itself: another view of the same document
   *  in a pane of its own, opened where this one is being read so the split
   *  starts as two windows onto the same place.
   *
   *  Nothing happens on a phone, where there is one pane and the commands for
   *  this are not offered. */
  split(along: Along, tabId?: string) {
    if (viewport.phone) return

    const tab = tabId ? this.tabs.find((one) => one.id === tabId) : this.active
    if (!tab) return

    const made = this.panes.split(along, tab.paneId)
    if (!made) return

    const beside = new Tab(tab.note, made.id)
    beside.cursor = tab.cursor
    beside.scroll = tab.scroll
    beside.anchor = tab.anchor

    this.add(beside)
    this.persist()
  }

  /** Whether a pane can still be split that way, which is what hides the entry
   *  rather than offering one that does nothing. */
  canSplit(along: Along, tabId?: string): boolean {
    if (viewport.phone) return false

    const tab = tabId ? this.tabs.find((one) => one.id === tabId) : this.active
    return !!tab && this.panes.splittable(along, tab.paneId)
  }

  /** A tab dragged into a pane, at a place in its strip: `at` counts along that
   *  strip, and past its end - or left out - means last, which is where a tab
   *  dropped on the note rather than on the strip belongs.
   *
   *  The pane it came from goes if that was its last tab, which is the same rule
   *  as closing one: dragging the last tab of a pane onto another pane's strip
   *  is how the two are merged. */
  moveTab(id: string, paneId: string, at: number | null = null) {
    const tab = this.tabs.find((one) => one.id === id)
    if (!tab || !this.panes.at(paneId)) return

    const from = tab.paneId
    // Dropped back where it already is, with no place asked for: nothing moved.
    if (from === paneId && at === null) return

    tab.paneId = paneId
    this.tabs = this.placed(tab, paneId, at)

    if (from !== paneId) {
      const left = this.tabsIn(from)
      if (!left.length) this.panes.close(from)
      else if (this.panes.at(from)?.activeTabId === id) {
        this.panes.activate(from, left[left.length - 1]?.id ?? null)
      }
    }

    this.activeTabId = id
    this.persist()
  }

  /** A tab dropped where the last drag told it: at a place in a strip, in the
   *  middle of a pane, or against one of its sides, which makes a pane there. */
  dropTab(id: string, landing: Landing) {
    if (!this.tabs.some((one) => one.id === id)) return

    if (landing.kind === 'strip') {
      this.moveTab(id, landing.paneId, landing.at)
      return
    }
    if (landing.zone === 'middle') {
      this.moveTab(id, landing.paneId)
      return
    }

    const made = this.panes.split(alongOf(landing.zone), landing.paneId, madeFirst(landing.zone))
    if (made) this.moveTab(id, made.id)
  }

  /** Notes dragged out of the file list onto a pane, opened where they were
   *  dropped: at their place in that pane's strip, or in a pane made against the
   *  side they were held against.
   *
   *  Opened first and split afterwards, so a note that turns out not to be there
   *  to open cannot leave a pane behind with nothing in it. */
  async dropNotes(paths: string[], landing: Landing) {
    if (!this.panes.at(landing.paneId)) return
    this.panes.focus(landing.paneId)

    const opened: string[] = []
    let at = landing.kind === 'strip' ? landing.at : null

    for (const path of paths) {
      await this.openEntry(path)
      const tab = this.active
      if (!tab) continue

      this.moveTab(tab.id, landing.paneId, at)
      if (at !== null) at += 1
      opened.push(tab.id)
    }

    if (landing.kind === 'strip' || landing.zone === 'middle' || !opened.length) return

    const made = this.panes.split(alongOf(landing.zone), landing.paneId, madeFirst(landing.zone))
    if (made) for (const id of opened) this.moveTab(id, made.id)
  }

  /** Whether a tab dropped against that side of a pane would do anything: the
   *  pane has to be able to split that way, and the tab must not be the only one
   *  in the pane being split, which would empty that pane and close it again the
   *  moment the new one opened. What decides which zones a pane offers. */
  canLand(side: Side, paneId: string, tabId: string | null): boolean {
    if (viewport.phone || !this.panes.splittable(alongOf(side), paneId)) return false

    const tab = tabId === null ? null : this.tabs.find((one) => one.id === tabId)
    return !(tab?.paneId === paneId && this.tabsIn(paneId).length < 2)
  }

  /** A pane and everything in it, asking about whatever is unsaved among its
   *  notes. The last pane cannot go: a window with none has nowhere to show a
   *  note. */
  async closePane(paneId: string = this.panes.focusedId) {
    if (this.panes.count < 2) return

    const tabs = this.tabsIn(paneId)
    if (!(await this.mayClose(tabs))) return

    for (const tab of tabs) this.close(tab.id)
  }

  /** The other panes showing the note this one is showing. What the link toggle
   *  appears for, and what a linked pane scrolls with. */
  twins(paneId: string): string[] {
    const note = this.showing(paneId)?.note
    if (!note) return []

    return this.panes.all
      .filter((one) => one.id !== paneId && this.showing(one.id)?.note === note)
      .map((one) => one.id)
  }

  /** The link between the panes showing one note, on or off. One toggle for the
   *  pair rather than one each: it is one relationship, and a pane that says it
   *  is linked while its twin says it is not would be a lie in one of them. */
  toggleLink(paneId: string) {
    const on = !(this.panes.at(paneId)?.linked ?? false)
    for (const id of [paneId, ...this.twins(paneId)]) this.panes.setLinked(id, on)
  }

  /** One pane again, with everything in it: what a phone gets, since there is no
   *  room there to put two notes beside each other. */
  collapsePanes() {
    if (this.panes.count < 2) return

    const kept = this.panes.focusedId
    for (const tab of this.tabs) tab.paneId = kept

    this.panes.collapse()
    this.persist()
  }

  /** Keeps the arrangement under a name; see workspace/layouts.svelte.ts. */
  saveLayout(name: string) {
    this.layouts.save(name, this.layout())
  }

  async useLayout(name: string) {
    const layout = this.layouts.of(name)
    if (layout) await this.applyLayout(layout)
  }
}

export const workspace = new Workspace()
