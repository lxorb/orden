import { t } from './i18n.svelte'
import { isDesktop, isNative } from './tauri'
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

/** The note's path, which only means something where there is a filesystem. */
export function copyPathEntry(path: string | null | undefined): MenuEntry[] {
  if (!isNative || !path) return []

  return [{ label: t('Copy path'), run: () => void navigator.clipboard.writeText(path) }]
}

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

/** "Reveal in Explorer", but only where there is a file manager to reveal in.
 *  Returns nothing in the browser, so the entry simply is not offered. */
export function revealEntry(path: string | null | undefined): MenuEntry[] {
  if (!isDesktop || !path) return []

  return [{ label: t('Reveal in Explorer'), run: () => void workspace.reveal(path) }]
}
