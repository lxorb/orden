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
  const [{ parseQuickAdd }, { region }, write] = await Promise.all([
    import('@orden/bases/language'),
    import('./region'),
    import('./quick-add/write'),
  ])
  const root = options.root ?? workspace.activeSpace?.root
  const notes = root === undefined ? {} : { notes: write.noteNames(root) }
  const read = parseQuickAdd(said, [region()], new Date(), notes)
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
    if ((await replaceInNotes(workspace, [changeOf(path, after, [undo])])) === 0) return false
    await dated(root, anchor.path, space, after, before)
    return true
  }
  if (!edit) return { at: edited.at, back }
  if ((await replaceInNotes(workspace, [changeOf(path, before, [edit])])) === 0) return null
  await dated(root, anchor.path, space, before, after)
  return { at: edited.at, back }
}

async function dated(root: string, relative: string, space: string, before: string, after: string) {
  const [{ clockOf, taskRowsOfText }, { datesChanged }, { listedAt }] = await Promise.all([
    import('@orden/bases/tasks'),
    import('@orden/bases/todo-lists'),
    import('./rows/todo-lists'),
  ])
  if (!listedAt(root, relative)) return
  const path = insideSpace(root, relative)
  const rows = (text: string) => taskRowsOfText(space, relative, text)
  const meta = workspace.itemMeta.of(path, root)
  const patch = datesChanged(rows(before), rows(after), meta, clockOf(new Date()).today)
  if (patch) workspace.itemMeta.set(path, patch, root)
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
