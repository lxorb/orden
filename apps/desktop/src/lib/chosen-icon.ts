import { isChatTarget, isPagesTarget, isTermTarget } from '@orden/markdown/links'
import type { ItemMeta } from '@orden/sync-core/meta'
import type { FileMark } from './file-mark'
import { folderNote, isFolderNote } from './folder-notes'
import { brandIcon, ICON_COLOUR_KEY, ICON_KEY, readIcon, siteBrand } from './icons'
import { links } from './link-index.svelte'
import { elsewhere } from './marks-elsewhere.svelte'
import { folderOf, isMarkdownPath, samePath, withinSpace } from './space-paths'
import { pages, siteMark } from './web-tab/pages.svelte'
import { workspace } from './workspace.svelte'

function mapKey(path: string): string {
  return isFolderNote(path) ? folderOf(path) : path
}

function awayIn(path: string): string | null {
  let home: string | null = null
  for (const space of workspace.spaces) {
    if (withinSpace(space.root, path) === null) continue
    if (home === null || space.root.length > home.length) home = space.root
  }

  const open = links.rootOf() ?? workspace.activeSpace?.root ?? null
  return home === null || samePath(home, open) ? null : home
}

function keptMeta(path: string): ItemMeta | null {
  if (!isMarkdownPath(path)) return null
  const meta = workspace.itemMeta.of(path)
  return meta?.[ICON_KEY] === undefined ? null : meta
}

export function chosenIcon(path: string): string | null {
  if (isChatTarget(path) || isTermTarget(path)) return elsewhere.of(path)?.icon ?? null
  const kept = keptMeta(path)
  if (kept) return kept[ICON_KEY] ?? null
  const away = awayIn(path)
  if (away === null) return links.iconOf(path) ?? workspace.folderIcons.iconOf(mapKey(path))

  return elsewhere.of(path)?.icon ?? workspace.folderIcons.iconOf(mapKey(path), away)
}

export function holdsPaper(path: string): boolean {
  if (__EVEN_PLUGIN__ || !isPagesTarget(path)) return false
  const listed = workspace.entryAt(path)
  if (listed) return listed.paper === true
  return elsewhere.of(path)?.paper === true
}

function saysNothing(path: string): boolean {
  return awayIn(path) === null ? links.saysNothing(path) : elsewhere.of(path)?.bare === true
}

function isEmpty(mark: FileMark, path: string): boolean {
  if (mark === 'note') return saysNothing(path)
  return workspace.entryAt(path)?.is_dir === true
}

function holdsMore(path: string): boolean {
  const listed = workspace.entryAt(path)
  if (listed?.is_dir) return listed.unlisted === true || listed.children.length > 0
  if (!isMarkdownPath(path)) return false

  const folder = workspace.entryAt(folderOf(path))
  const own = folder ? folderNote(folder) : null
  if (!folder || !own || !samePath(own.path, path)) return false
  return folder.unlisted === true || folder.children.some((one) => !samePath(one.path, path))
}

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

export function faviconFor(path: string | undefined, url?: string | null): string | null {
  if (path === undefined) return siteMark(null, url)
  if (wearsChosen(path)) return null
  return siteMark(liveMarkOf(path), url ?? addressOf(path), writtenMarkOf(path))
}

export function wearsChosen(path: string | null | undefined): boolean {
  return !!path && readIcon(chosenIcon(path)) !== null
}

export function addressOf(path: string): string | null {
  return awayIn(path) === null ? links.shortcutOf(path) : (elsewhere.of(path)?.address ?? null)
}

function writtenMarkOf(path: string): string | null {
  return awayIn(path) === null ? links.faviconOf(path) : (elsewhere.of(path)?.favicon ?? null)
}

function liveMarkOf(path: string): string | null {
  for (const tab of workspace.tabs) {
    if (tab.kind !== 'web' || tab.path === null || !samePath(tab.path, path)) continue
    const icon = pages.iconOf(tab.id)
    if (icon) return icon
  }
  return null
}

export function chosenTint(path: string): string | null {
  if (isChatTarget(path) || isTermTarget(path)) return elsewhere.of(path)?.iconColor ?? null
  const kept = keptMeta(path)
  if (kept) return kept[ICON_COLOUR_KEY] ?? null
  const away = awayIn(path)
  if (away === null) return links.tintOf(path) ?? workspace.folderIcons.tintOf(mapKey(path))

  return elsewhere.of(path)?.iconColor ?? workspace.folderIcons.tintOf(mapKey(path), away)
}
