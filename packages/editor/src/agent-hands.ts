import { foldable, foldedRanges, foldEffect, unfoldEffect } from '@codemirror/language'
import { EditorSelection, type EditorState, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'

export interface Place {
  line: number
  ch: number
}

export interface Stretch {
  anchor: Place
  head: Place
}

export type Severity = 'error' | 'warning' | 'info'

export interface AgentMark {
  agent: string
  from: Place
  to: Place
  message: string
  severity: Severity
}

interface Held {
  agent: string
  from: number
  to: number
  message: string
  severity: Severity
}

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

export function offsetOf(state: EditorState, place: Place): number {
  const doc = state.doc
  const line = doc.line(Math.min(Math.max(1, Math.floor(place.line)), doc.lines))
  return line.from + Math.min(Math.max(0, Math.floor(place.ch)), line.length)
}

export function placeOf(state: EditorState, offset: number): Place {
  const line = state.doc.lineAt(Math.min(Math.max(0, offset), state.doc.length))
  return { line: line.number, ch: offset - line.from }
}

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

export function selectionsOf(
  view: EditorView,
  most = Infinity,
  longest = Infinity,
): (Stretch & { text: string; truncated?: true })[] {
  const { ranges, main } = view.state.selection
  let left = longest
  return [main, ...ranges.filter((one) => one !== main)].slice(0, most).map((one) => {
    const to = Math.min(one.to, one.from + left)
    left -= to - one.from
    return {
      anchor: placeOf(view.state, one.anchor),
      head: placeOf(view.state, one.head),
      text: view.state.sliceDoc(one.from, to),
      ...(to < one.to ? { truncated: true as const } : {}),
    }
  })
}

export function select(view: EditorView, stretches: Stretch[]): void {
  if (!stretches.length) return
  const ranges = stretches.map((one) =>
    EditorSelection.range(offsetOf(view.state, one.anchor), offsetOf(view.state, one.head)),
  )
  view.dispatch({ selection: EditorSelection.create(ranges, 0) })
}

export function foldLine(view: EditorView, line: number): boolean {
  const at = view.state.doc.line(Math.min(Math.max(1, line), view.state.doc.lines))
  const range = foldable(view.state, at.from, at.to)
  if (!range) return false
  view.dispatch({ effects: foldEffect.of(range) })
  return true
}

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
