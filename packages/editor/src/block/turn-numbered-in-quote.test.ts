// @vitest-environment jsdom
import { syntaxTree } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { parsed } from '../../test/parsed'
import { editorState } from '../editor'
import { turnBlocksInto } from './commands'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

const open: EditorView[] = []

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

function turnedToText(doc: string, words: string): EditorView {
  const view = new EditorView({ state: parsed(editorState({ doc })), parent: document.body })
  open.push(view)
  turnBlocksInto(view, doc.indexOf(words) + 1, 'paragraph')
  view.setState(parsed(view.state))
  return view
}

function inNumberedList(view: EditorView, words: string): boolean {
  const at = view.state.doc.toString().indexOf(words)
  for (let node = syntaxTree(view.state).resolveInner(at, 1).node; node.parent; node = node.parent) {
    if (node.name === 'OrderedList') return true
  }
  return false
}

describe('Turn into Text on the first item of a numbered list inside a callout', () => {
  test('keeps the items after it a numbered list', () => {
    const view = turnedToText('> [!NOTE]\n> 1. Preheat\n> 2. Mix\n> 3. Bake', 'Preheat')
    expect(view.state.doc.line(2).text).toBe('> Preheat')
    expect(inNumberedList(view, 'Mix')).toBe(true)
    expect(inNumberedList(view, 'Bake')).toBe(true)
  })

  test('keeps the items after it a numbered list inside a quote', () => {
    const view = turnedToText('> Steps:\n>\n> 1. Preheat\n> 2. Mix\n> 3. Bake', 'Preheat')
    expect(inNumberedList(view, 'Mix')).toBe(true)
  })

  test('keeps nested items after it a numbered list under their bullet', () => {
    const view = turnedToText('> [!NOTE]\n> - Cake\n>   1. Preheat\n>   2. Mix', 'Preheat')
    expect(inNumberedList(view, 'Mix')).toBe(true)
  })
})
