import { oneEdit } from '@orden/markdown/edits'
import { reverse } from '@orden/scan/search/replace'
import type { NoteDoc } from '../../documents/src/api'
import type { FileActions } from '../../file-undo/src/api'
import { writeFile } from '../../file-writes/src/api'
import { folderOf, invoke, joinPath, nameOf, onDisk, samePath, sameSpelling } from '../../platform/src/api'
import { renameSteps, isFolderNote } from '../../tree/src/api'
import { busy } from '../../ui-kit/src/api'
import { sameName, stemOf, titleOf } from './title-name'

export interface Retitles {
  readonly undone: FileActions
  nameTaken(dir: string, except?: string): (name: string) => boolean
  rename(path: string, name: string): Promise<void>
  documentAt(path: string): NoteDoc | null
}
function worded(text: string, words: string): string | null {
  const title = titleOf(text)
  return title && text.slice(0, title.from) + words + text.slice(title.to)
}
export function replaced(path: string, before: string, after: string) {
  const edit = oneEdit(before, after)
  return {
    kind: 'replace' as const,
    notes: [{ path, content: before, after, edits: edit ? reverse(before, [edit]) : [] }],
  }
}
export async function retitle(
  note: NoteDoc | null,
  path: string,
  target: string,
  words?: string,
): Promise<{ before: string; after: string } | null> {
  const was = stemOf(path)
  const now = stemOf(target)
  const before = note
    ? note.text
    : now === null
      ? null
      : await invoke<string>('read_note', { path: target }).catch(() => null)
  const title = before === null ? null : titleOf(before)
  if (before === null || title === null || was === null || now === null || !sameName(title.words, was)) return null
  const after = worded(before, words ?? now)
  if (after === null || after === before) return null
  if (note) {
    note.replace(after, note.dirty)
    note.dirty = true
  } else await writeFile(target, after)
  return { before, after }
}
export async function renameByTitle(ws: Retitles, path: string, name: string, was: string): Promise<void> {
  const extension = /\.[^./\\]+$/.exec(path)?.[0] ?? '.md'
  const steps = isFolderNote(path) ? renameSteps(path, name + extension) : [{ path, name: name + extension }]
  for (const step of steps) {
    const dir = folderOf(step.path)
    const there = joinPath(dir, step.name)
    if (sameSpelling(there, step.path)) continue
    if (ws.nameTaken(dir, step.path)(step.name) || (await onDisk(there))) {
      busy.failed(
        `Could not rename ${stemOf(path) ?? nameOf(path)} to ${name}: a note with that name already exists here.`,
      )
      return
    }
  }
  await ws.undone.batch(async () => {
    for (const step of steps) {
      const landed = joinPath(folderOf(step.path), step.name)
      await ws.rename(step.path, step.name)
      if (!samePath(step.path, path)) continue
      const after = ws.documentAt(landed)?.text ?? null
      const before = after === null ? null : worded(after, was)
      if (after !== null && before !== null && before !== after) ws.undone.record(replaced(landed, before, after))
    }
  })
}
