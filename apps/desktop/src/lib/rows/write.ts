import type { DateValue, DurationValue, LinkValue, Row, TaskChange, Value } from '@orden/bases'
import { listAsWritten, noteValues, taskHash, tick, todayOf } from '@orden/bases'
import { appliedEdits, oneEdit, type TextEdit } from '@orden/markdown/edits'
import { type Property, keyCalled, readProperties } from '@orden/markdown/properties'
import {
  type ListItem,
  listItems,
  listLines,
  withItem,
  writeList,
  writeProperty,
} from '@orden/markdown/property-edits'
import { writeTask } from '@orden/markdown/task-edits'
import { readTask } from '@orden/markdown/task-line'
import { changeOf } from '@orden/scan/search/replace'
import { type HoldsNotes, noteText, replaceInNotes } from '../workspace/note-text'

export interface RowChange {
  note?: Record<string, Value | null>
  task?: TaskChange
  list?: Record<string, ListChange>
}

export type ListChange = { add: string } | { remove: number }

export async function writeRow(
  ws: HoldsNotes,
  path: string,
  row: Row,
  change: RowChange,
): Promise<boolean> {
  const before = await noteText(ws, path)
  if (before === null) return false

  const after = changed(before, row, change)
  if (after === null) return false

  const edit = oneEdit(before, after)
  if (!edit) return false

  return (await replaceInNotes(ws, [changeOf(path, before, [edit])])) > 0
}

export function changed(text: string, row: Row, change: RowChange): string | null {
  let after = text

  for (const [key, value] of Object.entries(change.note ?? {})) {
    const edit = propertyEdit(after, key, value)
    if (edit === undefined) return null
    if (edit) after = appliedEdits(after, [edit])
  }

  for (const [key, edit] of Object.entries(change.list ?? {})) {
    const list = asList(after, key)
    if (!list) return null
    const items = listChanged(list.property, edit)
    if (!items) continue
    const written = list.write(items)
    if (written) after = appliedEdits(after, [written])
  }

  if (change.task && Object.keys(change.task).length) {
    if (!row.anchor) return null
    const at = taskLine(after, row.anchor)
    if (at === null) return null

    const { done, ...rest } = change.task
    const line = after.slice(at.from, at.to)
    const edits = writeTask(line, rest).map((edit) => ({
      from: edit.from + at.from,
      to: edit.to + at.from,
      insert: edit.insert,
    }))
    after = appliedEdits(after, edits)
    if (done != null) after = ticked(after, at.from, done)
  }

  return after
}

function ticked(text: string, from: number, done: boolean): string {
  const end = text.indexOf('\n', from)
  const line = text.slice(from, end === -1 ? text.length : end).replace(/\r$/, '')
  const fields = readTask(line)
  if (!fields || fields.done === done) return text

  const today = todayOf()
  if (done && fields.cancelled) {
    const edits = writeTask(line, { done: true, cancelledOn: null })
    return appliedEdits(
      text,
      edits.map((edit) => ({ ...edit, from: edit.from + from, to: edit.to + from })),
    )
  }
  return appliedEdits(text, tick(text, text.slice(0, from).split('\n').length - 1, today))
}

export function taskLine(
  text: string,
  anchor: { line: number; hash: string },
): { from: number; to: number } | null {
  const lines: { from: number; to: number }[] = []
  for (let from = 0; from <= text.length;) {
    const end = text.indexOf('\n', from)
    const stop = end === -1 ? text.length : end
    lines.push({ from, to: text[stop - 1] === '\r' ? stop - 1 : stop })
    if (end === -1) break
    from = end + 1
  }

  const names = (at: number) => {
    const line = lines[at]
    if (!line) return false
    const fields = readTask(text.slice(line.from, line.to))
    return fields !== null && taskHash(fields.text) === anchor.hash
  }

  for (let distance = 0; distance < lines.length; distance++) {
    if (names(anchor.line - distance)) return lines[anchor.line - distance] ?? null
    if (distance && names(anchor.line + distance)) return lines[anchor.line + distance] ?? null
  }
  return null
}

function asList(
  text: string,
  key: string,
): { property: Property; write: (items: ListItem[]) => TextEdit | null } | null {
  const empty: Property = { key, kind: 'list', value: '', items: [], from: 0, to: 0 }
  const whole = (property: Property) => ({
    property,
    write: (items: ListItem[]) => writeList(text, key, items),
  })
  const rows = readProperties(text)
  if (!rows) {
    const found = listAsWritten(text, key)
    if (found === null) return null
    if (found === 'absent') return whole(empty)
    return {
      property: found.property,
      write: (items) => ({
        from: found.from,
        to: found.to,
        insert: listLines(found.property.key, items, text),
      }),
    }
  }
  const found = keyCalled(rows, key)
  if (found?.kind === 'map') return null
  if (!found) return whole(empty)
  if (found.kind === 'list') return whole(found)
  if (found.value === '') return whole({ ...empty, key: found.key })
  return whole({
    ...empty,
    key: found.key,
    items: [found.value],
    ...(found.quoted ? { quotedItems: [true] } : {}),
  })
}

function listChanged(property: Property, edit: ListChange): ListItem[] | null {
  if ('add' in edit) return withItem(property, edit.add)
  if (edit.remove < 0 || edit.remove >= property.items.length) return null
  return listItems(property).filter((_, at) => at !== edit.remove)
}

function propertyEdit(text: string, key: string, value: Value): TextEdit | null | undefined {
  if (value === null) return writeProperty(text, key, null)
  if (Array.isArray(value)) {
    const kept = keptMembers(text, key)
    return writeList(
      text,
      key,
      value.map(
        (one) =>
          kept(one) ??
          (one === null || typeof one === 'number' || typeof one === 'boolean'
            ? one
            : (written(one) ?? '')),
      ),
    )
  }
  if (typeof value === 'boolean') return writeProperty(text, key, String(value), 'checkbox')
  if (typeof value === 'number') return writeProperty(text, key, String(value), 'number')
  const said = written(value)
  if (said === null) return undefined
  return writeProperty(text, key, said, hasKind(value, 'date') ? 'date' : 'text')
}

function keptMembers(text: string, key: string): (value: Value) => ListItem | null {
  const list = asList(text, key)?.property
  const values = list ? noteValues(text)[list.key] : undefined
  if (!list || !Array.isArray(values) || values.length !== list.items.length) return () => null
  const members = listItems(list)
  const left = values.map((one, at) => ({ said: JSON.stringify(one), member: members[at] }))
  return (value) => {
    const said = JSON.stringify(value)
    const at = left.findIndex((one) => one.said === said)
    if (at === -1) return null
    const [found] = left.splice(at, 1)
    return found?.member ?? null
  }
}

function hasKind<K extends 'date' | 'duration' | 'link'>(
  value: Value,
  kind: K,
): value is Extract<DateValue | DurationValue | LinkValue, { kind: K }> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && value.kind === kind
}

function written(value: Value): string | null {
  if (value === null) return ''
  if (typeof value !== 'object') return String(value)
  if (Array.isArray(value)) return value.map((one) => written(one) ?? '').join(', ')
  if (hasKind(value, 'link')) {
    return value.display ? `[[${value.target}|${value.display}]]` : `[[${value.target}]]`
  }
  if (hasKind(value, 'date')) return value.time ? `${value.iso}T${value.time}` : value.iso
  if (hasKind(value, 'duration')) return `${Math.round(value.ms / 60_000)}m`
  return null
}
