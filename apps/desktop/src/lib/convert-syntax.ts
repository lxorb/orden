import { oneEdit } from '@orden/markdown/edits'

import { converted } from './import/convert'
import { protection } from './protect/protection.svelte'
import type { Change } from './search/apply'
import { changeOf } from './search/replace'
import { isMarkdownPath } from './platform/src/api'
import { workspace } from './workspace.svelte'

export function syntaxChanges(
  notes: readonly { path: string; text: string }[],
  names: readonly string[],
): { changes: Change[]; rewrites: number } {
  const changes: Change[] = []
  let rewrites = 0

  for (const note of notes) {
    if (!isMarkdownPath(note.path) || protection.locked(note.path)) continue

    const said = converted(note.text, names)
    if (!said.changes) continue

    const edit = oneEdit(note.text, said.text)
    if (!edit) continue

    changes.push(changeOf(note.path, note.text, [edit]))
    rewrites += said.changes
  }

  return { changes, rewrites }
}

export async function convertSyntax() {
  const { prompt } = await import('./ui-kit/src/api')
  const open = workspace.active
  const names = workspace.notes.map((one) => one.name)

  const where =
    !open?.path || !isMarkdownPath(open.path)
      ? 'space'
      : await prompt.choose({
          title: 'Convert syntax',
          options: [
            { id: 'note', label: 'In this note', primary: true },
            { id: 'space', label: 'In the whole space' },
          ],
        })

  if (!where) return

  const notes =
    where === 'note' && open?.path
      ? [{ path: open.path, text: (workspace.flush(), open.doc) }]
      : await everyNote()

  const { changes, rewrites } = syntaxChanges(notes, names)

  if (!rewrites) {
    await prompt.confirm({
      title: 'Nothing here needs converting.',
      confirmLabel: 'Close',
    })
    return
  }

  const sure = await prompt.confirm({
    title: rewrites === 1 ? 'Rewrite 1 thing?' : `Rewrite ${rewrites} things?`,
    detail: changes.length === 1 ? 'In 1 note.' : `In ${changes.length} notes.`,
    confirmLabel: 'Rewrite',
  })

  if (sure) await workspace.replaceInNotes(changes)
}

async function everyNote(): Promise<{ path: string; text: string }[]> {
  workspace.flush()
  const found: { path: string; text: string }[] = []

  for (const entry of workspace.notes) {
    if (protection.locked(entry.path)) continue
    const text = await workspace.noteText(entry.path)
    if (text !== null) found.push({ path: entry.path, text })
  }

  return found
}
