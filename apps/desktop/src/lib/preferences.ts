import type { EditorView } from '@nib/editor'
import { resetFields } from './reset-fields'
import { generalPane } from './settings/general-pane'
import { editorPane } from './settings/editor-pane'
import { spellingPane } from './settings/spelling-pane'
import { kindsPane } from './settings/kinds-pane'
import { markdownPane } from './settings/markdown-pane'
import { appearancePane } from './settings/appearance-pane'
import { glassesPanes } from './settings/glasses-pane'
import { exportPane } from './settings/export-pane'
import type { Pane } from './settings/fields'

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

/** Built against a live view so a change lands in the editor on screen. */
export function preferences(view?: EditorView): Pane[] {
  // One moment for every example on the pane, so the options read as one set of
  // spellings of the same time rather than as four different times.
  const moment = new Date()

  return [
    generalPane(),
    editorPane(view, moment),
    spellingPane(view),
    kindsPane(),
    markdownPane(view),
    appearancePane(),
    ...glassesPanes(),
    exportPane(),
  ]
}

/** Whether every field in the pane knows what it started as. */
export function resettable(pane: Pane): boolean {
  return pane.groups.every((group) =>
    group.fields.every((field) => field.kind === 'value' || field.initial !== undefined),
  )
}

/** Puts every field in the pane back to what it started as; see reset-fields.ts. */
export function resetPane(pane: Pane) {
  resetFields(pane.groups.flatMap((group) => group.fields))
}
