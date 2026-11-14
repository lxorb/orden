import { copyText } from '../../ui-controls/src/api'
import { fileClipboard } from '../../list-landing.svelte'
import { DIVIDER, type MenuEntry } from '../../ui-kit/src/api'
import { reveal, showLabel } from '../../reveal'
import { platform } from '../../platform/src/api'
import { shortcuts } from '../../shortcuts.svelte'
import { workspace } from '../../workspace.svelte'
import { carry, changeable, duplicate, newFolder, paste, removeForGood, trash } from './changes'
import { type Entry, openWithSystem } from './commands'
import { inASpace, openFile, ordenOpens } from './open'
import { places } from './places.svelte'
import type { SortKey } from './order'
import { explorerPrefs } from './prefs.svelte'
import { viewOf, type ExplorerView } from './view.svelte'

function otherFolder(view: ExplorerView): string | null {
  for (const pane of workspace.panes.all) {
    const tab = workspace.showing(pane.id)
    if (tab?.kind !== 'explorer' || tab === view.tab) continue
    const folder = viewOf(tab).listing?.path
    if (folder && viewOf(tab).listing?.own === false) return folder
  }
  return null
}

export function rowMenu(view: ExplorerView, entry: Entry): MenuEntry[] {
  if (!view.picked.names.has(entry.name)) view.pick(entry.name, 'one')
  const paths = view.chosen
  const path = view.pathOf(entry.name)
  const writes = changeable(view)
  const other = otherFolder(view)
  const outside = paths.some((one) => !inASpace(one))
  return [
    {
      label: 'Open',
      run: () => (entry.folder ? void view.go(path) : void openFile(path)),
    },
    ...(!entry.folder && ordenOpens(path)
      ? [{ label: 'Open with the system app', run: () => void openWithSystem(path) }]
      : []),
    { label: showLabel(platform(), false), run: () => void reveal(path, { system: true }) },
    DIVIDER,
    ...(writes
      ? [
          {
            label: 'Cut',
            hint: shortcuts.hint('fixed.cut'),
            run: () => fileClipboard.hold(paths, true),
          },
        ]
      : []),
    {
      label: 'Copy',
      hint: shortcuts.hint('fixed.copy'),
      run: () => fileClipboard.hold(paths, false),
    },
    ...(writes && entry.folder && fileClipboard.paths.length
      ? [
          {
            label: 'Paste',
            hint: shortcuts.hint('fixed.paste'),
            run: () => void paste(view, path),
          },
        ]
      : []),
    ...(other
      ? [
          { label: 'Copy to the other pane', run: () => void carry(view, paths, other, 'copy') },
          ...(writes
            ? [
                {
                  label: 'Move to the other pane',
                  run: () => void carry(view, paths, other, 'move'),
                },
              ]
            : []),
        ]
      : []),
    DIVIDER,
    ...(writes
      ? [
          { label: 'Duplicate', run: () => void duplicate(view, paths) },
          {
            label: 'Rename',
            hint: shortcuts.hint('tree.rename'),
            run: () => {
              if (paths.length > 1) view.renamingMany = paths
              else view.renaming = entry.name
            },
          },
        ]
      : []),
    { label: 'Copy path', run: () => void copyText(paths.join('\n')) },
    ...(entry.folder && !places.isPinned(path)
      ? [{ label: 'Pin to Places', run: () => places.pin(path) }]
      : []),
    ...(writes
      ? [
          DIVIDER,
          {
            label: 'Move to Trash',
            hint: shortcuts.hint('tree.delete'),
            danger: true,
            run: () => void trash(view, paths),
          },
          ...(outside
            ? [
                {
                  label: 'Delete for good',
                  hint: shortcuts.hint('explorer.delete'),
                  danger: true,
                  run: () => void removeForGood(view, paths),
                },
              ]
            : []),
        ]
      : []),
  ]
}

export function roomMenu(view: ExplorerView): MenuEntry[] {
  const folder = view.listing?.path
  const writes = changeable(view)
  return [
    ...(writes
      ? [
          {
            label: 'New folder',
            hint: shortcuts.hint('explorer.new-folder'),
            run: () => void newFolder(view),
          },
          ...(fileClipboard.paths.length
            ? [
                {
                  label: 'Paste',
                  hint: shortcuts.hint('fixed.paste'),
                  run: () => void paste(view),
                },
              ]
            : []),
          DIVIDER,
        ]
      : []),
    {
      label: 'Hidden files',
      hint: shortcuts.hint('explorer.hidden'),
      checked: explorerPrefs.hidden,
      run: () => explorerPrefs.toggleHidden(),
    },
    ...(folder
      ? [
          {
            label: showLabel(platform(), false),
            run: () => void reveal(folder, { system: true }),
          },
        ]
      : []),
  ]
}

function sortKeysOf(view: ExplorerView): { key: SortKey; label: string }[] {
  return [
    { key: 'name', label: 'Name' },
    { key: 'modified', label: 'Modified' },
    { key: 'created', label: 'Created' },
    { key: 'size', label: 'Size' },
    { key: 'kind', label: 'Kind' },
    ...(view.search ? [{ key: 'folder' as const, label: 'Folder' }] : []),
  ]
}

export function sortMenu(view: ExplorerView): MenuEntry[] {
  const { key, down } = view.sort
  return [
    ...sortKeysOf(view).map((one) => ({
      label: one.label,
      checked: key === one.key,
      run: () => explorerPrefs.sortOn(one.key),
    })),
    DIVIDER,
    { label: 'Ascending', checked: !down, run: () => explorerPrefs.sortTurned(false) },
    { label: 'Descending', checked: down, run: () => explorerPrefs.sortTurned(true) },
  ]
}
