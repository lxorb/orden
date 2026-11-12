import { foreignCopy } from '@orden/sync-core'
import { folderNote, nestedIn } from './folder-notes'
import { basesOn, hiddenKinds, type KindName } from './settings.svelte'
import { kindLabel } from './kind-words'
import {
  archiveEntry,
  coverEntries,
  DIVIDER,
  iconEntries,
  searchAgainEntry,
  type MenuEntry,
  shareEntry,
} from './menu.svelte'
import { moveTargets, type MoveTarget, movesInto } from './move-targets'
import { howFor } from './new-tab'
import { rowName } from './note-name'
import { canWriteAt } from './sharing.svelte'
import { shortcuts } from './shortcuts.svelte'
import { folderOf, isMarkdownPath, isPicturePath, relativeTo } from './space-paths'
import { isDesktop, joinPath } from './tauri'
import { showLabel } from './reveal'
import { entryAt } from './tree-edits'
import { viewport } from './viewport.svelte'
import type { Entry } from './workspace.svelte'
import { workspace } from './workspace.svelte'
import { protectEntries } from './protect/entries'

export function webDataEntry(entry: { path: string; is_dir: boolean }): MenuEntry[] {
  if (!isDesktop || entry.is_dir || !/\.url$/i.test(entry.path)) return []
  if (!canWriteAt(entry.path)) return []
  const path = entry.path
  return [
    {
      label: 'Web data',
      keep: true,
      run: () => void import('./web-tab/own-data').then((one) => one.showWebData(path)),
    },
  ]
}

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
      run: () =>
        void import('./wallpaper/wallpaper.svelte').then(({ wallpaper }) =>
          wallpaper.takeFrom(entry.path),
        ),
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
      run: () => void workspace.removeMany(paths),
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

function archiveAll(paths: readonly string[]): MenuEntry[] {
  const [first] = paths
  const entry = first === undefined ? [] : archiveEntry(first)
  if (!entry.length) return []

  return __EVEN_PLUGIN__
    ? []
    : [
        {
          label: 'Archive',
          run: () => void import('./archiving').then(({ archive }) => archive(paths)),
        },
      ]
}

function moveEntry(entry: Entry): MenuEntry[] {
  if (!viewport.touch) return []
  const targets = moveTargets({
    moving: entry.path,
    tree: workspace.tree,
    spaces: workspace.spaces,
    here: workspace.activeSpace?.root ?? null,
  }).filter((target) => canWriteAt(target.id))
  if (!targets.length) return []

  return [{ label: 'Move', run: () => void moveTo(entry, targets) }]
}

async function moveAllTo(paths: readonly string[]) {
  const asked = (moving: string | null) =>
    moveTargets({
      moving,
      tree: workspace.tree,
      spaces: workspace.spaces,
      here: workspace.activeSpace?.root ?? null,
    })
  const each = paths.map((path) => new Set(asked(path).map((target) => target.id)))
  const targets = asked(null).filter(
    (target) =>
      canWriteAt(target.id) &&
      movesInto(paths, target.id) &&
      paths.every((path, at) => each[at]?.has(target.id) === true || folderOf(path) === target.id),
  )

  const { prompt } = await import('./prompt.svelte')
  const into = await prompt.find({ title: 'Move to', options: targets })
  if (into) await workspace.moveMany([...paths], into)
}

async function moveTo(entry: Entry, targets: readonly MoveTarget[]) {
  const { prompt } = await import('./prompt.svelte')
  const into = await prompt.find({ title: 'Move to', options: [...targets] })

  if (into) await workspace.moveMany([entry.path], into)
}

async function removeRow(entry: Entry, marked: Entry, inside: boolean) {
  if (workspace.keepsArchived(entry.path)) {
    await refuseDeleting([entry.path])
    return
  }

  if (!inside) {
    await workspace.remove(entry.path, entry.is_dir)
    return
  }

  const { prompt } = await import('./prompt.svelte')
  const sure = await prompt.confirm({
    title: `Delete ${rowName(marked.name, marked.is_dir)}?`,
    detail: 'The notes inside it go too.',
    confirmLabel: 'Delete',
    danger: true,
  })

  if (sure) await workspace.remove(entry.path, true)
}

export async function refuseDeleting(paths: readonly string[]) {
  const root = workspace.activeSpace?.root ?? ''
  const held = [...workspace.archive.keysOf(root)].filter((one) =>
    paths.some((path) => {
      const at = relativeTo(root, path)
      return one === at || one.startsWith(`${at}/`)
    }),
  ).length

  const { prompt } = await import('./prompt.svelte')
  const show = await prompt.confirm({
    title: 'Nothing archived is deleted',
    detail: held === 1 ? '1 archived item inside' : `${held} archived items inside`,
    confirmLabel: 'Show them',
  })

  if (show) {
    const { archiveList } = await import('./archive-list.svelte')
    archiveList.show()
  }
}

function revealEntry(entry: Entry): MenuEntry[] {
  if (!isDesktop) return []
  return [
    {
      label: showLabel(),
      run: () => void import('./reveal').then((one) => one.reveal(entry.path)),
    },
  ]
}

const MAKERS: Partial<Record<KindName, (folder?: string) => unknown>> = {
  note: (folder) => workspace.createNote(folder),
  canvas: (folder) => workspace.createCanvas(folder),
  pages: (folder) => workspace.createPages(folder),
  web: (folder) => workspace.createWebsite(folder),
  ...(__EVEN_PLUGIN__
    ? {}
    : {
        chat: (folder?: string) =>
          import('./chats/view/open').then(({ makeChat }) => makeChat(folder)),
      }),
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
            run: () => void import('./views/new-database').then((one) => one.createDatabase()),
          },
        ]),
  ]
}
