import type { EditorView } from '@orden/editor'
import { resetFields } from './reset-fields'
import { generalPane } from './settings/general-pane'
import { editorPane } from './settings/editor-pane'
import { spellingPane } from './settings/spelling-pane'
import { kindsPane } from './settings/kinds-pane'
import { markdownPane } from './settings/markdown-pane'
import { appearancePane } from './settings/appearance-pane'
import { exportPane } from './settings/export-pane'
import { experimentalPane } from './settings/experimental-pane'
import type { Field, Pane } from './settings/fields'
import { changed } from './usage/src/api'

export type {
  Caption,
  Field,
  Group,
  PairField,
  Pane,
  PictureSide,
  Segment,
  SwatchOption,
} from './settings/fields'

export function preferences(view?: EditorView): Pane[] {
  return declaredPanes(view).map((pane) => ({
    ...pane,
    groups: pane.groups.map((group) => ({
      ...group,
      fields: group.fields.map(tallied),
    })),
  }))
}

function tallied(field: Field): Field {
  if (field.kind === 'switch') {
    const set = (on: boolean) => {
      changed(field.key, on)
      field.set(on)
    }
    return { ...field, set }
  }
  if (field.kind === 'select' || field.kind === 'segmented' || field.kind === 'swatches') {
    const set = (value: string) => {
      changed(field.key, value)
      field.set(value)
    }
    return { ...field, set }
  }
  return field
}

export function declaredPanes(view?: EditorView): Pane[] {
  const moment = new Date()

  return [
    generalPane(),
    editorPane(view, moment),
    spellingPane(view),
    kindsPane(),
    markdownPane(view),
    appearancePane(),
    experimentalPane(),
    exportPane(),
  ]
}

export function resettable(pane: Pane): boolean {
  return pane.groups.every((group) =>
    group.fields.every((field) => field.kind === 'value' || field.initial !== undefined),
  )
}

export function resetPane(pane: Pane) {
  resetFields(pane.groups.flatMap((group) => group.fields))
}
