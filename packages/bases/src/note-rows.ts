import { findLinks } from '@orden/markdown/links'
import { tagsIn } from '@orden/markdown/task-line'
import { INBOX_NAME, INBOX_PATH } from './inbox'
import { noteValues } from './note-values'
import { type ScannedTask, scanRows, type Stamp } from './scan'
import { fileInfo, taskRowsOf } from './task-rows'
import { LIST_KEYS } from './todo-lists'
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

function withoutListKeys(meta: NoteRead['meta']): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(meta ?? {}))
    if (!LIST_KEYS.has(name)) out[name] = value
  return out
}

export function rowsOf(space: string, read: NoteRead): Row[] {
  const inbox = read.path === INBOX_PATH
  const file = inbox
    ? { ...fileInfo(read), name: `${INBOX_NAME}.md`, basename: INBOX_NAME }
    : fileInfo(read)
  const note: Record<string, Value> = {
    ...(read.front === null ? {} : noteValues(read.front)),
    ...withoutListKeys(read.meta),
  }
  const tasks = taskRowsOf(space, read.path, read.tasks, file, note)
  if (inbox) return tasks
  const own: Row = { kind: 'note', space, path: read.path, file, note }
  return [own, ...tasks]
}

export function rowsOfText(
  space: string,
  path: string,
  text: string,
  stamp: Stamp | null = null,
): Row[] {
  const scanned = scanRows(text)
  const tags = [...new Set(tagsIn(text).map((tag) => tag.toLowerCase()))]
  const links = findLinks(text).map((link) => ({ target: link.target, embed: link.embed }))
  return rowsOf(space, { path, front: scanned.front, tasks: scanned.tasks, stamp, tags, links })
}

export function movedRows(rows: readonly Row[], path: string, space: string): Row[] {
  const first = rows[0]
  if (!first) return []

  const { name, basename, folder, ext } = fileInfo({ path, stamp: null, tags: [], links: [] })
  const file: FileInfo = { ...first.file, path, name, basename, folder, ext }
  return rows.map((row) => ({ ...row, space, path, file }))
}
