// @vitest-environment jsdom

import { EditorState, EditorView } from '@orden/editor'
import { select } from '@orden/editor/agent-hands'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { callerOf } from '../../automation/caller'

interface FakeTab {
  id: string
  kind: string
  paneId: string
  note: { path: string | null }
}
const tabs: FakeTab[] = [
  { id: 'n1', kind: 'note', paneId: 'p1', note: { path: '/s/Work/Plan.md' } },
  { id: 'n2', kind: 'note', paneId: 'p1', note: { path: '/s/Work/Other.md' } },
]
const showing: Record<string, string> = { p1: 'n1' }
vi.mock('../../workspace.svelte', () => ({
  workspace: {
    get tabs() {
      return tabs
    },
    showing: (pane: string) => tabs.find((one) => one.id === showing[pane]) ?? null,
  },
}))

const locked = new Set<string>()
vi.mock('../../protect/src/api', () => ({
  protection: { agentsMay: (path: string) => !locked.has(path) },
}))

const views = {
  held: new Map<string, EditorView>(),
  onPut: null as ((pane: string, view: EditorView) => void) | null,
  of(pane: string) {
    return this.held.get(pane)
  },
  put(pane: string, view: EditorView) {
    this.held.set(pane, view)
    this.onPut?.(pane, view)
  },
}
vi.mock('../../views.svelte', () => ({ views }))

vi.mock('./tab-target', () => ({
  namedTab: (call: { args: { tab?: unknown } }) => {
    const tab = tabs.find((one) => one.id === call.args.tab)
    if (!tab) throw new Error('no tab')
    return { tab, relative: tab.note.path }
  },
}))

const { noteEditor, keepMarksOf } = await import('./editor')

const open: EditorView[] = []
function editorFor(pane: string, doc: string): EditorView {
  const view = new EditorView({ state: EditorState.create({ doc }), parent: document.body })
  open.push(view)
  views.put(pane, view)
  return view
}

function call(args: Record<string, unknown>, scopes = ['editor']) {
  return {
    verb: 'note_editor',
    args,
    caller: callerOf({ id: 'claude', name: 'Claude', scopes, mode: 'unsupervised' }),
  }
}

beforeEach(() => {
  showing.p1 = 'n1'
  editorFor('p1', 'teh plan\nsecond line\n')
})
afterEach(() => {
  keepMarksOf(new Set())
  for (const view of open.splice(0)) view.destroy()
  views.held.clear()
})

