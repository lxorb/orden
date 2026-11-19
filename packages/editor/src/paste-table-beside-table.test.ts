import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, test } from 'vitest'
import { parsed } from '../test/parsed'
import { ordenMarkdownExtensions } from './markdown/extensions'
import { placed } from './paste-place'

function stateOf(doc: string, at: number): EditorState {
  return parsed(
    EditorState.create({
      doc,
      selection: EditorSelection.cursor(at),
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
}
function headersIn(state: EditorState): string[] {
  const headers: string[] = []
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'Table') return
      const header = node.node.getChild('TableHeader')
      headers.push(header ? state.doc.sliceString(header.from, header.to) : '')
      return false
    },
  })
  return headers
}
function pasted(doc: string, at: number, text: string): EditorState {
  const state = stateOf(doc, at)
  return parsed(state.update(placed(state, text)).state)
}
const first = '| Name | Age |\n| ---- | --- |\n| Ann  | 30  |'
const second = '| City | Pop |\n| ---- | --- |\n| Oslo | 7   |'
describe('edit32 a table pasted on the blank line beside another table', () => {
  test('on the blank line under a table, the pasted table stays a table of its own', () => {
    const doc = `${first}\n\nMore words.`
    const after = pasted(doc, first.length + 1, second)
    expect(headersIn(after)).toEqual(['| Name | Age |', '| City | Pop |'])
  })
  test('on the blank line above a table, the pasted table stays a table of its own', () => {
    const doc = `Intro.\n\n${first}`
    const after = pasted(doc, 'Intro.\n'.length, second)
    expect(headersIn(after)).toEqual(['| City | Pop |', '| Name | Age |'])
  })
  test('a row pasted on the blank line above a table leaves that table a table', () => {
    const doc = `Intro.\n\n${first}`
    const after = pasted(doc, 'Intro.\n'.length, '| Bob  | 41  |')
    expect(headersIn(after)).toEqual(['| Name | Age |'])
  })
})
