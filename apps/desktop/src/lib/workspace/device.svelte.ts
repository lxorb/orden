/** What this machine remembers about the file list, as opposed to what the
 *  notes themselves say.
 *
 *  Which folders are open, which notes were opened lately, and the icon each
 *  space wears: all of it describes a view rather than a note, so it stays on
 *  the device and never travels with the account - with one exception, the
 *  icons, which the account does carry so a space looks the same on every
 *  machine. The rest is keyed by path, and a path is only meaningful on the
 *  machine that holds the folder.
 *
 *  The bookmarks above the file list started out here as pins and are next
 *  door now, in bookmarks.svelte.ts: they say what someone chose to keep, not
 *  how this machine happens to be looking at it, so they follow the account.
 *
 *  Kept out of the tree component because that one is rebuilt from scratch
 *  every time the folder is read again - on every save, rename and sync - and
 *  took the open folders with it each time. */

import { isBoolean, isString, recordOf, stored, stringList } from '../stored'
import { without, withOrWithout } from '../records'

export const RECENT_KEY = 'nib:recent'
export const ICONS_KEY = 'nib:icons'
/** The colour each of those icons is drawn in. Its own key rather than a second
 *  field in the one above, because that map is a map of strings that older builds
 *  read and write back, and a value that is not a string is a value they drop. */
export const ICON_TINTS_KEY = 'nib:icon-tints'
export const EXPANDED_KEY = 'nib:expanded'
export const TAGS_KEY = 'nib:expanded-tags'

/** Enough that a note opened this morning is still there, short enough that
 *  the list is worth reading. */
const RECENT_LIMIT = 15

export class DeviceView {
  /** Most recent first, no duplicates. */
  recent = $state<string[]>([])

  /** Which folders are open, by path. */
  expanded = $state<Record<string, boolean>>({})

  /** Which tags are open, by tag path. Its own record rather than a share of the
   *  one above: a tag `work/nib` and a folder called `work/nib` are two
   *  different things to open, and one would otherwise open the other. */
  expandedTags = $state<Record<string, boolean>>({})

  /** The icon a space wears, keyed by folder rather than by id so it survives
   *  the ids being handed out again on the next launch. */
  icons = $state<Record<string, string>>({})

  /** And the colour it is drawn in, where somebody chose one: the same keys, and
   *  empty for every space that wears its icon in the plain foreground. */
  iconTints = $state<Record<string, string>>({})

  constructor() {
    this.reread()
  }

  /** Reads all four out of storage.
   *
   *  Called again by the plugin, which is why it is a method at all. Emil, on his
   *  phone: *"I don't see the icons of the spaces on the Even Realities plugin right
   *  now."* The storage a packed plugin reads is not the page's own - a fresh port
   *  every launch, so the page's own is always empty - and the one that replaces it
   *  is seeded in two goes: a cookie, at once, with what decides the first paint,
   *  and the phone app's own store, seconds later, with everything. A field
   *  initialiser reads once and reads early, and what it read was the empty one.
   *
   *  Reading again rather than the store telling this: what the second seeding does
   *  is fill in keys nothing has written this launch, so what storage says and what
   *  this holds cannot disagree - see `fillFrom` in lib/even/local.ts. */
  reread(): void {
    this.recent = stringList(stored(RECENT_KEY)) ?? []
    this.expanded = recordOf(stored(EXPANDED_KEY), isBoolean)
    this.expandedTags = recordOf(stored(TAGS_KEY), isBoolean)
    this.icons = recordOf(stored(ICONS_KEY), isString)
    this.iconTints = recordOf(stored(ICON_TINTS_KEY), isString)
  }

  remember(path: string) {
    this.recent = [path, ...this.recent.filter((entry) => entry !== path)].slice(0, RECENT_LIMIT)
    localStorage.setItem(RECENT_KEY, JSON.stringify(this.recent))
  }

  forgetRecent() {
    this.recent = []
    localStorage.removeItem(RECENT_KEY)
  }

  isExpanded(path: string): boolean {
    return this.expanded[path] === true
  }

  toggleFolder(path: string) {
    this.expanded = this.isExpanded(path)
      ? without(this.expanded, path)
      : { ...this.expanded, [path]: true }

    localStorage.setItem(EXPANDED_KEY, JSON.stringify(this.expanded))
  }

  isTagOpen(path: string): boolean {
    return this.expandedTags[path] === true
  }

  toggleTag(path: string) {
    this.expandedTags = this.isTagOpen(path)
      ? without(this.expandedTags, path)
      : { ...this.expandedTags, [path]: true }

    localStorage.setItem(TAGS_KEY, JSON.stringify(this.expandedTags))
  }

  /** Opens a folder without closing one that is already open: making a note
   *  inside a closed folder should show it. */
  expand(path: string) {
    if (this.isExpanded(path)) return
    this.toggleFolder(path)
  }

  iconOf(root: string): string | null {
    return this.icons[root] ?? null
  }

  /** The colour that icon is drawn in, or null for the plain foreground. */
  tintOf(root: string): string | null {
    return this.iconTints[root] ?? null
  }

  setIcon(root: string, name: string | null, tint: string | null = null) {
    this.writeIcons(withOrWithout(this.icons, root, name))
    this.writeTints(withOrWithout(this.iconTints, root, name === null ? null : tint))
  }

  /** Carries a chosen icon over to a renamed folder. Without this a rename
   *  looks like a space that never had an icon, and it falls back to a letter. */
  moveIcon(from: string, to: string) {
    const icon = this.icons[from]
    if (!icon || from === to) return

    this.writeIcons({ ...without(this.icons, from), [to]: icon })

    const tint = this.iconTints[from]
    if (tint) this.writeTints({ ...without(this.iconTints, from), [to]: tint })
  }

  private writeIcons(next: Record<string, string>) {
    this.icons = next
    localStorage.setItem(ICONS_KEY, JSON.stringify(next))
  }

  private writeTints(next: Record<string, string>) {
    this.iconTints = next
    localStorage.setItem(ICON_TINTS_KEY, JSON.stringify(next))
  }
}
