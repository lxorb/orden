import { movedTo, relativeTo, samePath, within } from '../space-paths'
import { type Folded, type Folding, meet, readSpaces, without } from '../records'
import { isRecord, isString, keepJson } from '../stored'
import { type EntryIds, entryIds } from './entry-ids'
import { carried, moving } from './file-ops'

const STORAGE_KEY = 'orden:bookmarks'

export const MOST_BOOKMARKS = 60

export const BOOKMARK_KINDS = [
  'note',
  'folder',
  'heading',
  'search',
  'block',
  'group',
  'graph',
] as const
type BookmarkKind = (typeof BOOKMARK_KINDS)[number]

const POINTS_AT_A_FILE: ReadonlySet<BookmarkKind> = new Set(['note', 'folder', 'heading', 'block'])

export interface Bookmark {
  kind: BookmarkKind
  path: string
  text: string
  parent?: string
  view?: string
  id?: string
}

const LONGEST_ID = 64

const LONGEST_VIEW = 400

export function isBookmark(value: unknown): value is Bookmark {
  return (
    isRecord(value) &&
    BOOKMARK_KINDS.some((kind) => kind === value.kind) &&
    isString(value.path) &&
    isString(value.text) &&
    (value.parent === undefined || isString(value.parent)) &&
    (value.view === undefined || (isString(value.view) && value.view.length <= LONGEST_VIEW))
  )
}

function idIn(value: unknown): string | null {
  return isString(value) && value.length > 0 && value.length <= LONGEST_ID ? value : null
}

function freeGroupId(taken: readonly Bookmark[]): string {
  for (;;) {
    const id = `g${Math.random().toString(36).slice(2, 8)}`
    if (!taken.some((one) => one.kind === 'group' && one.path === id)) return id
  }
}

export function filedUnder(mark: Bookmark, parent?: string | null): Bookmark {
  const row = { ...mark }
  if (parent) row.parent = parent
  else delete row.parent
  return row
}

export function bookmarkList(value: unknown): Bookmark[] {
  if (!Array.isArray(value)) return []

  return value
    .filter(isBookmark)
    .map((one) => {
      const id = POINTS_AT_A_FILE.has(one.kind) ? idIn(one.id) : null
      return {
        kind: one.kind,
        path: one.path,
        text: one.text,
        ...(one.parent ? { parent: one.parent } : {}),
        ...(one.view ? { view: one.view } : {}),
        ...(id ? { id } : {}),
      }
    })
    .slice(0, MOST_BOOKMARKS)
}

export function located(
  root: string,
  list: readonly Bookmark[],
  ids: EntryIds,
  { moves = true }: { moves?: boolean } = {},
): Bookmark[] {
  const found = list.map((mark) => {
    if (!POINTS_AT_A_FILE.has(mark.kind)) return mark

    const file = fileOf(mark)
    const here = ids.idOf(root, file)
    if (here !== null) return here === mark.id ? mark : { ...mark, id: here }
    if (!mark.id || !moves) return mark

    const there = ids.pathOf(root, mark.id)
    return there === null || there === file
      ? mark
      : { ...mark, path: there + mark.path.slice(file.length) }
  })
  return found.filter((one, at) => found.findIndex((other) => sameBookmark(one, other)) === at)
}

function sameIds(one: readonly Bookmark[], other: readonly Bookmark[]): boolean {
  return one.length === other.length && one.every((mark, at) => mark.id === other[at]?.id)
}

export function isTile(mark: Bookmark): boolean {
  return mark.kind === 'note' && !mark.parent
}

function fileOf(mark: Bookmark): string {
  const cut = mark.kind === 'block' ? mark.path.indexOf('#') : -1
  return cut === -1 ? mark.path : mark.path.slice(0, cut)
}

export function sameBookmark(one: Bookmark, other: Bookmark): boolean {
  return one.kind === other.kind && samePath(one.path, other.path) && one.text === other.text
}

function sameList(one: readonly Bookmark[], other: readonly Bookmark[]): boolean {
  if (one.length !== other.length) return false

  return one.every((mark, at) => {
    const theirs = other[at]
    return !!theirs && sameBookmark(mark, theirs)
  })
}

