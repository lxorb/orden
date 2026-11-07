import { type FoldLines, type NoteJump, sameFolds, type SpaceTag } from '@orden/editor'
import { account } from './account.svelte'
import { hiddenKinds, settings } from './settings.svelte'
import { modes } from './modes.svelte'
import { arriving } from './arriving.svelte'
import { keptAway } from './web/away.svelte'
import {
  blockIds,
  isApplicationTarget,
  isCanvasTarget,
  isPagesTarget,
  isPdfTarget,
  isTabFile,
  isWebTarget,
} from '@orden/markdown/links'
import { freePath } from '@orden/markdown/paths'
import { openerFor, sharedKind } from './openers'
import { links, type Retargeting } from './link-index.svelte'
import { onDisk } from './on-disk'
import { noteId } from './note-id'
import { insideOnly } from './automation/inside'
import {
  askCase,
  folderOf,
  insideSpace,
  isMarkdownPath,
  movedTo,
  nameOf,
  noteName,
  pathKey,
  pathKeys,
  relativeTo,
  samePath,
  sameSpelling,
  within,
  withinSpace,
} from './space-paths'
import { t } from './i18n.svelte'
import { AGENTS_NAME, isAgentsName, nameFromContent, shownName } from './note-name'
import type { TreeRow } from './tree-keys'
import { isPlugin } from './plugin'
import { scanFootnotes } from './footnotes'
import { lineOfHeading, scanHeadings } from './outline'
import type { Change } from './search/apply'
import { startup } from './startup.svelte'
import { tabOverview } from './surfaces.svelte'
import { nextTask } from './breathe'
import { mark, markPainted } from './trace'
import { afterQuiet, waited } from './timing'
import { GIVE_UP } from './parting'
import { isRecord, keepJson, stored } from './stored'
import { WELCOME_PATH } from './welcome'
import {
  arrangementIn,
  arrivingWith,
  type Draft,
  frameDraft,
  frameOf,
  type Layout,
  panesOf,
  readSession,
  type Session,
  writeSession,
} from './workspace/session'
import type { Across } from './workspace/across'
import { Bookmarks } from './workspace/bookmarks.svelte'
import { FolderIcons } from './workspace/folder-icons.svelte'
import { ItemMetaStore } from './workspace/item-meta.svelte'
import { Excluded } from './workspace/excluded.svelte'
import { protection } from './protect/protection.svelte'
import { unlocks } from './protect/unlocked.svelte'
import { Archive } from './workspace/archive.svelte'
import { ArchivedSpaces } from './workspace/archived-spaces.svelte'
import { SpaceGraphSettings } from './workspace/graph-settings.svelte'
import { ClosedTabs } from './workspace/closed.svelte'
import { DeviceView } from './workspace/device.svelte'
import {
  type DocumentStart,
  holdsWords,
  NoteDoc,
  unixLines,
  Tab,
  UNTITLED,
} from './workspace/documents.svelte'
import { Layouts } from './workspace/layouts.svelte'
import { OpenDocuments, secondWebTabs } from './workspace/open'
import { type Along, type Frame, panesIn, withoutPane } from './workspace/pane-tree'
import { successor } from './workspace/recency'
import { type Landing, Panes } from './workspace/panes.svelte'
import { type Around, closedAround } from './workspace/closing-around'
import { alongOf, madeFirst, type Side } from './workspace/zones'
import { Positions } from './workspace/positions'
import { FileOps, keeping, type Kind } from './workspace/file-ops'
import * as composing from './workspace/composing'
import * as panels from './workspace/panels'
import { type Filling, fills } from './panel-tab'
import type { Sides } from './workspace/panels'
import * as spaces from './workspace/spaces'
import * as ahead from './workspace/ahead'
import { firstScreen } from './first-screen.svelte'
import * as text from './workspace/note-text'
import { Saving } from './workspace/saving.svelte'
import { draftFile, hasWords, isDraft, isUnsaved, worthAFile } from './workspace/drafts'
import { TAB_KINDS } from './workspace/tab-kinds'
import type { Picked } from './import/sources'
import { type Binning, type FileAction, FileActions, type Kept } from './workspace/undo.svelte'
import { fetchAcross, inFileTurn, meetAcross } from './workspace/in-turn'
import { writeFile } from './workspace/write-file'
import { isScratchpad, shown as pad } from './scratchpad/is.svelte'
import { outermost, Selection } from './workspace/selection.svelte'
import { readTint } from './icons'
import {
  folderFor,
  folderNote,
  folderNotePath,
  isFolderNote,
  linkedFiles,
  noteToNest,
  unnesting,
} from './folder-notes'
import { carriedRows } from './drag-paths'
import { anyOpen, flatRows, standsOpen } from './tree-flat'
import { entryAt, withComing, withEntry, withMove, withoutEntry, withoutRows } from './tree-edits'
import { rowIds } from './row-ids'
import { orderedTree, type SortMode } from './tree-order'
import { Arranged, SpaceSorting } from './workspace/arranged.svelte'
import { log } from './log'
import { invoke, isDesktop, isNative, joinPath, openExternal } from './tauri'
import { viewport } from './viewport.svelte'
import { plainOrigin } from './web-tab/address'
import { apartOf, readWebFile } from '@orden/scan/shortcut'
import { pages } from './web-tab/pages.svelte'
import { agentMarks } from './agent-marks.svelte'
import { besideAt, howFor, type LinkAsk, type OpenHow, type TabAsk } from './new-tab'

function isInstructions(root: string, path: string): boolean {
  return samePath(path, joinPath(root, AGENTS_NAME), root)
}

export interface Entry {
  name: string
  path: string
  is_dir: boolean
  modified: number
  created: number
  children: Entry[]
  evicted?: boolean
  unlisted?: boolean
  paper?: boolean
}

export interface TreeOptions {
  showHidden: boolean
}

export interface Space {
  id: string
  name: string
  root: string
}

export type { NoteDoc, Tab, TabKind } from './workspace/documents.svelte'

export type Panel = 'tree' | 'outline' | 'search' | 'tasks' | 'chats' | 'time' | 'links' | 'ask'

export type PanelSide = 'left' | 'right'

export type NewKind = 'note' | 'canvas' | 'pages' | 'web' | 'chat' | 'database'

export interface Naming {
  path: string
  appending: boolean
  making: NewKind | null
}

const PLACEHOLDER: Record<NewKind, string> = {
  note: 'Untitled.md',
  canvas: 'Untitled.canvas',
  pages: 'Untitled.pages',
  web: 'Untitled.url',
  chat: 'Chat.chat',
  database: 'Untitled',
}

export type { Heading } from './outline'

const STORAGE_KEY = 'nib:workspace'
const TREE_KEY = 'nib:tree'
const SESSION_DELAY = 400
const WORDS_KEPT = 1_000_000

const TRAIL = 30

const unread = (path: string) => import('./unread.svelte').then((one) => one.unread.there(path))
const changes = () => import('./workspace/space-changes')
const essentials = () => import('./essentials.svelte')
const paneStays = (strip: number, showing: Tab | null) =>
  strip > 0 || (showing?.essential ?? null) !== null
const sets = () => import('./workspace/sets.svelte').then((one) => one.sets)

function lineOfTarget(doc: string, jump: NoteJump): number | null {
  if (jump.block !== null) {
    return blockIds(doc).find((one) => one.id === jump.block)?.line ?? null
  }
  if (jump.heading === null) return null

  return lineOfHeading(scanHeadings(doc), jump.heading)
}

function readTreeOptions(): TreeOptions {
  const saved = stored(TREE_KEY)
  if (!isRecord(saved)) return { showHidden: false }

  return { showHidden: saved.showHidden === true }
}

function emptyMap<T>(): Map<string, T> {
  return new Map<string, T>()
}

function papers(): Promise<typeof import('./pdf/papers')> {
  return import('./pdf/papers')
}

async function viewOfExplorer(tab: Tab): Promise<import('./explorer/view.svelte').ExplorerView> {
  const { viewOf } = await import('./explorer/view.svelte')
  return viewOf(tab)
}

function unfetched(): void {
  // Answered by reloading.svelte.ts.
}

function worthReopening(tab: Tab): boolean {
  return !tab.inPrivate && !tab.nowhere && (!isDraft(tab.note) || hasWords(tab.note))
}

const unsaved = (tab: Tab) => isDraft(tab.note) && hasWords(tab.note)

class Workspace {
  private readonly pdfPageNotes = new Map<string, Promise<string | null>>()
  spaces = $state<Space[]>([])
  activeSpaceId = $state<string | null>(null)
  readonly archivedSpaces = new ArchivedSpaces()

  get shownSpaces(): Space[] {
    return this.spaces.filter((one) => !this.archivedSpaces.has(one.root))
  }

  tree = $state.raw<Entry | null>(null)
  private strip = $state<Tab[]>([])

  get tabs(): Tab[] {
    return this.strip
  }

  set tabs(next: Tab[]) {
    const before = this.strip
    this.strip = next
    for (const [tab, keeper] of secondWebTabs(before, next)) this.asUnsaved(tab, keeper)
  }

  asUnsaved(tab: Tab, keeper: Tab) {
    const url = pages.addressOf(keeper.id) ?? keeper.address ?? this.webAddressOf(keeper)
    tab.apart = apartOf(keeper)
    tab.note = this.document({
      kind: 'web',
      path: null,
      name: url ? plainOrigin(url) : t('New tab'),
      text: '',
      dirty: false,
      home: this.spaceOf(keeper.note),
    })
    tab.address = url ?? undefined
    pages.of(tab.id).url = url
    pages.of(tab.id).title = pages.of(keeper.id).title || tab.note.name
  }
  readonly panes = new Panes(() => {
    this.scheduleSession()
    this.saving.hurry()
  })
  readonly layouts = new Layouts()
  panel = $state<Panel | null>(null)
  private panelChosen = false
  right = $state<Panel[]>(panels.rightFrom(undefined))
  rightPanel = $state<Panel | null>(null)
  lastRight: Panel | null = null
  private lastLeft = $state<Panel>('tree')
  previewTabId = $state<string | null>(null)
  private besideLast: { opener: string; tab: string } | null = null
  private choosing: string | null = null
  essentialComing: string | null = null
  naming = $state<Naming | null>(null)
  treeOptions = $state<TreeOptions>(readTreeOptions())
  readonly undone = new FileActions()
  readonly closed = new ClosedTabs()
  tags = $state<SpaceTag[]>([])
  readonly device = new DeviceView()
  readonly bookmarks = new Bookmarks(
    () => this.activeSpace?.root ?? null,
    () => {
      if (this.tabs.some((one) => one.essential !== null))
        void essentials().then((one) => one.kept())
    },
  )
  readonly folderIcons = new FolderIcons(() => this.activeSpace?.root ?? null)
  readonly itemMeta = new ItemMetaStore((path) => this.rootHolding(path))
  readonly arranged = new Arranged(() => this.activeSpace?.root ?? null)
  readonly graphSettings = new SpaceGraphSettings(() => this.activeSpace?.root ?? null)
  readonly sorting = new SpaceSorting(() => this.activeSpace?.root ?? null)
  readonly excluded = new Excluded(() => this.activeSpace?.root ?? null)
  readonly archive = new Archive(() => this.activeSpace?.root ?? null)
  readonly protection = protection

  leftOutOf(root: string): string[] {
    return [...this.excluded.of(root), ...this.archive.keysOf(root)]
  }

  get leftOut(): string[] {
    const root = this.activeSpace?.root
    return root === undefined ? [] : [...this.leftOutOf(root), this.instructionsName(root)]
  }

  instructionsName(root: string): string {
    const tree = samePath(this.tree?.path, root) ? this.tree : null
    const listed = tree?.children.find((one) => !one.is_dir && isInstructions(root, one.path))
    return listed?.name ?? AGENTS_NAME
  }

  instructionsAt(path: string): boolean {
    const root = this.rootHolding(path)
    return root !== null && isInstructions(root, path)
  }
  private readonly picked = new Selection()
  private readonly saving = new Saving(this)
  private readonly session = afterQuiet(() => this.persist(), SESSION_DELAY)

  readonly opened = new OpenDocuments(
    () => this.tabs,
    (start) => new NoteDoc(start, (note) => this.saving.edited(note)),
  )

  positions = new Positions()

  readonly fileOps = new FileOps()

  constructor() {
    this.fileOps.follow((op) => this.opened.follow(op, (id) => this.close(id)))
    this.fileOps.follow((op) => this.saving.follow(op))
    this.fileOps.follow((op) => this.positions.follow(op))
    this.fileOps.follow((op) => this.device.follow(op))
    this.fileOps.follow((op) => this.closed.follow(op))
    this.fileOps.follow((op) => this.undone.follow(op))
    this.fileOps.follow((op) => {
      if (op.op !== 'moved' || op.kind === 'space') return
      for (const tab of this.tabs) {
        const to = tab.essential && movedTo(tab.essential, op.from, op.to, op.root ?? undefined)
        if (to) tab.essential = to
      }
    })
    this.fileOps.follow((op) => {
      if (op.op === 'moved') rowIds.moved(op.from, op.to)
      else if (op.op === 'removed') rowIds.gone(op.path)
    })
    for (const store of [
      this.picked,
      this.bookmarks,
      this.folderIcons,
      this.itemMeta,
      this.arranged,
      this.excluded,
      this.archive,
      this.graphSettings,
      this.sorting,
      this.protection,
      unlocks,
    ]) {
      this.fileOps.follow(keeping(store))
    }
    this.fileOps.follow((op) => links.follow(op))
    this.fileOps.follow((op) => {
      if (op.op === 'moved') {
        void papers().then(({ paperMoved }) => paperMoved(op.from, op.to), unfetched)
      } else if (op.op === 'removed') {
        void papers().then(({ paperGone }) => paperGone(op.path), unfetched)
      }
    })
    this.fileOps.follow((op) => {
      const tree = this.tree
      if (op.op !== 'moved' || op.kind === 'space' || !op.root || !tree || op.heard) return
      if (!samePath(op.root, this.activeSpace?.root ?? '')) return
      return import('./views/order-paths').then(
        ({ orderMoved }) => orderMoved(tree, op.root ?? '', op.from, op.to),
        unfetched,
      )
    })
  }

  readonly activeSpace = $derived(
    this.spaces.find((space) => space.id === this.activeSpaceId) ?? null,
  )
  readonly active = $derived(this.tabs.find((tab) => tab.id === this.activeTabId) ?? null)

  get activeTabId(): string | null {
    return this.panes.focused.activeTabId
  }

  set activeTabId(id: string | null) {
    const tab = id === null ? null : (this.tabs.find((one) => one.id === id) ?? null)
    if (id !== null && !tab) return
    if (tab && !this.panes.at(tab.paneId)) {
      void sets().then((one) => one.reveal(tab.id))
      return
    }

    const paneId = tab?.paneId ?? this.panes.focusedId
    this.panes.focus(paneId)
    this.panes.activate(paneId, tab?.id ?? null)
  }

  tabsIn(paneId: string): Tab[] {
    return this.tabs.filter((tab) => tab.paneId === paneId && !tab.essential)
  }

  heldIn(paneId: string): Tab[] {
    return this.tabs.filter((tab) => tab.paneId === paneId)
  }

  get documents(): NoteDoc[] {
    return this.opened.all
  }

  documentAt(path: string): NoteDoc | null {
    const open = this.opened.at(path)
    return open && !TAB_KINDS[open.kind].fileDocument ? null : open
  }

