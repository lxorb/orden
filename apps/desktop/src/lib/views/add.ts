import { type Base, nextId, rowsInBase, type Value } from '@orden/bases'
import { noteName, plainValue, rowPlace, withProperties } from '@orden/bases/agent'
import { joinPath, insideOnly, folderOf, insideSpace, within } from '../platform/src/api'
import { contextFor } from './context'
import { nowHere, todayHere } from './days'
import { templatePath, templateWords } from './templates'
import { rows } from '../rows/rows.svelte'
import { canWriteAt } from '../sharing.svelte'
import { workspace } from '../workspace.svelte'
import { writeFile } from '../workspace/write-file'
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

export async function addNote(
  base: Base,
  at: number,
  file: string | null,
  group?: { property: string; key: Value },
  made: NewNote = {},
): Promise<string | null> {
  const space =
    (file === null ? null : workspace.spaces.find((one) => within(one.root, file) !== null)) ??
    workspace.activeSpace
  if (!space) return null
  const view = base.views[at]
  const place = rowPlace(base, view?.name)
  const folder =
    place.folder !== undefined && place.folder !== '' ? insideOnly(place.folder) : undefined
  if (folder === null) return null
  const dir =
    folder !== undefined ? insideSpace(space.root, folder) : file ? folderOf(file) : space.root
  if (!canWriteAt(dir)) return null

  const props: Record<string, unknown> = { ...place.properties }
  const key = group?.key
  if (
    group &&
    isNoteProperty(group.property) &&
    (typeof key === 'string' || typeof key === 'number')
  ) {
    props[bare(group.property)] = key
  }
  for (const [name, value] of Object.entries(made.properties ?? {})) props[name] = plainValue(value)
  Object.assign(props, idFor(base, space))

  const title = noteName(made.title ?? 'Untitled')
  const name = await workspace.freeNameOnDisk(dir, `${title}.md`)
  const link =
    made.template === undefined ? (view?.orden.template ?? base.orden.template) : made.template
  const template = link ? templatePath(link, space) : null
  const words = template === null ? '' : await templateWords(template, name.replace(/.md$/i, ''))
  const path = joinPath(dir, name)
  await writeFile(path, withProperties(words, props))
  await workspace.loadTree()
  await workspace.fileCame(path, 'file')
  if (made.open !== false) await workspace.open(path)
  return path
}
