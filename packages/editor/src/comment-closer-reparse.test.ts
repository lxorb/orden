// @vitest-environment jsdom
import { ensureSyntaxTree } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'
import { type Tree, TreeFragment } from '@lezer/common'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { createEditor } from './editor'
import { ordenMarkdownParser } from './markdown/extensions'

const AROUND = Array.from({ length: 10 }, (_, at) => `Paragraph ${at} of the note.`).join('\n\n')

const NOTE = `${AROUND}\n\nMeeting notes %% private\nthought here\n%% back to words\n\n${AROUND}\n`

const LINE_END = NOTE.indexOf('thought here') + 'thought here'.length

const open: EditorView[] = []

function settle(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms))
}

function opened(): EditorView {
  const view = createEditor({ parent: document.body, doc: NOTE, selection: { anchor: 0 } })
  open.push(view)
  ensureSyntaxTree(view.state, NOTE.length, 5000)
  return view
}

async function typed(view: EditorView, at: number): Promise<void> {
  view.dispatch({
    changes: { from: at, insert: 'x' },
    selection: { anchor: at + 1 },
    userEvent: 'input.type',
  })
  await settle(200)
}

function comments(tree: Tree, doc: string): string[] {
  const found: string[] = []
  tree.iterate({
    enter: (node) => {
      if (node.name === 'CommentBlock' || node.name === 'PercentComment') {
        found.push(`${node.name} ${doc.slice(node.from, node.to)}`)
      }
    },
  })
  return found
}

beforeAll(async () => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
  await typed(opened(), NOTE.indexOf('thought here'))
})

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

describe('typing at the end of the line above the closing %% of a comment spanning paragraph lines', () => {
  test('reads as a fresh parse of the note', () => {
    const doc = `${NOTE.slice(0, LINE_END)}x${NOTE.slice(LINE_END)}`
    const fragments = TreeFragment.applyChanges(
      TreeFragment.addTree(ordenMarkdownParser.parse(NOTE)),
      [{ fromA: LINE_END, toA: LINE_END, fromB: LINE_END, toB: LINE_END + 1 }],
    )
    expect(comments(ordenMarkdownParser.parse(doc, fragments), doc)).toEqual(
      comments(ordenMarkdownParser.parse(doc), doc),
    )
  })

  test('in the editor, does not turn the closing line into a comment block hiding the rest of the note', async () => {
    const view = opened()
    await settle(50)
    await typed(view, LINE_END)
    const doc = view.state.doc.toString()
    const tree = ensureSyntaxTree(view.state, doc.length, 5000)
    expect(tree).not.toBeNull()
    if (!tree) return
    expect(comments(tree, doc)).toEqual(['PercentComment %% private\nthought herex\n%%'])
  })
})
