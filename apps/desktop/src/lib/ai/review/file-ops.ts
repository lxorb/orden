/** A file change of a thread's taken back, or done again for Redo (files.ts says what
 *  the changes are). A move is moved back the way the agent moved it, links and all; a
 *  deleted note comes back out of Recently deleted, or from the snapshot taken as it
 *  went, the way the tree's own Undo puts it back (workspace/undoing.ts), and that undo
 *  step is dropped so it cannot write the note a second time. Both are fetched with the
 *  first Undo: the move's machinery carries the app's menus with it. */

import { busy } from '../../busy.svelte'
import { t } from '../../i18n.svelte'
import { shownName } from '../../note-name'
import { insideSpace, nameOf, samePath } from '../../space-paths'
import { workspace } from '../../workspace.svelte'
import type { FileAction } from '../../workspace/undo.svelte'
import type { Thread } from '../chat/types'
import { type FileChange, spaceNamed } from './files'

/** A file moved the way an agent's move moves it. */
async function moved(root: string, from: string, to: string): Promise<void> {
  const { movedIn } = await import('../../automation/acts')
  // Taken back: an agent's move off the space's instructions puts them back.
  await movedIn(root, from, to, true)
}

/** The folder of the space a change was made in: the one the call said, else the
 *  thread's, for a call of before calls said it. */
function rootOf(change: FileChange, thread: Pick<Thread, 'space'>): string | null {
  const named = change.space
  const space =
    (named ? spaceNamed(workspace.spaces, named) : undefined) ??
    workspace.spaces.find((one) => one.id === thread.space)
  return space?.root ?? null
}

const unmade = new WeakSet()

/** The step that deleted `path`, newest first, if it is still on the stack: on its own,
 *  or the first of a delete and the unnesting it caused. */
function deletion(path: string): Extract<FileAction, { kind: 'delete' }> | null {
  for (const action of [...workspace.undone.stack].reverse()) {
    const step = action.kind === 'many' ? action.steps[0] : action
    if (step?.kind === 'delete' && !unmade.has(step) && samePath(step.path, path)) return step
  }
  return null
}

export function markUnmade(path: string): void {
  const step = deletion(path)
  if (step) unmade.add(step)
}

/** Takes one change back. Answers whether it was. */
export async function undoFile(
  change: FileChange,
  thread: Pick<Thread, 'space'>,
): Promise<boolean> {
  const root = rootOf(change, thread)
  if (!root) return false
  try {
    if (change.kind === 'moved') {
      await moved(root, change.path, change.from)
      return true
    }
    const step = deletion(insideSpace(root, change.path))
    if (!step) return false
    const { putBack } = await import('../../workspace/undoing')
    const back = await putBack(step)
    // Off the tree's own Undo, which would otherwise write it back a second time; here
    // rather than a method of the stack's, which is in the first paint.
    workspace.undone.stack = workspace.undone.stack.flatMap((one): FileAction[] =>
      one === step
        ? []
        : one.kind === 'many'
          ? [{ ...one, steps: one.steps.filter((x) => x !== step) }]
          : [one],
    )
    cameBackAt.set(change, back)
    await workspace.fileCame(back, 'file', undefined, undefined, true)
    await workspace.loadTree()
    if (!samePath(back, insideSpace(root, change.path))) {
      busy.failed(t('Back as {name}', { name: shownName(nameOf(back)) }))
    }
    return true
  } catch {
    // Something has since taken the name, or the copy is gone: left as it is, and the
    // row stays for the reader to see.
    return false
  }
}

/** Where a delete taken back landed, for a Redo: beside whatever took its name, which is the
 *  reader's and is not what the agent deleted. */
const cameBackAt = new WeakMap<FileChange, string>()

/** Does a change taken back again: the move made again, the note deleted again. Throws
 *  where it could not, for the Redo to stop and say. */
export async function redoFile(change: FileChange, thread: Pick<Thread, 'space'>): Promise<void> {
  const root = rootOf(change, thread)
  if (!root) throw new Error(`the space of ${change.path} is not here`)
  if (change.kind === 'moved') await moved(root, change.from, change.path)
  else await workspace.remove(cameBackAt.get(change) ?? insideSpace(root, change.path), false)
}
