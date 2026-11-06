import { readTask } from '@orden/markdown/task-line'
import { type ScannedTask, scanRows, type Stamp } from './scan'
import { taskHash } from './task-hash'
import type { FileInfo, Row, TaskRow, Value } from './types'

const NONE: never[] = []
Object.freeze(NONE)
const NO_FIELDS: Record<string, string> = Object.freeze({})

interface FileRead {
  path: string
  stamp: Stamp | null
  tags: readonly string[]
  links: readonly { target: string; embed: boolean }[]
}

export function fileInfo(read: FileRead): FileInfo {
  const name = read.path.slice(read.path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  const slash = read.path.lastIndexOf('/')

  return {
    name,
    basename: dot > 0 ? name.slice(0, dot) : name,
    path: read.path,
    folder: slash === -1 ? '' : read.path.slice(0, slash),
    ext: dot > 0 ? name.slice(dot + 1) : '',
    size: read.stamp?.size ?? 0,
    ctime: read.stamp?.ctime ?? 0,
    mtime: read.stamp?.mtime ?? 0,
    tags: read.tags.length ? [...read.tags] : NONE,
    links: targets(read.links, false),
    embeds: targets(read.links, true),
  }
}

function targets(links: FileRead['links'], embeds: boolean): string[] {
  const out = links.filter((one) => one.embed === embeds && one.target).map((one) => one.target)
  return out.length ? out : NONE
}

export function taskRowsOf(
  space: string,
  path: string,
  tasks: readonly ScannedTask[],
  file: FileInfo,
  note: Record<string, Value>,
): Row[] {
  const rows: Row[] = []
  const above: { indent: number; line: number }[] = []
  let section = ''

  for (const scanned of tasks) {
    const fields = readTask(`- [${scanned.mark}] ${scanned.text}`)
    if (!fields) continue

    const under = scanned.section.join('\n')
    if (under !== section) above.length = 0
    section = under
    while ((above.at(-1)?.indent ?? -1) >= scanned.indent) above.pop()
    const parent = above.at(-1)?.line
    above.push({ indent: scanned.indent, line: scanned.line })

    const task: TaskRow = Object.assign(fields, {
      section: scanned.section,
      indent: scanned.indent,
      remind: fields.remind.length ? fields.remind : NONE,
      tags: fields.tags.length ? fields.tags : NONE,
      dependsOn: fields.dependsOn.length ? fields.dependsOn : NONE,
      fields: Object.keys(fields.fields).length ? fields.fields : NO_FIELDS,
      ...(parent === undefined ? {} : { parent }),
      ...(scanned.description === undefined ? {} : { description: scanned.description }),
      ...(scanned.comments === undefined ? {} : { comments: scanned.comments }),
    })
    rows.push({
      kind: 'task',
      space,
      path,
      anchor: { line: scanned.line, hash: taskHash(fields.text) },
      file,
      note,
      task,
    })
  }
  return rows
}

export function scannedTaskRows(space: string, path: string, tasks: readonly ScannedTask[]): Row[] {
  return taskRowsOf(space, path, tasks, fileInfo({ path, stamp: null, tags: [], links: [] }), {})
}

export function taskRowsOfText(space: string, path: string, text: string): Row[] {
  return scannedTaskRows(space, path, scanRows(text).tasks)
}
