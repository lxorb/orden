import { iconChoice } from './icon-choice.svelte'
import { t } from './i18n.svelte'
import { links } from './link-index.svelte'
import { setNoteIcon } from './note-icon'
import { isMarkdownPath } from './space-paths'
import type { Bookmark } from './workspace/bookmarks.svelte'
import { workspace } from './workspace.svelte'

export interface MenuItem {
  label: string
  /** Undefined where the entry has no key bound to it. */
  hint?: string | undefined
  danger?: boolean
  disabled?: boolean
  run: () => void
}

/** A separator between groups. */
export const DIVIDER = null
export type MenuEntry = MenuItem | typeof DIVIDER

/** How a phone shows the menu. A desktop ignores both: there it is always a
 *  popover at the pointer. */
interface MenuOptions {
  /** What the menu is about, for the sheet a phone shows, which does not
   *  point at anything the way a popover does. */
  title?: string
  /** Stay by the finger as a callout instead of rising from the bottom: for
   *  a selection in the text, which has to stay in view. */
  near?: boolean
}

class ContextMenu {
  open = $state(false)
  x = $state(0)
  y = $state(0)
  items = $state<MenuEntry[]>([])
  title = $state<string | null>(null)
  near = $state(false)

  /** Opens at the pointer. The caller has already decided what belongs here,
   *  so an empty list means "no menu" rather than an empty box. */
  show(event: MouseEvent, items: MenuEntry[], options: MenuOptions = {}) {
    event.preventDefault()
    event.stopPropagation()

    const usable = trim(items)
    if (!usable.length) return

    this.items = usable
    this.title = options.title ?? null
    this.near = !!options.near
    this.x = event.clientX
    this.y = event.clientY
    this.open = true
  }

  hide() {
    this.open = false
  }
}

/** Drops leading, trailing and doubled dividers. */
export function trim(items: MenuEntry[]): MenuEntry[] {
  const out: MenuEntry[] = []

  for (const item of items) {
    if (item === DIVIDER && (!out.length || out[out.length - 1] === DIVIDER)) continue
    out.push(item)
  }

  while (out.length && out[out.length - 1] === DIVIDER) out.pop()
  return out
}

export const menu = new ContextMenu()

/** One gesture and one word for everything that can be kept above the file
 *  list: a note, a folder, a heading, a search. Nothing to offer where there is
 *  nothing to point at - a heading with no note, an empty search box. */
export function bookmarkEntry(mark: Bookmark | null): MenuEntry[] {
  if (!mark) return []

  return [
    {
      label: workspace.bookmarks.has(mark) ? t('Remove bookmark') : t('Bookmark'),
      run: () => workspace.bookmarks.toggle(mark),
    },
  ]
}

/** The icon a note wears, in the same words the rail offers a space: one entry to
 *  choose one, and a second to take away the one it has.
 *
 *  Here rather than in the file list, because the icon belongs to the note and
 *  every list that shows a note can offer it - the tree today, a search result or
 *  a bookmark whenever one of those grows a menu of its own.
 *
 *  Only a note, because the icon lives in the note's front matter and a PDF, a
 *  picture and a canvas have none to write it into. */
export function iconEntries(path: string | null | undefined): MenuEntry[] {
  if (!path || !isMarkdownPath(path)) return []

  return [
    { label: t('Choose an icon'), run: () => iconChoice.note(path) },
    ...(links.iconOf(path) === null
      ? []
      : [{ label: t('Remove icon'), run: () => void setNoteIcon(path, null) }]),
  ]
}
