// @vitest-environment jsdom
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { editorState } from './editor'
import { foldLines } from './fold'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

const open: EditorView[] = []

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

const paragraph = 'Some words about the plan for the week, written out as a note would be. '.repeat(4)

function noteWith(before: number): string {
  const lead = Array.from({ length: before }, () => paragraph).join('\n\n')
  return `# Week\n\n${lead}\n\n> [!faq]- Why so long?\n> Because it is.\n> And more.\n\nAfter.\n`
}

describe('a callout the note says is shut, further down a note', () => {
  test('opens folded in a short note', () => {
    const doc = noteWith(2)
    const view = new EditorView({ state: editorState({ doc }), parent: document.body })
    open.push(view)
    expect(foldLines(view.state)).toHaveLength(1)
  })

  test('opens folded when a few screens of words come before it', () => {
    const doc = noteWith(20)
    expect(doc.indexOf('> [!faq]-')).toBeGreaterThan(5000)
    const view = new EditorView({ state: editorState({ doc }), parent: document.body })
    open.push(view)
    expect(foldLines(view.state)).toHaveLength(1)
  })
})
