import { flushTableEdits } from '@nib/editor'
import { key, t } from './i18n.svelte'
import { nameFromContent } from './note-name'
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

export interface Tab {
  id: string
  path: string | null
  name: string
  doc: string
  dirty: boolean
  /** Offset of the caret and pixels scrolled, so a note reopens where it was
   *  left rather than at the top. */
  cursor?: number
  scroll?: number
}

export type Panel = 'tree' | 'outline' | 'search'

/** A file operation that can be put back. */
export type FileAction =
  | { kind: 'move' | 'rename'; from: string; to: string }
  | { kind: 'delete'; path: string; content: string }

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

export interface Heading {
  level: number
  text: string
  line: number
}

const STORAGE_KEY = 'nib:workspace'
const AUTO_SAVE_KEY = 'nib:autosave'
const TREE_KEY = 'nib:tree'
const RECENT_KEY = 'nib:recent'
const RECENT_LIMIT = 15
const UNDO_LIMIT = 20
const PINNED_KEY = 'nib:pinned'
const ICONS_KEY = 'nib:icons'
const EXPANDED_KEY = 'nib:expanded'
const AUTO_SAVE_DELAY = 1200
const AUTO_SAVE_DELAY_KEY = 'nib:autosave-delay'
// Short enough that a crash costs a moment's typing, long enough that the strip
// is not serialised on every keystroke.
const SESSION_DELAY = 400
const UNTITLED = 'Untitled'
const MARKDOWN = /\.(md|markdown|mdown|mkd)$/i

/** One tab as it is written down: enough to put it back exactly, including
 *  work that never reached the disk. */
interface Draft {
  path: string | null
  name: string
  doc: string
  dirty: boolean
  cursor: number
  scroll: number
}

interface Persisted {
  spaces: Space[]
  activeSpace: string | null
  tabs?: Draft[]
  /** Index into `tabs`, not an id: ids are handed out fresh on every run. */
  active?: number
  /** Written by versions before drafts existed. Still read, so an update
   *  arrives with the same notes open. */
  openPaths?: string[]
  activePath?: string | null
  panel: Panel | null
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

function identifier(): string {
  return Math.random().toString(36).slice(2, 10)
}

function readRecent(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(saved) ? (saved as string[]) : []
  } catch {
    return []
  }
}

function readExpanded(): Record<string, boolean> {
  try {
    const saved = JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '{}')
    return saved && typeof saved === 'object' ? (saved as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

function readIcons(): Record<string, string> {
  try {
    const saved = JSON.parse(localStorage.getItem(ICONS_KEY) ?? '{}')
    return saved && typeof saved === 'object' ? (saved as Record<string, string>) : {}
  } catch {
    return {}
  }
}

function readPinned(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(PINNED_KEY) ?? '[]')
    return Array.isArray(saved) ? (saved as string[]) : []
  } catch {
    return []
  }
}

function readTreeOptions(): TreeOptions {
  const fallback: TreeOptions = { showHidden: false, sort: 'name', descending: false }

  try {
    return { ...fallback, ...(JSON.parse(localStorage.getItem(TREE_KEY) ?? '{}') as TreeOptions) }
  } catch {
    return fallback
  }
}

/** Where a note that has never been saved should go. The desktop asks the
 *  system; the browser has no file dialog, so it asks for a name and puts the
 *  note in the space that is open. Either way the first line is the suggestion. */
