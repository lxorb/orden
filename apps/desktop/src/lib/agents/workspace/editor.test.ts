// @vitest-environment jsdom
/** A note's editor as an agent uses it (#1078): its selections, marks kept for the note
 *  and drawn again in an editor built later, folds, and the reader's screen moved only
 *  when the agent may move it. */

import { EditorState, EditorView } from '@orden/editor'
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
    return { tab }
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

    // The pane shows another note and then this one again, in an editor built fresh.
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