  get openNotes(): { key: string; path: string; note: NoteDoc }[] {
    return this.documents
      .filter((note) => holdsWords(note.kind) && (note.path !== null || note.shared !== null))
      .map((note) => ({ key: note.key, path: note.path ?? '', note }))
  }

  readonly relativeNote = $derived.by((): string | null => {
    const root = this.activeSpace?.root
    const path = this.active?.path ?? this.recent[0] ?? null
    if (root === undefined || path === null) return null

    return within(root, path)
  })

  heldTabId = $state<string | null>(null)

  readonly panelTab = $derived(this.tabs.find((tab) => tab.id === this.heldTabId) ?? this.active)

  readonly panelNote = $derived.by((): string | null => {
    const root = this.activeSpace?.root
    const path = this.panelTab?.path ?? null
    if (root === undefined || path === null) return null

    return within(root, path)
  })

  holdPanel(tabId: string | null) {
    this.heldTabId = tabId
  }

  readonly held = $derived(!!this.heldTabId && this.panelTab?.id === this.heldTabId)

  holdable(panel: Panel | null): boolean {
    return !viewport.touch && (panel === 'outline' || panel === 'links')
  }

  readonly holdablePanel = $derived.by((): Panel | null => {
    for (const panel of [this.panel, this.openOn('right')]) {
      if (this.holdable(panel)) return panel
    }

    return null
  })

  readonly headings = $derived.by(() => scanHeadings(this.markdownOfPanel))

  readonly footnotes = $derived.by(() => scanFootnotes(this.markdownOfPanel))

  readonly panelFilling = $derived.by((): Filling | null => {
    const tab = this.panelTab
    if (!tab) return null
    return {
      kind: tab.kind,
      markdown: tab.kind === 'note' && (tab.path === null || isMarkdownPath(tab.path)),
      headings: this.headings.length,
      footnotes: this.footnotes.length,
    }
  })

  fills(panel: Panel): boolean {
    return fills(panel, this.panelFilling)
  }

  private get markdownOfPanel(): string {
    const tab = this.panelTab
    return tab?.kind === 'note' && !this.protection.locked(tab.path) ? tab.doc : ''
  }

  readonly files = $derived.by((): Entry[] => {
    const out: Entry[] = []
    const walk = (entry: Entry) => {
      for (const child of entry.children) {
        if (child.is_dir) walk(child)
        else out.push(child)
      }
    }
    if (this.tree) walk(this.tree)
    const root = this.tree?.path
    return root === undefined ? out : out.filter((one) => !isInstructions(root, one.path))
  })

  readonly notes = $derived(this.files.filter((one) => !isTabFile(one.name)))

  readonly shownTree = $derived.by((): Entry | null => {
    const coming =
      this.tree && arriving.coming.size ? withComing(this.tree, [...arriving.coming]) : this.tree
    if (!coming) return null

    const root = coming.path
    const coder = modes.coder
    const listed = withoutRows(
      coming,
      (entry) =>
        !entry.is_dir &&
        (isInstructions(root, entry.path) || (!coder && isApplicationTarget(entry.path))),
    )
    return orderedTree(this.unkept(this.unarchived(listed)), this.sortMode, (folder) =>
      this.arranged.listOf(folder),
    )
  })

  inEssentials(path: string): boolean {
    const root = this.activeSpace?.root
    if (root === undefined || !within(root, path)) return false

    const at = relativeTo(root, path)
    return this.bookmarks.list.some((one) => one.kind === 'note' && samePath(one.path, at))
  }

  private unkept(tree: Entry): Entry {
    const root = this.activeSpace?.root
    const kept = this.bookmarks.list.filter((one) => one.kind === 'note').map((one) => one.path)
    if (root === undefined || !kept.length) return tree

    return withoutRows(tree, (entry) => {
      if (entry.is_dir) return false
      const at = relativeTo(root, entry.path)
      return kept.some((one) => samePath(one, at))
    })
  }

  private unarchived(tree: Entry): Entry {
    const root = this.activeSpace?.root
    const keys = root === undefined ? null : this.archive.keysOf(root)
    if (root === undefined || !keys?.size) return tree

    return withoutRows(tree, (entry) => keys.has(relativeTo(root, entry.path)))
  }

  readonly sortMode = $derived<SortMode>(
    this.activeSpace ? this.sorting.of(this.activeSpace.root) : 'name',
  )

  readonly nothingToShow = $derived(
    arriving.showing && !this.spaces.length && !this.tree && !arriving.coming.size,
  )

  restored = $state(false)

  async restore() {
    this.sessionKey = null
    try {
      await this.readSitting()
    } finally {
      this.restored = true
      ahead.forgetAhead()
    }
  }

  private async readSitting() {
    if (!isNative && !isPlugin()) {
      try {
        const { seed } = await import('./web/commands')
        if (await seed()) {
          ;(await import('./first-visit.svelte')).firstVisit.seeded()
          settings.setup = -1
        }
      } catch (error) {
        log('warn', `first visit: nothing seeded - ${String(error)}`)
      }
    }

    const slots = await import('./workspace/slot').catch(() => null)
    const slot = (await slots?.takeSlot().catch(() => 0)) ?? 0
    this.sessionKey = slots?.sessionOf(slot) ?? STORAGE_KEY
    this.slot = slot
    const state =
      readSession(stored(this.sessionKey)) ??
      (slot === 0 || !slots ? null : slots.freshWindow(stored(STORAGE_KEY)))
    this.layouts.restore()
    this.arriving = state && arrangementIn(state)

    if (!state) {
      await this.loadSpaces()
      if (this.activeSpaceId) await this.loadTree()

      await startup.shown()
      markPainted('tree painted')

      if (!this.tabs.length) {
        const first = this.files[0]
        if (first) await this.openFirst(first.path)
      }

      void this.takeWhatWasLeft(slot)

      return
    }

    this.spaces = state.spaces
    this.positions = new Positions(state.positions ?? {})
    this.closed.restore(state.closed ?? [])
    this.setsRead = state.sets
    if (!this.panelChosen) {
      this.panel = panels.leftPanelFrom(state.panel)
      this.rightPanel = state.rightPanel ?? null
    }
    this.right = panels.rightFrom(state.right, state.known)
    this.lastRight ??= state.lastRight ?? null
    this.activeSpaceId = state.activeSpace ?? this.spaces[0]?.id ?? null

    await this.loadSpaces()

    if (this.activeSpaceId) await this.loadTree()

    await firstScreen.arm(state, async (front) =>
      front.path === null
        ? null
        : ((await ahead.noteAheadPeek(front.path)) ??
          invoke<string>('read_note', { path: front.path }).catch(() => null)),
    )

    await startup.shown()
    markPainted('tree painted')

    if (state.layout) await this.applyLayout(state.layout, false)
    else if (state.tabs?.length) await this.restoreStrip(state.tabs, state.active ?? 0)
    else {
      for (const path of state.openPaths ?? []) {
        await this.openEntry(path, { activate: samePath(path, state.activePath) })
      }
      this.arriving = null
    }

    for (const tab of this.tabs) tab.reading = false
    if (state.sets !== undefined) void startup.turn('doors').then(sets)

    this.oneDocument()

    void this.takeWhatWasLeft(slot)

    markPainted('active tab painted')
  }

  meetOthers(across: Across) {
    this.saving.across = across
    meetAcross(across)
  }

  acrossWhenWriting(fetch: () => Promise<Across>) {
    this.saving.acrossSoon = fetch
    fetchAcross(fetch)
  }

  wroteAll(path: string, key: string, words: string) {
    this.closed.wroteAll(path, key, words)
  }

  owedWords(note: NoteDoc) {
    this.saving.owed(note)
  }

  private slot = 0
  private sessionKey: string | null = STORAGE_KEY
  private arriving: Layout | null = null

  private async takeWhatWasLeft(slot: number) {
    try {
      const { LEAVING_GRACE, othersInStorage } = await import('./workspace/slot')
      if (!othersInStorage(slot)) return
      const { asDrafts, takeSessionsLeft } = await import('./workspace/sessions-left')
      const waiting = await takeSessionsLeft(slot, async (drafts) => {
        const says = async (path: string) =>
          this.opened.at(path)?.latest ??
          (await invoke<string>('read_note', { path }).catch(() => null))
        const tabs = await this.tabsFrom(
          await asDrafts(drafts, says, (path) => this.spaceIdAt(path)),
          this.panes.focusedId,
        )
        this.tabs = [...this.tabs, ...tabs]
        if (!this.persist()) throw new Error('no room to write them down')
      })
      if (waiting) setTimeout(() => void this.takeWhatWasLeft(slot), LEAVING_GRACE)
    } catch (error) {
      log('warn', `session: what another window left stays where it is - ${String(error)}`)
    }
  }

  private async tabsFrom(drafts: Draft[], paneId: string): Promise<Tab[]> {
    const made = [...new Set(await this.tabsAlong(drafts, paneId))].filter((one) => one !== null)
    if (this.panes.at(paneId)) return made

    for (const tab of made) if (tab.paneId === paneId) tab.paneId = this.panes.focusedId
    return made
  }

  private async tabsAlong(drafts: Draft[], paneId: string): Promise<(Tab | null)[]> {
    return this.opened.arranging(async () => {
      const made: (Tab | null)[] = []

      for (const written of drafts) {
        let draft = written.path ? { ...written, path: this.spelled(written.path) } : written

        if (draft.kind === 'pdf' && draft.path) {
          if (!(await this.opens(draft.path))) {
            made.push(null)
            continue
          }
          const writable = await this.mayTurn(draft.path)
          const held = writable ? null : await this.heldBy(draft.path)
          const turned = writable || held !== null
          const path = held ?? (writable ? await this.pageNoteForPdf(draft.path) : draft.path)
          const doc = turned ? '' : await this.paperText(draft.path)
          if (!path || doc === null) {
            made.push(null)
            continue
          }
          draft = turned
            ? { ...draft, kind: 'pages', path, name: nameOf(path), dirty: false, doc }
            : { ...draft, dirty: false, doc }
        }

        if (draft.path && !draft.dirty && this.instructionsAt(draft.path)) {
          made.push(null)
          continue
        }

        const away = viewport.touch || (!!draft.path && draft.address !== undefined)
        if (draft.kind === 'web' && !isDesktop && away) {
          made.push(null)
          continue
        }

        if (draft.path && !(await this.opens(draft.path))) {
          log('info', `restore: ${draft.path} is outside every space, so its tab is not put back`)
          made.push(null)
          continue
        }

        const same = this.sameDocument(draft)
        if (same) {
          made.push(this.viewOf(same, paneId, draft))
          continue
        }

        const viewOnce = (note: NoteDoc) =>
          made.find((one) => one?.note === note) ?? this.viewOf(note, paneId, draft)
        const already = draft.path ? this.opened.at(draft.path) : null
        if (already) {
          made.push(viewOnce(await this.wordsMeet(already, draft)))
          continue
        }

        const open = { read: false }
        const note =
          holdsWords(draft.kind) && draft.path
            ? await this.opened.opening(draft.path, () => {
                open.read = true
                return draft.dirty ? this.unwrittenBack(draft) : this.drafted(draft)
              })
            : this.opened.make({
                kind: draft.kind,
                path: draft.path,
                name: draft.name,
                text: draft.doc,
                dirty: draft.dirty,
                home: draft.space ?? null,
              })

        if (draft.dirty && draft.path && !open.read && holdsWords(draft.kind)) {
          const back = note
            ? await this.wordsMeet(note, draft)
            : await this.opened.opening(draft.path, () => this.unwrittenBack(draft))
          made.push(back ? viewOnce(back) : null)
          continue
        }

        made.push(note ? this.viewOf(note, paneId, draft) : null)
      }

      for (const tab of made) if (tab?.note.dirty) this.saving.owed(tab.note)

      return made
    })
  }

  private sameDocument(draft: Draft): NoteDoc | null {
    const shared = draft.share ? this.opened.withKey(draft.share) : null
    if (shared && samePath(shared.path, draft.path)) return shared
    return draft.share ? this.opened.cameBackAs(draft.share) : null
  }

  private async wordsMeet(open: NoteDoc, draft: Draft): Promise<NoteDoc> {
    const words = unixLines(draft.doc)
    const path = draft.path
    if (path === null || !draft.dirty || !holdsWords(open.kind)) return open
    if (unixLines(open.latest) === words) return open

    const { wordsOnto } = await import('./workspace/unwritten')
    for (;;) {
      const holds = unixLines(open.latest)
      const merged = await wordsOnto(draft, open.kind, holds)
      if (unixLines(open.latest) !== holds) continue

      let met = open
      if (merged === null || open.live.holdingBack) {
        met = this.opened.make({
          kind: draft.kind,
          path: null,
          name: draft.name,
          text: words,
          dirty: true,
          home: this.spaceIdAt(path),
        })
      } else if (merged !== holds) {
        void invoke('snapshot_note', { path, content: holds }).catch(() => undefined)
        open.replace(merged)
      }
      if (draft.share !== undefined) this.opened.cameBack(draft.share, met)
      return met
    }
  }

  private spaceIdAt(path: string): string | null {
    return this.spaces.find((one) => within(one.root, path) !== null)?.id ?? null
  }

  private async unwrittenBack(draft: Draft): Promise<NoteDoc | null> {
    const path = draft.path
    if (path === null) return null
    const { cameBack } = await import('./workspace/unwritten')
    const back = await cameBack(
      { ...draft, path },
      {
        read: (one) => invoke<string>('read_note', { path: one }).catch(() => null),
        exists: onDisk,
        keepVersion: (one, content) => invoke('snapshot_note', { path: one, content }),
        spaceOf: (one) => this.spaceIdAt(one),
        reachable: (one) => {
          const root = this.rootHolding(one)
          return root === null ? Promise.resolve(true) : onDisk(root)
        },
      },
    )
    const open = back.path === null ? null : this.opened.at(back.path)
    if (open) return this.wordsMeet(open, draft)

    const note = this.opened.make({
      kind: draft.kind,
      path: back.path,
      name: draft.name,
      text: back.text,
      dirty: back.dirty,
      home: back.home,
    })
    note.onDisk = back.onDisk
    if (draft.share !== undefined) this.opened.cameBack(draft.share, note)
    return note
  }

  private async drafted(draft: Draft): Promise<NoteDoc | null> {
    const path = draft.path
    if (path === null) return null

    const text =
      (await ahead.noteAhead(path)) ??
      (await invoke<string>('read_note', { path }).catch(() => null))
    if (text === null) return null
    if (draft.kind === 'canvas' || draft.kind === 'pages') {
      const { parseAhead } = await import('./canvas/format')
      if (!parseAhead(text)) return unread(path).then(() => null)
    }

    return this.opened.make({
      kind: draft.kind,
      path,
      name: draft.name,
      text,
      dirty: false,
    })
  }

  private viewOf(note: NoteDoc, paneId: string, draft: Draft): Tab {
    const tab = new Tab(note, paneId)
    tab.cursor = draft.cursor
    tab.scroll = draft.scroll
    tab.anchor = draft.anchor
    tab.folds = draft.folds
    tab.reading = draft.reading === true
    if (draft.source !== undefined) tab.source = draft.source
    tab.page = draft.page
    tab.zoom = draft.zoom
    tab.address = draft.address
    tab.apart = draft.apart ?? null
    return tab
  }

