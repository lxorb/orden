// @vitest-environment jsdom
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { deleteBlocks, duplicateBlocks, moveBlocks, turnBlocksInto } from './commands'
import { editorState } from '../editor'
import { parsed } from '../../test/parsed'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})
const open: EditorView[] = []
afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})
function clickedIn(doc: string, words: string): { view: EditorView; at: number } {
  const view = new EditorView({ state: parsed(editorState({ doc })), parent: document.body })
  open.push(view)
  return { view, at: doc.indexOf(words) + 1 }
}
const wrapped = '> intro\n>\n> first line\n> second line\n>\n> last'
describe('the block menu on a paragraph of two lines inside a quote', () => {
  test('Delete on its second line deletes only that paragraph, not the whole quote', () => {
    const { view, at } = clickedIn(wrapped, 'second line')
    deleteBlocks(view, at)
    expect(view.state.doc.toString()).toBe('> intro\n>\n> last')
  })
  test('Turn into heading on its second line keeps the rest of the quote quoted', () => {
    const { view, at } = clickedIn(wrapped, 'second line')
    turnBlocksInto(view, at, 'heading2')
    expect(view.state.doc.toString()).toBe('> intro\n>\n> ## first line\n> second line\n>\n> last')
  })
  test('Move up on the paragraph below it lands just above it, not at the top of the quote', () => {
    const { view, at } = clickedIn(wrapped, 'last')
    moveBlocks(view, at, -1)
    expect(view.state.doc.toString()).toBe('> intro\n>\n> last\n>\n> first line\n> second line')
  })
  test('Move up on a paragraph under a callout title with body words keeps the title first', () => {
    const { view, at } = clickedIn('> [!note] Tips\n> Body text\n>\n> Second para\n\nafter', 'Second')
    moveBlocks(view, at, -1)
    expect(view.state.doc.toString().split('\n')[0]).toBe('> [!note] Tips')
  })
})
describe('Duplicate on the last paragraph of a callout with words after it', () => {
  test('puts the copy inside the callout', () => {
    const { view, at } = clickedIn('> [!NOTE]\n> one\n>\n> two\n\nafter', 'two')
    duplicateBlocks(view, at)
    expect(view.state.doc.toString()).toBe('> [!NOTE]\n> one\n>\n> two\n>\n> two\n\nafter')
  })
})
describe('Move down on a paragraph of a callout with words after it', () => {
  test('keeps it inside the callout below the paragraph it passes', () => {
    const { view, at } = clickedIn('> [!NOTE]\n> x\n>\n> one\n>\n> two\n\nafter', 'one')
    moveBlocks(view, at, 1)
    expect(view.state.doc.toString()).toBe('> [!NOTE]\n> x\n>\n> two\n>\n> one\n\nafter')
  })
})
describe('Turn into on a list item holding a quote', () => {
  test('numbering a bullet keeps its quote inside the widened item', () => {
    const { view, at } = clickedIn('- a\n  > note\n- b', 'a')
    turnBlocksInto(view, at, 'numbered')
    expect(view.state.doc.toString()).toMatch(/^1\. a\n {3}> note\n/)
  })
})
