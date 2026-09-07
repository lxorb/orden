/** The bookmarks of a space: the notes, folders, headings and searches kept in
 *  the row above the file list.
 *
 *  A bookmark says where it points the way a link does, relative to the space,
 *  never as a path on this disk, because the list travels: signed in it lives
 *  on the account and every machine reads the same one. Signed out it stays
 *  here, the way the pins it grew out of did.
 *
 *  Kept per space, so two spaces cannot crowd each other out of one list and a
 *  space that goes takes its bookmarks with it. */

import { isMarkdownPath, relativeTo } from '../space-paths'
import { isRecord, isString, stored, stringList } from '../stored'

const STORAGE_KEY = 'nib:bookmarks'

/** What pins were kept under. Read once and dropped; see `migrate`. */
const PINNED_KEY = 'nib:pinned'

/** More than anyone keeps above a file list. The service holds an account to
 *  the same number, so a list that fits here fits there. */
export const MOST_BOOKMARKS = 60

export const BOOKMARK_KINDS = ['note', 'folder', 'heading', 'search'] as const
type BookmarkKind = (typeof BOOKMARK_KINDS)[number]

export interface Bookmark {
  kind: BookmarkKind
  /** The note or folder it points at, relative to the space. Empty for a
   *  search, which points at no file. */
  path: string
  /** The heading a heading bookmark names, or the words a search looks for.
   *  Empty for a note or a folder. Always a string rather than an optional
   *  field, so one shape serves the storage, the wire and the comparison
   *  below. */
  text: string
}

export function isBookmark(value: unknown): value is Bookmark {
  return (
    isRecord(value) &&
    BOOKMARK_KINDS.some((kind) => kind === value.kind) &&
    isString(value.path) &&
    isString(value.text)
  )
}

/** The bookmarks in an unknown, with whatever is not one left out. A list
 *  written by a newer build may hold a kind this one has never heard of, and
 *  that is a row it cannot draw. */
export function bookmarkList(value: unknown): Bookmark[] {
  if (!Array.isArray(value)) return []

  return value
    .filter(isBookmark)
    .map((one) => ({ kind: one.kind, path: one.path, text: one.text }))
    .slice(0, MOST_BOOKMARKS)
}

/** Two bookmarks are the same one when they point at the same thing. */
export function sameBookmark(one: Bookmark, other: Bookmark): boolean {
  return one.kind === other.kind && one.path === other.path && one.text === other.text
}

function sameList(one: readonly Bookmark[], other: readonly Bookmark[]): boolean {
  if (one.length !== other.length) return false

  return one.every((mark, at) => {
    const theirs = other[at]
    return !!theirs && sameBookmark(mark, theirs)
  })
}

/** The account's list, with anything this machine had and it has not added
 *  after it.
 *
 *  Run once per space and account: afterwards the account holds the one copy,
 *  because a union run on every pass would hand back a bookmark that another
 *  machine had deliberately removed. */
export function mergeBookmarks(theirs: Bookmark[], mine: Bookmark[]): Bookmark[] {
  const extra = mine.filter((one) => !theirs.some((held) => sameBookmark(held, one)))
  return [...theirs, ...extra].slice(0, MOST_BOOKMARKS)
}

/** True when `path` names something inside `root` rather than merely starting
 *  with the same letters: `Nib/Work` does not hold `Nib/Working`. */
function startsInside(root: string, path: string): boolean {
  return path.length > root.length && path.startsWith(root) && /[\\/]/.test(path[root.length] ?? '')
}

/** The pins an older build kept, as the bookmarks of the space each one is in.
 *
 *  A pin was a path on this disk and a bookmark is a path a space speaks, so a
 *  pin that belongs to none of the spaces at hand has nowhere to go and is
 *  dropped. Whether it named a note or a folder is read off its extension,
 *  which is what the file list would have gone by anyway. */
export function bookmarksFromPins(
  pins: readonly string[],
  roots: readonly string[],
): Record<string, Bookmark[]> {
  const out: Record<string, Bookmark[]> = {}
  // Longest first, so a space that sits inside another one claims its own pins.
  const deepest = [...roots].sort((one, other) => other.length - one.length)

  for (const pin of pins) {
    const root = deepest.find((one) => startsInside(one, pin))
    if (!root) continue

    const path = relativeTo(root, pin)
    const mark: Bookmark = { kind: isMarkdownPath(path) ? 'note' : 'folder', path, text: '' }
    out[root] = [...(out[root] ?? []), mark]
  }

  return out
}

