import type { Bookmark } from '@orden/contracts'
import {
  isCanvasTarget,
  isChatTarget,
  isPagesTarget,
  isTermTarget,
  isWebTarget,
} from '@orden/markdown/links'
import { COVER_KEY } from '@orden/markdown/cover'
import { DIVIDER, type MenuEntry } from './ui-kit/src/api'
import { iconChoice } from './icon-choice.svelte'
import { links } from './link-index/src/api'
import { canShareItem, canWriteAt, shareThisFile } from './sharing/src/api'
import { isMarkdownPath, withinSpace } from './platform/src/api'
import { workspace } from './workspace/src/api'
import { archive, unarchive } from './archive/src/api'

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

  const archived = workspace.archive.has(path)
  return __EVEN_PLUGIN__
    ? []
    : [
        {
          label: archived ? 'Unarchive' : 'Archive',
          run: () => void (archived ? unarchive(path) : archive([path])),
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
  const cover = () => import('./note-cover')

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