describe('a note’s editor', () => {
  test('a protected note the reader has not let agents read shows an agent nothing of itself', () => {
    locked.add('/s/Work/Plan.md')
    try {
      for (const args of [
        { op: 'selection' },
        { op: 'select', selections: [{ anchor: { line: 1, ch: 0 }, head: { line: 2, ch: 0 } }] },
        { op: 'fold', line: 1 },
        { op: 'reveal', line: 2 },
        { op: 'mark', marks: [{ from: { line: 1 }, to: { line: 1 }, message: 'x' }] },
      ]) {
        expect(() =>
          noteEditor(call({ tab: 'n1', ...args }, ['editor', 'workspace.focus'])),
        ).toThrow(/protected/)
      }
    } finally {
      locked.clear()
    }
  })

  test('its selections are read, and set only by an agent that may move the reader', () => {
    expect(noteEditor(call({ tab: 'n1', op: 'selection' }))).toMatchObject({
      result: { selections: [{ anchor: { line: 1, ch: 0 }, head: { line: 1, ch: 0 } }] },
    })
    const select = {
      tab: 'n1',
      op: 'select',
      selections: [{ anchor: { line: 2, ch: 0 }, head: { line: 2, ch: 6 } }],
    }
    expect(() => noteEditor(call(select))).toThrow(/workspace.focus/)
    expect(noteEditor(call(select, ['editor', 'workspace.focus']))).toMatchObject({
      result: { selections: [{ text: 'second' }] },
    })
  })

  test('at most 500 selections are set or read, with at most 20000 characters of their words', () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: `${'word '.repeat(6000)}\n${'x\n'.repeat(700)}`,
        extensions: EditorState.allowMultipleSelections.of(true),
      }),
      parent: document.body,
    })
    open.push(view)
    views.put('p1', view)
    const focus = ['editor', 'workspace.focus']
    const place = (line: number) => ({ line, ch: 0 })
    const many = (count: number) =>
      Array.from({ length: count }, (_, at) => ({ anchor: place(at + 2), head: place(at + 2) }))
    expect(() =>
      noteEditor(call({ tab: 'n1', op: 'select', selections: many(501) }, focus)),
    ).toThrow(/at most 500 selections/)
    expect(view.state.selection.ranges).toHaveLength(1)

    select(view, [{ anchor: place(1), head: { line: 1, ch: 30_000 } }, ...many(599)])
    const read = noteEditor(call({ tab: 'n1', op: 'selection' })) as {
      result: { selections: { text: string; truncated?: true }[]; more?: number }
    }
    expect(read.result.selections).toHaveLength(500)
    expect(read.result.more).toBe(100)
    expect(read.result.selections[0]?.text).toHaveLength(20_000)
    expect(read.result.selections[0]?.truncated).toBe(true)
  })

  test('at most 500 marks, each saying at most 2000 characters', () => {
    const mark = (message: string) => ({
      from: { line: 1, ch: 0 },
      to: { line: 1, ch: 3 },
      message,
    })
    expect(() =>
      noteEditor(
        call({ tab: 'n1', op: 'mark', marks: Array.from({ length: 501 }, () => mark('x')) }),
      ),
    ).toThrow(/at most 500 marks/)
    expect(() =>
      noteEditor(call({ tab: 'n1', op: 'mark', marks: [mark('x'.repeat(2001))] })),
    ).toThrow(/at most 2000 characters/)
    expect(document.querySelector('.cm-agent-mark')).toBeNull()
  })

  test('marks are drawn, kept for the note and drawn again in an editor built later', () => {
    noteEditor(
      call({
        tab: 'n1',
        op: 'mark',
        marks: [
          {
            from: { line: 1, ch: 0 },
            to: { line: 1, ch: 3 },
            message: 'the?',
            severity: 'warning',
          },
        ],
      }),
    )
    expect(document.querySelector('.cm-agent-mark-warning')?.getAttribute('title')).toBe('the?')

    for (const view of open.splice(0)) view.destroy()
    editorFor('p1', 'teh plan\nsecond line\n')
    expect(document.querySelector('.cm-agent-mark-warning')?.getAttribute('title')).toBe('the?')

    noteEditor(call({ tab: 'n1', op: 'clear_marks' }))
    expect(document.querySelector('.cm-agent-mark')).toBeNull()
  })

  test('marks go with an agent that goes', () => {
    noteEditor(
      call({
        tab: 'n1',
        op: 'mark',
        marks: [{ from: { line: 1, ch: 0 }, to: { line: 1, ch: 3 }, message: 'x' }],
      }),
    )
    keepMarksOf(new Set(['codex']))
    expect(document.querySelector('.cm-agent-mark')).toBeNull()
  })

  test('a note not on screen has no editor but keeps its marks for when it is', () => {
    expect(() => noteEditor(call({ tab: 'n2', op: 'selection' }))).toThrow(/not on screen/)
    expect(
      noteEditor(
        call({
          tab: 'n2',
          op: 'mark',
          marks: [{ from: { line: 1, ch: 0 }, to: { line: 1, ch: 2 }, message: 'later' }],
        }),
      ),
    ).toMatchObject({ result: { marks: 1 } })
  })

  test('a line is revealed only by an agent that may move the reader', () => {
    expect(() => noteEditor(call({ tab: 'n1', op: 'reveal', line: 2 }))).toThrow(/workspace.focus/)
    expect(
      noteEditor(call({ tab: 'n1', op: 'reveal', line: 2 }, ['editor', 'workspace.focus'])),
    ).toMatchObject({
      result: { line: 2 },
    })
  })
})
