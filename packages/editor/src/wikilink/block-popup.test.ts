// @vitest-environment jsdom
import { autocompletion, currentCompletions, startCompletion } from '@codemirror/autocomplete'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, test } from 'vitest'
import { ordenMarkdownExtensions } from '../markdown/extensions'
import { wikilinkCompletions } from './complete'
import { type NoteIndex, noteIndex } from './notes'

const GROCERIES = '# Groceries\n\nBuy these on Friday.\n\n- milk\n- eggs\n'

const index: NoteIndex = {
  notes: [
    { path: 'Groceries.md', name: 'Groceries', headings: ['Groceries'], blocks: [], aliases: [] },
  ],
  files: [],
  path: 'Today.md',
  read: () => Promise.resolve(GROCERIES),
}

const views: EditorView[] = []

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
})

const settle = () => new Promise((done) => setTimeout(done, 200))

async function shownAfterTyping(opening: string, typed: string): Promise<string[]> {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: opening,
      selection: EditorSelection.cursor(opening.length),
      extensions: [
        markdown({ base: markdownLanguage, extensions: ordenMarkdownExtensions }),
        noteIndex.of(index),
        autocompletion({ override: [wikilinkCompletions], activateOnTypingDelay: 0 }),
      ],
    }),
  })
  views.push(view)
  startCompletion(view)
  await settle()
  for (const letter of typed) {
    const at = view.state.selection.main.head
    view.dispatch({
      changes: { from: at, insert: letter },
      selection: { anchor: at + 1 },
      userEvent: 'input.type',
    })
    await settle()
  }
  return currentCompletions(view.state).map((one) => one.label)
}

describe('the block popup of a named note in the editor', () => {
  test('lists the note blocks once [[Groceries#^ is typed', async () => {
    expect(await shownAfterTyping('[[Groceries#', '^')).toContain('Buy these on Friday.')
  })

  test('lists the block whose words are typed after the caret mark', async () => {
    expect(await shownAfterTyping('[[Groceries#^', 'milk')).toContain('milk')
  })

  test('the heading popup of the same note does list its headings', async () => {
    expect(await shownAfterTyping('[[Groceries#', 'Gro')).toContain('Groceries')
  })
})