  private async restoreStrip(drafts: Draft[], active: number) {
    const paneId = this.panes.focusedId
    const restored = await this.tabsFrom(drafts, paneId)
    const shown = restored[active] ?? restored[0]

    this.panes.activate(shown?.paneId ?? paneId, shown?.id ?? null)
    this.tabs = [
      ...restored,
      ...this.tabs.filter((tab) => !restored.some((one) => one.note === tab.note)),
    ]
    this.arriving = null
  }

  async applyLayout(layout: Layout, asked = true) {
    await this.opened.arranging(async () => this.arrange(await this.built(layout), layout, asked))
  }

  async built(layout: Layout): Promise<{ frame: Frame; made: Tab[] }> {
    const showing = emptyMap<string | null>()
    const made: Tab[] = []

    for (const draft of panesOf(layout.frame)) {
      const along = await this.tabsAlong(draft.tabs, draft.id)
      const tabs = [...new Set(along)].filter((one) => one !== null)
      const order = (draft.recent ?? []).flatMap((at) => {
        const one = along[at]
        return one ? [one.id] : []
      })
      this.panes.recall(order)
      const shown =
        along[draft.active] ??
        (order.length
          ? tabs.find(
              (one) =>
                one.id ===
                successor(
                  tabs.map((tab) => tab.id),
                  order,
                ),
            )
          : undefined) ??
        along.slice(draft.active).find((one) => one !== null)
      showing.set(draft.id, (shown ?? tabs.at(-1))?.id ?? null)
      made.push(...tabs)
    }

    let frame: Frame = frameOf(layout.frame, (draft) => showing.get(draft.id) ?? null)

    for (const empty of panesIn(frame)) {
      if (!made.some((tab) => tab.paneId === empty.id)) frame = withoutPane(frame, empty.id)
    }

    return { frame, made }
  }

  private arrange({ frame, made }: { frame: Frame; made: Tab[] }, layout: Layout, asked: boolean) {
    const aside = this.tabs.filter((tab) => !this.panes.at(tab.paneId))
    const open = this.tabs.filter((tab) => !aside.includes(tab))

    const rescued = asked ? open.filter((tab) => tab.dirty) : open
    const inFront = asked ? null : this.active

    if (asked) {
      const batch = Date.now()
      for (const tab of open) {
        if (rescued.includes(tab) || made.some((one) => one.note === tab.note)) continue
        if (worthReopening(tab)) {
          const at = Math.max(this.tabsIn(tab.paneId).indexOf(tab), 0)
          this.closed.record({ draft: this.draftOf(tab), paneId: tab.paneId, at, batch })
        }
        if (tab.kind === 'web') pages.forget(tab.id)
      }
    }

    this.tabs = [...made, ...aside]
    if (!asked) this.arriving = null
    this.panes.restore(frame, layout.focused)
    if (asked || !this.panelChosen) this.panel = layout.panel
    this.panelChosen = false

    for (const tab of rescued) {
      if (made.some((one) => one.note === tab.note)) continue

      tab.paneId = this.panes.focusedId
      this.tabs = this.placed(tab, this.panes.focusedId, null)
    }

    const still =
      inFront &&
      (this.tabs.includes(inFront) ? inFront : this.tabs.find((one) => one.note === inFront.note))

    if (still) this.activeTabId = still.id
    else if (!this.activeTabId && this.tabs.length) {
      this.activeTabId = this.panes.successorOf(
        this.tabsIn(this.panes.focusedId).map((one) => one.id),
      )
    }

    this.oneDocument()

    pages.keepOnly(this.tabs.map((tab) => tab.id))
    this.persist()
  }

  layout(frame = this.panes.frame, focused = this.panes.focusedId, panel = this.panel): Layout {
    this.flush()

    return {
      frame: frameDraft(frame, (pane) => {
        const tabs = [
          ...this.tabsIn(pane.id).filter((tab) => !tab.inPrivate),
          ...[...this.puttingAway].filter((tab) => tab.paneId === pane.id),
        ]
        const ids = tabs.map((tab) => tab.id)
        const shown = pane.activeTabId ?? this.panes.lastOf(ids)
        return {
          tabs: tabs.map((tab) => this.draftOf(tab)),
          recent: this.panes.used.flatMap((id) => {
            const at = ids.indexOf(id)
            return at < 0 ? [] : [at]
          }),
          active: Math.max(
            0,
            tabs.findIndex((tab) => tab.id === shown),
          ),
        }
      }),
      focused,
      panel,
    }
  }

  private draftOf(tab: Tab): Draft {
    const copied = tab.path === null || (tab.dirty && tab.doc.length <= WORDS_KEPT)
    return {
      kind: tab.kind,
      path: tab.path,
      name: tab.name,
      doc: copied ? tab.doc : '',
      dirty: copied && tab.dirty,
      ...(copied && tab.dirty && tab.path !== null && tab.note.onDisk !== null
        ? { base: tab.note.onDisk }
        : {}),
      cursor: tab.cursor ?? 0,
      scroll: tab.scroll ?? 0,
      anchor: tab.anchor,
      ...(tab.folds?.length ? { folds: tab.folds } : {}),
      share: tab.note.key,
      ...(tab.reading ? { reading: true } : {}),
      ...(tab.kind === 'note' ? { source: tab.source } : {}),
      ...(tab.page === undefined ? {} : { page: tab.page }),
      ...(tab.zoom === undefined ? {} : { zoom: tab.zoom }),
      ...(tab.address === undefined ? {} : { address: tab.address }),
      ...(tab.path === null && tab.apart !== null ? { apart: tab.apart } : {}),
      ...(tab.path === null && tab.note.home !== null ? { space: tab.note.home } : {}),
    }
  }

  persist(): boolean {
    this.session.cancel()
    if (this.sessionKey === null) return false

    const state: Session = {
      spaces: this.spaces,
      activeSpace: this.activeSpaceId,
      layout: this.arriving ? arrivingWith(this.arriving, this.layout()) : this.layout(),
      panel: this.panel,
      right: [...this.right],
      known: [...panels.PANELS],
      ...(this.rightPanel ? { rightPanel: this.rightPanel } : {}),
      ...(this.lastRight ? { lastRight: this.lastRight } : {}),
      positions: this.positions.all,
      closed: this.closed.stack,
      sets: this.setsWritten(),
    }

    const written = writeSession(this.sessionKey, state)

    if (this.slot !== 0 || this.arriving) return written

    const reads = this.tabs.filter((tab) => tab.path && !tab.dirty && holdsWords(tab.kind))
    const front = this.active
    ahead.plan({
      root: this.activeSpace?.root ?? null,
      options: this.treeOptions,
      notes: [...reads.filter((tab) => tab === front), ...reads.filter((tab) => tab !== front)]
        .map((tab) => tab.path)
        .filter((path) => path !== null),
      web: this.panes.all.some((pane) => this.showing(pane.id)?.kind === 'web'),
    })
    return written
  }

  setsRead: unknown
  setsWritten = (): unknown => this.setsRead

  scheduleSession() {
    this.session()
  }

  noteView(
    id: string,
    cursor: number,
    scroll: number,
    anchor?: number,
    line?: number,
    folds?: readonly FoldLines[],
  ) {
    const tab = this.tabs.find((one) => one.id === id)
    if (!tab) return
    if (tab.line !== line) tab.line = line
    if (
      tab.cursor === cursor &&
      tab.scroll === scroll &&
      tab.anchor === anchor &&
      sameFolds(tab.folds, folds)
    ) {
      return
    }

    tab.cursor = cursor
    tab.scroll = scroll
    tab.anchor = anchor
    tab.folds = folds?.length ? folds : undefined
    if (tab.path) this.positions.remember(tab.path, cursor, scroll, anchor, folds)
    this.scheduleSession()
  }

  notePdf(id: string, page: number, zoom: number | undefined) {
    const tab = this.tabs.find((one) => one.id === id)
    if (!tab || (tab.page === page && tab.zoom === zoom)) return

    tab.page = page
    tab.zoom = zoom
    this.scheduleSession()
  }

  notePlace(id: string, scroll: number, anchor: number) {
    const tab = this.tabs.find((one) => one.id === id)
    if (!tab) return

    this.noteView(id, tab.cursor ?? 0, scroll, anchor, tab.line)
  }

  toggleReading(tabId: string = this.activeTabId ?? '') {
    const tab = this.tabs.find((one) => one.id === tabId)
    if (tab?.kind !== 'note') return

    tab.reading = !tab.reading
    this.scheduleSession()
  }

  openBlank(name = UNTITLED, doc = '', home: string | null = this.activeSpaceId) {
    const note = this.document({
      kind: 'note',
      path: null,
      name,
      text: doc,
      dirty: !!doc,
      home,
    })
    this.add(new Tab(note, this.panes.focusedId))
    this.showNote()
    if (doc) void this.placeAtHome(note)
  }

  private async placeAtHome(note: NoteDoc): Promise<void> {
    const home = await this.draftHome(note.home).catch(() => null)
    if (home === null) return
    await this.saving.place(note, home, draftFile(note)).catch((error: unknown) => {
      log('warn', `a new draft was not written where it goes: ${String(error)}`)
    })
  }

  async newCanvas() {
    const { blankCanvas } = await import('./canvas/format')
    this.openUnsaved('canvas', blankCanvas())
  }

  async newPages() {
    const { blankPages } = await import('@orden/markdown/pages')
    const { modes } = await import('./modes.svelte')
    this.openUnsaved('pages', blankPages(modes.pagesPaper))
  }

  openUnsaved(
    kind: 'note' | 'canvas' | 'pages' | 'terminal' | 'application' | 'explorer',
    text: string,
    name = UNTITLED,
    beside: string | null = null,
    activate = true,
  ): Tab {
    const file = this.document({
      kind,
      path: null,
      name,
      text,
      dirty: false,
      home: this.activeSpaceId,
    })
    const tab = this.add(new Tab(file, this.panes.focusedId), activate, beside)
    if (activate) {
      this.showNote()
      this.dropScaffolding(tab)
    }
    this.persist()
    return tab
  }

  openShared(item: { id: string; name: string; path: string }, text: string) {
    const existing = this.documents.find((one) => one.shared === item.id)
    const open = existing ? this.tabs.find((tab) => tab.note.key === existing.key) : undefined

    if (open) {
      this.panes.activate(open.paneId, open.id)
      this.showNote()
      return
    }

    const note = this.document({
      kind: sharedKind(item.path),
      path: null,
      name: item.name,
      text,
      dirty: false,
      shared: item.id,
    })

    const tab = new Tab(note, this.panes.focusedId)
    this.add(tab)
    this.dropScaffolding(tab)
    this.showNote()
  }

  showingShared(id: string): boolean {
    return this.documents.some((one) => one.shared === id)
  }

  closeShared(id: string) {
    this.closeEach(this.tabs.filter((one) => one.note.shared === id).map((tab) => tab.id))
  }

  private document(start: DocumentStart): NoteDoc {
    return this.opened.make(start)
  }

  outside(path: string): boolean {
    return !this.spaces.some((one) => within(one.root, path) !== null)
  }

  private async opens(path: string): Promise<boolean> {
    if (!this.outside(path)) return true
    return invoke('file_stamp', { path }).then(
      () => true,
      () => false,
    )
  }

  async draftHome(home: string | null = null): Promise<string | null> {
    if (!this.activeSpace) await this.loadSpaces()

    const here = (this.spaces.find((one) => one.id === home) ?? this.activeSpace)?.root
    if (here !== undefined) return here

    const made = await this.addSpace(t('Notes'))
    return made?.root ?? null
  }

  spaceOf(note: NoteDoc): string | null {
    const path = note.path
    if (path === null) return note.home ?? this.activeSpaceId

    const holding = this.spaces.find((one) => within(one.root, path) !== null)
    return holding?.id ?? this.activeSpaceId
  }

  born(path: string) {
    this.showEntry(this.freshEntry(path, false))
    this.remember(path)
  }

  touched(path: string) {
    const entry = this.entryAt(path)

    if (!entry) {
      const folder = folderOf(path)
      if (samePath(folder, this.tree?.path) || this.entryAt(folder)?.is_dir) this.born(path)
      return
    }

    if (this.sortMode.startsWith('modified')) this.showEntry({ ...entry, modified: Date.now() })
  }

  private add(tab: Tab, activate = true, opener: string | null = null): Tab {
    if (this.essentialComing !== null && samePath(tab.path, this.essentialComing)) {
      tab.essential = this.essentialComing
      this.essentialComing = null
    }
    const chosenOn = activate ? this.chosenFor(tab) : null
    if (chosenOn) {
      this.tabs = this.placed(tab, tab.paneId, this.tabsIn(tab.paneId).indexOf(chosenOn))
    } else {
      this.tabs = opener === null ? [...this.tabs, tab] : this.besideOf(tab, opener)
    }
    if (activate) {
      this.panes.activate(tab.paneId, tab.id)
      this.onlyOne(tab)
    }
    if (chosenOn) this.close(chosenOn.id, false)

    return tab
  }

  newTab(paneId: string = this.panes.focusedId) {
    this.focusPane(paneId)
    if (hiddenKinds.offers('web')) this.openWebsite()
    else this.deselect(paneId)
  }

  chosenOn(tabId: string) {
    this.choosing = tabId
  }

  private chosenFor(tab: Tab): Tab | null {
    const id = this.choosing
    if (id === null) return null

    this.choosing = null
    const chosenOn = this.tabs.find((one) => one.id === id)
    const inFront = this.panes.at(tab.paneId)?.activeTabId === id
    return chosenOn?.paneId === tab.paneId && inFront && this.isNewTab(chosenOn) ? chosenOn : null
  }

  isNewTab(tab: Tab): boolean {
    return tab.nowhere && !tab.inPrivate && !pages.addressOf(tab.id)
  }

  isBlankTab(tab: Tab): boolean {
    return this.isNewTab(tab) && !pages.typedInto(tab.id) && !(tab.id in agentMarks.opened)
  }

  closeLeftBlank() {
    const here = this.activeTabId
    for (const tab of this.tabs) {
      if (tab.id === here || !this.isBlankTab(tab)) continue
      if (this.panes.at(tab.paneId) && this.tabsIn(tab.paneId).length === 1) continue
      this.close(tab.id, false)
    }
  }

  private openedFrom(how: OpenHow, paneId: string): string | null {
    return how.beside ? (this.panes.at(paneId)?.activeTabId ?? null) : null
  }

  private besideOf(tab: Tab, opener: string): Tab[] {
    const previous = this.besideLast?.opener === opener ? this.besideLast.tab : null
    this.besideLast = { opener, tab: tab.id }
    return this.placed(tab, tab.paneId, besideAt(this.tabsIn(tab.paneId), opener, previous))
  }

  private onlyOne(kept: Tab) {
    if (!viewport.touch) return

    for (const other of this.tabs) {
      if (other.id === kept.id || !this.panes.at(other.paneId)) continue
      const held = this.tabs.some((one) => one !== other && one.note === other.note)
      if (!held && isDraft(other.note) && worthAFile(other.note)) this.putAwayWritten(other)
      else this.close(other.id)
    }
  }

  private readonly puttingAway = new Set<Tab>()

  private putAwayWritten(tab: Tab) {
    const paneId = tab.paneId
    const at = Math.max(this.tabsIn(paneId).indexOf(tab), 0)
    this.puttingAway.add(tab)
    this.close(tab.id, false)

    void import('./workspace/placing')
      .then((one) => one.putAway(this, tab, paneId, at))
      .catch((error: unknown) => {
        log('warn', `a put-away draft's words did not reach Recently deleted: ${String(error)}`)
      })
  }

