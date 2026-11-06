import type { EditorView } from '@orden/editor'
import type { Command } from './commands'
import { t } from './i18n.svelte'
import type { MenuEntry } from './menu.svelte'
import { shownName } from './note-name'
import { canWriteAt, canWriteIn } from './sharing.svelte'
import { isMarkdownPath } from './space-paths'
import { carvable, mergeable } from './workspace/composing'
import { workspace } from './workspace.svelte'

function mergeTargets(exclude: string) {
  return workspace.notes.filter((note) => note.path !== exclude && isMarkdownPath(note.path))
}

async function askForNote(exclude: string): Promise<string | null> {
  const { prompt } = await import('./prompt.svelte')
  const options = mergeTargets(exclude).map((note) => ({
    id: note.path,
    label: shownName(note.name),
  }))

  if (!options.length) return null

  return prompt.find({ title: t('Merge into'), options, placeholder: t('Note') })
}

function hasSelection(view?: EditorView): boolean {
  return !!view && !view.state.selection.main.empty && !view.state.readOnly
}

function hasRest(view?: EditorView): boolean {
  if (!view || view.state.readOnly) return false
  const at = view.state.selection.main.head
  return view.state.doc.sliceString(at).trim().length > 0
}

function canMerge(path: string | null, view?: EditorView): boolean {
  if (!path || !mergeTargets(path).length || !typable(view)) return false
  return mergeable(workspace.activeSpace?.root ?? null, path, canWriteAt)
}

function canWrite(path: string | null, view?: EditorView): path is string {
  if (!path || !typable(view)) return false
  return carvable(path, canWriteAt)
}

function typable(view?: EditorView): boolean {
  return !view?.state.readOnly && canWriteIn(workspace.active?.note)
}

export function composerCommands(view?: EditorView): Command[] {
  const path = workspace.active?.path ?? null

  return [
    {
      id: 'merge-into',
      label: t('Merge into…'),
      disabled: !canMerge(path, view),
      run: () => {
        if (path) void merge(path)
      },
    },
    {
      id: 'split-at-caret',
      label: t('Split at caret'),
      disabled: !canWrite(path, view) || !hasRest(view),
      run: () => {
        if (view) void workspace.splitAtCaret(view.state.selection.main.head)
      },
    },
    {
      id: 'extract-selection',
      label: t('Extract selection'),
      disabled: !canWrite(path, view) || !hasSelection(view),
      run: () => {
        if (!view) return
        const range = view.state.selection.main
        void workspace.extractSelection(range.from, range.to)
      },
    },
  ]
}

async function merge(path: string) {
  const into = await askForNote(path)
  if (into) await workspace.mergeInto(path, into)
}

export function composerEntries(view?: EditorView): MenuEntry[] {
  return composerCommands(view).map((command) => ({
    label: command.label,
    disabled: command.disabled ?? false,
    run: command.run,
  }))
}
