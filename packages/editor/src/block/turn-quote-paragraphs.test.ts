// @vitest-environment jsdom
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { turnBlocksInto } from './commands'
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

function turned(doc: string, words: string, shape: Parameters<typeof turnBlocksInto>[2]): string {
  const view = new EditorView({ state: parsed(editorState({ doc })), parent: document.body })
  open.push(view)
  turnBlocksInto(view, doc.indexOf(words) + 1, shape)
  return view.state.doc.toString()
}

const twoParagraphs = 'before\n\n> First words.\n>\n> Second words.\n\nafter'

describe('Turn into on a quote of two paragraphs', () => {
  test('into paragraph leaves no bare quote mark between them', () => {
    expect(turned(twoParagraphs, 'First', 'paragraph')).toBe('before\n\nFirst words.\n\nSecond words.\n\nafter')
  })

  test('into heading leaves no bare quote mark under it', () => {
    expect(turned(twoParagraphs, 'First', 'heading2')).not.toMatch(/^>$/m)
  })

  test('into bullet list leaves no bare quote mark between the items', () => {
    expect(turned(twoParagraphs, 'First', 'bullet')).not.toMatch(/^>$/m)
  })
})
