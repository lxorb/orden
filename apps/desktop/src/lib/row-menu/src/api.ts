import { type Bookmark, portOf } from '@orden/contracts'
import {
  isCanvasTarget,
  isChatTarget,
  isPagesTarget,
  isTermTarget,
  isWebTarget,
} from '@orden/markdown/links'
import { COVER_KEY } from '@orden/markdown/cover'
import { DIVIDER, type MenuEntry } from '../../ui-kit/src/api'
import { iconChoice } from '../../icon-choice.svelte'
import { links } from '../../link-index/src/api'
import { canShareItem, canWriteAt, shareThisFile } from '../../sharing/src/api'
import { isDesktop, isMarkdownPath, withinSpace } from '../../platform/src/api'
import { workspace } from '../../workspace/src/api'
import { entryAt, folderNote } from '../../tree/src/api'

export function bookmarkEntry(mark: Bookmark | null): MenuEntry[] {
  if (!mark) return []

  return [
    {
      label: workspace.bookmarks.has(mark) ? 'Remove from Essentials' : 'Add to Essentials',
      run: () => workspace.bookmarks.toggle(mark),
    },
  ]
}

export function searchAgainEntry(path: string | null | undefined): MenuEntry[] {
  if (!path || !workspace.excluded.names(path)) return []

  return [{ label: 'Search here again', run: () => workspace.excluded.toggle(path) }]
}

export function archiveEntry(path: string | null | undefined): MenuEntry[] {
  const root = workspace.activeSpace?.root
  if (!path || !root || withinSpace(root, path) === null || !canWriteAt(path)) return []

  const archiving = portOf('archive')
  if (!archiving.ok) return []
  const archived = workspace.archive.has(path)
  return [
    {
      label: archived ? 'Unarchive' : 'Archive',
      run: () =>
        void (archived ? archiving.value.unarchive(path) : archiving.value.archive([path])),
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
  const mapped = folder || !kept

  return [
    {
      label: 'Choose an icon',
      run: () => (mapped ? iconChoice.folder(path) : iconChoice.file(path)),
    },
  ]
}

export function coverEntries(path: string | null | undefined): MenuEntry[] {
  if (!path || !isMarkdownPath(path) || !canWriteAt(path)) return []

  const there = links.coverOf(path) !== null || workspace.itemMeta.valueOf(path, COVER_KEY) !== null
  const cover = () => import('../../note-cover')

  return [
    {
      label: there ? 'Change cover' : 'Set cover',
      run: () => void cover().then((one) => one.chooseCover(path)),
    },
    ...(there
      ? [
          {
            label: 'Remove cover',
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
      label: workspace.stacked(paneId) ? 'Unstack tabs' : 'Stack tabs',
      checked: workspace.stacked(paneId),
      run: () => workspace.toggleStacked(paneId),
    },
    DIVIDER,
  ]
}

export function shareEntry(path: string | null | undefined): MenuEntry[] {
  if (!path || !canShareItem(path)) return []

  return [{ label: 'Share', run: () => void shareThisFile(path) }]
}

export function webDataEntry(entry: { path: string; is_dir: boolean }): MenuEntry[] {
  if (!isDesktop || entry.is_dir || !/\.url$/i.test(entry.path)) return []
  if (!canWriteAt(entry.path)) return []
  const sites = portOf('web.sites')
  if (!sites.ok) return []
  const path = entry.path
  return [{ label: 'Web data', keep: true, run: () => void sites.value.showData(path) }]
}

export function bookmarkAll(paths: readonly string[]): MenuEntry[] {
  const marks = paths.flatMap((path) => {
    const entry = entryAt(workspace.tree, path)
    const mark = entry && workspace.bookmarks.forEntry(folderNote(entry) ?? entry)
    return mark ? [mark] : []
  })
  if (!marks.length) return []

  const all = marks.every((mark) => workspace.bookmarks.has(mark))
  return [
    {
      label: all ? 'Remove from Essentials' : 'Add to Essentials',
      run: () => workspace.bookmarks.toggleAll(marks),
    },
  ]
}

export const rowMenus = () => import('./row-menu')
