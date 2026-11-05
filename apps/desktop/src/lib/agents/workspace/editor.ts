/** A note's editor, as a VS Code extension's `TextEditor`: `note_editor` (docs/agent-native.md
 *  8.15, #1078).
 *
 *  Its own scope, `editor`. The tab is a note's tab of the reader's, shown in its pane -
 *  an editor exists only there:
 *
 *  - `selection` reads the selections, the main one first, by line (from 1) and
 *    character (from 0); `select` sets them, several carets where there are several.
 *    That moves the reader's caret, so it needs `workspace.focus`, as `reveal` (a line
 *    brought into view) does (#1070).
 *  - `mark` draws the agent's marks - an underline with a message, as an extension's
 *    diagnostics are - in place of the ones it had in that note, and `clear_marks` takes
 *    them away. They are the agent's alone, kept for the note and drawn again in every
 *    editor that shows it, moved with the words in each, and they go when the agent goes:
 *    stopped, or connected no longer.
 *  - `fold` and `unfold` a line's block, as its arrow does.
 *
 *  The other kinds of note have tools of their own (canvas, pages, PDFs, tables, tasks). */

import { type EditorView, showLine } from '@orden/editor'
import {
  type AgentMark,
  foldLine,
  type Place as AgentPlace,
  select as selectStretches,
  selectionsOf,
  setAgentMarks,
  type Severity,
  type Stretch,
  unfoldLine,
} from '@orden/editor/agent-hands'
import type { AgentAnswer } from '../../automation/caller'
import { views } from '../../views.svelte'
import { type Tab, workspace } from '../../workspace.svelte'
import { type Call, done, need, needScope } from './call'
import { Refused } from './problem'
import { namedTab } from './tab-target'

/** The most marks an agent draws in one note. */
const MOST_MARKS = 500

/** Every agent's marks, by agent and then by the note they are in. */
const kept = new Map<string, Map<string, AgentMark[]>>()

/** The note a tab shows, as marks are kept by it. */
function noteOf(tab: Tab): string {
  return tab.note.path ?? `tab:${tab.id}`
}

/** Every editor on the page showing a note, with the tab it shows. */
function editorsOf(note: string): EditorView[] {
  return workspace.tabs.flatMap((tab) => {
    if (noteOf(tab) !== note || workspace.showing(tab.paneId) !== tab) return []
    const view = views.of(tab.paneId)
    return view ? [view] : []
  })
}

/** An editor built fresh draws the marks kept for its note. */
function drawn(paneId: string, view: EditorView): void {
  const tab = workspace.showing(paneId)
  if (!tab) return
  const note = noteOf(tab)
  for (const [agent, notes] of kept) {
    const marks = notes.get(note)
    if (marks?.length) setAgentMarks(view, agent, marks)
  }
}

/** An agent's marks in a note replaced, and drawn where it is shown. */
function marked(agent: string, note: string, marks: AgentMark[]): void {
  const notes = kept.get(agent) ?? new Map<string, AgentMark[]>()
  if (marks.length) notes.set(note, marks)
  else notes.delete(note)
  if (notes.size) kept.set(agent, notes)
  else kept.delete(agent)
  views.onPut ??= drawn
  for (const view of editorsOf(note)) setAgentMarks(view, agent, marks)
}

/** Every mark of every agent but these taken away: the others went, or were stopped. */
export function keepMarksOf(agents: ReadonlySet<string>): void {
  for (const [agent, notes] of [...kept]) {
    if (agents.has(agent)) continue
    for (const note of [...notes.keys()]) marked(agent, note, [])
  }
}

/** A place an agent gave, read. */
function placeIn(value: unknown, name: string): AgentPlace {
  const record =
    typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
  const line = Number(record.line)
  const ch = Number(record.ch ?? 0)
  if (!Number.isFinite(line) || !Number.isFinite(ch)) {
    throw new Refused('bad_arguments', `${name} is { line, ch }: a line from 1, a character from 0`)
  }
  return { line, ch }
}

function listOf(call: Call, name: string): Record<string, unknown>[] {
  const value = call.args[name]
  if (!Array.isArray(value)) throw new Refused('bad_arguments', `say ${name}, a list`)
  return value.map(
    (one) => (typeof one === 'object' && one !== null ? one : {}) as Record<string, unknown>,
  )
}

const SEVERITIES: readonly Severity[] = ['error', 'warning', 'info']

export function noteEditor(call: Call): AgentAnswer {
  const agent = call.caller.agent
  const { tab } = namedTab(call, ['note'], 'a note')
  const op = need(call, 'op')
  const view = workspace.showing(tab.paneId) === tab ? views.of(tab.paneId) : undefined

  if (op === 'mark' || op === 'clear_marks') {
    if (agent === null) throw new Refused('by_hand', 'the command line draws no marks')
    const marks =
      op === 'clear_marks'
        ? []
        : listOf(call, 'marks').map((one, at) => {
            const severity = SEVERITIES.find((word) => word === one.severity) ?? 'info'
            const message = typeof one.message === 'string' ? one.message : ''
            if (!message) throw new Refused('bad_arguments', `mark ${at} says no message`)
            return {
              agent: agent.id,
              from: placeIn(one.from, `marks[${at}].from`),
              to: placeIn(one.to, `marks[${at}].to`),
              message,
              severity,
            }
          })
    if (marks.length > MOST_MARKS) throw new Refused('bad_arguments', `at most ${MOST_MARKS} marks`)
    marked(agent.id, noteOf(tab), marks)
    return done({ tab: tab.id, marks: marks.length })
  }

  if (!view) {
    throw new Refused(
      'failed',
      `tab ${tab.id} is not on screen, so it has no editor: workspace_tabs focus shows it`,
    )
  }

  switch (op) {
    case 'selection':
      return done({ tab: tab.id, selections: selectionsOf(view) })
    case 'select': {
      needScope(call, 'workspace.focus', 'moving the reader’s caret')
      const stretches: Stretch[] = listOf(call, 'selections').map((one, at) => {
        const anchor = placeIn(one.anchor ?? one.head, `selections[${at}].anchor`)
        return {
          anchor,
          head: one.head === undefined ? anchor : placeIn(one.head, `selections[${at}].head`),
        }
      })
      if (!stretches.length) throw new Refused('bad_arguments', 'say at least one selection')
      selectStretches(view, stretches)
      return done({ tab: tab.id, selections: selectionsOf(view) })
    }
    case 'fold':
    case 'unfold': {
      const line = lineOf(call)
      const changed = op === 'fold' ? foldLine(view, line) : unfoldLine(view, line)
      return done({ tab: tab.id, line, changed })
    }
    case 'reveal': {
      needScope(call, 'workspace.focus', 'scrolling the reader’s note')
      const line = lineOf(call)
      showLine(view, view.state.doc.line(Math.min(Math.max(1, line), view.state.doc.lines)).from)
      return done({ tab: tab.id, line })
    }
    default:
      throw new Refused(
        'bad_arguments',
        'op is one of selection, select, mark, clear_marks, fold, unfold, reveal',
      )
  }
}

function lineOf(call: Call): number {
  const line = Number(call.args.line)
  if (!Number.isInteger(line) || line < 1) throw new Refused('bad_arguments', 'say line, from 1')
  return line
}
