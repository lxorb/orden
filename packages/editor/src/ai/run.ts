import { syntaxTree } from '@codemirror/language'
import {
  type EditorState,
  type Extension,
  StateEffect,
  StateField,
  type TransactionSpec,
} from '@codemirror/state'
import { fenceCode, fenceLanguage } from '../fence'
import { label } from '../labels'
import { enclosingNamed } from '../nodes'
import { answerParts, answerSpan, isAiLanguage, mentionsNote } from './block'

export interface AiAsk {
  prompt: string
  note: string | null
  started: (model: string) => void
  wrote: (text: string) => void
}

export type AiRunner = (ask: AiAsk, signal: AbortSignal) => Promise<void>

let runner: AiRunner | null = null

export function setAiRunner(next: AiRunner | null) {
  runner = next
}

export interface AiFence {
  from: number
  to: number
  closeLine: number
  prompt: string
}

export function aiFenceAt(state: EditorState, pos: number): AiFence | null {
  const node = enclosingNamed(syntaxTree(state).resolveInner(pos, 1), 'FencedCode')
  if (!node || !isAiLanguage(fenceLanguage(state, node))) return null

  const close = state.doc.lineAt(Math.min(node.to, state.doc.length))
  return {
    from: state.doc.lineAt(node.from).from,
    to: close.to,
    closeLine: close.number - 1,
    prompt: fenceCode(state, node),
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

const FENCE = /^[\s>]*(?:`{3,}|~{3,})/

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
          const alive = run.from <= doc.length && FENCE.test(doc.lineAt(run.from).text)
          if (!alive) run.stop()
          return alive
        })
    }

    for (const effect of transaction.effects) {
      if (effect.is(openAsk)) {
        const { id, from, stop } = effect.value
        for (const run of next.filter((one) => one.from === from)) run.stop()
        next = [
          ...next.filter((one) => one.from !== from),
          { id, from, body: null, at: null, stop },
        ]
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

export function askingAt(state: EditorState, from: number): boolean {
  return (state.field(asks, false) ?? []).some((run) => run.from === from)
}

export function stopAskAt(view: AiView, from: number) {
  for (const run of view.state.field(asks, false) ?? []) {
    if (run.from === from) run.stop()
  }
}

export function asksMoved(before: EditorState, after: EditorState): boolean {
  return before.field(asks, false) !== after.field(asks, false)
}

let counter = 0

function fill(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.hasOwn(values, name) ? (values[name] ?? whole) : whole,
  )
}

function today(): string {
  const now = new Date()
  const two = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`
}

function runOf(state: EditorState, id: number): AiRun | null {
  return (state.field(asks, false) ?? []).find((run) => run.id === id) ?? null
}

export function askAiFence(view: AiView, fence: AiFence): boolean {
  if (!runner || !view.state.field(asks, false) || view.state.readOnly) return false

  const prompt = fence.prompt.trim()
  if (!prompt) return false

  const id = ++counter
  const controller = new AbortController()
  const ask = runner
  view.dispatch({ effects: openAsk.of({ id, from: fence.from, stop: () => controller.abort() }) })

  void ask(
    {
      prompt,
      note: mentionsNote(prompt) ? view.state.doc.toString() : null,
      started: (model) => beginAnswer(view, id, model),
      wrote: (text) => writeAnswer(view, id, text),
    },
    controller.signal,
  )
    .catch(() => undefined)
    .finally(() => {
      trimAnswer(view, id)
      view.dispatch({ effects: closeAsk.of(id) })
    })

  return true
}

function beginAnswer(view: AiView, id: number, model: string) {
  const live = runOf(view.state, id)
  if (!live) return
  if (live.body !== null) return

  const found = aiFenceAt(view.state, live.from)
  if (!found) return

  const { head, tail } = answerParts(fill(label('aiAnswered'), { model, date: today() }))
  const existing = answerSpan(view.state.doc.toString().split('\n'), found.closeLine)
  const span = existing ?? { from: found.to, to: found.to }
  const lead = existing ? '' : '\n\n'

  view.dispatch({
    changes: { from: span.from, to: span.to, insert: `${lead}${head}${tail}` },
    effects: beganAnswer.of({ id, body: span.from + lead.length + head.length }),
    scrollIntoView: true,
  })
}

function writeAnswer(view: AiView, id: number, text: string) {
  const live = runOf(view.state, id)
  if (!live) return
  if (live.at === null || !text) return

  view.dispatch({
    changes: { from: live.at, insert: text },
    effects: wroteAnswer.of({ id, at: live.at + text.length }),
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
