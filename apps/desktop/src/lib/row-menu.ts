import { foreignCopy } from '@orden/sync-core/foreign'
import { folderNote, nestedIn } from './folder-notes'
import { basesOn, hiddenKinds, type KindName } from './settings.svelte'
import { kindLabel } from './kind-words'
import { key, plural, t } from './i18n.svelte'
import {
  archiveEntry,
  coverEntries,
  listEntry,
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
import { isDesktop, joinPath, platform } from './tauri'
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
      label: t('Web data'),
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
  if (!canWriteAt(entry.path)) return readOnlyMenu(entry, own, marked)

  return [
    { label: t('Open'), run: () => void workspace.openRow(entry.path) },
    ...openElsewhere(entry, own),
    ...compareEntry(entry),
    DIVIDER,
    ...(holds && hiddenKinds.offers('note')
      ? [
          {
            label: t('New note inside'),
            run: () => void workspace.createInside(entry.path),
            more: () => Promise.resolve(newFileRows(entry.path)),
          },
        ]
      : []),
    DIVIDER,
    { label: t('Rename'), run: () => workspace.startRenaming(entry.path) },
    ...moveEntry(entry),
    ...iconEntries(marked.path, entry.is_dir && !own),
    ...coverEntries(marked.path),
    ...listEntry(marked.path),
    ...wallpaperEntry(entry),
    ...webDataEntry(entry),
    ...searchAgainEntry(entry.path),
    ...archiveEntry(entry.path),
    ...protectEntries(entry.path),
    ...shareEntry(marked.path),
    {
      label: t('Duplicate'),
      hint: shortcuts.hint('tree.duplicate'),
      run: () => void workspace.duplicate(entry.path),
    },
    ...revealEntry(entry),
    DIVIDER,
    { label: t('Delete'), danger: true, run: () => void removeRow(entry, marked, inside) },
  ]
}

function readOnlyMenu(entry: Entry, own: Entry | null, marked: Entry): MenuEntry[] {
  return [
    { label: t('Open'), run: () => void workspace.openRow(entry.path) },
    ...openElsewhere(entry, own),
    ...compareEntry(entry),
    DIVIDER,
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
      label: t('Use as wallpaper'),
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
    return [{ label: t('Open all'), run: () => void openAll(paths) }]
  }
  const count = workspace.deletable(paths).length

  return [
    { label: t('Open all'), run: () => void openAll(paths) },
    DIVIDER,
    ...(viewport.touch ? [{ label: t('Move'), run: () => void moveAllTo(paths) }] : []),
    ...archiveAll(paths),
    DIVIDER,
    {
      label: plural(count, { one: 'Delete {count} item', other: 'Delete {count} items' }),
      danger: true,
      disabled: count === 0,
      run: () => void workspace.removeMany(paths),
    },
  ]
}

function openElsewhere(entry: Entry, own: Entry | null): MenuEntry[] {
  const behind = {
    label: t('Open in new tab'),
    run: () => void workspace.openRow(entry.path, howFor('behind')),
  }
  if (viewport.touch || (entry.is_dir && !own)) return [behind]

  return [
    behind,
    { label: t('Open to the side'), run: () => void workspace.openAside(own?.path ?? entry.path) },
  ]
}

function compareEntry(entry: Entry): MenuEntry[] {
  const copy = entry.is_dir ? null : foreignCopy(entry.name)
  const original = copy && entryAt(workspace.tree, joinPath(folderOf(entry.path), copy.original))
  if (!original || original.is_dir) return []

  return [{ label: t('Compare with original'), run: () => void compare(original.path, entry.path) }]
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
      label: all ? t('Remove from Essentials') : t('Add to Essentials'),
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
          label: t('Archive'),
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

  return [{ label: t('Move'), run: () => void moveTo(entry, targets) }]
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
  const into = await prompt.find({ title: t('Move to'), options: targets })
  if (into) await workspace.moveMany([...paths], into)
}

async function moveTo(entry: Entry, targets: readonly MoveTarget[]) {
  const { prompt } = await import('./prompt.svelte')
  const into = await prompt.find({ title: t('Move to'), options: [...targets] })

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
    title: t('Delete {name}?', { name: rowName(marked.name, marked.is_dir) }),
    detail: t('The notes inside it go too.'),
    confirmLabel: key('Delete'),
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
    title: t('Nothing archived is deleted'),
    detail: plural(held, {
      one: '{count} archived item inside',
      other: '{count} archived items inside',
    }),
    confirmLabel: key('Show them'),
  })

  if (show) {
    const { archiveList } = await import('./archive-list.svelte')
    archiveList.show()
  }
}

function revealEntry(entry: Entry): MenuEntry[] {
  if (!isDesktop) return []
  const label = platform() === 'macos' ? t('Reveal in Finder') : t('Show in folder')
  return [{ label, run: () => void import('./reveal').then((one) => one.reveal(entry.path)) }]
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
            label: t('New database'),
            run: () => void import('./views/new-database').then((one) => one.createDatabase()),
          },
        ]),
  ]
}
