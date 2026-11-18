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

function viewOf(doc: string): EditorView {
  const view = new EditorView({ state: parsed(editorState({ doc })), parent: document.body })
  open.push(view)
  return view
}

function clickedIn(doc: string, words: string): { view: EditorView; at: number } {
  return { view: viewOf(doc), at: doc.indexOf(words) + 1 }
}

function quotedThroughout(doc: string): boolean {
  return doc.split('\n').every((line) => line.startsWith('>'))
}

describe('the block menu on a block inside a callout or quote', () => {
  test('Delete on a list item in a callout keeps the items below it in the callout', () => {
    const { view, at } = clickedIn('> [!NOTE]\n> - milk\n> - eggs\n> - bread', 'eggs')
    deleteBlocks(view, at)
    expect(view.state.doc.toString()).toBe('> [!NOTE]\n> - milk\n> - bread')
  })

  test('Delete on a paragraph in a quote leaves one quote', () => {
    const { view, at } = clickedIn('> one\n>\n> two\n>\n> three', 'two')
    deleteBlocks(view, at)
    expect(view.state.doc.toString()).toBe('> one\n>\n> three')
  })

  test('Duplicate on a paragraph in a callout puts the copy inside the callout', () => {
    const { view, at } = clickedIn('> [!TIP]\n> one\n>\n> two', 'two')
    duplicateBlocks(view, at)
    const doc = view.state.doc.toString()
    expect(doc.match(/two/g)?.length).toBe(2)
    expect(quotedThroughout(doc)).toBe(true)
  })

  test('Move up on a list item in a callout keeps it under the callout title', () => {
    const { view, at } = clickedIn('> [!NOTE]\n> - milk\n> - eggs', 'eggs')
    moveBlocks(view, at, -1)
    const doc = view.state.doc.toString()
    expect(doc.split('\n')[0]).toBe('> [!NOTE]')
    expect(quotedThroughout(doc)).toBe(true)
  })

  test('Turn into heading on a paragraph in a callout keeps it in the callout', () => {
    const { view, at } = clickedIn('> [!NOTE]\n> one\n>\n> two', 'two')
    turnBlocksInto(view, at, 'heading2')
    expect(view.state.doc.toString()).toBe('> [!NOTE]\n> one\n>\n> ## two')
  })

  test('Turn into numbered list on an item in a callout keeps it in the callout', () => {
    const { view, at } = clickedIn('> [!NOTE]\n> - one\n> - two', 'two')
    turnBlocksInto(view, at, 'numbered')
    expect(quotedThroughout(view.state.doc.toString())).toBe(true)
  })

  test('Delete on a paragraph between two quotes keeps the quotes apart', () => {
    const { view, at } = clickedIn('> a\n\npara\n\n> b', 'para')
    deleteBlocks(view, at)
    expect(view.state.doc.toString()).toBe('> a\n\n> b')
  })

  test('Move up on a quote below another quote keeps the two quotes apart', () => {
    const { view, at } = clickedIn('> a\n\n> b', 'b')
    moveBlocks(view, at, -1)
    expect(view.state.doc.toString()).toBe('> b\n\n> a')
  })
})
