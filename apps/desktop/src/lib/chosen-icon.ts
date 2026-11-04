/** The icon a row in the file list wears, wherever that icon is kept.
 *
 *  Four kinds of thing can wear one and each keeps it in the only place it has: a
 *  note in its front matter, a canvas under its `nib` key, a chat in its pointer, a
 *  folder in the space's own map, because a folder is not a file. Which of them a
 *  path is matters to whoever writes the icon and to nobody who draws it, so it is
 *  answered here once and every mark in the app asks this.
 *
 *  A path as the app holds one or as the space speaks it, since both stores read
 *  both. See file-icon.ts and workspace/folder-icons.svelte.ts for the writing, and
 *  icons.ts for what the value says.
 *
 *  **By the space the file is in, never by the open one.** The link index is a scan
 *  of the open space, so a tab, a bookmark or a search hit from another space asked
 *  it and got nothing: a note wore its chosen icon only while its own space was the
 *  open one (Emil, 2026-10-03). A path on the disk under another space's root is
 *  answered from what that file says, read once on its own (marks-elsewhere.svelte.ts),
 *  and a folder from that space's own map. A path the space speaks, with no root in
 *  front of it, is the open space's, which is the only space a caller holding one can
 *  mean. Every mark in the app asks here, so each of them follows. */

import { isChatTarget, isPagesTarget } from '@orden/markdown/links'
import type { FileMark } from './file-mark'
import { folderNote, isFolderNote } from './folder-notes'
import { brandIcon, readIcon, siteBrand } from './icons'
import { links } from './link-index.svelte'
import { elsewhere } from './marks-elsewhere.svelte'
import { folderOf, isMarkdownPath, samePath, withinSpace } from './space-paths'
import { pages, siteMark } from './web-tab/pages.svelte'
import { workspace } from './workspace.svelte'

/** Which key the space's map is asked under. For `A/A.md` that is `A/`, because
 *  the row wearing the mark is the folder and the note in one.
 *
 *  So an icon chosen on a folder that came out of somebody's vault, before that
 *  folder had a note at all, still dresses the row once somebody writes in it. The
 *  file wins wherever it says anything, and choosing an icon on such a row writes
 *  the file and takes the map's word away; see `setFileIcon`. */
function mapKey(path: string): string {
  return isFolderNote(path) ? folderOf(path) : path
}

/** The root of the space a path is on the disk in, where that is not the open space;
 *  null for one the open space speaks for. The longest root that holds it, so a space
 *  inside another's folder answers for its own files. */
function awayIn(path: string): string | null {
  let home: string | null = null
  for (const space of workspace.spaces) {
    if (withinSpace(space.root, path) === null) continue
    if (home === null || space.root.length > home.length) home = space.root
  }

  const open = links.rootOf() ?? workspace.activeSpace?.root ?? null
  return home === null || samePath(home, open) ? null : home
}

export function chosenIcon(path: string): string | null {
  // A chat keeps it in its pointer, which no scan reads; see marks-elsewhere.
  if (isChatTarget(path)) return elsewhere.of(path)?.icon ?? null
  const away = awayIn(path)
  if (away === null) return links.iconOf(path) ?? workspace.folderIcons.iconOf(mapKey(path))

  return elsewhere.of(path)?.icon ?? workspace.folderIcons.iconOf(mapKey(path), away)
}

/** Whether the page note at `path` was made from a PDF, and so wears its mark (#676):
 *  the open space's listing says (`paper` in tree.rs), and for a note it does not list,
 *  another space's, marks-elsewhere.svelte.ts asks the disk once. */
export function holdsPaper(path: string): boolean {
  if (__EVEN_PLUGIN__ || !isPagesTarget(path)) return false
  const listed = workspace.entryAt(path)
  if (listed) return listed.paper === true
  return elsewhere.of(path)?.paper === true
}

/** Whether the note at `path` says nothing yet (#1042): the scan's word for the open
 *  space's notes (`bare`, see `saysNothing` in scan-note.ts), and for another space's what that file says,
 *  read once on its own. Never a read of the file per row. */
function saysNothing(path: string): boolean {
  return awayIn(path) === null ? links.saysNothing(path) : elsewhere.of(path)?.bare === true
}

/** Whether a row is an empty page: a note that says nothing yet, or a folder with no
 *  note of its own, which is the note it would be before anybody writes in it. A `file`
 *  that is a file - `Notes.md.bak` - is neither. */
function isEmpty(mark: FileMark, path: string): boolean {
  if (mark === 'note') return saysNothing(path)
  return workspace.entryAt(path)?.is_dir === true
}

/** Whether the row a note or a folder is drawn as holds anything: for a note, whether it
 *  is its folder's own note and the folder has more in it; for a folder that has no note,
 *  whether it has anything at all. A folder the listing did not read into is taken to
 *  hold something, since it was left unread for holding too much. The open space's
 *  listing; another space's rows are not listed, and hold nothing as far as this knows. */
function holdsMore(path: string): boolean {
  const listed = workspace.entryAt(path)
  if (listed?.is_dir) return listed.unlisted === true || listed.children.length > 0
  if (!isMarkdownPath(path)) return false

  const folder = workspace.entryAt(folderOf(path))
  const own = folder ? folderNote(folder) : null
  if (!folder || !own || !samePath(own.path, path)) return false
  return folder.unlisted === true || folder.children.some((one) => !samePath(one.path, path))
}

