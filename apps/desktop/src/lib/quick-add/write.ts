import { changeOf } from '../search/replace'
import { readIfThere, toldIfUnreadable } from '../read-if-there'
import { workspace } from '../workspace.svelte'
import { noteText, replaceInNotes } from '../workspace/note-text'
import { type Entry, linesOf, placeIn } from './entry'

let adding: Promise<unknown> = Promise.resolve()

export async function addTask(
  entry: Entry,
  options: { open?: boolean } = {},
): Promise<{ path: string; line: number } | null> {
  const added = adding.then(() => addOne(entry))
  adding = added.catch(() => undefined)
  const landed = await added
  if (landed && options.open) {
    await workspace.open(landed.path)
    workspace.goto = { ...landed }
  }
  return landed
}

async function addOne(entry: Entry): Promise<{ path: string; line: number } | null> {
  const path = await (await import('../rows/inbox-note')).inboxNote()
  if (path === null) return null

  let before: string
  try {
    before = (await noteText(workspace, path)) ?? (await readIfThere(path)) ?? ''
  } catch (error) {
    return toldIfUnreadable(error)
  }
  const placed = placeIn(before, linesOf(entry))
  await replaceInNotes(workspace, [
    changeOf(path, before, [{ from: placed.at, to: placed.at, insert: placed.insert }]),
  ])
  return { path, line: placed.line }
}
