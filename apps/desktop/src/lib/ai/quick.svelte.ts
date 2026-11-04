/** A quick question: Claude Code's /btw for the whole app. A field in the middle of the
 *  window, what the reader is looking at going along with it, the answer streamed in
 *  place, and gone again with Escape.
 *
 *  A shortcut to the AI panel's own chat, not a second kind of one (#1115): the question
 *  starts the chat a message typed into the panel starts - the same context with the date
 *  and the place the reader is in, the same tools and permissions, the provider and model
 *  Ask uses, kept with its history - in the panel's list at once, while the chat open there
 *  stays open. The sheet draws that chat's words while it is up; put away, the chat goes
 *  on and is in the panel like any other, to be opened and carried on. What is in front goes along as the panel sends it
 *  (sidebar/around.ts): the note, the words selected in it, or the page.
 *
 *  The sheet is QuickQuestion.svelte, fetched by the first press through the door in
 *  surfaces.svelte.ts; the chat's store is fetched by the first question. */

import type { EditorView } from '@orden/editor'
import { quickSheet } from '../surfaces.svelte'
import { views } from '../views.svelte'
import { workspace } from '../workspace.svelte'
import { type ContextKind, insertion } from './quick'
import type { Thread, Turn } from './chat/types'
import type { Ended } from './commands/types'
import { ai } from './store.svelte'
import { noteInFront, SELECTION_CHIP, selectionHere } from './sidebar/around'
import type { Around } from './sidebar/chat.svelte'
import type { Mention } from './sidebar/mentions'

type Chat = (typeof import('./sidebar/chat.svelte'))['chat']

/** What goes along with the first question, as its chip says it. */
interface Context {
  kind: ContextKind
  /** The note's or the page's name, or the selected words. */
  name: string
  around: Around
  chips: Mention[]
}

/** One line of the sheet's conversation. */
export interface Said {
  role: 'you' | 'model'
  text: string
}

/** A turn's words as the sheet draws them: a message as it was typed, an answer's text. */
function saidOf(turn: Turn): Said {
  if (turn.role === 'you') return { role: 'you', text: turn.draft?.text ?? '' }
  const text = turn.parts.flatMap((part) => (part.kind === 'text' ? [part.text] : [])).join('\n\n')
  return { role: 'model', text }
}

/** The chat's store, fetched once. */
let store: Promise<Chat> | null = null
const chatStore = () => (store ??= import('./sidebar/chat.svelte').then((one) => one.chat))

class Quick {
  open = $state(false)
  question = $state('')
  /** What goes along with the first question, until its chip is pressed. */
  context = $state<Context | null>(null)
  /** The chat the sheet's questions are in, once the first is asked. */
  private thread = $state.raw<Thread | null>(null)
  /** The chat's store, here once a question has fetched it. */
  private chat = $state.raw<Chat | null>(null)
  /** What went wrong before the chat could say it: no provider, no engine. */
  private failed = $state<string | null>(null)

  /** The note a context came from, and where in it the answer goes: under the
   *  selection, or under the caret's line. Null where the context was not a note. */
  private target: { view: EditorView; at: number } | null = null

  /** Whether anything can be asked: a provider for the panel's chats. */
  get ready(): boolean {
    return ai.providerFor('ask') !== null
  }

  /** The sheet's chat's turns, as the store draws them for it. */
  private get drawn(): readonly Turn[] {
    const watched = this.chat?.watched
    return watched && watched.id === this.thread?.id ? watched.turns : []
  }

  /** The conversation so far: the chat's words, and a message on its way before it is
   *  a turn. */
  get turns(): Said[] {
    const thread = this.thread
    if (!this.chat || !thread) return []
    const said = this.drawn.map(saidOf).filter((one) => one.role === 'you' || one.text)
    const pending = this.chat.pending[thread.id]
    return pending !== undefined ? [...said, { role: 'you', text: pending }] : said
  }

  /** Whether the chat waits on the reader: a question its agent asked, answered in the
   *  panel. */
  get asking(): boolean {
    return this.drawn.some((turn) =>
      turn.parts.some((part) => part.kind === 'tool' && part.state === 'asking'),
    )
  }

  get running(): boolean {
    return !!this.thread && !!this.chat?.running.includes(this.thread.id)
  }

  /** What went wrong: the store's word for the chat in front, else the notice an answer
   *  ended on. */
  get trouble(): string | null {
    if (this.running) return null
    const parts = this.drawn.at(-1)?.parts ?? []
    const notice = parts.filter((part) => part.kind === 'notice' && part.code === 'error').at(-1)
    return notice?.kind === 'notice' ? notice.text : this.failed
  }