async function pickSavePath(
  spaces: Space[],
  activeId: string | null,
  doc = '',
): Promise<string | null> {
  if (!spaces.length) return null

  const { prompt } = await import('./prompt.svelte')
  const answer = await prompt.askName({
    title: t('Name the note'),
    value: nameFromContent(doc) ?? UNTITLED,
    placeholder: t('Untitled'),
    confirmLabel: key('Save'),
    spaces: spaces.map((space) => ({ id: space.id, name: space.name })),
    space: activeId,
  })

  if (!answer?.name) return null

  const target = spaces.find((space) => space.id === answer.space) ?? spaces[0]
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
  /** Path of the tree row currently being renamed in place. */
  renaming = $state<string | null>(null)
  autoSave = $state(localStorage.getItem(AUTO_SAVE_KEY) !== 'false')
  /** How long to wait after the last keystroke before writing. */
  autoSaveDelay = $state(Number(localStorage.getItem(AUTO_SAVE_DELAY_KEY)) || AUTO_SAVE_DELAY)
  treeOptions = $state<TreeOptions>(readTreeOptions())
  recent = $state<string[]>(readRecent())
  /** Not persisted: putting a file back only makes sense while it is fresh. */
  undoable = $state<FileAction[]>([])
  tags = $state<Tag[]>([])
  pinned = $state<string[]>(readPinned())
  icons = $state<Record<string, string>>(readIcons())
  /** Which folders are open in the tree. Kept here rather than in the tree
   *  component: that one is rebuilt from scratch every time the folder is read
   *  again - on every save, rename and sync - and took the open folders with
   *  it each time. Per device, because it describes a view and not a note. */
  expanded = $state<Record<string, boolean>>(readExpanded())

  private saveTimer: ReturnType<typeof setTimeout> | undefined
  private sessionTimer: ReturnType<typeof setTimeout> | undefined

  readonly activeSpace = $derived(this.spaces.find((space) => space.id === this.activeSpaceId) ?? null)
  readonly active = $derived(this.tabs.find((tab) => tab.id === this.activeTabId) ?? null)

  readonly headings = $derived.by((): Heading[] => {
    const doc = this.active?.doc
    if (!doc) return []

    const found: Heading[] = []
    let fenced = false

    doc.split('\n').forEach((text, index) => {
      if (/^\s*(```|~~~)/.test(text)) fenced = !fenced
      if (fenced) return

      const match = /^(#{1,6})\s+(.*)$/.exec(text)
      if (match) found.push({ level: match[1].length, text: match[2].trim(), line: index })
    })

    return found
  })

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

    const saved = localStorage.getItem(STORAGE_KEY)

    let state: Persisted | null = null
    try {
      state = saved ? (JSON.parse(saved) as Persisted) : null
    } catch {
      state = null
    }

    if (!state) {
      await this.loadSpaces()
      if (this.activeSpaceId) await this.loadTree()

      // A first visit opens what it was given rather than a blank page.
      const first = this.notes[0]
      if (first) await this.open(first.path)
      if (!this.tabs.length) this.openBlank()
      return
    }

    this.spaces = state.spaces ?? []
    // The sidebar comes back the way it was left.
    this.panel = state.panel ?? null
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

      if (draft.path && !draft.dirty) {
        try {
          doc = await invoke<string>('read_note', { path: draft.path })
        } catch {
          // Deleted or moved while Nib was away, and nothing unsaved to keep.
          continue
        }
      }

      restored.push({
        id: identifier(),
        path: draft.path,
        name: draft.name,
        doc,
        dirty: draft.dirty,
        cursor: draft.cursor,
        scroll: draft.scroll,
      })
    }

    this.tabs = restored
    this.activeTabId = (restored[active] ?? restored[0])?.id ?? null
  }

  private persist() {
    clearTimeout(this.sessionTimer)

    const state: Persisted = {
      spaces: this.spaces,
      activeSpace: this.activeSpaceId,
      tabs: this.tabs.map((tab) => ({
        path: tab.path,
        name: tab.name,
        doc: tab.doc,
        dirty: tab.dirty,
        cursor: tab.cursor ?? 0,
        scroll: tab.scroll ?? 0,
      })),
      active: Math.max(0, this.tabs.findIndex((tab) => tab.id === this.activeTabId)),
      panel: this.panel,
    }

    this.write(state)
  }

  /** Storage is finite. Unsaved work is what has to survive a full one, so the
   *  saved notes give up their copies first - they are still on disk, and get
   *  re-read on the way back in. */
  private write(state: Persisted) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      return
    } catch {
      // Out of room. Try again with less.
    }

    const lean = {
      ...state,
      tabs: state.tabs?.map((draft) => (draft.dirty ? draft : { ...draft, doc: '' })),
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lean))
    } catch {
      // Nothing left to give up. The previous entry stays, which is still a
      // better place to come back to than none at all.
    }
  }

  /** Writes the session soon rather than now, so a burst of typing costs one
   *  write instead of one per keystroke. */
  private scheduleSession() {
    clearTimeout(this.sessionTimer)
    this.sessionTimer = setTimeout(() => this.persist(), SESSION_DELAY)
  }

  /** Where the caret and the scroll are. Recorded as they move, because after
   *  a crash there is no chance to write them down on the way out. */
  noteView(id: string, cursor: number, scroll: number) {
    const tab = this.tabs.find((one) => one.id === id)
    if (!tab || (tab.cursor === cursor && tab.scroll === scroll)) return

    tab.cursor = cursor
    tab.scroll = scroll
    this.scheduleSession()
  }

  openBlank(name = UNTITLED, doc = '') {
    const tab: Tab = { id: identifier(), path: null, name, doc, dirty: !!doc }
    this.tabs = [...this.tabs, tab]
    this.activeTabId = tab.id
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
    this.moveIcon(space.root, renamed.path)

    space.name = renamed.name
    space.root = renamed.path
    if (this.activeSpaceId === id) await this.loadTree()
    this.persist()
  }

  /** Drops the dragged space in front of `beforeId`, or at the end for null.
   *  Returns whether anything actually moved, so a drag onto itself is quiet. */
  moveSpace(id: string, beforeId: string | null): boolean {
    const from = this.spaces.findIndex((space) => space.id === id)
    if (from < 0 || id === beforeId) return false

    const rest = this.spaces.filter((space) => space.id !== id)
    const at = beforeId ? rest.findIndex((space) => space.id === beforeId) : rest.length
    if (at < 0) return false

    const next = [...rest.slice(0, at), this.spaces[from], ...rest.slice(at)]
    if (next.every((space, index) => space.id === this.spaces[index].id)) return false

    this.spaces = next
    this.persist()
    return true
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

    if (next.every((space, index) => space.id === this.spaces[index].id)) return false

    this.spaces = next
    this.persist()
    return true
  }

  async selectSpace(id: string) {
    this.activeSpaceId = id
    await this.loadTree()
    this.persist()
  }

  /** The rail's way in. Picking a space with the sidebar closed showed
   *  nothing, so the sidebar comes up with the tree, as Ctrl+Shift+L opens it. */
  async showSpace(id: string) {
    if (!this.panel) this.panel = 'tree'
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
    this.activeSpaceId = null
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
      const gone = await invoke('delete_space', { path: space.root })
        .then(() => true)
        .catch(() => false)

      if (!gone) return
    }

    for (const tab of this.tabs.filter((tab) => tab.path?.startsWith(space.root))) {
      this.close(tab.id)
    }

    this.spaces = this.spaces.filter((entry) => entry.id !== id)
    if (this.activeSpaceId !== id) return this.persist()

    this.activeSpaceId = this.spaces[0]?.id ?? null
    this.tree = null
    if (this.activeSpaceId) await this.selectSpace(this.activeSpaceId)
    else this.persist()
  }

  async loadTree() {
    const root = this.activeSpace?.root
    if (!root) return

    try {
      this.tree = await invoke<Entry>('read_tree', { root, options: this.treeOptions })
    } catch {
      this.tree = null
    }
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

    await invoke('rename_note', { from, to: target })
    this.recordFileAction({ kind:'move', from, to: target })

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

    let doc = ''
    try {
      doc = await invoke<string>('read_note', { path })
    } catch {
      return
    }

    // A preview reuses the one preview tab rather than opening another.
    const reusable =
      options.preview && this.tabs.find((tab) => tab.id === this.previewTabId && !tab.dirty)

    if (reusable) {
      reusable.path = path
      reusable.name = basename(path)
      reusable.doc = doc
      reusable.dirty = false

      if (options.activate !== false) {
        this.activeTabId = reusable.id
        this.showNote()
      }
      this.remember(path)
      this.persist()
      return
    }

    const tab: Tab = { id: identifier(), path, name: basename(path), doc, dirty: false }
    this.tabs = [...this.tabs, tab]
    if (options.activate !== false) {
      this.activeTabId = tab.id
      this.showNote()
    }
    this.previewTabId = options.preview ? tab.id : this.previewTabId
    this.remember(path)

    // A blank untouched tab is scaffolding, not something worth keeping around.
    // Compared by id: `this.tabs` holds reactive proxies, so `=== tab` on the
    // object that was just pushed is never true.
    this.tabs = this.tabs.filter((other) => other.id === tab.id || other.path || other.dirty)
    this.persist()
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

  edit(doc: string) {
    const tab = this.active
    if (!tab || tab.doc === doc) return

    tab.doc = doc
    tab.dirty = true

    // Typing in a note you were only previewing is what makes it yours.
    this.keep(tab.id)

    this.scheduleSave()
    // Auto-save may be off, or the note may have nowhere to be saved to yet.
    // Either way the words themselves are written down.
    this.scheduleSession()
  }

  /** Typora saves as you pause; so does this, but only for notes that already
   *  live somewhere. An untitled note waits for you to choose a home. */
  private scheduleSave() {
    if (!this.autoSave || !this.active?.path) return

    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => void this.save(), this.autoSaveDelay)
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
    return this.tabs.filter((tab) => tab.dirty && tab.doc.trim().length > 0)
  }

  async saveAll() {
    for (const tab of this.unsaved) await this.save(tab)
  }

  async save(target?: Tab) {
    // A table cell holds its text until it loses focus; make sure it landed.
    flushTableEdits()

    const tab = target ?? this.active
    if (!tab) return

    let path = tab.path
    if (!path) {
      const picked = await pickSavePath(this.spaces, this.activeSpaceId, tab.doc)
      if (!picked) return
      path = picked
    }

    // Keep the version that is about to be replaced, before replacing it.
    if (tab.path) {
      await invoke('snapshot_note', { path, content: tab.doc }).catch(() => undefined)
    }

    await invoke('write_note', { path, content: tab.doc })

    tab.path = path
    tab.name = basename(path)
    tab.dirty = false

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

  /** Most-recent-first, newest at the front, no duplicates. */
  private remember(path: string) {
    this.recent = [path, ...this.recent.filter((entry) => entry !== path)].slice(0, RECENT_LIMIT)
    localStorage.setItem(RECENT_KEY, JSON.stringify(this.recent))

    // The taskbar keeps its own recent list; this is what puts a note in it.
    if (isDesktop) void invoke('remember_recent', { path }).catch(() => undefined)
  }

  forgetRecent() {
    this.recent = []
    localStorage.removeItem(RECENT_KEY)
  }

  /** The icon a space shows in the rail, if it has been given one. Keyed by
   *  folder rather than id, so it survives the ids being handed out again. */
  iconFor(spaceId: string | null): string | null {
    const space = this.spaces.find((entry) => entry.id === spaceId)
    return space ? (this.icons[space.root] ?? null) : null
  }

  /** An icon that came from the account rather than from this machine. */
  applyIcon(root: string, name: string | null) {
    if ((this.icons[root] ?? null) === name) return

    const next = { ...this.icons }
    if (name) next[root] = name
    else delete next[root]

    this.icons = next
    localStorage.setItem(ICONS_KEY, JSON.stringify(next))
  }

  setIcon(spaceId: string, name: string | null) {
    const space = this.spaces.find((entry) => entry.id === spaceId)
    if (!space) return

    const next = { ...this.icons }
    if (name) next[space.root] = name
    else delete next[space.root]

    this.icons = next
    localStorage.setItem(ICONS_KEY, JSON.stringify(next))

    // Imported here rather than at the top: syncing reads the workspace, and
    // the two would import each other.
    void import('./sync.svelte').then(({ sync }) => sync.pushIcon(space.root, name))
  }

  /** Carries a chosen icon over to a renamed folder. Without this a rename
   *  looks like a space that never had an icon, and it falls back to a letter. */
  private moveIcon(from: string, to: string) {
    const icon = this.icons[from]
    if (!icon || from === to) return

    const next = { ...this.icons }
    delete next[from]
    next[to] = icon

    this.icons = next
    localStorage.setItem(ICONS_KEY, JSON.stringify(next))
  }

  isExpanded(path: string): boolean {
    return !!this.expanded[path]
  }

  toggleFolder(path: string) {
    const next = { ...this.expanded }
    if (next[path]) delete next[path]
    else next[path] = true

    this.expanded = next
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(next))
  }

  isPinned(path: string): boolean {
    return this.pinned.includes(path)
  }

  /** Pinned notes and folders sit above the tree, whatever their depth. */
  togglePin(path: string) {
    this.pinned = this.isPinned(path)
      ? this.pinned.filter((entry) => entry !== path)
      : [...this.pinned, path]

    localStorage.setItem(PINNED_KEY, JSON.stringify(this.pinned))
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
    await invoke('write_note', { path, content: `# ${name.replace(MARKDOWN, '')}\n\n` })
    await this.loadTree()
    await this.open(path)
    this.startRenaming(path)
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
    await invoke('create_folder', { path })
    await this.loadTree()
    this.startRenaming(path)
  }

  /** Every path in the open space. `notes` holds only files; this counts the
   *  folders between them too. */
  private everyPath(): Set<string> {
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

  /** Opens the name field on a row that has just been made, so naming it is
   *  part of making it. Pointless while the tree is not the panel on show. */
  private startRenaming(path: string) {
    if (this.panel === 'tree') this.renaming = path
  }

  async rename(path: string, name: string) {
    const clean = name.trim()
    if (!clean || clean.includes('/') || clean.includes('\\')) return

    const target = joinPath(folderOf(path), clean)
    if (target === path) return

    await invoke('rename_note', { from: path, to: target })
    this.recordFileAction({ kind:'rename', from: path, to: target })

    const tab = this.tabs.find((entry) => entry.path === path)
    if (tab) {
      // A new note is written with its own name as the heading, so renaming it
      // straight afterwards would otherwise leave `# Untitled` at the top. Only
      // while the heading still is the old name; an edited one is the author's.
      const was = `# ${basename(path).replace(MARKDOWN, '')}`
      if (tab.doc === was || tab.doc.startsWith(was + '\n')) {
        tab.doc = `# ${clean.replace(MARKDOWN, '')}${tab.doc.slice(was.length)}`
      }

      tab.path = target
      tab.name = basename(target)
    }

    await this.loadTree()
    this.persist()
  }

  async remove(path: string, isFolder: boolean) {
    // A deleted note keeps one last snapshot, so the delete is recoverable.
    if (!isFolder) {
      const content = await invoke<string>('read_note', { path }).catch(() => '')
      if (content) await invoke('snapshot_note', { path, content }).catch(() => undefined)
      this.recordFileAction({ kind:'delete', path, content })
    }

    await invoke(isFolder ? 'delete_folder' : 'delete_note', { path })

    for (const tab of this.tabs.filter((entry) => entry.path?.startsWith(path))) {
      this.close(tab.id)
    }

    await this.loadTree()
  }

  /** The last handful of file operations, newest last, so one can be taken back.
   *  Deleting a folder is not among them: its contents are already gone. */
  private recordFileAction(action: FileAction) {
    this.undoable = [...this.undoable, action].slice(-UNDO_LIMIT)
  }

  /** Puts the last move, rename or deletion back. */
  async undoFileAction() {
    const action = this.undoable.at(-1)
    if (!action) return

    this.undoable = this.undoable.slice(0, -1)

    try {
      if (action.kind === 'delete') {
        await invoke('write_note', { path: action.path, content: action.content })
      } else {
        await invoke('rename_note', { from: action.to, to: action.from })

        for (const tab of this.tabs.filter((entry) => entry.path === action.to)) {
          tab.path = action.from
          tab.name = basename(action.from)
        }
      }
    } catch {
      // Something else has since changed the file; leave what is there alone.
      return
    }

    await this.loadTree()
    this.persist()
  }

  /** What undoing would do, phrased for a menu. Null when there is nothing. */
  get undoLabel(): string | null {
    const action = this.undoable.at(-1)
    if (!action) return null

    const name = basename(action.kind === 'delete' ? action.path : action.to)
    return {
      move: t('Undo moving {name}', { name }),
      rename: t('Undo renaming {name}', { name }),
      delete: t('Undo deleting {name}', { name }),
    }[action.kind]
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

  toggleSidebar() {
    this.panel = this.panel ? null : 'tree'
    this.persist()
  }
}

export const workspace = new Workspace()
