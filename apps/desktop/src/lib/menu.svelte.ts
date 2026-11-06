import {
  isCanvasTarget,
  isChatTarget,
  isPagesTarget,
  isTermTarget,
  isWebTarget,
} from '@orden/markdown/links'
import { DIVIDER, type MenuEntry } from './menu-item'
import { chosenIcon } from './chosen-icon'
import { iconChoice } from './icon-choice.svelte'
import { t } from './i18n.svelte'
import { links } from './link-index.svelte'
import { canShareItem, canWriteAt, shareThisFile } from './sharing.svelte'
import { isMarkdownPath, withinSpace } from './space-paths'
import type { Bookmark } from './workspace/bookmarks.svelte'
import { workspace } from './workspace.svelte'

export { DIVIDER, type MenuEntry, type MenuItem } from './menu-item'

interface MenuOptions {
  title?: string
  near?: boolean
  keepFocus?: boolean
  up?: boolean
}

class ContextMenu {
  open = $state(false)
  x = $state(0)
  y = $state(0)
  items = $state<MenuEntry[]>([])
  title = $state<string | null>(null)
  near = $state(false)
  keepFocus = $state(false)
  up = $state(false)
  lit = $state(-1)
  heldAt: { x: number; y: number } | null = null
  from: Element | null = null

  show(event: MouseEvent, items: MenuEntry[], options: MenuOptions = {}) {
    event.preventDefault()
    event.stopPropagation()

    const usable = trim(items)
    if (!usable.length) return

    this.items = usable
    this.title = options.title ?? null
    this.near = !!options.near
    this.keepFocus = !!options.keepFocus
    this.up = !!options.up
    this.lit = -1
    this.from = event.type === 'click' ? openerOf(event) : null
    const under = this.from?.getBoundingClientRect()
    this.x = under ? under.left : event.clientX
    this.y = under ? (this.up ? under.top : under.bottom) : event.clientY
    this.heldAt = event.buttons ? { x: event.clientX, y: event.clientY } : null
    this.open = true
  }

  replace(items: MenuEntry[]) {
    if (this.open) this.items = trim(items)
  }

  hide() {
    this.open = false
  }
}

function openerOf(event: MouseEvent): Element | null {
  const at = event.currentTarget ?? event.target
  if (typeof Element === 'undefined' || !(at instanceof Element)) return null
  return at.closest('button, [role="button"], a[href], [aria-haspopup]')
}

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

export type TextField = HTMLInputElement | HTMLTextAreaElement

const TEXT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number'])

export function textFieldOf(target: EventTarget | null): TextField | null {
  if (target instanceof HTMLTextAreaElement) return target
  if (target instanceof HTMLInputElement && TEXT_TYPES.has(target.type)) return target
  return null
}

export function bookmarkEntry(mark: Bookmark | null): MenuEntry[] {
  if (!mark) return []

  return [
    {
      label: workspace.bookmarks.has(mark) ? t('Remove from Essentials') : t('Add to Essentials'),
      run: () => workspace.bookmarks.toggle(mark),
    },
  ]
}

export function searchAgainEntry(path: string | null | undefined): MenuEntry[] {
  if (!path || !workspace.excluded.names(path)) return []

  return [{ label: t('Search here again'), run: () => workspace.excluded.toggle(path) }]
}

export function archiveEntry(path: string | null | undefined): MenuEntry[] {
  const root = workspace.activeSpace?.root
  if (!path || !root || withinSpace(root, path) === null || !canWriteAt(path)) return []

  const archived = workspace.archive.has(path)
  return __EVEN_PLUGIN__
    ? []
    : [
        {
          label: archived ? t('Unarchive') : t('Archive'),
          run: () =>
            void import('./archiving').then((one) =>
              archived ? one.unarchive(path) : one.archive([path]),
            ),
        },
      ]
}

export function iconEntries(path: string | null | undefined, folder = false): MenuEntry[] {
  if (!path || !canWriteAt(path)) return []
  const chat = !__EVEN_PLUGIN__ && isChatTarget(path)
  const web = isWebTarget(path) && !/\.webloc$/i.test(path.trim())
  const term = !__EVEN_PLUGIN__ && isTermTarget(path)
  const kept =
    chat || web || term || [isMarkdownPath, isCanvasTarget, isPagesTarget].some((one) => one(path))
  if (!folder && !kept) return []

  const take = () =>
    folder
      ? workspace.setFolderIcon(path, null)
      : void import('./file-icon').then((one) => one.setFileIcon(path, null))

  return [
    {
      label: t('Choose an icon'),
      run: () => (folder ? iconChoice.folder(path) : iconChoice.file(path)),
    },
    ...(chosenIcon(path) === null
      ? []
      : [{ label: web ? t('Reset to site icon') : t('Remove icon'), run: take }]),
  ]
}

export function coverEntries(path: string | null | undefined): MenuEntry[] {
  if (!path || !isMarkdownPath(path) || !canWriteAt(path)) return []

  const there = links.coverOf(path) !== null
  const cover = () => import('./note-cover')

  return [
    {
      label: there ? t('Change cover') : t('Set cover'),
      run: () => void cover().then((one) => one.chooseCover(path)),
    },
    ...(there
      ? [
          {
            label: t('Remove cover'),
            run: () => void cover().then((one) => one.removeCover(path)),
          },
        ]
      : []),
  ]
}

export function stackEntries(paneId: string): MenuEntry[] {
  if (!workspace.canStack(paneId)) return []

  return [
    {
      label: workspace.stacked(paneId) ? t('Unstack tabs') : t('Stack tabs'),
      checked: workspace.stacked(paneId),
      run: () => workspace.toggleStacked(paneId),
    },
    DIVIDER,
  ]
}

export function shareEntry(path: string | null | undefined): MenuEntry[] {
  if (!path || !canShareItem(path)) return []

  return [{ label: t('Share'), run: () => void shareThisFile(path) }]
}
