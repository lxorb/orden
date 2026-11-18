// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { sectionOf } from '@orden/markdown/links'
import { afterEach, beforeAll, describe, expect, test } from 'vitest'
import '@orden/markdown/eager'
import { parsed } from '../test/parsed'
import { moveBlocks } from './block/commands'
import { dropAt } from './block/handle'
import { landing, moveBlock } from './block/move'
import { blockAt } from './block/span'
import { editorState } from './editor'
import { ordenMarkdownExtensions } from './markdown/extensions'

const TABLE = '| a |\n| - |\n| 1 |'

const FENCE = '```\ncode\n```'

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

const open: EditorView[] = []

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

function movedUp(doc: string, words: string): string {
  const view = new EditorView({ state: parsed(editorState({ doc })), parent: document.body })
  open.push(view)
  view.dispatch({ selection: EditorSelection.cursor(doc.indexOf(words) + 1) })
  moveBlocks(view, view.state.selection.main.head, -1)
  return view.state.doc.toString()
}

function stateOf(doc: string) {
  return parsed(
    EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions })],
    }),
  )
}

function dropped(doc: string, words: string, onto: string, upper: boolean): string {
  const state = stateOf(doc)
  const span = blockAt(state, doc.indexOf(words))
  if (!span) throw new Error(`no block at ${words}`)
  const at = dropAt(state, doc.indexOf(onto), () => upper)
  const to = at === null ? null : landing(state, span, at)
  const edit = to === null ? null : moveBlock(state, span, to)
  return edit ? state.update({ changes: edit.changes }).state.doc.toString() : doc
}

describe('dragging a block onto the own-line id of a named block', () => {
  test('a paragraph dropped on the top half of a table id does not land between the table and its id', () => {
    const text = dropped(`intro\n\n${TABLE}\n\n^tid\n\nend`, 'end', '^tid', true)
    expect(sectionOf(text, { heading: null, block: 'tid' })).toBe(TABLE)
  })

  test('a paragraph dropped on the top half of a paragraph id does not land between the words and their id', () => {
    const text = dropped('intro\n\nwords\n\n^pid\n\nend', 'end', '^pid', true)
    expect(sectionOf(text, { heading: null, block: 'pid' })).toBe('words')
  })
})

describe('Move up on the block right under a block named by an own-line id', () => {
  test('a paragraph under a named table does not land between the table and its id', () => {
    const text = movedUp(`intro\n\n${TABLE}\n\n^tid\n\nend`, 'end')
    expect(sectionOf(text, { heading: null, block: 'tid' })).toBe(TABLE)
  })

  test('a paragraph under a named code fence does not land between the code and its id', () => {
    const text = movedUp(`intro\n\n${FENCE}\n\n^fid\n\nend`, 'end')
    expect(sectionOf(text, { heading: null, block: 'fid' })).toBe(FENCE)
  })
})
