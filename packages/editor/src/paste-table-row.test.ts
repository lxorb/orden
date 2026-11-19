import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState, type SelectionRange } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { placed } from './paste-place'

function stateOf(doc: string, selection: EditorSelection | SelectionRange): EditorState {
  return parsed(
    EditorState.create({
      doc,
      selection,
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
}
function tablesIn(state: EditorState): number[] {
  const rows: number[] = []
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'Table') return
      rows.push(node.node.getChildren('TableRow').length)
      return false
    },
  })
  return rows
}
const table = '| Name | Age |\n| ---- | --- |\n| Ann  | 30  |\n| Bob  | 41  |'
describe('edit31 a table row copied in Orden and pasted inside the same table', () => {
  test('pasted at the start of a row, the table stays one table with the new row in it', () => {
    const state = stateOf(table, EditorSelection.cursor(table.indexOf('| Ann')))
    const after = parsed(state.update(placed(state, '| Bob  | 41  |\n')).state)
    expect(tablesIn(after)).toEqual([3])
  })
  test('pasted over a triple-clicked row, the table stays one table', () => {
    const from = table.indexOf('| Ann')
    const to = table.indexOf('| Bob')
    const state = stateOf(table, EditorSelection.range(from, to))
    const after = parsed(state.update(placed(state, '| Cat  | 25  |\n')).state)
    expect(tablesIn(after)).toEqual([2])
  })
})
