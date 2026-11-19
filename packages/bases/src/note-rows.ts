import { noteValues } from './note-values'
import type { ScannedTask, Stamp } from './scan'
import { fileInfo, taskRowsOf } from './task-rows'
import type { FileInfo, Row, Value } from './types'

export interface NoteRead {
  path: string
  front: string | null
  tasks: readonly ScannedTask[]
  stamp: Stamp | null
  tags: readonly string[]
  links: readonly { target: string; embed: boolean }[]
  meta?: Readonly<Record<string, string>> | null | undefined
}
export function rowsOf(space: string, read: NoteRead): Row[] {
  const file = fileInfo(read)
  const note: Record<string, Value> = {
    ...(read.front === null ? {} : noteValues(read.front)),
    ...(read.meta ?? {}),
  }
  const tasks = taskRowsOf(space, read.path, read.tasks, file, note)
  const own: Row = { kind: 'note', space, path: read.path, file, note }
  return [own, ...tasks]
}
export function movedRows(rows: readonly Row[], path: string, space: string): Row[] {
  const first = rows[0]
  if (!first) return []
  const { name, basename, folder, ext } = fileInfo({ path, stamp: null, tags: [], links: [] })
  const file: FileInfo = { ...first.file, path, name, basename, folder, ext }
  return rows.map((row) => ({ ...row, space, path, file }))
}
