import { copyText } from '../clipboard'
import { t } from '../i18n.svelte'
import { fileClipboard } from '../list-landing.svelte'
import { DIVIDER, type MenuEntry } from '../menu-item'
import { showLabel } from '../reveal'
import { shortcuts } from '../shortcuts.svelte'
import { workspace } from '../workspace.svelte'
import { carry, changeable, duplicate, newFolder, paste, removeForGood, trash } from './changes'
import { type Entry, openWithSystem, showInSystem } from './commands'
import { inASpace, openFile, ordenOpens } from './open'
import { places } from './places.svelte'
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
      label: t('Open'),
      run: () => (entry.folder ? void view.go(path) : void openFile(path, entry.name)),
    },
    ...(!entry.folder && inASpace(path) && ordenOpens(entry.name)
      ? [{ label: t('Open with the system app'), run: () => void openWithSystem(path) }]
      : []),
    { label: t(showLabel()), run: () => void showInSystem(path) },
    DIVIDER,
    ...(writes
      ? [
          {
            label: t('Cut'),
            hint: shortcuts.hint('fixed.cut'),
            run: () => fileClipboard.hold(paths, true),
          },
        ]
      : []),
    {
      label: t('Copy'),
      hint: shortcuts.hint('fixed.copy'),
      run: () => fileClipboard.hold(paths, false),
    },
    ...(writes && entry.folder && fileClipboard.paths.length
      ? [
          {
            label: t('Paste'),
            hint: shortcuts.hint('fixed.paste'),
            run: () =>
              void carry(view, fileClipboard.paths, path, fileClipboard.cut ? 'move' : 'copy'),
          },
        ]
      : []),
    ...(other
      ? [
          { label: t('Copy to the other pane'), run: () => void carry(view, paths, other, 'copy') },
          ...(writes
            ? [
                {
                  label: t('Move to the other pane'),
                  run: () => void carry(view, paths, other, 'move'),
                },
              ]
            : []),
        ]
      : []),
    DIVIDER,
    ...(writes
      ? [
          { label: t('Duplicate'), run: () => void duplicate(view, paths) },
          {
            label: t('Rename'),
            hint: shortcuts.hint('tree.rename'),
            run: () => (view.renaming = entry.name),
          },
        ]
      : []),
    { label: t('Copy path'), run: () => void copyText(paths.join('\n')) },
    ...(entry.folder && !places.isPinned(path)
      ? [{ label: t('Pin to Places'), run: () => places.pin(path) }]
      : []),
    ...(writes
      ? [
          DIVIDER,
          {
            label: t('Move to Trash'),
            hint: shortcuts.hint('tree.delete'),
            danger: true,
            run: () => void trash(view, paths),
          },
          ...(outside
            ? [
                {
                  label: t('Delete for good'),
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
            label: t('New folder'),
            hint: shortcuts.hint('explorer.new-folder'),
            run: () => void newFolder(view),
          },
          ...(fileClipboard.paths.length
            ? [
                {
                  label: t('Paste'),
                  hint: shortcuts.hint('fixed.paste'),
                  run: () => void paste(view),
                },
              ]
            : []),
          DIVIDER,
        ]
      : []),
    {
      label: t('Hidden files'),
      hint: shortcuts.hint('explorer.hidden'),
      checked: explorerPrefs.hidden,
      run: () => explorerPrefs.toggleHidden(),
    },
    ...(folder ? [{ label: t(showLabel()), run: () => void showInSystem(folder) }] : []),
  ]
}
