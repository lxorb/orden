// @vitest-environment jsdom
import { syntaxTree } from '@codemirror/language'
import { EditorSelection } from '@codemirror/state'
import { EditorView, runScopeHandlers } from '@codemirror/view'
import { renderMarkdown } from '@orden/markdown'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { parsed } from '../test/parsed'
import { editorState } from './editor'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})
const open: EditorView[] = []
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})
function enterBefore(doc: string, words: string): string {
  const view = new EditorView({ state: parsed(editorState({ doc })), parent: document.body })
  open.push(view)
  view.dispatch({ selection: EditorSelection.cursor(doc.indexOf(words)) })
  runScopeHandlers(view, new KeyboardEvent('keydown', { key: 'Enter' }), 'editor')
  return view.state.doc.toString()
}
function listsIn(doc: string): string[] {
  const names: string[] = []
  syntaxTree(parsed(editorState({ doc }))).iterate({
    enter: (node) => {
      if (node.name === 'BulletList' || node.name === 'OrderedList') names.push(node.name)
    },
  })
  return names
}
describe('Enter at the start of the first item of a list right under a line of words', () => {
  test('a numbered list stays a numbered list', () => {
    const written = enterBefore('Steps:\n1. Preheat the oven\n2. Mix', 'Preheat')
    expect(listsIn(written)).toContain('OrderedList')
    expect(renderMarkdown(written)).toContain('<ol>')
  })
  test('a bullet list does not turn its new item into words of the line above', () => {
    const written = enterBefore('Shopping:\n- milk\n- eggs', 'milk')
    expect(renderMarkdown(written)).toContain('<p>Shopping:</p>')
  })
  test('a numbered list nested under an item stays a list in the editor', () => {
    const written = enterBefore('- Parent\n  1. first\n  2. second', 'first')
    expect(listsIn(written)).toContain('OrderedList')
  })
})
