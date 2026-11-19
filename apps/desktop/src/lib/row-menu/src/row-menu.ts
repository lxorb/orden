import { type Entry, portOf, tabKindLoaded } from '@orden/contracts'
import { foreignCopy } from '@orden/sync-core'
import { isChatTarget } from '@orden/markdown/links'
import { moveTargets, type MoveTarget, movesInto, folderNote, nestedIn, entryAt } from '../../tree/src/api'
import { basesOn, hiddenKinds, type KindName } from '../../gates/src/api'
import { kindLabel } from '../../new-here/src/api'
import { DIVIDER, type MenuEntry, viewport } from '../../ui-kit/src/api'
import { archiveEntry, coverEntries, iconEntries, searchAgainEntry, shareEntry, webDataEntry } from './api'
import {
  rowName,
  folderOf,
  isMarkdownPath,
  isPicturePath,
  relativeTo,
  isDesktop,
  joinPath,
  within,
} from '../../platform/src/api'
import { canWriteAt, protectEntries } from '../../sharing/src/api'
import { shortcuts } from '../../shortcuts/src/api'
import { reveal, showLabel } from '../../files-out/src/api'
import { workspace, howFor } from '../../workspace/src/api'

export function rowMenu(entry: Entry): MenuEntry[] {
  const several = selectionMenu(entry)
  if (several) return several

  const own = folderNote(entry)
  const holds = entry.is_dir || isMarkdownPath(entry.name)
  const marked = own ?? entry
  const inside = entry.is_dir && nestedIn(entry).length > 0
  if (!canWriteAt(entry.path)) return readOnlyMenu(entry, marked)

  return [
    ...compareEntry(entry).flatMap((one) => [one, DIVIDER]),
    ...(holds && hiddenKinds.offers('note')
      ? [
          {
            label: 'New note inside',
            run: () => void workspace.createInside(entry.path),
            more: () => Promise.resolve(newFileRows(entry.path)),
          },
        ]
      : []),
    DIVIDER,
    { label: 'Rename', run: () => workspace.startRenaming(entry.path) },
    ...moveEntry(entry),
    ...iconEntries(marked.path, entry.is_dir && !own),
    ...coverEntries(marked.path),
    ...wallpaperEntry(entry),
    ...webDataEntry(entry),
    ...searchAgainEntry(entry.path),
    ...archiveEntry(entry.path),
    ...protectEntries(entry.path),
    ...shareEntry(marked.path),
    {
      label: 'Duplicate',
      hint: shortcuts.hint('tree.duplicate'),
      run: () => void workspace.duplicate(entry.path),
    },
    ...revealEntry(entry),
    DIVIDER,
    { label: 'Delete', danger: true, run: () => void removeRow(entry, marked, inside) },
  ]
}

function readOnlyMenu(entry: Entry, marked: Entry): MenuEntry[] {
  return [
    ...compareEntry(entry).flatMap((one) => [one, DIVIDER]),
    ...wallpaperEntry(entry),
    ...webDataEntry(entry),
    ...searchAgainEntry(entry.path),
    ...protectEntries(entry.path),
    ...shareEntry(marked.path),
    ...revealEntry(entry),
  ]
}

function wallpaperEntry(entry: Entry): MenuEntry[] {
  if (__EVEN_PLUGIN__ || entry.is_dir || !isPicturePath(entry.name)) return []

  return [
    {
      label: 'Use as wallpaper',
      run: () => void import('../../theme-looks/src/api').then(({ wallpaper }) => wallpaper.takeFrom(entry.path)),
    },
  ]
}

function selectionMenu(entry: Entry): MenuEntry[] | null {
  if (!workspace.isSelected(entry.path) || workspace.selection.length < 2) return null
  const paths = [...workspace.selection]
  if (!paths.every((path) => canWriteAt(path))) {
    return [{ label: 'Open all', run: () => void openAll(paths) }]
  }
  const count = workspace.deletable(paths).length

  return [
    { label: 'Open all', run: () => void openAll(paths) },
    DIVIDER,
    ...(viewport.touch ? [{ label: 'Move', run: () => void moveAllTo(paths) }] : []),
    ...archiveAll(paths),
    DIVIDER,
    {
      label: count === 1 ? 'Delete 1 item' : `Delete ${count} items`,
      danger: true,
      disabled: count === 0,
      run: () => void removeAsking(paths),
    },
  ]
}

function compareEntry(entry: Entry): MenuEntry[] {
  const copy = entry.is_dir ? null : foreignCopy(entry.name)
  const original = copy && entryAt(workspace.tree, joinPath(folderOf(entry.path), copy.original))
  if (!original || original.is_dir) return []

  return [{ label: 'Compare with original', run: () => void compare(original.path, entry.path) }]
}

async function compare(original: string, copy: string) {
  await workspace.openRow(original)
  await workspace.openAside(copy)
}