  /** Opens it, with what is in front as its context. Pressed while it is up, it closes,
   *  the way a key that opens a layer puts it away again. */
  show() {
    if (this.open) {
      this.close()
      return
    }

    void quickSheet.ask()
    this.reset()
    this.gather()
    this.open = true
  }

  /** Puts the sheet away. Its chat is the panel's and goes on there. */
  close() {
    this.open = false
    this.reset()
  }

  private reset() {
    this.question = ''
    this.context = null
    this.target = null
    this.thread = null
    this.failed = null
    this.chat?.watch(null)
  }

  /** What is in front, read the way the panel reads it: the selection in the note, else
   *  the note, else the page. */
  private gather() {
    const tab = workspace.panelTab
    if (!tab) return

    if (tab.kind === 'web') {
      const chip: Mention = { kind: 'tab', id: tab.id, label: tab.shown }
      this.context = { kind: 'page', name: tab.shown, around: nothing(), chips: [chip] }
      return
    }

    if (tab.kind !== 'note') return
    const view = views.of(workspace.panes.focusedId)
    const range = view?.state.selection.main
    if (view) this.target = { view, at: range?.to ?? 0 }
    const front = noteInFront(workspace.activeSpace?.root ?? null)
    const picked = selectionHere()
    const around: Around = { front, selection: picked.text, picked: picked.picked }
    if (picked.text) {
      const name = picked.text.slice(0, 120)
      this.context = { kind: 'selection', name, around, chips: [SELECTION_CHIP] }
    } else if (front?.text.trim()) {
      this.context = { kind: 'note', name: front.name, around, chips: [] }
    }
  }

  /** The chip pressed: the question goes without it. */
  drop() {
    this.context = null
  }

  /** Stops the answer on its way; what arrived stays. */
  stop() {
    if (this.thread) this.chat?.stopIn(this.thread.id)
  }

  /** Asks what is in the field: the first question starts the chat, a follow-up goes on
   *  in it. The question is on screen at once, as the panel draws it. */
  async ask() {
    const question = this.question.trim()
    if (!question || this.running || !this.ready) return
    this.question = ''

    this.failed = null
    const chat = await chatStore()
    this.chat = chat
    if (!this.open) return
    let ended: Promise<Ended>
    if (this.thread) ended = chat.sendIn(this.thread, question, [], nothing())
    else {
      const context = this.context
      this.context = null
      const started = chat.startHere(question, context?.chips ?? [], context?.around ?? nothing())
      this.thread = started.thread
      chat.watch(started.thread)
      ended = started.ended
    }
    const thread = this.thread
    const end = await ended
    // Put away meanwhile, or asked again from a fresh sheet: nothing here is about it.
    if (this.thread !== thread) return
    // Read where it was asked: the panel's list has no answer here the reader has not seen.
    void chat.saw(thread.id)
    // A refusal before any turn (no provider, no engine) has nowhere else to be said.
    if (end.stop === 'error' && !end.turn && end.error) this.failed = end.error
  }

  /** The chat in the panel and the sheet put away: it is the panel's already, so this is
   *  only where it is drawn. */
  async continueInPanel() {
    const thread = this.thread
    if (!thread || !workspace.offers('ask')) return
    this.close()
    const [chat, { revealChat }] = await Promise.all([chatStore(), import('./sidebar/reveal')])
    revealChat()
    await chat.openThread(thread.id)
  }

  /** An answer into the note it was asked about, on lines of its own under the
   *  selection or the caret's line, and the sheet put away with the caret after it.
   *  Asked about anything else - a page, nothing - it goes on the end of the
   *  scratchpad, which is where a thought with no note yet belongs. */
  async addToNote(text: string) {
    const target = this.target
    if (target && !target.view.state.readOnly && target.view.dom.isConnected) {
      const { view } = target
      const doc = view.state.doc.toString()
      const { from, insert, caret } = insertion(doc, Math.min(target.at, doc.length), text)
      view.dispatch({
        changes: { from, insert },
        selection: { anchor: caret },
        scrollIntoView: true,
        userEvent: 'input.paste',
      })
      this.close()
      view.focus()
      return
    }

    const { scratchpad } = await import('../scratchpad/pad')
    await scratchpad.append(text)
    this.close()
  }
}

/** Nothing around a message: a follow-up, or a question with its chip taken off. */
function nothing(): Around {
  return { front: null, selection: '', picked: null }
}

export const quick = new Quick()