  putAwayDone(tab: Tab, paneId: string, at: number) {
    this.puttingAway.delete(tab)
    this.closed.record({ draft: this.draftOf(tab), paneId, at })
    this.persist()
  }

  oneDocument() {
    if (!viewport.touch) return

    this.collapsePanes()
    const kept = this.active ?? this.tabsIn(this.panes.focusedId)[0]
    if (kept) this.onlyOne(kept)
  }

  openView(
    words: string,
    name: string,
    path: string | null,
    how: OpenHow = {},
    kind?: 'channel',
  ): Tab {
    const file = this.document({ kind: kind ?? 'view', path, name, text: words, dirty: false })
    const tab = new Tab(file, this.panes.focusedId)
    this.arrive(tab, how)
    if (how.activate !== false) this.showNote()
    if (path !== null) this.remember(path)
    this.persist()
    return tab
  }

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

  openChat() {
    const was = this.tabs.find((tab) => tab.kind === 'chat')
    if (was) this.panes.activate(was.paneId, was.id)
    else {
      const doc = { kind: 'chat', path: null, name: t('Ask'), text: '', dirty: false } as const
      this.add(new Tab(this.document(doc), this.panes.focusedId))
    }
    this.persist()
  }

  async openPdf(asked: string, page: number | null = null, how: OpenHow = {}) {
    if (__EVEN_PLUGIN__) return

    void import('./surfaces.svelte').then(({ pagesSurface }) => pagesSurface())

    const path = this.spelled(asked)
    const held = isPagesTarget(path) ? path : await this.heldBy(path)
    if (held) {
      await this.openPages(held, page, how)
      return
    }
    if (!(await this.mayTurn(path))) {
      await this.openPaper(path, page, how)
      return
    }
    const pageNote = await this.pageNoteForPdf(path)
    if (!pageNote) {
      await unread(path)
      return
    }
    await this.openPages(pageNote, page, how)
  }

  private async heldBy(path: string): Promise<string | null> {
    const [{ noteHolding }, { onDisk }] = await Promise.all([
      import('./pages/from-pdf'),
      import('./on-disk'),
    ])
    return noteHolding(path, {
      root: this.rootHolding(path),
      exists: onDisk,
      read: (one) => invoke<string>('read_note', { path: one }).catch(() => null),
    })
  }

  private async mayTurn(path: string): Promise<boolean> {
    const { canWriteAt } = await import('./sharing.svelte')
    return canWriteAt(path)
  }

  private async openPaper(path: string, page: number | null, how: OpenHow) {
    const tab = this.showTab(
      await this.opened.opening(path, async () => {
        const text = await this.paperText(path)
        if (text === null) return unread(path).then(() => null)

        const file = this.document({ kind: 'pdf', path, name: nameOf(path), text, dirty: false })
        const tab = new Tab(file, this.panes.focusedId)
        if (page !== null) tab.page = page
        this.arrive(tab, how)
        this.remember(path)
        this.persist()
        return file
      }),
      how,
    )
    if (tab && page !== null && tab.page !== page) this.gotoPage = { path, page }
  }

  private async paperText(path: string): Promise<string | null> {
    const [{ asItself }, { pageSizes }] = await Promise.all([
      import('./pages/from-pdf'),
      import('./pdf/document'),
    ])
    return asItself(path, pageSizes).catch((error: unknown) => {
      log('error', `open PDF as itself: ${path} - ${String(error)}`)
      return null
    })
  }

  pageNoteForPdf(asked: string): Promise<string | null> {
    const path = this.spelled(asked)
    const existing = this.pdfPageNotes.get(path)
    if (existing) return existing

    const making = this.turning(path)
      .then(({ from, how }) => from.asPageNote(path, how))
      .catch((error: unknown) => {
        log('error', `open PDF as page note: ${path} - ${String(error)}`)
        return null
      })
    this.pdfPageNotes.set(path, making)
    void making.finally(() => this.pdfPageNotes.delete(path))
    return making
  }

  private async turning(path: string) {
    if (!(await this.mayTurn(path))) throw new Error(`${path} is in a space shared to be read`)
    const [from, { turningIn }] = await Promise.all([
      import('./pages/from-pdf'),
      import('./pages/turning'),
    ])
    const how = turningIn(this.rootHolding(path), (one, to) =>
      this.renameFile(one, to, false, true),
    )
    return { from, how }
  }

  async openCanvas(asked: string, how: OpenHow = {}) {
    if (__EVEN_PLUGIN__) return

    const path = this.spelled(asked)
    this.showTab(await this.opened.opening(path, () => this.openPlane(path, how)), how)
  }

  private showTab(note: NoteDoc | null, how: OpenHow = {}): Tab | null {
    const tab = note && this.tabOf(note)
    if (!tab) return null

    if (!how.preview) this.keep(tab.id)
    if (how.activate !== false) {
      this.activeTabId = tab.id
      this.showNote()
    }
    return tab
  }

  private tabOf(note: NoteDoc): Tab | undefined {
    const all = this.tabs.filter((one) => one.note === note)
    return all.find((one) => this.panes.at(one.paneId)) ?? all[0]
  }

  private arrive(tab: Tab, how: OpenHow) {
    const activate = how.activate !== false
    this.add(tab, activate, this.openedFrom(how, tab.paneId))
    if (how.preview) this.previewIn(tab)
    if (activate) this.dropScaffolding(tab)
  }

  private replaceablePreview(): Tab | null {
    return (
      this.tabs.find(
        (tab) =>
          tab.id === this.previewTabId &&
          !tab.dirty &&
          tab.paneId === this.panes.focusedId &&
          !this.tabs.some((one) => one.id !== tab.id && one.note === tab.note),
      ) ?? null
    )
  }

  private previewIn(tab: Tab) {
    const was = this.replaceablePreview()
    if (was && was.id !== tab.id) {
      const at = this.tabsIn(was.paneId).findIndex((one) => one.id === was.id)
      this.tabs = this.placed(tab, tab.paneId, at)
      this.close(was.id, false)
    }

    this.previewTabId = tab.id
  }

  private async openPlane(path: string, how: OpenHow): Promise<NoteDoc | null> {
    const text = await invoke<string>('read_note', { path }).catch(() => null)
    if (text === null) return unread(path).then(() => null)

    const { parseAhead } = await import('./canvas/format')
    if (!parseAhead(text)) return unread(path).then(() => null)
    await nextTask()

    const file = this.document({
      kind: 'canvas',
      path,
      name: nameOf(path),
      text,
      dirty: false,
    })
    const tab = new Tab(file, this.panes.focusedId)
    this.arrive(tab, how)

    links.canvasRead(path, text)

    this.remember(path)
    this.persist()
    return file
  }

  async openWeb(asked: string, how: OpenHow = {}) {
    if (isPlugin()) return

    const path = this.spelled(asked)
    const held = this.opened.at(path)
    if (held) {
      if (await this.handedOut(path)) {
        this.closeEach(
          this.tabs.filter((one) => one.note === held).map((tab) => tab.id),
          false,
        )
        return
      }
      this.showTab(held, how)
      return
    }
    if (isDesktop) {
      const windows = await import('./web-tab/one-window.svelte')
      if (windows.heldElsewhere(path)) {
        windows.showElsewhere(path)
        return
      }
    }

    if (!isWebTarget(path) && !(await this.writableAt(path))) {
      await this.browseOldWebsite(path, how)
      return
    }
    const opening = isWebTarget(path)
      ? path
      : await import('./web-tab/convert').then(({ asShortcut }) => asShortcut(this, path))
    if (opening === null) {
      await this.open(path, how)
      return
    }

    this.showTab(await this.opened.opening(opening, () => this.openSite(opening, how)), how)
  }

  private async browseOldWebsite(path: string, how: OpenHow) {
    const text = await invoke<string>('read_note', { path }).catch(() => null)
    const { webUrlOf } = await import('./web-tab/note')
    const url = webUrlOf(text)
    if (url === null) {
      await this.open(path, how)
      return
    }
    this.remember(path)
    if (!isDesktop || this.openPage(url) === null) await openExternal(url)
  }

  private async handedOut(path: string): Promise<boolean> {
    if (isDesktop) return false
    const text = await invoke<string>('read_note', { path }).catch(() => null)
    const said = readWebFile(path, text)
    if (!said) return false
    await openExternal(said.url)
    this.remember(path)
    return true
  }

  private async openSite(opening: string, how: OpenHow): Promise<NoteDoc | null> {
    const text = await invoke<string>('read_note', { path: opening }).catch(() => null)
    const said = readWebFile(opening, text)
    if (said === null && /\.webloc$/i.test(opening.trim())) {
      return unread(opening).then(() => null)
    }

    if (!isDesktop && (said || viewport.touch)) {
      if (said) await openExternal(said.url)
      this.remember(opening)
      return null
    }

    const file = this.document({
      kind: 'web',
      path: opening,
      name: nameOf(opening),
      text: text ?? '',
      dirty: false,
    })
    const tab = new Tab(file, this.panes.focusedId)
    if (said) tab.address = said.url

    const page = pages.of(tab.id)
    page.url = said?.url ?? null
    page.title = said?.title ?? shownName(nameOf(opening))

    this.arrive(tab, how)

    this.remember(opening)
    this.persist()
    return file
  }

  async convertWebsites(): Promise<number> {
    const root = this.activeSpace?.root
    if (!root || !(await this.writableAt(root))) return 0
    const { convertWebsites } = await import('./web-tab/convert')
    return convertWebsites(this)
  }

  openWebsite(inPrivate = false) {
    if (__EVEN_PLUGIN__ || viewport.touch) return

    const file = this.document({
      kind: 'web',
      path: null,
      name: t('New tab'),
      text: '',
      dirty: false,
      home: this.activeSpaceId,
    })
    const tab = new Tab(file, this.panes.focusedId)
    tab.inPrivate = inPrivate
    pages.of(tab.id).inPrivate = inPrivate
    this.add(tab)
    this.dropScaffolding(tab)
    this.showNote()
    this.persist()
  }

  openPage(url: string, ask: TabAsk = 'plain', opener?: string): string | null {
    if (__EVEN_PLUGIN__ || viewport.touch) return null

    const back = ask === 'behind' && !viewport.touch
    const from = this.tabs.find((one) => one.id === opener)
    const pane = from?.paneId ?? this.panes.focusedId

    const source = from ?? this.active
    const file = this.document({
      kind: 'web',
      path: null,
      name: plainOrigin(url),
      text: '',
      dirty: false,
      home: source ? this.spaceOf(source.note) : this.activeSpaceId,
    })
    const tab = new Tab(file, pane)
    tab.address = url

    const page = pages.of(tab.id)
    page.url = url
    page.title = plainOrigin(url)
    tab.inPrivate = from?.inPrivate === true
    page.inPrivate = tab.inPrivate
    tab.apart = from ? apartOf(from) : null

    this.add(tab, !back, from?.id ?? this.openedFrom(howFor(ask), pane))
    if (!back) {
      this.showNote()
      this.dropScaffolding(tab)
    }

    this.persist()
    return tab.id
  }

  async createWebsite(folder?: string, named?: string) {
    if (__EVEN_PLUGIN__ || viewport.touch) return

    const dir = folder ?? this.activeSpace?.root
    if (!dir || !(await this.writableAt(dir))) return
    if (named === undefined && this.startNaming('web', dir)) return

    const { newSite } = await import('./web-tab/new-site')
    const path = await newSite(this, dir, named)
    this.undone.record({ kind: 'create', path })
    await this.loadTree()
    await this.openWeb(path)
  }

  webAddressOf(tab: Tab): string | null {
    if (tab.kind !== 'web' || tab.path === null) return null
    return readWebFile(tab.path, tab.doc)?.url ?? null
  }

  async webAimed(tab: Tab, url: string) {
    const { aimed } = await import('./web-tab/aimed')
    await aimed(this, tab, url)
  }

  webWalked(tab: Tab, url: string) {
    if (tab.address === url) return

    if (tab.nowhere && !pages.of(tab.id).title) tab.name = plainOrigin(url)
    tab.address = url
    this.scheduleSession()
  }

  private readonly keeping = new Set<string>()

  webNamed(tab: Tab, title: string) {
    if (tab.kind !== 'web' || tab.path !== null) return

    const named = title.trim()
    if (named && tab.name !== named) tab.name = named
  }

  async save(tab: Tab, folder?: string, file?: string): Promise<string | null> {
    if (!isUnsaved(tab.note) || tab.inPrivate || this.keeping.has(tab.id)) return null
    this.keep(tab.id)

    this.keeping.add(tab.id)
    try {
      const dir = folder ?? (await this.draftHome(tab.note.home))
      if (dir === null || !(await this.writableAt(dir))) return null
      await this.nestFor(dir, [])

      const claim = (path: string, run: () => Promise<NoteDoc | null>) =>
        this.opened.opening(path, run)
      const saved =
        tab.kind === 'web'
          ? await import('./workspace/placing').then((one) =>
              one.keepWeb(this, claim, tab, dir, file),
            )
          : tab.kind === 'terminal'
            ? await import('./workspace/placing').then((one) =>
                one.keepTerm(this, claim, tab, dir, file),
              )
            : await this.saving.place(tab.note, dir, file ?? draftFile(tab.note))
      this.persist()
      return saved
    } catch (error) {
      log('error', `save: ${tab.path ?? 'a draft'} - ${String(error)}`)
      return null
    } finally {
      this.keeping.delete(tab.id)
    }
  }

  async openPages(asked: string, page: number | null = null, how: OpenHow = {}) {
    if (__EVEN_PLUGIN__) return

    const path = this.spelled(asked)
    await this.holdPaperBeside(path)
    const tab = this.showTab(
      await this.opened.opening(path, () => this.openDeck(path, page, how)),
      how,
    )
    if (tab && page !== null && tab.page !== page) this.gotoPage = { path, page }
  }

  private async holdPaperBeside(path: string) {
    const pdf = path.replace(/\.pages$/i, '.pdf')
    if (this.opened.at(path) || !this.files.some((one) => samePath(one.path, pdf))) return
    if (!(await this.mayTurn(path))) return

    await this.turning(path)
      .then(({ from, how }) => from.adoptBeside(path, how))
      .catch((error: unknown) => {
        log('warn', `page note beside its PDF: ${path} - ${String(error)}`)
      })
  }

  private async openDeck(path: string, page: number | null, how: OpenHow): Promise<NoteDoc | null> {
    const text = await invoke<string>('read_note', { path }).catch(() => null)
    if (text === null) return unread(path).then(() => null)
    const { parseAhead } = await import('./canvas/format')
    if (!parseAhead(text)) return unread(path).then(() => null)

    const file = this.document({
      kind: 'pages',
      path,
      name: nameOf(path),
      text,
      dirty: false,
    })
    const tab = new Tab(file, this.panes.focusedId)
    if (page !== null) tab.page = page
    this.arrive(tab, how)

    links.canvasRead(path, text)

    this.remember(path)
    this.persist()
    return file
  }

  async createPages(folder?: string, named?: string) {
    const dir = folder ?? this.activeSpace?.root
    if (!dir || !(await this.writableAt(dir))) return
    if (named === undefined && this.startNaming('pages', dir)) return

    const { blankPages } = await import('@orden/markdown/pages')
    const { modes } = await import('./modes.svelte')

    const path = joinPath(dir, await this.freeNameOnDisk(dir, named ?? PLACEHOLDER.pages))
    const content = blankPages(modes.pagesPaper)

    this.showEntry(this.freshEntry(path, false))
    if (!samePath(dir, this.activeSpace?.root)) this.device.expand(dir)

    const file = this.document({
      kind: 'pages',
      path,
      name: nameOf(path),
      text: content,
      dirty: false,
    })
    const tab = this.add(new Tab(file, this.panes.focusedId))
    this.showNote()
    this.remember(path)
    this.dropScaffolding(tab)

    await writeFile(path, content)
    this.undone.record({ kind: 'create', path })
    await this.loadTree()
    this.persist()
  }