export function mergeBookmarks(theirs: Bookmark[], mine: Bookmark[]): Bookmark[] {
  const extra = mine.filter((one) => !theirs.some((held) => sameBookmark(held, one)))
  return [...theirs, ...extra].slice(0, MOST_BOOKMARKS)
}

interface Kept extends Folded {
  list: Bookmark[]
  sent: boolean
}

function read(): Record<string, Kept> {
  return readSpaces(STORAGE_KEY, (one) => ({
    list: bookmarkList(one.list),
    sent: one.sent !== false,
  }))
}

const LISTS: Folding<Bookmark[]> = { fold: mergeBookmarks, same: sameList }

export class Bookmarks {
  private spaces = $state<Record<string, Kept>>(read())

  private get ids(): EntryIds | null {
    return entryIds()
  }

  offered: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly root: () => string | null,
    private readonly changed: () => void = () => undefined,
  ) {}

  get list(): Bookmark[] {
    const root = this.root()
    return root === null ? [] : this.of(root)
  }

  of(root: string): Bookmark[] {
    return this.spaces[root]?.list ?? []
  }

  has(mark: Bookmark | null): boolean {
    return !!mark && this.list.some((held) => sameBookmark(held, mark))
  }

  toggle(mark: Bookmark | null) {
    const root = this.root()
    if (!mark || root === null) return

    const held = this.of(root)
    const next = this.has(mark)
      ? held.filter((one) => !sameBookmark(one, mark))
      : [...held, mark].slice(0, MOST_BOOKMARKS)

    this.put(root, next)
  }

  toggleAll(marks: readonly Bookmark[]) {
    const root = this.root()
    if (!marks.length || root === null) return

    const held = this.of(root)
    const holds = (mark: Bookmark) => held.some((one) => sameBookmark(one, mark))
    const next = marks.every(holds)
      ? held.filter((one) => !marks.some((mark) => sameBookmark(one, mark)))
      : [...held, ...marks.filter((mark) => !holds(mark))].slice(0, MOST_BOOKMARKS)

    this.put(root, next)
  }

  move(from: number, to: number) {
    const root = this.root()
    if (root === null) return

    const held = this.of(root)
    const mark = held[from]
    if (!mark || to < 0 || to >= held.length || from === to) return

    const rest = held.filter((_, at) => at !== from)
    this.put(root, [...rest.slice(0, to), mark, ...rest.slice(to)])
  }

  addGroup(name: string): Bookmark | null {
    const root = this.root()
    const words = name.trim()
    if (root === null || !words) return null

    const held = this.of(root)
    if (held.length >= MOST_BOOKMARKS) return null

    const group: Bookmark = { kind: 'group', path: freeGroupId(held), text: words }
    this.put(root, [...held, group])
    return group
  }

  rename(mark: Bookmark, name: string) {
    const root = this.root()
    const words = name.trim()
    if (root === null || mark.kind !== 'group' || !words) return

    this.put(
      root,
      this.of(root).map((one) => (sameBookmark(one, mark) ? { ...one, text: words } : one)),
    )
  }

  remove(mark: Bookmark, root = this.root()) {
    if (root === null) return

    const held = this.of(root)
    const freed = held.find((one) => sameBookmark(one, mark))?.parent

    this.put(
      root,
      held
        .filter((one) => !sameBookmark(one, mark))
        .map((one) =>
          mark.kind === 'group' && one.parent === mark.path ? filedUnder(one, freed) : one,
        ),
    )
  }

  moveInto(mark: Bookmark, parent: string | null) {
    const root = this.root()
    if (root === null) return
    if (parent !== null && mark.kind === 'group' && this.holds(mark.path, parent)) return

    this.put(
      root,
      this.of(root).map((one) => (sameBookmark(one, mark) ? filedUnder(one, parent) : one)),
    )
  }

  moved(from: string, to: string, root = this.root(), into: string | null = root) {
    if (root === null || from === to) return

    const move = moving(from, to, root, into)
    const { was } = move
    if (!was) return

    const held = this.of(root)
    if (move.across) {
      const { left, went } = carried(
        held,
        move,
        (one) => (POINTS_AT_A_FILE.has(one.kind) ? fileOf(one) : null),
        ({ parent: _, ...one }, file) => ({
          ...one,
          path: file + one.path.slice(fileOf(one).length),
        }),
      )
      if (left.length === held.length) return
      this.put(root, left)
      if (!went.length) return
      const there = this.of(move.there)
      const fresh = went.filter(
        (one, at) =>
          !there.some((other) => sameBookmark(one, other)) &&
          went.findIndex((other) => sameBookmark(one, other)) === at,
      )
      this.put(move.there, [...there, ...fresh].slice(0, Math.max(there.length, MOST_BOOKMARKS)))
      return
    }

    const now = move.now ?? ''
    const next = held.map((one) => {
      if (!POINTS_AT_A_FILE.has(one.kind)) return one

      const file = fileOf(one)
      const moved = movedTo(file, was, now, root)
      return moved === null ? one : { ...one, path: moved + one.path.slice(file.length) }
    })

    if (sameList(held, next)) return
    this.put(
      root,
      next.filter((one, at) => next.findIndex((other) => sameBookmark(one, other)) === at),
    )
  }

  spaceMoved(from: string, to: string) {
    const kept = this.spaces[from]
    if (!kept || from === to) return

    this.spaces = { ...without(this.spaces, from), [to]: kept }
    this.write()
  }

  private holds(group: string, other: string): boolean {
    const held = this.list
    let at: string | undefined = other

    for (let steps = 0; at !== undefined && steps <= MOST_BOOKMARKS; steps++) {
      if (at === group) return true
      at = held.find((one) => one.kind === 'group' && one.path === at)?.parent
    }

    return false
  }

  forEntry(entry: { path: string; is_dir: boolean }): Bookmark | null {
    const root = this.root()
    if (root === null || !within(root, entry.path)) return null

    return { kind: entry.is_dir ? 'folder' : 'note', path: relativeTo(root, entry.path), text: '' }
  }

  forHeading(note: string | null, text: string): Bookmark | null {
    const words = text.trim()
    if (!note || !words) return null

    return { kind: 'heading', path: note, text: words }
  }

  forBlock(note: string | null, target: string, words: string): Bookmark | null {
    const said = target.trim()
    const label = words.trim()
    if (!note || !said.startsWith('#')) return null

    return { kind: 'block', path: `${note}${said}`, text: label || said }
  }

  forSearch(query: string): Bookmark | null {
    const words = query.trim()
    return words ? { kind: 'search', path: '', text: words } : null
  }

  forGraph(name: string, settings: unknown): Bookmark | null {
    const words = name.trim()
    if (!words) return null

    const view = JSON.stringify(settings)
    if (view.length > LONGEST_VIEW) return null

    return { kind: 'graph', path: '', text: words, view }
  }

  adopt(root: string, theirs: Bookmark[], accountId: string): Bookmark[] | null {
    const said = bookmarkList(theirs)
    const account = this.ids ? located(root, said, this.ids) : said
    const held = this.spaces[root]
    const met = meet(held, accountId, held?.list ?? [], account, LISTS)
    if (!met) {
      if (held && !sameIds(held.list, account)) {
        this.spaces = { ...this.spaces, [root]: { ...held, list: account } }
        this.write()
      }
      return null
    }

    this.spaces = {
      ...this.spaces,
      [root]: { list: met.value, account: accountId, sent: !met.tell },
    }
    this.write()

    return met.tell ? met.value : null
  }

  said(root: string, landed: boolean, list: readonly Bookmark[]) {
    const held = this.spaces[root]
    if (!held || held.sent === landed || (landed && !sameList(held.list, list))) return

    this.spaces = { ...this.spaces, [root]: { ...held, sent: landed } }
    this.write()
  }

  put(root: string, given: Bookmark[]) {
    const list = this.ids ? located(root, given, this.ids, { moves: false }) : given
    this.spaces = {
      ...this.spaces,
      [root]: { list, account: this.spaces[root]?.account ?? null, sent: false },
    }
    this.write()

    this.offered = import('../sync.svelte').then(({ sync }) => sync.pushBookmarks(root))
  }

  private write() {
    keepJson(STORAGE_KEY, this.spaces)
    this.changed()
  }
}
