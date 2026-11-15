// @vitest-environment jsdom
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeAll, expect, test } from 'vitest'
import { toggleTask } from './commands'
import { createEditor, editorState } from './editor'
import { HeldState } from './held'
import { SharedDoc } from './shared'
import { tickLines } from './task-tick'
import { noteIndex, type TaskHelp } from './wikilink/notes'

const HELP: TaskHelp = {
  tick(note, line) {
    const from = note.split('\n').slice(0, line).join('\n').length + (line ? 1 : 0)
    return Promise.resolve([{ from: from + 3, to: from + 4, insert: 'x' }])
  },
  pick: () => undefined,
  dayAtEnd: () => null,
}

const NOTE = '- [ ] one\n- [ ] two\nplain'

const open: EditorView[] = []

beforeAll(() => {
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList
  Range.prototype.getBoundingClientRect = () => new DOMRect()
})

afterEach(() => {
  for (const view of open.splice(0)) view.destroy()
})

function pressed(change: { from: number; to?: number; insert?: string }): Promise<string> {
  const view = new EditorView({
    state: EditorState.create({
      doc: NOTE,
      selection: EditorSelection.range(0, NOTE.length),
      extensions: [
        markdown({ base: markdownLanguage }),
        noteIndex.of({
          notes: [],
          files: [],
          path: null,
          read: () => Promise.resolve(null),
          tasks: HELP,
        }),
      ],
    }),
    parent: document.body,
  })
  open.push(view)
  toggleTask(view)
  view.dispatch({ changes: change })
  return new Promise((resolve) => setTimeout(() => resolve(view.state.doc.toString()), 50))
}

test('a line written above is kept, and the boxes still tick where they went', async () => {
  expect(await pressed({ from: 0, insert: 'new line\n' })).toBe(
    'new line\n- [x] one\n- [x] two\n- [ ] plain',
  )
})

test('a line taken away meanwhile is not ticked, and the others still are', async () => {
  expect(await pressed({ from: 0, to: 10 })).toBe('- [x] two\n- [ ] plain')
})

test('a line changed meanwhile is left as it now is', async () => {
  expect(await pressed({ from: 6, insert: 'very ' })).toBe('- [ ] very one\n- [x] two\n- [ ] plain')
})

test('two boxes pressed one after the other, before the first is written, are both ticked', async () => {
  const view = new EditorView({
    state: EditorState.create({
      doc: NOTE,
      extensions: [
        markdown({ base: markdownLanguage }),
        noteIndex.of({
          notes: [],
          files: [],
          path: null,
          read: () => Promise.resolve(null),
          tasks: HELP,
        }),
      ],
    }),
    parent: document.body,
  })
  open.push(view)

  view.dispatch({ selection: EditorSelection.cursor(3) })
  toggleTask(view)
  view.dispatch({ selection: EditorSelection.cursor(13) })
  toggleTask(view)
  await new Promise((resolve) => setTimeout(resolve, 50))

  expect(view.state.doc.toString()).toBe('- [x] one\n- [x] two\nplain')
})

function switching(firstText: string, secondText: string) {
  const first = new SharedDoc(firstText)
  const second = new SharedDoc(secondText)
  const view = createEditor({ parent: document.body, shared: first, selection: { anchor: 0 } })
  open.push(view)
  const firstHeld = HeldState.shownIn(first, view)
  const secondHeld = HeldState.waiting(second, editorState({ shared: second }))
  let answer: () => void = () => undefined
  const answered = new Promise<void>((resolve) => {
    answer = resolve
  })
  const slow: TaskHelp = {
    ...HELP,
    tick: (note, line) => answered.then(() => HELP.tick(note, line)),
  }

  return {
    first,
    second,
    view,
    ticking: tickLines(view, slow, view.state.doc, [1]),
    away() {
      firstHeld.take(view)
      secondHeld.give(view)
    },
    answer: () => answer(),
  }
}

test('a box whose pane moves to a note with the same task is ticked in its own note', async () => {
  const pane = switching('- [ ] one\nplain', '- [ ] one\nplain')

  pane.away()
  pane.answer()
  await pane.ticking

  expect(pane.first.text.toString()).toBe('- [x] one\nplain')
  expect(pane.second.text.toString()).toBe('- [ ] one\nplain')
  expect(pane.view.state.doc.toString()).toBe('- [ ] one\nplain')
})

test('a box whose pane moves to another note is ticked in its own note', async () => {
  const pane = switching('- [ ] one\nplain', 'else\n- [ ] one')

  pane.away()
  pane.answer()
  await pane.ticking

  expect(pane.first.text.toString()).toBe('- [x] one\nplain')
  expect(pane.second.text.toString()).toBe('else\n- [ ] one')
})

test('a box whose note changed in the background is ticked where its line went', async () => {
  const pane = switching('- [ ] one\nplain', '- [ ] one\nplain')

  pane.away()
  pane.first.edit([{ from: 0, to: 0, insert: 'new line\n' }])
  pane.answer()
  await pane.ticking

  expect(pane.first.text.toString()).toBe('new line\n- [x] one\nplain')
  expect(pane.second.text.toString()).toBe('- [ ] one\nplain')
})

test('a box whose tab is reused for another note is not ticked in that note', async () => {
  const pane = switching('# Monday\n- [ ] water plants\n', 'else')
  const ticking = tickLines(pane.view, HELP, pane.view.state.doc, [2])

  pane.first.takeOn('# Tuesday\nother\n- [ ] water plants\n')
  pane.answer()
  await ticking
  await pane.ticking

  expect(pane.first.text.toString()).toBe('# Tuesday\nother\n- [ ] water plants\n')
})
