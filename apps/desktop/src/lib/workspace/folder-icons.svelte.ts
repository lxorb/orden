/** The icons the folders of a space wear, where those folders have no note.
 *
 *  A note keeps its icon in its own front matter and a canvas under its `nib`
 *  key, which is what makes those icons the file's: they travel with it, into
 *  another vault and into Obsidian. A folder that holds a note of its own name is
 *  drawn as that note and keeps its icon there like any other note; what is left
 *  for this map is a folder that has no such note - one out of somebody's vault -
 *  which has no file anywhere to keep an icon in. See folder-notes.ts,
 *  chosen-icon.ts and docs/tree.md.
 *
 *  A dotfile in the folder would sync for free and survive a move without being
 *  told - but it puts a file in every folder somebody gave an icon to, and every
 *  other tool that walks the vault sees it. So the icon is kept beside the space
 *  instead.
 *
 *  So: one map per space, from the folder's path as the space speaks it to the
 *  icon's name. Nothing is added to anybody's folders, the map is the size of what
 *  was chosen rather than of the space, and it goes where the space's other
 *  settings already go - the account for a space the account knows, this machine
 *  for one it does not. A rename or a move rewrites the key, which is the one
 *  thing the dotfile would have got for free; see `moved`.
 *
 *  Paths are relative and `/`-separated, never a path on this disk, for the same
 *  reason a bookmark is: the map travels between machines, and one of them is
 *  Windows. `nib:bookmarks` is this store's twin in every respect, down to
 *  remembering which account a space's map has been folded into. */

import { relativeTo } from '../space-paths'
import { isRecord, isString, stored } from '../stored'
import { without, withOrWithout } from '../records'

export const STORAGE_KEY = 'nib:folder-icons'

/** How many folders of one space may wear an icon.
 *
 *  Higher than the bookmark limit by a lot, because these are not a list somebody
 *  reads: a big vault has hundreds of folders and no reason not to mark them all.
 *  The service holds an account to the same number, so a map that fits here fits
 *  there. */
export const MOST_FOLDER_ICONS = 400

/** How long a folder's path and an icon's name may be. The service's limits, so
 *  nothing is kept here that would be refused there. */
const LONGEST_PATH = 300
const LONGEST_NAME = 64

/** Whether a key names a folder inside its own space. The same reading the
 *  service does: a path on this disk, or one that climbs out of the space, is not
 *  something any machine could resolve. */
function insideSpace(path: string): boolean {
  return (
    !!path &&
    path.length <= LONGEST_PATH &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !path.split('/').includes('..')
  )
}

/** The map in an unknown, with whatever is not a folder and an icon left out.
 *  Written by a newer build, by an older one, or by hand: what reads as a pair is
 *  kept and the rest is dropped, the way every other store here reads itself. */
export function folderIconMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}

  const out: Record<string, string> = {}
  for (const [path, name] of Object.entries(value)) {
    if (Object.keys(out).length >= MOST_FOLDER_ICONS) break
    if (!insideSpace(path) || !isString(name)) continue

    const said = name.trim()
    if (said && said.length <= LONGEST_NAME) out[path] = said
  }

  return out
}

/** One space's map, and which account it has already been reconciled with. */
interface Kept {
  icons: Record<string, string>
  /** The colour each stroked icon is drawn in, where one was chosen. A second map
   *  because it is the rarer of the two, and because the account holds the icons and
   *  not yet the colours: a folder's colour is this device's until there is a column
   *  for it, the way a space's icon was until there was one. */
  colors: Record<string, string>
  /** The account this map has been folded into, or null while there was none. A
   *  different account signing in on this machine merges again; the same one
   *  signing in twice does not, or an icon it took away on another machine would
   *  be handed straight back to it. */
  account: string | null
}

