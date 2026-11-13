import type { TextEdit } from '@orden/markdown/edits'
import { CodeBlocks, WORDS } from '@orden/markdown/fences'
import { frontMatterBlock } from '@orden/markdown/front-matter'
import { taskLine } from '@orden/markdown/task-edits'
import type { TaskFields } from '@orden/markdown/task-line'
import type { QuickFields } from '../language/parse'

export interface Entry {
  text: string
  fields: QuickFields
  description?: string
}

export function taskOf(entry: Entry): TaskFields {
  const { fields } = entry
  const task: TaskFields = {
    text: entry.text,
    status: ' ',
    done: false,
    cancelled: false,
    remind: fields.remind,
    priority: fields.priority ?? 4,
    tags: fields.tags,
    dependsOn: [],
    fields: {},
  }
  if (fields.due !== undefined) task.start = fields.due
  if (fields.time !== undefined) task.time = fields.time
  if (fields.recurrence !== undefined) task.recurrence = fields.recurrence
  if (fields.assignee !== undefined) task.assignee = fields.assignee
  if (fields.deadline !== undefined) task.deadline = fields.deadline
  if (fields.duration !== undefined) task.duration = fields.duration
  return task
}

export function linesOf(entry: Entry): string[] {
  const words = (entry.description ?? '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line, index, all) => line !== '' || (index > 0 && index < all.length - 1))
  return [taskLine(taskOf(entry)), ...words.map((line) => (line === '' ? '' : `  ${line}`))]
}

export interface Placed {
  at: number
  insert: string
  line: number
}

const HEADING = /^(#{1,6})[ \t]+(.*?)[ \t#]*$/
const ITEM = /^(?:[-*+]|\d+[.)])[ \t]/

function headingsOf(
  note: string,
  all: readonly string[],
): ({ level: number; text: string } | null)[] {
  const block = frontMatterBlock(note)
  const wordsFrom = block ? note.slice(0, block.close).split('\n').length : 0
  const code = new CodeBlocks()
  return all.map((line, index) => {
    if (index < wordsFrom || code.line(line) !== WORDS) return null
    const found = HEADING.exec(line)
    return found ? { level: found[1]?.length ?? 1, text: found[2] ?? '' } : null
  })
}

function endsInList(lines: readonly string[], first: number, last: number): boolean {
  for (let index = last; index >= first; index--) {
    const line = lines[index] ?? ''
    if (line.trim() === '') return false
    if (ITEM.test(line)) return true
    if (!/^[ \t]/.test(line)) return false
  }
  return false
}

function lastWords(lines: readonly string[], first: number, end: number): number {
  for (let index = end - 1; index >= first; index--) {
    if ((lines[index] ?? '').trim() !== '') return index
  }
  return -1
}

export function placeIn(note: string, lines: readonly string[], heading?: string): Placed {
  const eol = note.includes('\r\n') ? '\r\n' : '\n'
  const all = note.split(/\r?\n/)
  const offsets: number[] = []
  let offset = 0
  for (const line of all) {
    offsets.push(offset)
    offset += line.length + eol.length
  }
  const endOf = (index: number) => (offsets[index] ?? 0) + (all[index]?.length ?? 0)
  const block = lines.join(eol)

  let first = 0
  let end = all.length
  if (heading !== undefined) {
    const wanted = heading.trim().toLowerCase()
    const headings = headingsOf(note, all)
    const at = headings.findIndex((one) => one?.text.toLowerCase() === wanted)
    if (at === -1) {
      const last = lastWords(all, 0, all.length)
      const opening = `## ${heading.trim()}`
      if (last === -1) return { at: 0, insert: `${opening}${eol}${block}${eol}`, line: 1 }
      return { at: endOf(last), insert: `${eol}${eol}${opening}${eol}${block}`, line: last + 3 }
    }
    const level = headings[at]?.level ?? 1
    first = at + 1
    const next = headings.findIndex((one, index) => index > at && (one?.level ?? 7) <= level)
    end = next === -1 ? all.length : next
    const last = lastWords(all, first, end)
    if (last === -1) return { at: endOf(at), insert: `${eol}${block}`, line: at + 1 }
    const joins = endsInList(all, first, last)
    return {
      at: endOf(last),
      insert: joins ? `${eol}${block}` : `${eol}${eol}${block}`,
      line: last + (joins ? 1 : 2),
    }
  }

  const last = lastWords(all, first, end)
  if (last === -1) return { at: 0, insert: `${block}${eol}`, line: 0 }
  const joins = endsInList(all, first, last)
  return {
    at: endOf(last),
    insert: joins ? `${eol}${block}` : `${eol}${eol}${block}`,
    line: last + (joins ? 1 : 2),
  }
}

export function placedEdit(placed: Placed): TextEdit {
  return { from: placed.at, to: placed.at, insert: placed.insert }
}