async function openAll(paths: readonly string[]) {
  const [first, ...rest] = paths
  if (first === undefined) return

  await workspace.openRow(first)
  for (const path of rest) await workspace.openRow(path, howFor('behind'))
}

function archiveAll(paths: readonly string[]): MenuEntry[] {
  const [first] = paths
  const archiving = portOf('archive')
  if (first === undefined || !archiving.ok || !archiveEntry(first).length) return []

  return [{ label: 'Archive', run: () => void archiving.value.archive(paths) }]
}

const targetsFor = (moving: string | null) =>
  moveTargets({
    moving,
    tree: workspace.tree,
    spaces: workspace.spaces,
    here: workspace.activeSpace?.root ?? null,
  })

function moveEntry(entry: Entry): MenuEntry[] {
  if (!viewport.touch) return []
  const targets = targetsFor(entry.path).filter((target) => canWriteAt(target.id))
  return targets.length ? [{ label: 'Move', run: () => void moveInto([entry.path], targets) }] : []
}

function moveAllTo(paths: readonly string[]) {
  const each = paths.map((path) => new Set(targetsFor(path).map((target) => target.id)))
  const targets = targetsFor(null).filter(
    (target) =>
      canWriteAt(target.id) &&
      movesInto(paths, target.id) &&
      paths.every((path, at) => each[at]?.has(target.id) === true || folderOf(path) === target.id),
  )
  return moveInto([...paths], targets)
}

async function moveInto(paths: string[], targets: MoveTarget[]) {
  const { prompt } = await import('../../ui-kit/src/api')
  const into = await prompt.find({ title: 'Move to', options: targets })
  if (into) await workspace.moveMany(paths, into)
}

async function removeRow(entry: Entry, marked: Entry, inside: boolean) {
  if (workspace.keepsArchived(entry.path)) {
    await refuseDeleting([entry.path])
    return
  }

  if (!inside) {
    if (await chatsKept([entry.path])) return
    await workspace.remove(entry.path, entry.is_dir)
    return
  }

  const { prompt } = await import('../../ui-kit/src/api')
  const sure = await prompt.confirm({
    title: `Delete ${rowName(marked.name, marked.is_dir)}?`,
    detail: 'The notes inside it go too.',
    confirmLabel: 'Delete',
    danger: true,
  })

  if (sure) await workspace.remove(entry.path, true)
}

async function chatsKept(paths: readonly string[]): Promise<boolean> {
  const chats = portOf('chats')
  const going = [...new Set([...paths, ...workspace.files.map((one) => one.path)])].filter(
    (path) => isChatTarget(path) && paths.some((one) => within(one, path) !== null),
  )
  if (!chats.ok || !going.length) return false
  return !(await chats.value.mayDelete(going))
}

export async function removeAsking(paths: readonly string[]) {
  if (await chatsKept(paths)) return
  await workspace.removeMany([...paths])
}

export async function refuseDeleting(paths: readonly string[]) {
  const root = workspace.activeSpace?.root ?? ''
  const held = [...workspace.archive.keysOf(root)].filter((one) =>
    paths.some((path) => {
      const at = relativeTo(root, path)
      return one === at || one.startsWith(`${at}/`)
    }),
  ).length

  const { prompt } = await import('../../ui-kit/src/api')
  const show = await prompt.confirm({
    title: 'Nothing archived is deleted',
    detail: held === 1 ? '1 archived item inside' : `${held} archived items inside`,
    confirmLabel: 'Show them',
  })

  const archiving = portOf('archive')
  if (show && archiving.ok) await archiving.value.show(null)
}

function revealEntry(entry: Entry): MenuEntry[] {
  return isDesktop ? [{ label: showLabel(), run: () => void reveal(entry.path) }] : []
}

const MAKERS: Partial<Record<KindName, (folder?: string) => unknown>> = {
  note: (folder) => workspace.createNote(folder),
  canvas: (folder) => workspace.createCanvas(folder),
  pages: (folder) => workspace.createPages(folder),
  web: (folder) => workspace.createWebsite(folder),
  ...(__EVEN_PLUGIN__ ? {} : { chat: (folder?: string) => tabKindLoaded('chat').then((kind) => kind.make?.(folder)) }),
}

export function newFileRows(inside?: string): MenuEntry[] {
  const into = inside ?? workspace.activeSpace?.root
  if (into !== undefined && !canWriteAt(into)) return []

  return [
    ...hiddenKinds.shown.flatMap((kind) => {
      const make = MAKERS[kind]
      if (!make) return []
      const run = inside ? () => void workspace.createInside(inside, make) : () => void make()
      return [{ label: kindLabel(kind), run }]
    }),
    ...(__EVEN_PLUGIN__ || inside || !basesOn()
      ? []
      : [
          {
            label: 'New database',
            run: () => void tabKindLoaded('view').then((kind) => kind.make?.()),
          },
        ]),
  ]
}
