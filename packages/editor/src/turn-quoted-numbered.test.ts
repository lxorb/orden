// @vitest-environment jsdom
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { parsed } from '../test/parsed'
import { turnBlocksInto } from './block/commands'
import { editorState } from './editor'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

const open: EditorView[] = []

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

function turned(doc: string, words: string, shape: 'paragraph' | 'heading1'): string {
  const view = new EditorView({ state: parsed(editorState({ doc })), parent: document.body })
  open.push(view)
  turnBlocksInto(view, doc.indexOf(words), shape)
  return view.state.doc.toString()
}

describe('Turn into on a quote that holds a numbered list', () => {
  test('Text does not write numbers into the words of later items', () => {
    const doc = turned('intro\n\n> 1. Preheat\n> 2. Mix\n> 3. Bake\n\nend', '> 1.', 'paragraph')
    expect(doc).not.toMatch(/Mix\d|Bake\d/)
    expect(doc).toContain('Mix')
    expect(doc).toContain('Bake')
  })

  test('Heading does not write numbers into the words of later lines', () => {
    const doc = turned('> 1. Preheat\n> 2. Mix\n> 3. Bake', 'Preheat', 'heading1')
    expect(doc.startsWith('# Preheat')).toBe(true)
    expect(doc).not.toMatch(/Mix\d|Bake\d/)
  })
})