  gotoPage = $state<{ path: string; page: number } | null>(null)

  async leaveTheWelcomeNote(): Promise<void> {
    const only = this.tabs.length === 1 ? this.tabs[0] : null
    if (!only || !samePath(only.path, WELCOME_PATH) || only.dirty) return

    const mine = this.notes.filter((one) => !samePath(one.path, WELCOME_PATH))
    const back = this.recent.find((path) => mine.some((one) => samePath(one.path, path)))
    const next = back ?? mine[0]?.path
    if (!next) return

    await this.openEntry(next, { activate: true })
    this.close(only.id)
  }

  async openFirst(path: string) {
    await this.openEntry(path, { activate: false })
    const only = this.tabs.length === 1 ? this.tabs[0] : null
    if (only && samePath(only.path, path)) this.front(only.id)
  }

  front(id: string) {
    this.activeTabId = id
    this.showNote()
    this.persist()
  }

  secondView(note: NoteDoc, how: OpenHow, essential: string | null = null): Tab {
    const tab = new Tab(note, this.panes.focusedId)
    tab.essential = essential
    if (note.path) this.placeAt(tab, note.path)
    this.add(tab, how.activate !== false, this.openedFrom(how, tab.paneId))
    if (how.activate !== false) this.showNote()
    this.persist()
    return tab
  }

  async openEntry(path: string, options: OpenHow = {}) {
    const opener = openerFor(path, (one) => links.urlOf(one) !== null, {
      evenBuild: __EVEN_PLUGIN__,
      isPlugin: isPlugin(),
    })

    switch (opener) {
      case null:
        return
      case 'pdf':
        await this.openPdf(path, null, options)
        return
      case 'web':
        await this.openWeb(path, options)
        return
      case 'pages':
        await this.openPages(path, null, options)
        return
      case 'canvas':
        await this.openCanvas(path, options)
        return
      case 'view': {
        if (__EVEN_PLUGIN__) return
        const { openBaseFile } = await import('./views/open')
        openBaseFile(path, options)
        return
      }
      case 'chat':
        if (!__EVEN_PLUGIN__) (await import('./chats/view/open')).openChat(path, options)
        return
      case 'term':
        if (!__EVEN_PLUGIN__) (await import('./online/open')).openTerm(path, options)
        return
      case 'application':
        if (!__EVEN_PLUGIN__) (await import('./apps/open')).openApplication(path, options)
        return
      case 'note':
        await this.open(path, options)
        return
    }
  }

  private dropScaffolding(kept: Tab) {
    for (const other of this.tabsIn(kept.paneId)) {
      if (other.id === kept.id || other.kind !== 'note' || other.path !== null || other.dirty) {
        continue
      }

      this.close(other.id)
    }
  }

  async loadSpaces() {
    await spaces.loadSpaces(this)
    mark('spaces listed')
  }

  async adoptSpace(name: string, fresh = false): Promise<string | null> {
    return (await changes()).adoptSpace(this, name, fresh)
  }

  async addSpace(name: string) {
    return (await changes()).addSpace(this, name)
  }

  async renameSpace(id: string, name: string) {
    await (await changes()).renameSpace(this, id, name)
  }

  moveSpace(id: string, beforeId: string | null): boolean {
    return spaces.moveSpace(this, id, beforeId)
  }

  applySpaceOrder(names: string[]): boolean {
    return spaces.applySpaceOrder(this, names)
  }

  async selectSpace(id: string) {
    await spaces.selectSpace(this, id)
  }

  async showSpace(id: string) {
    await spaces.selectSpace(this, id)
  }

  async deleteSpace(id: string, keep = false) {
    await (await changes()).deleteSpace(this, id, keep)
  }

  async loadTree() {
    const root = this.activeSpace?.root
    if (!root) return

    mark('tree asked')
    try {
      this.tree =
        (await ahead.treeAhead(root, this.treeOptions)) ??
        (await invoke<Entry>('read_tree', { root, options: this.treeOptions }))
    } catch {
      this.tree = null
    }
    this.saving.across?.listed()

    mark('tree read')

    void startup.turn('index').then(() =>
      askCase(
        root,
        this.files.map((one) => one.path),
      ),
    )

    this.picked.keepOnly((path) => !!this.entryAt(path))
    this.keepOpenRows(root)
    this.keepNaming()

    arriving.prune((path) => !!this.entryAt(path))

    if (!samePath(links.rootOf(), root)) {
      void links.build(root)
      void startup.turn('index').then(() =>
        import('./workspace/setext').then(
          ({ dropSetext }) =>
            dropSetext(this, root, () => account.signedIn).catch((error: unknown) => {
              log('error', `setext headings in ${root} not rewritten - ${String(error)}`)
            }),
          unfetched,
        ),
      )
      void import('./workspace/own-keys-moved').then(
        ({ moveOwnKeysSoon }) => moveOwnKeysSoon(root, this, account.signedIn),
        unfetched,
      )
      void import('./rows/old-lists').then(
        ({ markOldListsSoon }) => markOldListsSoon(root, !account.signedIn, this),
        unfetched,
      )
      void import('./search/warm.svelte').then(({ warm }) => warm.forSpace(root), unfetched)
      const listed = this.files
      const tree = this.tree
      void import('./pdf/extract').then(
        ({ readPapers }) => readPapers(root, listed, tree),
        unfetched,
      )
    }
  }

  setSort(mode: SortMode) {
    this.sorting.set(mode)
  }

  toggleHidden() {
    this.treeOptions = { ...this.treeOptions, showHidden: !this.treeOptions.showHidden }
    this.persistTreeOptions()
  }

  private persistTreeOptions() {
    keepJson(TREE_KEY, this.treeOptions)
    void this.loadTree()
  }

  async move(from: string, intoFolder: string, how?: 'follows' | 'nests' | 'carries') {
    const name = nameOf(from)
    const target = joinPath(intoFolder, name)

    if (samePath(target, from) || within(from, intoFolder) !== null) return
    if (!(await this.writableAt(from, intoFolder))) return

    const leaving = this.spaces.find((one) => within(one.root, from) !== null)
    let back = () => Promise.resolve()
    if (leaving && within(leaving.root, intoFolder) === null) {
      back = await (await import('./workspace/chat-leaving')).chatsCarried(from, intoFolder)
    }

    const kind = this.kindAt(from)
    this.showMove(from, target)

    await this.undone.batch(async () => {
      const { moving } = await import('./views/moving')
      await moving(target, () =>
        this.saving.holdingUnder(from, async () => {
          try {
            await this.renameOnDisk(from, target, kind)
          } catch (error) {
            await back()
            await this.loadTree()
            throw error
          }

          const rewrote = await this.retargetMoved(from, target)
          this.undone.record({
            kind: 'move',
            from,
            to: target,
            ...(rewrote ? { rewrote } : {}),
            ...(how ? { [how]: true } : {}),
          })
          await this.fileMoved(from, target, kind)
        }),
      )
      await this.loadTree()
      await this.unnest(folderOf(from))
    })
    this.persist()
  }

  private async unnest(folder: string) {
    const entry = this.entryAt(folder)
    const back = entry && unnesting(entry)
    if (!back) return
    if (this.entryAt(joinPath(back.into, nameOf(back.note)))) return

    await this.move(back.note, back.into, 'follows')

    this.hideEntry(back.folder)

    await invoke('remove_empty_folder', { path: back.folder }).catch(() => undefined)
    await this.loadTree()
  }

  private showNote() {
    if (!viewport.drawer || !this.panel) return

    this.panel = null
    this.persist()
  }

  async openRow(path: string, options: OpenHow = {}) {
    const entry = this.entryAt(path)
    if (!entry) return
    if (!entry.is_dir) return this.openEntry(path, options)

    const own = folderNote(entry)
    await this.open(own?.path ?? folderNotePath(path), { ...options, blank: !own })
  }

  async open(asked: string, options: OpenHow & { blank?: boolean; asNote?: boolean } = {}) {
    const path = this.spelled(asked)
    if (isScratchpad(path) && !options.asNote && !this.opened.at(path)) {
      const { scratchpad } = await import('./scratchpad/pad')
      scratchpad.show()
      return
    }
    if (this.instructionsAt(path) && !this.opened.at(path)) {
      if (options.activate !== false) {
        const root = this.rootHolding(path)
        if (root !== null) (await import('./reserved-name.svelte')).openInstructions(root)
      }
      return
    }

    const note = await this.opened.opening(path, () => this.openNote(path, options))
    const tab = note && this.tabOf(note)
    if (!tab) return

    if (!options.preview) this.keep(tab.id)
    if (options.activate !== false) {
      this.activeTabId = tab.id
      this.showNote()
    }
  }

  private async openNote(
    path: string,
    options: OpenHow & { blank?: boolean },
  ): Promise<NoteDoc | null> {
    const found = await invoke<string>('read_note', { path }).catch(() => null)

    if (found === null && (arriving.coming.has(path) || keptAway.at(path))) {
      const waiting = this.document({
        kind: 'note',
        path,
        name: nameOf(path),
        text: '',
        dirty: false,
      })
      const tab = new Tab(waiting, this.panes.focusedId)
      tab.coming = true
      this.add(tab, options.activate !== false, this.openedFrom(options, tab.paneId))

      this.dropScaffolding(tab)
      this.persist()
      return waiting
    }

    const doc = found ?? ((await unread(path)) || !options.blank ? null : '')
    if (doc === null) return null
    const unwritten = found === null

    const previewing = options.preview ? this.replaceablePreview() : null
    const reusable = previewing?.kind === 'note' ? previewing : null

    if (reusable) {
      reusable.note.adopt({ path, name: nameOf(path), text: doc })
      if (unwritten) reusable.note.onDisk = null
      this.walked(reusable, path)
      this.placeAt(reusable, path)
      reusable.reading = false

      this.remember(path)
      this.persist()
      return reusable.note
    }

    const note = this.document({
      kind: 'note',
      path,
      name: nameOf(path),
      text: doc,
      dirty: false,
    })
    if (unwritten) note.onDisk = null
    const tab = new Tab(note, this.panes.focusedId)
    this.walked(tab, path)
    this.placeAt(tab, path)
    this.arrive(tab, options)

    this.remember(path)
    this.persist()
    return note
  }

  private spelled(path: string): string {
    return this.entryAt(path)?.path ?? path
  }

  private placeAt(tab: Tab, path: string) {
    const place = this.positions.of(path)
    tab.cursor = place.cursor
    tab.scroll = place.scroll
    tab.anchor = place.anchor
    tab.folds = place.folds
  }

  openRelative(relative: string, how: OpenHow, from: string | null = null) {
    const root = this.rootHolding(from)
    if (!root) return

    void this.openEntry(insideSpace(root, relative), how)
  }

  activate(id: string) {
    this.activeTabId = id
    this.persist()
  }

  deselect(paneId: string = this.panes.focusedId) {
    this.panes.deselect(paneId)
  }

  deselectAll() {
    const panes = this.panes.all
    if (panes.some((one) => one.activeTabId !== null)) {
      for (const one of panes) this.panes.deselect(one.id)
      return
    }

    for (const one of panes) {
      const strip = this.tabsIn(one.id).map((tab) => tab.id)
      const back = this.panes.successorOf(strip)
      if (back) this.panes.activate(one.id, back)
    }
  }

  focusPane(id: string) {
    this.panes.focus(id)
  }

  showing(paneId: string): Tab | null {
    const id = this.panes.at(paneId)?.activeTabId
    return (id ? this.tabs.find((tab) => tab.id === id) : null) ?? null
  }

  private walked(tab: Tab, path: string) {
    if (samePath(tab.trail[tab.at], path)) return

    const behind = tab.trail.slice(0, tab.at + 1)
    tab.trail = [...behind, path].slice(-TRAIL)
    tab.at = tab.trail.length - 1
  }

  async walk(to: number, id: string | null = this.activeTabId) {
    const tab = this.tabs.find((one) => one.id === id)
    if (!tab || to < 0 || to >= tab.trail.length || to === tab.at) return

    const path = tab.trail[to]
    if (path === undefined) return

    this.flush()
    const note = await this.opened.opening(path, () => this.stepped(tab, path))
    if (!note) {
      tab.trail = tab.trail.filter((one) => !samePath(one, path))
      tab.at = Math.min(tab.at, Math.max(tab.trail.length - 1, 0))
      return
    }

    tab.note = note
    tab.at = to
    this.placeAt(tab, path)
    tab.reading = false

    this.activeTabId = tab.id
    this.showNote()
    this.remember(path)
    this.persist()
  }

  private async stepped(tab: Tab, path: string): Promise<NoteDoc | null> {
    const text = await invoke<string>('read_note', { path }).catch(() => null)
    if (text === null) return unread(path).then(() => null)

    const note = this.document({ kind: 'note', path, name: nameOf(path), text, dirty: false })
    tab.note = note
    return note
  }

  zoomPage(step: 'in' | 'out' | 'reset'): boolean {
    const tab = this.active
    if (tab?.kind !== 'web' || !pages.of(tab.id).live) return false

    void import('./web-tab/zoom').then((one) => one.zoomStep(tab.id, pages.of(tab.id), step))
    return true
  }

  goBack(id: string | null = this.activeTabId, ask: TabAsk = 'plain') {
    const tab = this.tabs.find((one) => one.id === id)
    if (!tab) return
    if (ask !== 'plain') {
      void this.stepAside(tab, -1, ask)
      return
    }

    if (tab.kind === 'web') void pages.step(tab.id, 'back')
    else if (!__EVEN_PLUGIN__ && tab.kind === 'explorer')
      void viewOfExplorer(tab).then((view) => view.back())
    else void this.walk(tab.at - 1, tab.id)
  }

  goForward(id: string | null = this.activeTabId, ask: TabAsk = 'plain') {
    const tab = this.tabs.find((one) => one.id === id)
    if (!tab) return
    if (ask !== 'plain') {
      void this.stepAside(tab, 1, ask)
      return
    }

    if (tab.kind === 'web') void pages.step(tab.id, 'forward')
    else if (!__EVEN_PLUGIN__ && tab.kind === 'explorer')
      void viewOfExplorer(tab).then((view) => view.forward())
    else void this.walk(tab.at + 1, tab.id)
  }

  private async stepAside(tab: Tab, by: -1 | 1, ask: TabAsk) {
    if (tab.kind === 'web') {
      const url = await pages.stepAddress(tab.id, by)
      if (url !== null) this.openPage(url, ask, tab.id)
      return
    }

    const path = tab.trail[tab.at + by]
    if (path !== undefined) await this.openEntry(path, howFor(ask))
  }

  keep(id: string) {
    if (this.previewTabId === id) this.previewTabId = null
  }

  async closeAsking(id: string) {
    const tab = this.tabs.find((one) => one.id === id)
    if (tab && (await this.mayClose([tab]))) this.close(id)
  }

  async closeActive() {
    const tab = this.active
    if (tab) await this.closeAsking(tab.id)
  }

  async closeAround(id: string, which: Around) {
    const tab = this.tabs.find((one) => one.id === id)
    const going = tab ? closedAround(this.tabsIn(tab.paneId), id, which) : []
    await this.closeMany(going.map((one) => one.id))
  }