/** One space's list, and which account it has already been reconciled with. */
interface Kept {
  list: Bookmark[]
  /** The account this list has been folded into, or null while there was none.
   *  A different account signing in on this machine merges again; the same one
   *  signing in twice does not, or a bookmark it dropped on another machine
   *  would be handed straight back to it. */
  account: string | null
}

function read(): Record<string, Kept> {
  const saved = stored(STORAGE_KEY)
  if (!isRecord(saved)) return {}

  const out: Record<string, Kept> = {}
  for (const [root, one] of Object.entries(saved)) {
    if (!isRecord(one)) continue
    out[root] = {
      list: bookmarkList(one.list),
      account: isString(one.account) ? one.account : null,
    }
  }

  return out
}

export class Bookmarks {
  private spaces = $state<Record<string, Kept>>(read())

  /** Which space the rows on screen belong to. A function rather than a value
   *  because the workspace decides that, and it changes as spaces are picked. */
  constructor(private readonly root: () => string | null) {}

  /** The open space's bookmarks, in the order they were put in. */
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

  /** In or out, whichever it is not. Bookmarking is one gesture, so it is one
   *  call, and the row answers in the frame the click happened in. */
  toggle(mark: Bookmark | null) {
    const root = this.root()
    if (!mark || root === null) return

    const held = this.of(root)
    const next = this.has(mark)
      ? held.filter((one) => !sameBookmark(one, mark))
      : [...held, mark].slice(0, MOST_BOOKMARKS)

    this.put(root, next)
  }

  /** Drags a row to another place in the list. Out-of-range indexes are what a
   *  drop that landed on nothing looks like, so they leave the order alone. */
  move(from: number, to: number) {
    const root = this.root()
    if (root === null) return

    const held = this.of(root)
    const mark = held[from]
    if (!mark || to < 0 || to >= held.length || from === to) return

    const rest = held.filter((_, at) => at !== from)
    this.put(root, [...rest.slice(0, to), mark, ...rest.slice(to)])
  }

  /** A note or folder in the open space, as a bookmark. Null for a row outside
   *  it, which is nothing this space can keep. */
  forEntry(entry: { path: string; is_dir: boolean }): Bookmark | null {
    const root = this.root()
    if (root === null || !startsInside(root, entry.path)) return null

    return { kind: entry.is_dir ? 'folder' : 'note', path: relativeTo(root, entry.path), text: '' }
  }

  /** One heading of a note, as a bookmark. `note` is already relative to the
   *  space, which is how the workspace names the note on screen. */
  forHeading(note: string | null, text: string): Bookmark | null {
    const words = text.trim()
    if (!note || !words) return null

    return { kind: 'heading', path: note, text: words }
  }

  forSearch(query: string): Bookmark | null {
    const words = query.trim()
    return words ? { kind: 'search', path: '', text: words } : null
  }

  /** Takes over what the account holds for one space, and answers with the list
   *  the account should be told about: this machine's own bookmarks the first
   *  time an account sees the space, nothing on the passes after that. */
  adopt(root: string, theirs: Bookmark[], accountId: string): Bookmark[] | null {
    // Read rather than trusted: the service is deployed on its own, so a build
    // of it older than this app answers with no bookmarks at all.
    const account = bookmarkList(theirs)
    const held = this.spaces[root]
    const first = held?.account !== accountId
    const list = first ? mergeBookmarks(account, held?.list ?? []) : account

    if (held && !first && sameList(held.list, list)) return null

    this.spaces = { ...this.spaces, [root]: { list, account: accountId } }
    this.write()

    return first && list.length > account.length ? list : null
  }

  /** Turns the pins an older build kept into bookmarks. Silent, and once: a
   *  pinned note simply is a bookmarked one now. */
  migrate(roots: readonly string[]) {
    const pins = stringList(stored(PINNED_KEY))
    if (!pins) return

    // Dropped whatever comes of it, so a pin that belonged to no space still
    // here does not have this run again on every launch.
    localStorage.removeItem(PINNED_KEY)

    const next = { ...this.spaces }
    for (const [root, pinned] of Object.entries(bookmarksFromPins(pins, roots))) {
      const kept = next[root]
      next[root] = {
        list: mergeBookmarks(kept?.list ?? [], pinned),
        account: kept?.account ?? null,
      }
    }

    this.spaces = next
    this.write()
  }

  private put(root: string, list: Bookmark[]) {
    this.spaces = { ...this.spaces, [root]: { list, account: this.spaces[root]?.account ?? null } }
    this.write()

    // Imported here rather than at the top: syncing reads the workspace this
    // store belongs to, and the two would import each other.
    void import('../sync.svelte').then(({ sync }) => sync.pushBookmarks(root))
  }

  private write() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.spaces))
  }
}
