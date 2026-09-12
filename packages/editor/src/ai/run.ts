/** Asking the model the question a ```` ```ai ```` fence holds, and writing what
 *  comes back into the note under it.
 *
 *  The editor owns the document and nothing else: which provider is asked, which
 *  model, and where the key lives are all the app's, handed over once through
 *  `setAiRunner`. What is here is the fence, the span the answer occupies, the
 *  stream going into it, and the one run per fence that can be stopped.
 *
 *  Written into the document rather than shown beside it, unlike a code block's
 *  output (see run/panel.ts): a run's output is about the code and goes when the
 *  editor closes, and an answer is part of the note. See ai/block.ts for what it
 *  looks like in the file. */

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

/** What the app is asked. Two callbacks rather than a returned string: the answer
 *  is written as it arrives, and the model has to be known before the first piece
 *  of it can be, because the line over the answer says which model said it. */
export interface AiAsk {
  /** The question, as the fence's body says it, `@note` and all. */
  prompt: string
  /** The note's own text, for a question that asked for it. Null where it did
   *  not, so a provider is never handed a note nobody mentioned. */
  note: string | null
  /** Said once, before the first piece: which model is answering. */
  started: (model: string) => void
  /** Each piece of the answer as it arrives. */
  wrote: (text: string) => void
}

/** Asks, and settles when the answer is complete or has stopped coming.
 *
 *  Saying what went wrong is the app's: a provider, a key and a quota are all things
 *  the editor knows nothing about, and the app has a line across the top of the
 *  window to say it on. So a rejection here is only a signal that the answer ended
 *  early, and what is left in the note is what had arrived. */
export type AiRunner = (ask: AiAsk, signal: AbortSignal) => Promise<void>

let runner: AiRunner | null = null

/** Hands the editor a way to ask. Null takes it away, which is what a build with
 *  no AI in it looks like from here.
 *
 *  An app with no provider set up still hands one over: the glyph on the fence
 *  shows either way, and a press with nothing behind it is answered by the app
 *  saying so, which is how somebody finds out where to add one. A glyph that was
 *  there or not depending on a setting would be a glyph that came and went for
 *  reasons nobody watching the note could see. */
export function setAiRunner(next: AiRunner | null) {
  runner = next
}

export interface AiFence {
  /** Start of the opening fence's line, which is what says which fence this is. */
  from: number
  /** End of the closing fence's line. */
  to: number
  /** Which line the closing fence is on, counting from zero, so the answer under
   *  it can be found. */
  closeLine: number
  prompt: string
}

/** The `ai` fence a position is in, or null where it is in none. */
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

/** A question being answered right now: which fence, where the answer is being
 *  written, and how to stop it. */
interface AiRun {
  /** Which run this is, so a stream from a replaced one can be ignored. */
  readonly id: number
  /** Start of the fence's opening line, moved along by every edit above it. */
  readonly from: number
  /** Where the answer's own text begins. Null until the model is known, which is
   *  when the answer's span is written at all. */
  readonly body: number | null
  /** Where the next piece goes, which is the end of what has been written. */
  readonly at: number | null
  readonly stop: () => void
}

const openAsk = StateEffect.define<{ id: number; from: number; stop: () => void }>()
const beganAnswer = StateEffect.define<{ id: number; body: number }>()
const wroteAnswer = StateEffect.define<{ id: number; at: number }>()
const closeAsk = StateEffect.define<number>()

/** A line that opens a fence, whatever comes before it. The same reading
 *  run/panel.ts does, and for the same reason: a fence whose backticks have been
 *  deleted is not a fence any more, however well its position was mapped. */
