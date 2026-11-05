/** What an agent does to a note's editor beside writing in it (#1078; the desktop's
 *  docs/agent-native.md 8.15), the way a VS Code extension uses a `TextEditor`: its
 *  selections, the marks it draws, its folds.
 *
 *  **Marks** are the agent's diagnostics: an underline with a message over a range, as
 *  `languages.createDiagnosticCollection` draws one, kept per agent and moved with the
 *  words they are on as the note is edited. Drawn by a field added to a view the first
 *  time one is set there, so a view no agent marked carries nothing.
 *
 *  Pure of the app: positions are a line (from 1) and a character on it (from 0), which
 *  is what an agent reading a note counts in, and are clamped to the note. */

import { foldable, foldedRanges, foldEffect, unfoldEffect } from '@codemirror/language'
import { EditorSelection, type EditorState, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'

/** A place in a note: a line from 1, a character on it from 0. */
export interface Place {
  line: number
  ch: number
}

/** A stretch of a note, from `anchor` to `head`, where a selection's caret is. */
export interface Stretch {
  anchor: Place
  head: Place
}

export type Severity = 'error' | 'warning' | 'info'

/** One mark: where, what it says, how much it matters, and whose it is. */
export interface AgentMark {
  agent: string
  from: Place
  to: Place
  message: string
  severity: Severity
}

/** A mark as the field keeps it, at offsets that move with the words. */
interface Held {
  agent: string
  from: number
  to: number
  message: string
  severity: Severity
}

/** An agent's marks replaced by these. */
const setMarks = StateEffect.define<{ agent: string; marks: Held[] }>()

const marks = StateField.define<Held[]>({
  create: () => [],
  update(held, transaction) {
    let next = transaction.docChanged
      ? held
          .map((one) => ({
            ...one,
            from: transaction.changes.mapPos(one.from, 1),
            to: transaction.changes.mapPos(one.to, -1),
          }))
          .filter((one) => one.to > one.from)
      : held
    for (const effect of transaction.effects) {
      if (!effect.is(setMarks)) continue
      next = [...next.filter((one) => one.agent !== effect.value.agent), ...effect.value.marks]
    }
    return next
  },
  provide: (field) =>
    EditorView.decorations.from(field, (held) =>
      Decoration.set(
        held.map((one) =>
          Decoration.mark({
            class: `cm-agent-mark cm-agent-mark-${one.severity}`,
            attributes: { title: one.message },
          }).range(one.from, one.to),
        ),
        true,
      ),
    ),
})

const look = EditorView.baseTheme({
  '.cm-agent-mark': {
    textDecorationLine: 'underline',
    textDecorationStyle: 'wavy',
    textDecorationThickness: '1px',
    textUnderlineOffset: '3px',
  },
  '.cm-agent-mark-error': { textDecorationColor: 'var(--danger, #d33)' },
  '.cm-agent-mark-warning': { textDecorationColor: 'var(--warning, #c80)' },
  '.cm-agent-mark-info': { textDecorationColor: 'var(--accent, #66f)' },
})

/** An offset for a place, clamped to the note. */
export function offsetOf(state: EditorState, place: Place): number {
  const doc = state.doc
  const line = doc.line(Math.min(Math.max(1, Math.floor(place.line)), doc.lines))
  return line.from + Math.min(Math.max(0, Math.floor(place.ch)), line.length)
}

/** The place an offset is at. */
export function placeOf(state: EditorState, offset: number): Place {
  const line = state.doc.lineAt(Math.min(Math.max(0, offset), state.doc.length))
  return { line: line.number, ch: offset - line.from }
}

/** An agent's marks in a view: these, in place of the ones it had. */
export function setAgentMarks(view: EditorView, agent: string, given: AgentMark[]): void {
  const held: Held[] = given
    .map((one) => ({
      agent,
      from: offsetOf(view.state, one.from),
      to: offsetOf(view.state, one.to),
      message: one.message,
      severity: one.severity,
    }))
    .filter((one) => one.to > one.from)
  const effects: StateEffect<unknown>[] = [setMarks.of({ agent, marks: held })]
  if (view.state.field(marks, false) === undefined) {
    effects.unshift(StateEffect.appendConfig.of([marks, look]))
  }
  view.dispatch({ effects })
}

/** The marks in a view, an agent's or everybody's, where they are now. */
export function agentMarksIn(view: EditorView, agent?: string): AgentMark[] {
  return (view.state.field(marks, false) ?? [])
    .filter((one) => agent === undefined || one.agent === agent)
    .map((one) => ({
      agent: one.agent,
      from: placeOf(view.state, one.from),
      to: placeOf(view.state, one.to),
      message: one.message,
      severity: one.severity,
    }))
}

/** The selections in a view, the main one first. */
export function selectionsOf(view: EditorView): (Stretch & { text: string })[] {
  const { ranges, main } = view.state.selection
  return [main, ...ranges.filter((one) => one !== main)].map((one) => ({
    anchor: placeOf(view.state, one.anchor),
    head: placeOf(view.state, one.head),
    text: view.state.sliceDoc(one.from, one.to),
  }))
}

/** The view's selection set to these stretches, several carets where there are several;
 *  the first is the main one. Not scrolled: where the reader is looking stays theirs. */
export function select(view: EditorView, stretches: Stretch[]): void {
  if (!stretches.length) return
  const ranges = stretches.map((one) =>
    EditorSelection.range(offsetOf(view.state, one.anchor), offsetOf(view.state, one.head)),
  )
  view.dispatch({ selection: EditorSelection.create(ranges, 0) })
}

/** The block a line opens folded, as the fold arrow would. Answers whether there was one. */
export function foldLine(view: EditorView, line: number): boolean {
  const at = view.state.doc.line(Math.min(Math.max(1, line), view.state.doc.lines))
  const range = foldable(view.state, at.from, at.to)
  if (!range) return false
  view.dispatch({ effects: foldEffect.of(range) })
  return true
}

/** Every fold on a line opened. Answers whether there was one. */
export function unfoldLine(view: EditorView, line: number): boolean {
  const at = view.state.doc.line(Math.min(Math.max(1, line), view.state.doc.lines))
  const effects: StateEffect<unknown>[] = []
  foldedRanges(view.state).between(at.from, at.to + 1, (from, to) => {
    effects.push(unfoldEffect.of({ from, to }))
  })
  if (!effects.length) return false
  view.dispatch({ effects })
  return true
}