/** What a file wears for what it is and where it came from, where its kind's own mark
 *  does not say it, and where nobody chose an icon for it.
 *
 *  - `mark`: a page note made from a PDF wears the PDF's (#676); a page note started
 *    blank, or anything else, wears its kind's. A note that says nothing yet - only
 *    whitespace, or only its own name as its heading - wears the empty page, and the
 *    folder where it holds notes; so does a folder that has no note of its own (#1042).
 *    An icon the reader chose is worn over all of these; see FileMark.svelte.
 *  - `icon`: a website wears its brand's logo, read off its address (#1082) - the
 *    stand-in for a site whose favicon has not been seen or will not load, in place of
 *    the plain globe. A written value, drawn once the logos have arrived; null for
 *    anything that is not a website, and a brand the set does not hold draws the mark.
 *
 *  The one place a file's source decides how it is drawn, so the file list, the tabs,
 *  the tab overview, a search hit, a bookmark and every other list that draws a file
 *  agree; FileMark.svelte asks it for every one of them. A source added later - a page
 *  note made from another kind of document - is a line here and a lettered mark in
 *  file-mark.ts (`typeMark`). */
export function sourceMark(
  mark: FileMark,
  path: string | undefined,
  url?: string | null,
): { mark: FileMark; icon: string | null } {
  if (mark === 'web') {
    const brand = siteBrand(url ?? (path === undefined ? null : addressOf(path)))
    return { mark, icon: brand === null ? null : brandIcon(brand) }
  }

  if (path !== undefined && mark === 'pages' && holdsPaper(path)) return { mark: 'pdf', icon: null }
  if (path !== undefined && (mark === 'note' || mark === 'file') && isEmpty(mark, path)) {
    return { mark: holdsMore(path) ? 'folder' : 'file', icon: null }
  }
  return { mark, icon: null }
}

/** A website's own mark, as an address, or null for anything that is not one or has
 *  none yet: `siteMark` with the mark its open tab wears now first, then the cache for
 *  where the `.url` points (or `url`, for a row that is an address and no file), then
 *  the file's `Nib-Icon`. Here beside the chosen icon so a row asks one façade for what
 *  it draws and never the index by name.
 *
 *  **The tab's mark first.** Emil, 2026-10-03: a web note's row wore another icon than
 *  its own tab, WhatsApp's and Slack's most - marks that redraw themselves with an
 *  unread count. The file keeps the mark a page arrived with and is not written for a
 *  badge, and the cache keeps a page's under the address the page is at, which a Slack
 *  tab that moved to another channel leaves behind. So the row, the bookmark, the
 *  palette and the hit list wear what the tab wears while it is open, badge and all,
 *  and the last of it after; see `filedUnder`. */
export function faviconFor(path: string | undefined, url?: string | null): string | null {
  if (path === undefined) return siteMark(null, url)
  if (wearsChosen(path)) return null
  return siteMark(liveMarkOf(path), url ?? addressOf(path), writtenMarkOf(path))
}

/** Whether the file at `path` wears an icon the reader chose, which is worn over the
 *  site's own mark wherever a website is drawn - the row, the tab, the overview, a
 *  bookmark, a hit (#1098). Asked here, beside the two it decides between, so no surface
 *  weighs them itself. */
export function wearsChosen(path: string | null | undefined): boolean {
  return !!path && readIcon(chosenIcon(path)) !== null
}

/** Where the website at `path` points, as its row asks the cache: what the index read
 *  of it, or for a file of another space what that file says. */
export function addressOf(path: string): string | null {
  return awayIn(path) === null ? links.shortcutOf(path) : (elsewhere.of(path)?.address ?? null)
}

/** The mark the website at `path` wrote down. */
function writtenMarkOf(path: string): string | null {
  return awayIn(path) === null ? links.faviconOf(path) : (elsewhere.of(path)?.favicon ?? null)
}

/** The mark an open tab of the website at `path` wears now, or null with none open or
 *  none shown yet. Asks the tabs, never makes a page. */
function liveMarkOf(path: string): string | null {
  for (const tab of workspace.tabs) {
    if (tab.kind !== 'web' || tab.path === null || !samePath(tab.path, path)) continue
    const icon = pages.iconOf(tab.id)
    if (icon) return icon
  }
  return null
}

/** The colour a stroked icon is drawn in, or null for the plain foreground.
 *
 *  A second value rather than part of the first, because the first is what other
 *  apps read: a note says `icon: rocket` and `icon-color: violet` on two lines, so
 *  Obsidian's Iconize still finds the icon and simply ignores the colour. A tint
 *  folded into the one value would have made every tinted icon a word Iconize does
 *  not know.
 *
 *  Only a stroked icon takes one; an emoji and a coloured drawing have their own
 *  colours. See `readTint` in icons.ts for which names count. */
export function chosenTint(path: string): string | null {
  if (isChatTarget(path)) return elsewhere.of(path)?.iconColor ?? null
  const away = awayIn(path)
  if (away === null) return links.tintOf(path) ?? workspace.folderIcons.tintOf(mapKey(path))

  return elsewhere.of(path)?.iconColor ?? workspace.folderIcons.tintOf(mapKey(path), away)
}