const FENCE = /^[\s>]*(?:`{3,}|~{3,})/

const asks = StateField.define<readonly AiRun[]>({
  create: () => [],

  update(runs, transaction) {
    let next = runs

    // The document first, then what the transaction says. An effect carries
    // positions in the document the transaction leaves behind - the answer's span
    // is written and its start reported in one go - so mapping after applying
    // would map a new position through the change that made it.
    if (transaction.docChanged) {
      const doc = transaction.state.doc
      next = next
        .map((run) => ({
          ...run,
          // Leaning right and then back to the line's own start, so a character
          // typed at the front of the fence line does not turn the same block
          // into a different one; see mapPanels in run/panel.ts.
          from: doc.lineAt(transaction.changes.mapPos(run.from, 1)).from,
          // The answer's start leans left and its end leans right, so the next
          // piece written at the end lands inside the answer and the start stays
          // where the answer starts. Both leaning the same way put the start after
          // the first piece, and the answer read as empty from then on.
          body: run.body === null ? null : transaction.changes.mapPos(run.body, -1),
          at: run.at === null ? null : transaction.changes.mapPos(run.at, 1),
        }))
        .filter((run) => {
          const alive = run.from <= doc.length && FENCE.test(doc.lineAt(run.from).text)
          // A fence that stopped being one stops its own run: the answer has
          // nowhere left to go.
          if (!alive) run.stop()
          return alive
        })
    }

    for (const effect of transaction.effects) {
      if (effect.is(openAsk)) {
        const { id, from, stop } = effect.value
        // One question per fence: asking again stops what the last press started.
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

/** As much of a view as asking needs. Spelled out rather than taken as an
 *  `EditorView`, which every editor view satisfies, so the whole of the streaming
 *  can be driven by a test without a DOM. */
export interface AiView {
  state: EditorState
  dispatch: (spec: TransactionSpec) => void
}

/** Whether the fence beginning at `from` is waiting on an answer. What the glyph
 *  on the fence's header reads to decide whether it offers a stop. */
export function askingAt(state: EditorState, from: number): boolean {
  return (state.field(asks, false) ?? []).some((run) => run.from === from)
}

/** Stops the question the fence beginning at `from` asked, keeping whatever of the
 *  answer had arrived. */
export function stopAskAt(view: AiView, from: number) {
  for (const run of view.state.field(asks, false) ?? []) {
    if (run.from === from) run.stop()
  }
}

/** Whether the questions being answered changed between two states. What the live
 *  preview watches, so a glyph becomes a stop in the frame it is pressed in rather
 *  than waiting for the first words to arrive. */
export function asksMoved(before: EditorState, after: EditorState): boolean {
  return before.field(asks, false) !== after.field(asks, false)
}

let counter = 0

function fill(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.hasOwn(values, name) ? (values[name] ?? whole) : whole,
  )
}

/** Today, as the note should read it: the calendar date and nothing finer. A
 *  timestamp would make every re-run a different line for no reader's benefit. */
function today(): string {
  const now = new Date()
  const two = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`
}

function runOf(state: EditorState, id: number): AiRun | null {
  return (state.field(asks, false) ?? []).find((run) => run.id === id) ?? null
}

/** Asks the question one fence holds. False where there is nothing to ask with,
 *  where the fence holds no question, or where the editor has no field to keep the
 *  run in, which is what source mode looks like from here. */
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
    // Whatever went wrong, the app has already said so; see `AiRunner`. Caught
    // rather than dropped, because a rejection nobody handles is a console full of
    // noise and, in a webview, sometimes worse.
    .catch(() => undefined)
    .finally(() => {
      trimAnswer(view, id)
      view.dispatch({ effects: closeAsk.of(id) })
    })

  return true
}

/** Writes the empty answer, marks and all, and remembers where its text begins.
 *
 *  Now rather than at the press: until the model has been reached there is nothing
 *  true to say over the answer, and a note should not be edited to say that a
 *  question is pending. */
function beginAnswer(view: AiView, id: number, model: string) {
  const live = runOf(view.state, id)
  if (!live) return
  // Said twice by a provider that sends more than one start. The first one wrote
  // the span; a second would write another under it.
  if (live.body !== null) return

  const found = aiFenceAt(view.state, live.from)
  if (!found) return

  const { head, tail } = answerParts(fill(label('aiAnswered'), { model, date: today() }))
  const existing = answerSpan(view.state.doc.toString().split('\n'), found.closeLine)
  const span = existing ?? { from: found.to, to: found.to }
  // A fresh answer needs the blank line that separates it from the fence; one
  // replacing an older answer is already in the right place.
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

/** Takes the blank space off the end of a finished answer, so the closing mark
 *  sits under the last line of it however the model chose to end.
 *
 *  Never past the answer's own start: an answer that came back empty keeps the
 *  blank line under its attribution, which is what makes the next thing written
 *  there a block of its own. */
function trimAnswer(view: AiView, id: number) {
  const live = runOf(view.state, id)
  if (!live) return
  if (live.body === null || live.at === null) return

  const text = view.state.doc.sliceString(live.body, live.at)
  const kept = text.replace(/\s+$/, '')
  if (kept.length === text.length) return

  view.dispatch({ changes: { from: live.body + kept.length, to: live.at, insert: '' } })
}

/** The field the asks live in. Part of the live preview, so source mode takes the
 *  glyph and the runs with it. */
export const aiExtension: Extension = [asks]