  async closeMany(ids: readonly string[]) {
    const going = this.tabs.filter((one) => ids.includes(one.id))
    if (!(await this.mayClose(going))) return

    this.closeEach(
      going.map((one) => one.id),
      true,
      Date.now(),
    )
  }

  closesAround(id: string, which: Around): number {
    const tab = this.tabs.find((one) => one.id === id)
    return tab ? closedAround(this.tabsIn(tab.paneId), id, which).length : 0
  }

  private async mayClose(closing: readonly Tab[]): Promise<boolean> {
    if (__EVEN_PLUGIN__) return true
    if (closing.some(unsaved)) {
      const { mayLose } = await import('./workspace/closing-unsaved')
      if (!(await mayLose(this, closing))) return false
    }
    if (!closing.some((tab) => tab.kind === 'terminal')) return true
    const { mayEnd } = await import('./terminal/closing')
    return mayEnd(closing, this.tabs)
  }

  async writeNow() {
    await this.saving.writeNow()
  }

  async writesSettled() {
    await this.saving.settled()
  }

  get writing(): boolean {
    return this.saving.writing
  }

  close(id: string, reopenable = true, batch?: number) {
    if (this.shut(id, reopenable, batch)) this.persist()
  }

  closeEach(ids: readonly string[], reopenable = true, batch?: number) {
    let shut = false
    for (const id of ids) shut = this.shut(id, reopenable, batch) || shut
    if (shut) this.persist()
  }

  private shut(id: string, reopenable: boolean, batch?: number): boolean {
    const tab = this.tabs.find((one) => one.id === id)
    if (!tab) return false

    const paneId = tab.paneId
    const at = this.tabsIn(paneId).findIndex((one) => one.id === id)

    this.flush()
    if (reopenable && worthReopening(tab)) {
      this.closed.record({
        draft: this.draftOf(tab),
        paneId,
        at: Math.max(at, 0),
        ...(batch ? { batch } : {}),
      })
      const last = !this.tabs.some((one) => one !== tab && one.note === tab.note)
      if (last && isDraft(tab.note)) void this.trashWords(tab.note)
    }

    if (tab.kind === 'web') pages.forget(tab.id)

    this.tabs = this.tabs.filter((one) => one.id !== id)
    if (this.previewTabId === id) this.previewTabId = null
    this.saving.closed(tab.note)

    if (!this.panes.at(paneId)) return true
    const left = this.tabsIn(paneId)
    const showing = this.panes.at(paneId)?.activeTabId === id ? null : this.showing(paneId)

    if (!paneStays(left.length, showing)) {
      if (this.closePaneOf(paneId)) this.panes.activate(paneId, null)
      return true
    }

    if (this.panes.at(paneId)?.activeTabId === id) {
      this.panes.activate(
        paneId,
        this.panes.successorOf(
          left.map((one) => one.id),
          at,
        ),
      )
    }
    return true
  }

  private closePaneOf(paneId: string): boolean {
    const held = this.heldIn(paneId)
    if (!this.panes.close(paneId)) return true

    for (const one of held) one.paneId = this.panes.focusedId
    return false
  }

  async reopenClosed() {
    for (let batch = this.closed.take(); batch.length; batch = this.closed.take()) {
      let back: { tab: Tab; paneId: string } | null = null
      for (const closed of batch) {
        const trashed = closed.trashed
        if (trashed !== undefined) {
          const { untrash } = await import('./workspace/placing')
          if (!(await untrash(trashed))) continue
        }

        const { reopening } = await import('./workspace/moving-space')
        const draft = await reopening(closed.draft)
        if (!draft) continue

        const paneId = this.panes.at(closed.paneId) ? closed.paneId : this.panes.focusedId
        const [tab] = await this.tabsFrom([draft], paneId)
        if (!tab) continue

        const there = this.tabsIn(tab.paneId).find((one) => one.note === tab.note)
        if (there) {
          back = { tab: there, paneId: tab.paneId }
          continue
        }

        this.tabs = this.placed(tab, tab.paneId, tab.paneId === paneId ? closed.at : null)
        back = { tab, paneId: tab.paneId }
      }
      if (!back) continue

      this.panes.activate(back.paneId, back.tab.id)
      this.panes.focus(back.paneId)
      this.onlyOne(back.tab)
      this.persist()
      return
    }
  }

  private async trashWords(note: NoteDoc) {
    const { trashWords } = await import('./workspace/placing')
    await trashWords(this, note).catch((error: unknown) => {
      log('warn', `a closed tab's words did not reach Recently deleted: ${String(error)}`)
    })
  }

  private placed(tab: Tab, paneId: string, at: number | null): Tab[] {
    const rest = this.tabs.filter((one) => one.id !== tab.id)
    const strip = rest.filter((one) => one.paneId === paneId && !one.essential)
    const after = at === null ? undefined : strip[Math.max(0, at)]
    const index = after ? rest.findIndex((one) => one.id === after.id) : -1
    if (index < 0) return [...rest, tab]

    return [...rest.slice(0, index), tab, ...rest.slice(index)]
  }

  flush() {
    this.saving.flush()
  }

  wordsNow() {
    this.saving.wordsNow()
  }

  replace(text: string, target?: Tab) {
    this.saving.replace(text, target)
  }

  async restoreVersion(text: string, target?: Tab) {
    const path = (target ?? this.active)?.path
    if (path && !(await this.writableAt(path))) return
    this.saving.restoreVersion(text, target)
  }

  get worthKeeping(): { key: string; path: string; text: string; revision: number }[] {
    return this.saving.worthKeeping
  }

  get recent(): string[] {
    return this.device.recent.filter(
      (path) =>
        !this.outside(path) &&
        !this.instructionsAt(path) &&
        !(this.archive.any && this.archive.has(path)),
    )
  }

  remember(path: string) {
    this.device.remember(path)
  }

  iconFor(spaceId: string | null): string | null {
    const space = this.spaces.find((entry) => entry.id === spaceId)
    return space ? this.device.iconOf(space.root) : null
  }

  tintFor(spaceId: string | null): string | null {
    const space = this.spaces.find((entry) => entry.id === spaceId)
    return space ? this.device.tintOf(space.root) : null
  }

  applyIcon(root: string, name: string | null, tint?: string | null): string | null {
    return this.device.applyIcon(root, name, tint)
  }

  setFolderIcon(path: string, value: string | null, tint: string | null = null) {
    this.folderIcons.set(path, value, value === null ? null : readTint(tint))
  }

  setIcon(spaceId: string, name: string | null, tint: string | null = null) {
    const space = this.spaces.find((entry) => entry.id === spaceId)
    if (!space) return

    const colour = name === null ? null : readTint(tint)
    this.device.setIcon(space.root, name, colour)

    void import('./sync.svelte').then(({ sync }) => sync.pushIcon(space.root, name, colour))
  }

  get selection(): string[] {
    return this.picked.paths
  }

  isSelected(path: string): boolean {
    return this.picked.has(path)
  }

  select(path: string) {
    this.picked.select(path)
  }

  toggleSelect(path: string) {
    this.picked.toggle(path)
  }

  selectRange(path: string) {
    this.picked.range(path, this.visibleRows())
  }

  selectAll() {
    this.picked.all(this.visibleRows())
  }

  extendSelection(from: string, to: string) {
    this.picked.extend(from, to, this.visibleRows())
  }

  clearSelection() {
    this.picked.clear()
  }

  visibleTree(): TreeRow[] {
    return flatRows(this.shownTree, (path) => this.isExpanded(path)).map(({ entry }) => ({
      path: entry.path,
      folder: entry.is_dir,
      open: standsOpen(entry, (path) => this.isExpanded(path)),
    }))
  }

  visibleRows(): string[] {
    return this.visibleTree().map((row) => row.path)
  }

  dragPayload(path: string): string[] {
    return this.picked.dragging(path)
  }

  carriedNotes(transfer: DataTransfer | null): readonly string[] {
    const root = this.activeSpace?.root
    return root ? linkedFiles(this.tree, root, carriedRows(transfer)) : []
  }

  refusedAsInstructions(paths: string[], intoFolder: string): boolean {
    const refused =
      paths.some((path) => isAgentsName(nameOf(path))) &&
      this.spaces.some((one) => samePath(one.root, intoFolder))
    if (refused)
      void import('./reserved-name.svelte').then((one) => one.reservedName.tell(intoFolder))
    return refused
  }

  async moveMany(paths: string[], intoFolder: string, undoing = false): Promise<boolean> {
    if (!undoing && this.refusedAsInstructions(paths, intoFolder)) {
      this.clearSelection()
      return false
    }
    if (!(await this.writableAt(intoFolder, ...paths))) {
      this.clearSelection()
      return false
    }
    const stayed: string[] = []
    await this.undone.batch(async () => {
      await this.nestFor(intoFolder, paths)
      for (const path of outermost(paths)) {
        await this.move(path, intoFolder).catch((error: unknown) => {
          log('warn', `${path} not moved into ${intoFolder} - ${String(error)}`)
          stayed.push(path)
        })
      }
    })
    this.clearSelection()
    if (!stayed.length) return true

    const { failed } = await import('./views/failed.svelte')
    failed.tell(() => void this.moveMany(stayed, intoFolder, undoing))
    return false
  }

  private async nestFor(intoFolder: string, arriving: string[]) {
    const nesting = noteToNest(this.tree, intoFolder)
    if (!nesting || arriving.includes(nesting)) return

    this.showEntry(this.freshEntry(intoFolder, true))
    await this.move(nesting, intoFolder, 'nests')
    this.device.expand(intoFolder)
  }

  async copyMany(paths: string[], intoFolder: string) {
    if (!(await this.writableAt(intoFolder))) return
    await this.nestFor(intoFolder, paths)
    const { copyRows } = await import('./workspace/copying')
    const rows = outermost(paths).map((from) => ({ from, into: intoFolder }))
    await this.copied(await copyRows(this, rows), intoFolder)
  }

  async duplicateMany(paths: string[]) {
    const { copyRows } = await import('./workspace/copying')
    const rows = outermost(await this.writableOf(paths)).map((from) => ({
      from,
      into: folderOf(from),
    }))
    await this.copied(await copyRows(this, rows), null)
  }

  async bringIn(files: readonly Picked[], intoFolder: string) {
    if (!(await this.writableAt(intoFolder))) return
    await this.nestFor(intoFolder, [])
    const { bringIn } = await import('./workspace/copying')
    await this.copied(await bringIn(this, files, intoFolder), intoFolder)
  }

  samePdfIn(from: string, root: string): Promise<string | null> {
    return invoke<string | null>('same_pdf', { from, space: root }).catch(() => null)
  }

  async draftPdf(from: string): Promise<void> {
    const drafts = __EVEN_PLUGIN__ ? null : await import('./workspace/handed-drafts')
    const open = drafts ? await drafts.draftPdf(this, from) : null
    if (open) this.showTab(open.note)
  }

  async keepPaper(note: NoteDoc, path: string): Promise<void> {
    const drafts = __EVEN_PLUGIN__ ? null : await import('./workspace/handed-drafts')
    await drafts?.keepPaper(this, note, path)
  }

  private async copied(landed: string[], into: string | null) {
    if (!landed.length) return

    if (into !== null && !samePath(into, this.activeSpace?.root)) this.device.expand(into)
    await this.loadTree()
    this.picked.all(landed)
    this.persist()

    const { sync } = await import('./sync.svelte')
    sync.nudge()
  }

  async removeMany(paths: string[]) {
    const writable = await this.writableOf(this.deletable(paths))
    await this.undone.batch(async () => {
      for (const path of writable) {
        const entry = this.entryAt(path)
        if (entry) await this.remove(path, entry.is_dir)
      }
    })
    this.clearSelection()
  }

  private async writableAt(...paths: string[]): Promise<boolean> {
    const { canWriteAt } = await import('./sharing.svelte')
    return paths.every((path) => canWriteAt(path))
  }

  private async writableOf(paths: readonly string[]): Promise<string[]> {
    const { canWriteAt } = await import('./sharing.svelte')
    return paths.filter((path) => canWriteAt(path))
  }

  deletable(paths: readonly string[]): string[] {
    return outermost([...paths]).filter((path) => !this.keepsArchived(path))
  }

  keepsArchived(path: string): boolean {
    const root = this.spaces.find((one) => withinSpace(one.root, path) !== null)?.root
    return root !== undefined && this.archive.holdsIn(root, path)
  }

  entryAt(path: string): Entry | null {
    const found = entryAt(this.tree, path)
    return found && !samePath(found.path, this.tree?.path) ? found : null
  }

  showEntry(entry: Entry) {
    if (this.tree) this.tree = withEntry(this.tree, entry)
  }

  private hideEntry(path: string) {
    if (this.tree) this.tree = withoutEntry(this.tree, path)
  }

  private showMove(from: string, to: string) {
    rowIds.moved(from, to)
    if (this.tree) this.tree = withMove(this.tree, from, to)
  }

  heardMove(from: string, to: string) {
    const tree = this.tree
    if (!tree || !entryAt(tree, from)) return
    if (!entryAt(tree, folderOf(to))?.is_dir) return
    this.showMove(from, to)
  }

  heardGone(path: string) {
    const tree = this.tree
    if (tree && !samePath(tree.path, path) && entryAt(tree, path)) this.hideEntry(path)
  }

