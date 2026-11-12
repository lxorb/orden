import { busy } from '../../busy.svelte'
import { shownName } from '../../note-name'
import { insideSpace, nameOf, samePath } from '../../space-paths'
import { workspace } from '../../workspace.svelte'
import type { FileAction } from '../../workspace/undo.svelte'
import type { Thread } from '../chat/types'
import { type FileChange, spaceNamed } from './files'

async function moved(root: string, from: string, to: string): Promise<void> {
  const { movedIn } = await import('../../automation/acts')
  await movedIn(root, from, to, true)
}

function rootOf(change: FileChange, thread: Pick<Thread, 'space'>): string | null {
  const named = change.space
  const space =
    (named ? spaceNamed(workspace.spaces, named) : undefined) ??
    workspace.spaces.find((one) => one.id === thread.space)
  return space?.root ?? null
}

const unmade = new WeakSet()

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
      busy.failed(`Back as ${shownName(nameOf(back))}`)
    }
    return true
  } catch {
    return false
  }
}

const cameBackAt = new WeakMap<FileChange, string>()

export async function redoFile(change: FileChange, thread: Pick<Thread, 'space'>): Promise<void> {
  const root = rootOf(change, thread)
  if (!root) throw new Error(`the space of ${change.path} is not here`)
  if (change.kind === 'moved') await moved(root, change.from, change.path)
  else await workspace.remove(cameBackAt.get(change) ?? insideSpace(root, change.path), false)
}
