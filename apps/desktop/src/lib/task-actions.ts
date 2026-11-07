import type { TaskOut } from '@orden/bases/tasks'
import { modes } from './modes.svelte'
import { changeOf } from './search/replace'
import { canWriteAt } from './sharing.svelte'
import { insideSpace } from './space-paths'
import type { Ticked } from './task-turns'
import { workspace } from './workspace.svelte'
import { replaceInNotes } from './workspace/note-text'

export async function addTask(
  text: string,
  options: { root?: string; typed?: boolean } = {},
): Promise<{ path: string; line: number } | null> {
  const said = text.trim()
  if (!said) return null
  const into = options.root === undefined ? {} : { root: options.root }
  if (options.typed === false) {
    const write = await import('./quick-add/write')
    return write.addTask({ text: said, fields: { tags: [], remind: [] } }, into)
  }
  const [{ parseQuickAdd }, { i18n }, write] = await Promise.all([
    import('@orden/bases/language'),
    import('./i18n.svelte'),
    import('./quick-add/write'),
  ])
  const root = options.root ?? workspace.activeSpace?.root
  const notes = root === undefined ? {} : { notes: write.noteNames(root) }
  const read = parseQuickAdd(said, [i18n.language], new Date(), notes)
  return write.addTask(
    {
      text: read.text || said,
      fields: read.fields,
      ...(read.note === undefined ? {} : { note: read.note }),
      ...(read.heading === undefined ? {} : { heading: read.heading }),
    },
    into,
  )
}

export async function tickTask(at: string, space: string, done: boolean): Promise<Ticked | null> {
  const root = workspace.spaces.find((one) => one.name === space)?.root
  if (root === undefined) return null
  const [{ clockOf, editedTask, readAt }, { oneEdit }] = await Promise.all([
    import('@orden/bases/tasks'),
    import('@orden/markdown/edits'),
  ])
  const anchor = readAt(at)
  const path = insideSpace(root, anchor.path)
  if (!canWriteAt(path)) return null
  const before = await workspace.noteText(path)
  if (before === null) return null

  let edited: { text: string; at: string }
  try {
    edited = editedTask(before, space, anchor.path, anchor, {}, done, clockOf(new Date()).today)
  } catch {
    return null
  }
  const after = edited.text
  const edit = oneEdit(before, after)
  const back = async () => {
    const now = await workspace.noteText(path)
    if (now !== after) return false
    const undo = oneEdit(after, before)
    if (!undo) return true
    return (await replaceInNotes(workspace, [changeOf(path, after, [undo])])) > 0
  }
  if (!edit) return { at: edited.at, back }
  if ((await replaceInNotes(workspace, [changeOf(path, before, [edit])])) === 0) return null
  return { at: edited.at, back }
}

export async function listed(filter?: string): Promise<{ total: number; tasks: TaskOut[] }> {
  if (__EVEN_PLUGIN__) throw new Error('no rows store on the glasses')
  const { rows } = await import('./rows/rows.svelte')
  if (!filter) {
    const { clockOf, taskOut, todayTasks } = await import('@orden/bases/tasks')
    const today = todayTasks(rows.shown(), clockOf(new Date()).today, modes.undatedInToday)
    return { total: today.length, tasks: today.slice(0, 50).map(taskOut) }
  }

  const { clockOf, listTasks } = await import('@orden/bases/agent')
  const names = new Set(
    rows
      .of()
      .filter((row) => row.kind === 'note')
      .map((row) => row.file.basename.toLowerCase()),
  )
  return listTasks(
    rows.shown(),
    { filter, inboxes: rows.inboxes(), isNote: (name) => names.has(name.toLowerCase()) },
    clockOf(new Date()),
  )
}