  freshEntry(path: string, isFolder: boolean): Entry {
    const at = Date.now()
    return {
      name: nameOf(path),
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

  isTagOpen(path: string): boolean {
    return this.device.isTagOpen(path)
  }

  toggleTag(path: string) {
    this.device.toggleTag(path)
  }

  isGroupOpen(id: string): boolean {
    return this.device.isGroupOpen(id)
  }

  toggleGroup(id: string) {
    this.device.toggleGroup(id)
  }

  openGroup(id: string) {
    if (!this.device.isGroupOpen(id)) this.device.toggleGroup(id)
  }

  async openAtBlock(target: string, how: OpenHow = {}) {
    const root = this.activeSpace?.root
    if (!root) return

    const cut = target.indexOf('#')
    const relative = cut < 0 ? target : target.slice(0, cut)
    const said = cut < 0 ? '' : target.slice(cut + 1)

    const path = this.spelled(insideSpace(root, relative))
    await this.open(path, how)
    if (!said) return

    const doc = this.tabs.find((tab) => samePath(tab.path, path))?.doc ?? ''
    const line = lineOfTarget(doc, {
      path: relative,
      target: relative,
      heading: said.startsWith('^') ? null : said,
      block: said.startsWith('^') ? said.slice(1) : null,
      page: null,
    })
    if (line !== null) this.goto = { path, line }
  }

  revealFolder(path: string) {
    const root = this.activeSpace?.root
    if (root === undefined || within(root, path) === null) return

    let here = root
    for (const part of relativeTo(root, path).split('/')) {
      here = joinPath(here, part)
      this.device.expand(here)
    }
  }

  revealing = $state<string | null>(null)

  revealNote(path = this.active?.path) {
    const root = this.activeSpace?.root
    if (!path || root === undefined || withinSpace(root, path) === null) return

    if (this.inEssentials(path)) {
      this.showPanel('tree')
      return
    }

    if (!__EVEN_PLUGIN__ && this.archive.has(path)) {
      this.showPanel('tree')
      void import('./archive-list.svelte').then(({ archiveList }) => archiveList.show(path))
      return
    }

    const holder = folderOf(isFolderNote(path) ? folderOf(path) : path)
    if (!samePath(holder, root)) this.revealFolder(holder)

    this.showPanel('tree')
    this.revealing = path
  }

  private keepOpenRows(root: string) {
    const tree = this.tree
    if (!tree || !samePath(tree.path, root)) return

    const listed = arriving.coming.size ? withComing(tree, [...arriving.coming]) : tree
    this.device.keepOpen(root, (path) => {
      const entry = entryAt(listed, path)
      return entry && standsOpen(entry, () => true) ? entry.path : null
    })
  }

  foldList() {
    const root = this.activeSpace?.root
    if (root !== undefined) this.device.foldUnder(root)
  }

  get unfolded(): boolean {
    return anyOpen(this.shownTree, (path) => this.isExpanded(path))
  }

  async openAtHeading(relative: string, heading: string, how: OpenHow = {}) {
    const root = this.activeSpace?.root
    if (!root) return

    const path = this.spelled(insideSpace(root, relative))
    await this.open(path, how)

    const doc = this.tabs.find((tab) => samePath(tab.path, path))?.doc ?? ''
    const line = lineOfHeading(scanHeadings(doc), heading)
    if (line !== null) this.goto = { path, line }
  }

  async loadTags() {
    await text.loadTags(this)
  }

  async retagNotes(from: string, to: string | null): Promise<number> {
    return text.retagNotes(this, from, to)
  }

  async noteText(path: string): Promise<string | null> {
    return text.noteText(this, path)
  }

  async toggleTaskAt(path: string, line: number, hash?: string): Promise<boolean> {
    return text.toggleTaskAt(this, path, line, hash)
  }

  async replaceInNotes(changes: readonly Change[], keeping?: text.Keeping): Promise<number> {
    return text.replaceInNotes(this, changes, keeping)
  }

  async writeNoteText(path: string, before: string, after: string) {
    await text.writeNoteText(this, path, before, after)
  }

  async createNote(folder?: string, named?: string) {
    const dir = folder ?? this.activeSpace?.root
    if (!dir || !(await this.writableAt(dir))) return
    if (named === undefined && this.startNaming('note', dir)) return

    const name = await this.freeNameOnDisk(dir, named ?? PLACEHOLDER.note)
    const path = joinPath(dir, name)
    const content = `# ${shownName(name)}\n\n`

    this.showEntry(this.freshEntry(path, false))
    if (!samePath(dir, this.activeSpace?.root)) this.device.expand(dir)

    const note = this.document({
      kind: 'note',
      path,
      name: nameOf(path),
      text: content,
      dirty: false,
    })
    const tab = this.add(new Tab(note, this.panes.focusedId))
    this.showNote()
    this.remember(path)
    this.dropScaffolding(tab)

    await writeFile(path, content)
    this.undone.record({ kind: 'create', path })
    await this.loadTree()
    this.persist()
  }

  async noteFrom(text: string, folder?: string): Promise<string | null> {
    const dir = folder ?? this.activeSpace?.root
    if (!dir || !(await this.writableAt(dir))) return null

    const stem = nameFromContent(text) ?? UNTITLED
    const path = joinPath(dir, await this.freeNameOnDisk(dir, `${stem}.md`))
    this.showEntry(this.freshEntry(path, false))

    await writeFile(path, text)
    await this.loadTree()
    this.persist()

    return path
  }

  async createCanvas(folder?: string, named?: string) {
    const dir = folder ?? this.activeSpace?.root
    if (!dir || !(await this.writableAt(dir))) return
    if (named === undefined && this.startNaming('canvas', dir)) return

    const { blankCanvas } = await import('./canvas/format')

    const path = joinPath(dir, await this.freeNameOnDisk(dir, named ?? PLACEHOLDER.canvas))
    const content = blankCanvas()

    this.showEntry(this.freshEntry(path, false))
    if (!samePath(dir, this.activeSpace?.root)) this.device.expand(dir)

    const file = this.document({
      kind: 'canvas',
      path,
      name: nameOf(path),
      text: content,
      dirty: false,
    })
    const tab = this.add(new Tab(file, this.panes.focusedId))
    this.showNote()
    this.remember(path)
    this.dropScaffolding(tab)

    await writeFile(path, content)
    this.undone.record({ kind: 'create', path })
    await this.loadTree()
    this.persist()
  }

  async createInside(path: string, make = (folder: string): unknown => this.createNote(folder)) {
    const entry = this.entryAt(path)
    if (!entry || !(await this.writableAt(path))) return

    const folder = entry.is_dir ? path : folderFor(path)
    if (samePath(folder, path) && !entry.is_dir) return

    await this.undone.batch(async () => {
      if (!entry.is_dir) await this.moveMany([], folder)
      await make(folder)
    })
  }

  freeName(dir: string, wanted: string, except?: string): string {
    const taken = pathKeys(this.everyPath(), dir)
    if (except !== undefined) taken.delete(pathKey(except, dir))
    const has = (name: string) => taken.has(pathKey(joinPath(dir, name), dir))
    return freePath(
      wanted,
      (candidate) =>
        has(candidate) ||
        isAgentsName(candidate) ||
        (/\.pages$/i.test(candidate) && has(`${candidate}.pdf`)) ||
        (/\.pages\.pdf$/i.test(candidate) && has(candidate.slice(0, -'.pdf'.length))),
    )
  }

  async freeNameOnDisk(dir: string, wanted: string): Promise<string> {
    const { pairOf } = await import('./pages/held')
    const found: string[] = []
    for (;;) {
      const name = freePath(
        wanted,
        (candidate) => found.includes(candidate) || this.freeName(dir, candidate) !== candidate,
      )
      const other = pairOf(name)
      const taken =
        (await onDisk(joinPath(dir, name))) ||
        (other !== null && (await onDisk(joinPath(dir, other))))
      if (taken) found.push(name)
      else if (this.freeName(dir, name) === name) return name
    }
  }

  private everyPath(): Set<string> {
    const out = this.opened.paths
    const walk = (entry: Entry) => {
      for (const child of entry.children) {
        out.add(child.path)
        if (child.is_dir) walk(child)
      }
    }

    if (this.tree) walk(this.tree)
    return out
  }

  startRenaming(path: string, appending = false) {
    const inHeader = this.spaces.some((space) => samePath(space.root, path))
    const listed = this.openOn(this.sideOf('tree')) === 'tree'
    if (!(inHeader ? this.panel !== null : listed)) return

    this.cancelNaming()
    this.naming = { path, appending, making: null }
  }

  canRenameFromTab(tab: Tab): boolean {
    return tab.kind === 'terminal' || (tab.path !== null && this.entryAt(tab.path) !== null)
  }

  startNaming(kind: NewKind, dir: string): boolean {
    if (this.panel !== 'tree' || !this.tree) return false

    this.cancelNaming()

    const path = joinPath(dir, this.freeName(dir, PLACEHOLDER[kind]))
    this.showEntry(this.freshEntry(path, false))
    if (!samePath(dir, this.activeSpace?.root)) this.device.expand(dir)
    this.naming = { path, appending: false, making: kind }

    return true
  }

  async makeNamed(name: string) {
    const naming = this.naming
    if (!naming?.making) return

    this.naming = null
    this.hideEntry(naming.path)

    const dir = folderOf(naming.path)
    if (naming.making === 'canvas') await this.createCanvas(dir, name)
    else if (naming.making === 'pages') await this.createPages(dir, name)
    else if (naming.making === 'web') await this.createWebsite(dir, name)
    else if (naming.making === 'database')
      await (await import('./views/new-database')).createDatabase(dir, name)
    else if (naming.making !== 'chat') await this.createNote(dir, name)
    else if (!__EVEN_PLUGIN__) await (await import('./chats/view/open')).makeChat(dir, name)
  }

  cancelNaming() {
    const naming = this.naming
    this.naming = null
    if (naming?.making) this.hideEntry(naming.path)
  }

  private keepNaming() {
    const naming = this.naming
    if (!naming) return

    if (naming.making) {
      this.showEntry(this.freshEntry(naming.path, false))
    } else if (!entryAt(this.tree, naming.path)) {
      this.naming = null
    }
  }

  namesBeside(path: string): string[] {
    const folder = entryAt(this.tree, folderOf(path))
    return (folder?.children ?? [])
      .filter((one) => !samePath(one.path, path))
      .map((one) => one.name)
  }

  async rename(path: string, name: string) {
    const clean = name.trim()
    if (!clean || clean.includes('/') || clean.includes('\\')) return

    const target = joinPath(folderOf(path), clean)
    if (sameSpelling(target, path) || !(await this.writableAt(path))) return

    await this.saving.holdingUnder(path, () => this.renameFile(path, target, true))
  }

  holdingUnder(path: string, run: () => Promise<void>): Promise<void> {
    return this.saving.holdingUnder(path, run)
  }

  holdingWrites<T>(path: string, run: () => Promise<T>, stalled: () => Promise<T>): Promise<T> {
    return this.saving.holdingWrites(path, run, stalled)
  }

  private async renameFile(path: string, target: string, undoable: boolean, hold = false) {
    const { moving } = await import('./views/moving')
    await moving(target, () => this.renamingFile(path, target, undoable, hold))
  }

  private async renamingFile(path: string, target: string, undoable: boolean, hold: boolean) {
    const kind = this.kindAt(path)

    this.showMove(path, target)
    if (undoable) this.naming = null

    try {
      await this.renameOnDisk(path, target, kind, hold ? { hold } : {})
    } catch (error) {
      await this.loadTree()
      throw error
    }

    const rewrote = await this.retargetMoved(path, target)
    if (undoable) {
      this.undone.record({
        kind: 'rename',
        from: path,
        to: target,
        ...(rewrote ? { rewrote } : {}),
      })
    }

    const note = this.opened.at(path)
    if (note) {
      note.flush()
      const was = `# ${shownName(nameOf(path))}`
      if (undoable && (note.text === was || note.text.startsWith(was + '\n'))) {
        note.replace(`# ${shownName(nameOf(target))}${note.text.slice(was.length)}`, note.dirty)
        note.dirty = true
        this.saving.owed(note)
      }
    }

    await this.fileMoved(path, target, kind)
    await this.loadTree()
    this.persist()
  }

  async renameOnDisk(from: string, to: string, kind: Kind, how: { hold?: boolean } = {}) {
    const op = {
      op: 'moved',
      from,
      to,
      kind,
      root: this.rootHolding(from),
      into: this.rootHolding(to),
    } as const
    await this.fileOps.doing(op, () =>
      inFileTurn(from, () => invoke('rename_note', { from, to, ...how })),
    )
  }

  private async retargetMoved(from: string, to: string): Promise<boolean> {
    try {
      return (await this.retarget(from, to, { moved: true })) > 0
    } catch (error) {
      log('error', `links to ${from} not rewritten after its move to ${to} - ${String(error)}`)
      return false
    }
  }

  private kindAt(path: string): 'file' | 'folder' {
    return this.entryAt(path)?.is_dir === true ? 'folder' : 'file'
  }

  async fileMoved(from: string, to: string, kind: Kind) {
    const root = kind === 'space' ? from : this.rootHolding(from)
    const into = kind === 'space' ? to : this.rootHolding(to)
    await this.fileOps.tell({ op: 'moved', from, to, kind, root, into })
  }

  async fileGone(path: string, kind: Kind, back?: string) {
    const root = this.rootHolding(path)
    await this.fileOps.tell({ op: 'removed', path, kind, root, ...(back ? { back } : {}) })
  }

  async fileCame(
    path: string,
    kind: 'file' | 'folder',
    key?: string,
    back?: string,
    putBack = !!back,
  ) {
    const root = this.rootHolding(path)
    await this.fileOps.tell({
      op: 'created',
      path,
      kind,
      root,
      ...(key ? { key } : {}),
      ...(back ? { back } : {}),
      ...(putBack ? { putBack } : {}),
    })
  }

  rootHolding(path: string | null): string | null {
    if (path === null) return this.activeSpace?.root ?? null
    const holding = this.spaces.find((one) => within(one.root, path) !== null)
    return holding?.root ?? this.activeSpace?.root ?? null
  }

  async remove(path: string, isFolder: boolean, source?: string) {
    if (this.keepsArchived(path) || !(await this.writableAt(path))) return

    await this.undone.batch(async () => {
      this.hideEntry(path)

      const kept = await this.bin(path, isFolder, { source })
      if (kept) this.undone.record({ kind: 'delete', path, ...kept })

      await this.fileGone(path, isFolder ? 'folder' : 'file', kept?.trashId ?? kept?.back)
      await this.loadTree()
      await this.unnest(folderOf(path))
    })
  }

  async bin(path: string, isFolder: boolean, how: Binning = {}): Promise<Kept | null> {
    const { source, madeHere = false } = how
    this.saving.wordsNow()
    await Promise.race([this.saving.settled(), waited(GIVE_UP)])
    const words = !isFolder && !isPdfTarget(path)
    let content: string | null = null
    if (words) {
      content = await invoke<string>('read_note', { path }).catch(() => null)
      if (content) await invoke('snapshot_note', { path, content, source }).catch(() => undefined)
    }

    const unread = words && content === null && !keptAway.at(path)
    const toAccount =
      account.signedIn &&
      !madeHere &&
      !unread &&
      !(!isFolder && isPagesTarget(path)) &&
      (await this.accountHolds(path, isFolder))
    const held =
      toAccount && isFolder ? await (await import('./workspace/undoing')).heldIn(path) : null

    const gone = {
      op: 'removed',
      path,
      kind: isFolder ? 'folder' : 'file',
      root: this.rootHolding(path),
    } as const
    try {
      if (toAccount) {
        const back = crypto.randomUUID()
        await this.fileOps.doing({ ...gone, back }, () =>
          inFileTurn(path, () => invoke(isFolder ? 'delete_folder' : 'delete_note', { path })),
        )
        if (isFolder) return held && { content: '', folder: true, ...held, back }
        return words ? { content: content ?? '', back } : null
      }
      let trashId = ''
      await this.fileOps.doing(gone, async () => {
        const entry = await inFileTurn(path, () =>
          invoke<{ id: string }>('trash_item', {
            path,
            kind: isFolder ? 'folder' : 'note',
          }),
        )
        trashId = entry.id
        return entry.id
      })
      return { content: content ?? '', trashId, ...(isFolder ? { folder: true } : {}) }
    } catch (error) {
      await this.loadTree()
      throw error
    }
  }

  private async accountHolds(path: string, isFolder: boolean): Promise<boolean> {
    if (!isFolder && !isMarkdownPath(path)) return false
    const root = this.rootHolding(path)
    if (!root) return false
    const { sync } = await import('./sync.svelte')
    const id = sync.remoteIdFor(root)
    if (account.spaces.find((one) => one.id === id)?.role !== 'owner') return false
    if (!isFolder) return sync.holds(path)
    const { accountHoldsAll } = await import('./workspace/undoing')
    return accountHoldsAll(path, (one, how) => sync.holds(one, how))
  }

  async undoFileAction(only?: FileAction) {
    await this.inTurn(async () => {
      if (!(await this.landedFor(() => void this.undoFileAction(only)))) return
      if (only && this.undone.last !== only) return
      const { undoLastFileAction } = await import('./workspace/undoing')
      await undoLastFileAction(this)
    })
  }

  async redoFileAction() {
    await this.inTurn(async () => {
      if (!(await this.landedFor(() => void this.redoFileAction()))) return
      const { redoLastFileAction } = await import('./workspace/redoing')
      await redoLastFileAction(this)
    })
  }

  private async landedFor(again: () => void): Promise<boolean> {
    if (await this.undone.landed()) return true
    const { failed } = await import('./views/failed.svelte')
    failed.tell(again, true)
    return false
  }

  private turn: Promise<void> = Promise.resolve()
  private inTurn(work: () => Promise<void>): Promise<void> {
    this.turn = this.turn.then(work, work)
    return this.turn
  }

  async arrived(path: string) {
    const waiting = this.tabs.filter((tab) => tab.coming && samePath(tab.path, path))
    if (!waiting.length) return

    const content = await invoke<string>('read_note', { path }).catch(() => null)
    if (content === null) return

    this.reload(path, content)
    for (const tab of waiting) tab.coming = false
  }

  reload(path: string, content: string) {
    this.opened.at(path)?.replace(content, false)
  }

  async retarget(from: string, to: string, how: Retargeting = {}): Promise<number> {
    const root = this.rootHolding(from)
    if (!root) return 0

    const touched = await links.retarget(from, to, root, (path) => this.documentAt(path), how)

    this.flush()
    for (const note of this.documents) {
      if (!note.path || note.dirty) continue

      const path = note.path
      const holding = note.arrivals
      const revision = note.revision
      const fresh = await invoke<string>('read_note', { path }).catch(() => null)
      if (fresh === null) continue
      if (!samePath(note.path, path) || note.arrivals !== holding || note.revision !== revision) {
        continue
      }

      if (fresh !== note.text) note.replace(fresh, false)
    }

    return touched
  }

  async followLink(jump: NoteJump, ask: LinkAsk = 'plain', from?: string | null) {
    const source = from === undefined ? (this.active?.path ?? null) : from
    const root = this.rootHolding(source)
    if (!root) return
    if (ask === 'aside') {
      await this.followAside(jump, root, source)
      return
    }
    const how = howFor(ask)

    if (isPdfTarget(jump.target)) {
      if (jump.path) await this.openPdf(insideSpace(root, jump.path), jump.page, how)
      return
    }

    if (isPagesTarget(jump.target)) {
      if (jump.path) await this.openPages(insideSpace(root, jump.path), jump.page, how)
      return
    }

    if (isCanvasTarget(jump.target)) {
      if (jump.path) await this.openCanvas(insideSpace(root, jump.path), how)
      return
    }

    const path = jump.path
      ? insideSpace(root, jump.path)
      : await this.linkedOrMade(jump, root, source)
    if (!path) return

    if (isWebTarget(path) || links.urlOf(path) !== null) {
      await this.openWeb(path, how)
      return
    }

    await this.open(path, how)
    this.landOn(path, jump)
  }

  private async followAside(jump: NoteJump, root: string, source: string | null) {
    const path = jump.path
      ? insideSpace(root, jump.path)
      : isTabFile(jump.target)
        ? null
        : await this.linkedOrMade(jump, root, source)
    if (!path) return

    await this.openAside(path)
    this.landOn(path, jump)
  }

  private landOn(asked: string, jump: NoteJump) {
    if (jump.heading === null && jump.block === null) return

    const path = this.spelled(asked)
    const doc = this.tabs.find((tab) => samePath(tab.path, path))?.doc ?? ''
    const line = lineOfTarget(doc, jump)
    if (line !== null) this.goto = { path, line }
  }

  goto = $state<{ path: string; line: number } | null>(null)

  private async linkedOrMade(
    jump: NoteJump,
    root: string,
    source: string | null,
  ): Promise<string | null> {
    const known = await links.targetWhenRead(source, { kind: 'wikilink', target: jump.target })
    return known === null ? this.makeLinked(jump.target, root, source) : insideSpace(root, known)
  }

  private async makeLinked(
    target: string,
    root: string,
    source: string | null,
  ): Promise<string | null> {
    const slashed = target.replace(/[\\]/g, '/')
    if (slashed.trimStart().startsWith('//')) return null
    const clean = slashed.replace(/^\/+|\/+$/g, '')
    if (!clean) return null

    const inside = source === null ? null : withinSpace(root, source)
    const here = inside === null || slashed.trimStart().startsWith('/') ? '' : folderOf(inside)
    const relative = clean.includes('/') || !here ? clean : `${here}/${clean}`

    const safe = insideOnly(isMarkdownPath(relative) ? relative : `${relative}.md`)
    if (safe === null) return null

    const path = insideSpace(root, safe)
    if (await onDisk(path)) return path

    if (!(await this.writableAt(path))) return null
    if (isAgentsName(nameOf(path))) {
      void import('./reserved-name.svelte').then((one) => one.reservedName.tell(root))
      return null
    }
    const content = `# ${noteName(relative)}\n\n`
    await writeFile(path, content)
    await this.loadTree()

    return path
  }

  async mergeInto(from: string, into: string) {
    await composing.mergeInto(this, from, into)
  }

  async splitAtCaret(at: number) {
    await composing.splitAtCaret(this, at)
  }

  async extractSelection(from: number, to: number) {
    await composing.extractSelection(this, from, to)
  }

  async createUniqueNote(format: string, folder?: string) {
    const dir = folder ?? this.activeSpace?.root
    if (!dir || !(await this.writableAt(dir))) return

    const name = await this.freeNameOnDisk(dir, `${noteId(format)}.md`)

    const path = joinPath(dir, name)
    const content = '# '

    this.showEntry(this.freshEntry(path, false))
    if (!samePath(dir, this.activeSpace?.root)) this.device.expand(dir)

    const note = this.document({
      kind: 'note',
      path,
      name: nameOf(path),
      text: content,
      dirty: false,
    })
    const tab = new Tab(note, this.panes.focusedId)
    tab.cursor = content.length
    this.add(tab)
    this.showNote()
    this.remember(path)
    this.dropScaffolding(tab)
    this.startRenaming(path, true)

    await writeFile(path, content)
    await this.loadTree()
    this.persist()
  }

  get undoLabel(): string | null {
    return this.undone.label
  }

  get canRedo(): boolean {
    return this.undone.canRedo
  }

  async duplicate(path: string) {
    await this.duplicateMany([path])
  }

  private get sides(): Sides {
    return {
      panel: this.panel,
      rightPanel: this.rightPanel,
      right: this.rightHere,
      covered: pad.on,
    }
  }

  private set sides(next: Sides) {
    this.panel = next.panel
    this.rightPanel = next.rightPanel
    if (next.panel) this.lastLeft = next.panel
    if (!this.phone) this.right = next.right
    if (next.rightPanel) this.lastRight = next.rightPanel
    if (pad.on && !next.covered) pad.hide()
    this.panelChosen = true
    this.persist()
  }

  private get phone(): boolean {
    return viewport.device === 'phone'
  }

  private get rightHere(): Panel[] {
    return this.phone ? panels.phoneRight(this.right) : this.right
  }

  get reopens(): Panel {
    return this.phone && this.offers(this.lastLeft) ? this.lastLeft : 'tree'
  }

  sideOf(panel: Panel): PanelSide {
    return panels.sideOf(this.rightHere, panel)
  }

  openOn(side: PanelSide): Panel | null {
    const open = panels.openOn(this.sides, side)
    return open && this.offers(open) ? open : null
  }

  panelsOn(side: PanelSide, every: readonly Panel[]): Panel[] {
    return panels.panelsOn(this.rightHere, side, every).filter((one) => this.offers(one))
  }

  offers(panel: Panel): boolean {
    return panel !== 'ask' || !viewport.touch
  }

  get nextRight(): Panel | null {
    const last = this.lastRight
    const right = this.rightHere.filter((one) => this.offers(one))
    const open = this.rightPanel && this.offers(this.rightPanel) ? this.rightPanel : null
    return open ?? (last && right.includes(last) ? last : right[0]) ?? null
  }

  showPanel(next: Panel) {
    if (!this.offers(next)) return
    this.unfill()
    if (this.openOn(this.sideOf(next)) === next) return

    this.sides = panels.showing(this.sides, next)
  }

  togglePanel(next: Panel) {
    if (!this.offers(next)) return
    if (this.unfill() && this.openOn(this.sideOf(next)) === next) return
    this.sides = panels.showing(this.sides, next)
  }

  private unfill(): boolean {
    if (this.panes.fills === null) return false
    this.panes.fills = null
    return true
  }

  closePanel(side: PanelSide = 'left') {
    if (!this.openOn(side)) return

    this.sides = panels.closing(this.sides, side)
  }

  movePanel(panel: Panel, side: PanelSide) {
    this.sides = panels.moving(this.sides, panel, side)
  }

  get rightShows(): Panel | 'scratchpad' | null {
    return pad.on ? 'scratchpad' : this.openOn('right')
  }

  private rightLast: Panel | 'scratchpad' | null = null

  showRight(what: Panel | 'scratchpad', take = true) {
    if (what !== 'scratchpad') {
      this.showPanel(what)
      return
    }
    this.unfill()
    if (!pad.on) pad.show(take)
  }

  closeRight() {
    const shows = this.rightShows
    if (shows === null) return
    this.rightLast = shows
    this.sides = { ...this.sides, rightPanel: null, covered: false }
  }

  toggleSidebar(side: PanelSide = 'left') {
    if (tabOverview.open) return
    if (side === 'right') {
      if (this.unfill() && this.rightShows !== null) return
      if (this.rightShows !== null) {
        this.closeRight()
        return
      }
      if (this.rightLast === 'scratchpad') {
        this.showRight('scratchpad')
        return
      }
      const next = this.nextRight
      if (next) this.showPanel(next)
      return
    }
    if (this.unfill() && this.openOn(side)) return

    this.panel = this.panel ? null : this.reopens
    this.panelChosen = true
    this.persist()
  }

  split(along: Along, tabId?: string) {
    if (viewport.touch) return

    const tab = tabId ? this.tabs.find((one) => one.id === tabId) : this.active
    if (!tab) return

    const made = this.panes.split(along, tab.paneId)
    if (!made) return

    const beside = new Tab(tab.note, made.id)
    beside.cursor = tab.cursor
    beside.scroll = tab.scroll
    beside.anchor = tab.anchor
    beside.folds = tab.folds
    beside.source = tab.source

    this.add(beside)
    this.persist()
  }

  canDuplicateTab(tab: Tab): boolean {
    return !viewport.touch && tab.kind !== 'graph'
  }

  canSplit(along: Along, tabId?: string): boolean {
    if (viewport.touch) return false

    const tab = tabId ? this.tabs.find((one) => one.id === tabId) : this.active
    return !!tab && this.panes.splittable(along, tab.paneId)
  }

  moveTab(id: string, paneId: string, at: number | null = null) {
    const tab = this.tabs.find((one) => one.id === id)
    if (!tab || !this.panes.at(paneId)) return

    const from = tab.paneId
    if (from === paneId && at === null) return

    const was = this.tabsIn(from).findIndex((one) => one.id === id)
    tab.paneId = paneId
    this.tabs = this.placed(tab, paneId, at)

    if (from !== paneId) {
      const left = this.tabsIn(from)
      if (!paneStays(left.length, this.showing(from))) this.closePaneOf(from)
      else if (this.panes.at(from)?.activeTabId === id) {
        this.panes.activate(
          from,
          this.panes.successorOf(
            left.map((one) => one.id),
            was,
          ),
        )
      }
    }

    this.activeTabId = id
    this.persist()
  }

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

  canMoveToOtherPane(id: string): boolean {
    const tab = this.tabs.find((one) => one.id === id)
    if (!tab || viewport.touch) return false

    return this.panes.count > 1 || this.canLand('right', tab.paneId, id)
  }

  async dropNotes(paths: string[], landing: Landing) {
    if (!this.panes.at(landing.paneId)) return
    this.panes.focus(landing.paneId)

    const opened: string[] = []
    let at = landing.kind === 'strip' ? landing.at : null

    for (const path of paths) {
      const before = this.active
      await this.openEntry(path)
      const tab = this.active
      if (!tab || (tab === before && !samePath(tab.path, path))) continue

      this.moveTab(tab.id, landing.paneId, at)
      if (at !== null) at += 1
      opened.push(tab.id)
    }

    if (landing.kind === 'strip' || landing.zone === 'middle' || !opened.length) return

    const made = this.panes.split(alongOf(landing.zone), landing.paneId, madeFirst(landing.zone))
    if (made) for (const id of opened) this.moveTab(id, made.id)
  }

  async openAside(path: string) {
    const from = this.panes.focusedId
    if (viewport.touch || this.instructionsAt(path) || !this.panes.splittable('row', from)) {
      await this.openEntry(path)
      return
    }

    const open = this.tabs.find((one) => samePath(one.path, path))
    if (!open) {
      await this.dropNotes([path], { kind: 'pane', paneId: from, zone: 'right' })
      return
    }
    if (open.kind === 'web') {
      this.showTab(open.note)
      return
    }

    const made = this.panes.split('row', from)
    if (!made) return

    this.add(new Tab(open.note, made.id))
    this.persist()
  }

  canLand(side: Side, paneId: string, tabId: string | null): boolean {
    if (viewport.touch || !this.panes.splittable(alongOf(side), paneId)) return false

    const tab = tabId === null ? null : this.tabs.find((one) => one.id === tabId)
    return !(tab?.paneId === paneId && this.tabsIn(paneId).length < 2)
  }

  async closePane(paneId: string = this.panes.focusedId) {
    if (this.panes.count < 2) return

    const tabs = this.heldIn(paneId)
    if (!(await this.mayClose(tabs))) return

    this.closeEach(
      tabs.map((tab) => tab.id),
      true,
      Date.now(),
    )
  }

  twins(paneId: string): string[] {
    const note = this.showing(paneId)?.note
    if (!note) return []

    return this.panes.all
      .filter((one) => one.id !== paneId && this.showing(one.id)?.note === note)
      .map((one) => one.id)
  }

  toggleLink(paneId: string) {
    const on = !(this.panes.at(paneId)?.linked ?? false)
    for (const id of [paneId, ...this.twins(paneId)]) this.panes.setLinked(id, on)
  }

  canStack(paneId: string = this.panes.focusedId): boolean {
    if (viewport.touch) return false

    return this.tabsIn(paneId).filter((tab) => tab.kind === 'note' && !tab.reading).length > 1
  }

  stacked(paneId: string = this.panes.focusedId): boolean {
    return this.panes.at(paneId)?.stacked ?? false
  }

  toggleStacked(paneId: string = this.panes.focusedId) {
    this.panes.setStacked(paneId, !this.stacked(paneId))
    this.persist()
  }

  collapsePanes() {
    if (this.panes.count < 2) return

    const kept = this.panes.focusedId
    for (const tab of this.tabs) if (this.panes.at(tab.paneId)) tab.paneId = kept

    this.panes.collapse()
    this.persist()
  }

  saveLayout(name: string) {
    this.layouts.save(name, this.layout())
  }

  async useLayout(name: string) {
    const layout = this.layouts.of(name)
    if (!layout) return
    const kept = panesOf(layout.frame).flatMap((pane) => pane.tabs.map((tab) => tab.path))
    const going = this.tabs.filter(
      (tab) =>
        this.panes.at(tab.paneId) &&
        !tab.dirty &&
        (tab.path === null || !kept.some((path) => samePath(path, tab.path))),
    )
    if (!(await this.mayClose(going))) return
    await this.applyLayout(layout)
  }
}

export const workspace = new Workspace()

links.archivedIn = (root) => workspace.archive.keysOf(root)
links.spaceOf = (path) => workspace.rootHolding(path)
links.lockedAt = (path) => workspace.protection.locked(path)
links.locksSeen = () => workspace.protection.seen
