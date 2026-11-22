import type { EditorView } from '@orden/editor'
import { generalPane } from './general-pane'
import { editorPane } from './editor-pane'
import { spellingGroups } from './spelling-pane'
import { kindsPane } from './kinds-pane'
import { markdownGroups } from './markdown-pane'
import { appearancePane } from './appearance-pane'
import { experimentalPane } from './experimental-pane'
import { browserPane } from './browser-pane'
import { terminalPane } from './terminal-pane'
import type { Field, Pane } from './fields'
import { changed } from '../../usage/src/api'

export type { Caption, Field, Group, PairField, Pane, PictureSide, Segment, SwatchOption } from './fields'
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
  const editor = editorPane(view, moment)
  return [
    generalPane(),
    { ...editor, groups: [...editor.groups, ...markdownGroups(view), ...spellingGroups(view)] },
    kindsPane(),
    appearancePane(),
    browserPane(),
    terminalPane(),
    experimentalPane(),
  ]
}