function read(): Record<string, Kept> {
  const saved = stored(STORAGE_KEY)
  if (!isRecord(saved)) return {}

  const out: Record<string, Kept> = {}
  for (const [root, one] of Object.entries(saved)) {
    if (!isRecord(one)) continue
    out[root] = {
      icons: folderIconMap(one.icons),
      colors: folderIconMap(one.colors),
      account: isString(one.account) ? one.account : null,
    }
  }

  return out
}

/** Two maps as one. */
function same(one: Record<string, string>, other: Record<string, string>): boolean {
  const keys = Object.keys(one)
  return keys.length === Object.keys(other).length && keys.every((key) => one[key] === other[key])
}

export class FolderIcons {
  private spaces = $state<Record<string, Kept>>(read())

  /** Which space the rows on screen belong to. A function rather than a value
   *  because the workspace decides that, and it changes as spaces are picked. */
  constructor(private readonly root: () => string | null) {}

  /** Reads the map again, once the storage that holds it has answered.
   *
   *  For the plugin. This map is one entry per folder somebody gave an icon to, so it
   *  grows with the vault rather than with the settings, and a packed plugin keeps
   *  anything that shape in the phone app's own store - which answers seconds after
   *  this store was built and read an empty one. See lib/even/local.ts, and `reread`
   *  in device.svelte.ts, which is the same fact about the same storage.
   *
   *  Filled in per space, never replaced: what is here was written this launch and is
   *  newer than anything storage is only now getting round to mentioning. */
  reread(): void {
    const held = read()
    const spaces = { ...this.spaces }
    let grew = false

    for (const [root, kept] of Object.entries(held)) {
      if (spaces[root]) continue

      spaces[root] = kept
      grew = true
    }

    if (grew) this.spaces = spaces
  }

  of(root: string): Record<string, string> {
    return this.spaces[root]?.icons ?? {}
  }

  private colorsOf(root: string): Record<string, string> {
    return this.spaces[root]?.colors ?? {}
  }

  /** What the folder at this path wears, as written, or null where it wears
   *  nothing.
   *
   *  Takes a path as the app holds one or as the space speaks it, because the
   *  surfaces that show a folder disagree: a row in the tree knows where the
   *  folder is on the disk, and a bookmark or a Move sheet knows it relative to
   *  the space. The same two readings `links.iconOf` takes. */
  iconOf(path: string): string | null {
    const root = this.root()
    if (root === null) return null

    return this.of(root)[relativeTo(root, path)] ?? null
  }

  /** The colour that folder's icon is drawn in, or null for the plain foreground. */
  tintOf(path: string): string | null {
    const root = this.root()
    if (root === null) return null

    return this.colorsOf(root)[relativeTo(root, path)] ?? null
  }

  /** Writes the icon a folder wears and the colour it is drawn in, or takes both
   *  away when `name` is null. */
  set(path: string, name: string | null, tint: string | null = null) {
    const root = this.root()
    if (root === null) return

    const at = relativeTo(root, path)
    if (!insideSpace(at)) return

    const held = this.of(root)
    const colour = name === null ? null : tint
    if ((held[at] ?? null) === name && (this.colorsOf(root)[at] ?? null) === colour) return
    if (name !== null && Object.keys(held).length >= MOST_FOLDER_ICONS && !(at in held)) return

    this.put(root, withOrWithout(held, at, name), withOrWithout(this.colorsOf(root), at, colour))
  }

  /** A folder that has been renamed or moved, with everything under it.
   *
   *  The one thing a dotfile inside the folder would have got for free, and the
   *  reason every path that changes has to say so: a key nobody rewrote is an
   *  icon that quietly stops being drawn. Called from the same three places
   *  `positions.move` is - a rename, a move, and the undo of either. */
  moved(from: string, to: string) {
    const root = this.root()
    if (root === null || from === to) return

    const was = relativeTo(root, from)
    const now = relativeTo(root, to)

    const rekeyed = (held: Record<string, string>) => {
      const next: Record<string, string> = {}
      let touched = false

      for (const [path, name] of Object.entries(held)) {
        const under = path === was || path.startsWith(`${was}/`)
        next[under ? now + path.slice(was.length) : path] = name
        touched ||= under
      }

      return touched ? next : null
    }

    const icons = rekeyed(this.of(root))
    if (icons) this.put(root, icons, rekeyed(this.colorsOf(root)) ?? this.colorsOf(root))
  }

