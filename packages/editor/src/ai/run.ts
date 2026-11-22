import {
  type EditorState,
  type Extension,
  Facet,
  StateEffect,
  StateField,
  type TransactionSpec,
} from '@codemirror/state'
import { fenceCode, fenceLanguage, fenceLead, fenceNear, opensFence } from '../fence'
import { todayHere } from '../task-days'
import { documentOf, type SharedDoc } from '../shared'
import { answerParts, answerSpan, isAiLanguage, mentionsNote } from './block'

export interface AiAsk {
  prompt: string
  note: string | null
  shows: SharedDoc | null
  place?: string | null
  started: (model: string) => void
  wrote: (text: string) => void
}
export const aiPlace = Facet.define<string, string | null>({
  combine: (values) => values[0] ?? null,
})
export type AiRunner = (ask: AiAsk, signal: AbortSignal) => Promise<void>
let runner: AiRunner | null = null
export function setAiRunner(next: AiRunner | null) {
  runner = next
}
export const aiRuns = (): boolean => runner !== null
export interface AiFence {
  from: number
  to: number
  closeLine: number
  prompt: string
  lead: string
}
export function aiFenceAt(state: EditorState, pos: number): AiFence | null {
  const node = fenceNear(state, pos)
  if (!node || !isAiLanguage(fenceLanguage(state, node))) return null
  const close = state.doc.lineAt(Math.min(node.to, state.doc.length))
  return {
    from: state.doc.lineAt(node.from).from,
    to: close.to,
    closeLine: close.number - 1,
    prompt: fenceCode(state, node),
    lead: fenceLead(state, node),
  }
}
interface AiRun {
  readonly id: number
  readonly from: number
  readonly body: number | null
  readonly at: number | null
  readonly stop: () => void
}
const openAsk = StateEffect.define<{ id: number; from: number; stop: () => void }>()
const beganAnswer = StateEffect.define<{ id: number; body: number }>()
const wroteAnswer = StateEffect.define<{ id: number; at: number }>()
const closeAsk = StateEffect.define<number>()
const asks = StateField.define<readonly AiRun[]>({
  create: () => [],
  update(runs, transaction) {
    let next = runs
    if (transaction.docChanged) {
      const doc = transaction.state.doc
      next = next
        .map((run) => ({
          ...run,
          from: doc.lineAt(transaction.changes.mapPos(run.from, 1)).from,
          body: run.body === null ? null : transaction.changes.mapPos(run.body, -1),
          at: run.at === null ? null : transaction.changes.mapPos(run.at, 1),
        }))
        .filter((run) => {
          const alive = run.from <= doc.length && opensFence(doc.lineAt(run.from).text)
          if (!alive) run.stop()
          return alive
        })
    }
    for (const effect of transaction.effects) {
      if (effect.is(openAsk)) {
        const { id, from, stop } = effect.value
        for (const run of next.filter((one) => one.from === from)) run.stop()
        next = [...next.filter((one) => one.from !== from), { id, from, body: null, at: null, stop }]
      } else if (effect.is(beganAnswer)) {
        const { id, body } = effect.value
        next = next.map((run) => (run.id === id ? { ...run, body, at: body } : run))
      } else if (effect.is(wroteAnswer)) {
        const { id, at } = effect.value
        next = next.map((run) => (run.id === id ? { ...run, at } : run))
      } else if (effect.is(closeAsk)) {
        next = next.filter((run) => run.id !== effect.value)
      }
    }
    return next
  },
})
export interface AiView {
  state: EditorState
  dispatch: (spec: TransactionSpec) => void
}
export const askingAt = (state: EditorState, from: number): boolean =>
  (state.field(asks, false) ?? []).some((run) => run.from === from)
export function stopAskAt(view: AiView, from: number) {
  for (const run of view.state.field(asks, false) ?? []) if (run.from === from) run.stop()
}
export const asksMoved = (before: EditorState, after: EditorState): boolean =>
  before.field(asks, false) !== after.field(asks, false)
let counter = 0
const runOf = (state: EditorState, id: number): AiRun | null =>
  (state.field(asks, false) ?? []).find((run) => run.id === id) ?? null
function holderOf(view: AiView, note: SharedDoc | null, turn: number | undefined, id: number): AiView | null {
  if (note && note.turn !== turn) return null
  if (runOf(view.state, id)) return view
  return note?.holding((state) => runOf(state, id) !== null) ?? null
}
export function askAiFence(view: AiView, fence: AiFence): boolean {
  if (!runner || !view.state.field(asks, false) || view.state.readOnly) return false
  const prompt = fence.prompt.trim()
  if (!prompt) return false
  const id = ++counter
  const controller = new AbortController()
  const ask = runner
  const shows = documentOf(view)
  const turn = shows?.turn
  view.dispatch({ effects: openAsk.of({ id, from: fence.from, stop: () => controller.abort() }) })
  const holding = (then: (holder: AiView) => void) => {
    const holder = holderOf(view, shows, turn, id)
    if (holder) then(holder)
    else controller.abort()
  }
  void ask(
    {
      prompt,
      note: mentionsNote(prompt) ? view.state.doc.toString() : null,
      shows,
      place: view.state.facet(aiPlace),
      started: (model) => holding((holder) => beginAnswer(holder, id, model)),
      wrote: (text) => holding((holder) => writeAnswer(holder, id, text)),
    },
    controller.signal,
  )
    .catch(() => undefined)
    .finally(() => {
      const holder = holderOf(view, shows, turn, id)
      if (!holder) return
      trimAnswer(holder, id)
      holder.dispatch({ effects: closeAsk.of(id) })
    })
  return true
}
function beginAnswer(view: AiView, id: number, model: string) {
  const live = runOf(view.state, id)
  if (!live) return
  if (live.body !== null) return
  const found = aiFenceAt(view.state, live.from)
  if (!found) return
  const parts = answerParts(`answered by ${model}, ${todayHere()}`)
  const head = within(parts.head, found.lead)
  const tail = within(parts.tail, found.lead)
  const existing = answerSpan(view.state.doc.toString().split('\n'), found.closeLine, found.lead)
  const span = existing ?? { from: found.to, to: found.to }
  const lead = existing ? '' : within('\n\n', found.lead)
  const from = existing ? span.from + found.lead.length : span.from
  view.dispatch({
    changes: { from, to: span.to, insert: `${lead}${head}${tail}` },
    effects: beganAnswer.of({ id, body: from + lead.length + head.length }),
    scrollIntoView: true,
  })
}
function within(text: string, lead: string): string {
  if (!lead) return text
  return text.replace(/\n(?=(\n?))/g, (_all, blank: string) => (blank ? `\n${lead.trimEnd()}` : `\n${lead}`))
}
function writeAnswer(view: AiView, id: number, text: string) {
  const live = runOf(view.state, id)
  if (!live) return
  if (live.at === null || !text) return
  const written = within(text, aiFenceAt(view.state, live.from)?.lead ?? '')
  view.dispatch({
    changes: { from: live.at, insert: written },
    effects: wroteAnswer.of({ id, at: live.at + written.length }),
  })
}
function trimAnswer(view: AiView, id: number) {
  const live = runOf(view.state, id)
  if (!live) return
  if (live.body === null || live.at === null) return
  const text = view.state.doc.sliceString(live.body, live.at)
  const kept = text.replace(/\s+$/, '')
  if (kept.length === text.length) return
  view.dispatch({ changes: { from: live.body + kept.length, to: live.at, insert: '' } })
}
export const aiExtension: Extension = [asks]
