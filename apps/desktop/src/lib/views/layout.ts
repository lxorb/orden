import type { Base, Row } from '@orden/bases'
import { editorOf, knownProperties, optionsOf } from './columns'
import { setGroup, setLayout, setNibOption } from './edit'
import type { Layout } from './words'

export function switched(base: Base, at: number, layout: Layout, rows: readonly Row[]): Base {
  let next = setLayout(base, at, layout)
  const view = next.views[at]
  if (!view) return next
  const kinds = view.nib.rows ?? 'notes'

  if (layout === 'kanban' && !view.groupBy) {
    const property =
      kinds === 'notes'
        ? (knownProperties(base, kinds, rows).find(
            (one) => one.startsWith('note.') && optionsOf(base, one).length,
          ) ?? 'note.status')
        : 'task.status'
    next = setGroup(next, at, { property, direction: 'ASC' })
  }

  if ((layout === 'calendar' || layout === 'timeline') && kinds === 'notes' && !view.nib.date) {
    const date = knownProperties(base, kinds, rows).find(
      (one) => one.startsWith('note.') && editorOf(base, one, rows) === 'date',
    )
    next = setNibOption(next, at, 'date', date ?? 'file.ctime')
  }
  return next
}