  /** A folder that has gone, with everything under it. */
  gone(path: string) {
    const root = this.root()
    if (root === null) return

    const at = relativeTo(root, path)
    const held = this.of(root)
    const kept = (map: Record<string, string>) =>
      Object.fromEntries(
        Object.entries(map).filter(([one]) => one !== at && !one.startsWith(`${at}/`)),
      )

    const next = kept(held)
    if (Object.keys(next).length !== Object.keys(held).length) {
      this.put(root, next, kept(this.colorsOf(root)))
    }
  }

  /** A space folder that has been renamed, which re-keys the whole map at once:
   *  the map is kept under the root, and the root is what moved. */
  spaceMoved(from: string, to: string) {
    const held = this.spaces[from]
    if (!held || from === to) return

    this.spaces = { ...without(this.spaces, from), [to]: held }
    this.write()
  }

  /** Forgets a space's map, for a space that is no longer here. */
  forget(root: string) {
    if (!(root in this.spaces)) return

    this.spaces = without(this.spaces, root)
    this.write()
  }

  /** Takes over what the account holds for one space: this machine's own icons
   *  folded in the first time an account sees the space, and the account's map
   *  outright on every pass after that.
   *
   *  After the first contact the account holds the one copy, because a union run
   *  on every pass would hand back an icon another machine had deliberately taken
   *  away. Exactly what `bookmarks.adopt` does, and for the same reason. What the
   *  fold added is sent straight back up, so the account has it before the machine
   *  that had it is closed. */
  adopt(root: string, theirs: unknown, accountId: string) {
    // Read rather than trusted: the service is deployed on its own, so a build of
    // it older than this app answers with no folder icons at all.
    const account = folderIconMap(theirs)
    const held = this.spaces[root]
    const first = held?.account !== accountId
    const icons = first ? { ...account, ...(held?.icons ?? {}) } : account

    if (held && !first && same(held.icons, icons)) return

    this.spaces = {
      ...this.spaces,
      // The colours stay: the account does not hold them, so it has nothing to say
      // about them, and a folder whose icon came down from the account simply has
      // none until somebody here chooses one.
      [root]: { icons, colors: held?.colors ?? {}, account: accountId },
    }
    this.write()

    if (first && !same(icons, account)) void this.push(root)
  }

  private put(root: string, icons: Record<string, string>, colors: Record<string, string>) {
    this.spaces = {
      ...this.spaces,
      [root]: { icons, colors, account: this.spaces[root]?.account ?? null },
    }
    this.write()
    void this.push(root)
  }

  /** The space's map as it now stands, sent up so every other machine draws the
   *  same rows.
   *
   *  Signed out, in a space the account has never heard of, or in one shared to
   *  read, it stays on this machine: the first two because there is nowhere to
   *  send it yet, and the last because the account would refuse it anyway.
   *
   *  Sent from here rather than from the syncing loop, which is where the space's
   *  own icon is sent from, because this map is written by a gesture in the file
   *  list and there is nothing to wait for. Imported where it is used: the loop
   *  reads the workspace this store belongs to, and the two would import each
   *  other. */
  private async push(root: string) {
    const [{ account }, { api }, { sync }] = await Promise.all([
      import('../account.svelte'),
      import('../api'),
      import('../sync.svelte'),
    ])

    const token = account.token
    const spaceId = sync.remoteIdFor(root)
    if (!token || !spaceId) return
    if (account.spaces.find((one) => one.id === spaceId)?.role === 'read') return

    await api.saveFolderIcons(token, spaceId, this.of(root)).catch(() => undefined)
    await account.loadSpaces().catch(() => undefined)
  }

  private write() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.spaces))
  }
}
