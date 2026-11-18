import { type Base, nextId, noteValues, rowsInBase, type Value } from '@orden/bases'
import { noteName, plainValue, rowPlace, withProperties } from '@orden/bases/agent'
import { joinPath, insideOnly, folderOf, insideSpace, spaceHolding } from '../../platform/src/api'
import { contextFor } from './context'
import { nowHere, todayHere } from './days'
import { templatePath, templateWords } from './templates'
import { rows } from '../../rows/src/api'
import { canWriteAt } from '../../sharing/src/api'
import { workspace } from '../../workspace/src/api'
import { writeFile } from '../../file-writes/src/api'
import { bare, isNoteProperty } from './columns'

export interface NewNote {
  title?: string
  properties?: Record<string, Value>
  template?: string | null
  open?: boolean
}

function idFor(base: Base, space: { name: string }): Record<string, string> {
  const id = base.orden.id
  if (!id) return {}
  const mine = rows.of(space.name)
  const context = contextFor({ rows: mine, today: todayHere(), now: nowHere() })
  const own = rowsInBase(base, mine, context)
  return own.partial ? {} : { [id.property]: nextId(own.rows, id.property, id.prefix) }
}

function frontValue(value: Value): unknown {
  if (Array.isArray(value)) return value.map(frontValue)
  if (value === null || typeof value !== 'object' || !('kind' in value) || value.kind !== 'link')
    return plainValue(value)
  const { target, display } = value
  if (typeof target !== 'string') return plainValue(value)
  return typeof display === 'string' && display ? `[[${target}|${display}]]` : `[[${target}]]`
}

export const askedProperties = (asked: Record<string, Value> = {}): Record<string, unknown> =>
  Object.fromEntries(Object.entries(asked).map(([name, value]) => [name, frontValue(value)]))

export function groupProperties(group?: { property: string; key: Value }): Record<string, unknown> {
  if (!group || !isNoteProperty(group.property)) return {}
  const key = group.key
  const kept =
    typeof key === 'string' ||
    typeof key === 'number' ||
    typeof key === 'boolean' ||
    (key !== null &&
      typeof key === 'object' &&
      'kind' in key &&
      (key.kind === 'date' || key.kind === 'link'))
  return kept ? { [bare(group.property)]: frontValue(key) } : {}
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function listed(value: unknown): unknown[] {
  if (Array.isArray(value)) return value as unknown[]
  return value === undefined || value === null ? [] : [value]
}

export function joinedProperties(
  ...layers: readonly Record<string, unknown>[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const layer of layers) {
    for (const [name, value] of Object.entries(layer)) {
      const now = out[name]
      if (!Array.isArray(now) && !Array.isArray(value)) {
        out[name] = value
        continue
      }
      const all = [...listed(now), ...listed(value)]
      out[name] = all.filter((one, at) => all.findIndex((other) => sameValue(one, other)) === at)
    }
  }
  return out
}

export function withTemplate(
  words: string,
  props: Record<string, unknown>,
): Record<string, unknown> {
  if (!words.startsWith('---')) return props
  const own = noteValues(words)
  const lists = Object.fromEntries(
    Object.keys(props).flatMap((name) => {
      const value = own[name]
      return Array.isArray(value) ? [[name, frontValue(value)]] : []
    }),
  )
  return joinedProperties(lists, props)
}

export async function addNote(
  base: Base,
  at: number,
  file: string | null,
  group?: { property: string; key: Value },
  made: NewNote = {},
): Promise<string | null> {
  const space =
    (file === null ? null : spaceHolding(workspace.spaces, file)) ?? workspace.activeSpace
  if (!space) return null
  const view = base.views[at]
  const place = rowPlace(base, view?.name)
  const folder =
    place.folder !== undefined && place.folder !== '' ? insideOnly(place.folder) : undefined
  if (folder === null) return null
  const dir =
    folder !== undefined ? insideSpace(space.root, folder) : file ? folderOf(file) : space.root
  if (!canWriteAt(dir)) return null

  const title = noteName(made.title ?? 'Untitled')
  const name = await workspace.freeNameOnDisk(dir, `${title}.md`)
  const link =
    made.template === undefined ? (view?.orden.template ?? base.orden.template) : made.template
  const template = link ? templatePath(link, space) : null
  const words = template === null ? '' : await templateWords(template, name.replace(/.md$/i, ''))
  const props = withTemplate(
    words,
    joinedProperties(place.properties, groupProperties(group), askedProperties(made.properties)),
  )
  Object.assign(props, idFor(base, space))
  const path = joinPath(dir, name)
  await writeFile(path, withProperties(words, props))
  await workspace.loadTree()
  await workspace.fileCame(path, 'file')
  if (made.open !== false) await workspace.open(path)
  return path
}
