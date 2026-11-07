import { documentOf, type EditorView, type SharedDoc, type Text } from '@orden/editor'
import { quickSheet } from '../surfaces.svelte'
import { views } from '../views.svelte'
import { workspace } from '../workspace.svelte'
import { carried, type ContextKind, insertion } from './quick'
import type { Thread, Turn } from './chat/types'
import type { Ended } from './commands/types'
import { ai } from './store.svelte'
import { noteInFront, SELECTION_CHIP, selectionHere } from './sidebar/around'
import type { Around } from './sidebar/chat.svelte'
import type { Mention } from './sidebar/mentions'

type Chat = (typeof import('./sidebar/chat.svelte'))['chat']

interface Context {
  kind: ContextKind
  name: string
  around: Around
  chips: Mention[]
}

interface Said {
  role: 'you' | 'model'
  text: string
}

function saidOf(turn: Turn): Said {
  if (turn.role === 'you') return { role: 'you', text: turn.draft?.text ?? '' }
  const text = turn.parts.flatMap((part) => (part.kind === 'text' ? [part.text] : [])).join('\n\n')
  return { role: 'model', text }
}

let store: Promise<Chat> | null = null
const chatStore = () => (store ??= import('./sidebar/chat.svelte').then((one) => one.chat))

class Quick {
  open = $state(false)
  question = $state('')
  context = $state<Context | null>(null)
  texts = $state<Mention[]>([])
  private thread = $state.raw<Thread | null>(null)
  private chat = $state.raw<Chat | null>(null)
  private failed = $state<string | null>(null)
  private session = 0
  private loading = false

  private target: { view: EditorView; at: number; doc: Text; shows: SharedDoc | null } | null = null

  get ready(): boolean {
    return ai.providerFor('ask') !== null
  }

  private get drawn(): readonly Turn[] {
    const watched = this.chat?.watched
    return watched && watched.id === this.thread?.id ? watched.turns : []
  }

  get turns(): Said[] {
    const thread = this.thread
    if (!this.chat || !thread) return []
    const said = this.drawn.map(saidOf).filter((one) => one.role === 'you' || one.text)
    const pending = this.chat.pending[thread.id]
    return pending !== undefined ? [...said, { role: 'you', text: pending }] : said
  }

  get asking(): boolean {
    return this.drawn.some((turn) =>
      turn.parts.some((part) => part.kind === 'tool' && part.state === 'asking'),
    )
  }

  get running(): boolean {
    return !!this.thread && !!this.chat?.running.includes(this.thread.id)
  }

  get trouble(): string | null {
    if (this.running) return null
    const parts = this.drawn.at(-1)?.parts ?? []
    const notice = parts.filter((part) => part.kind === 'notice' && part.code === 'error').at(-1)
    return notice?.kind === 'notice' ? notice.text : this.failed
  }

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

  close() {
    this.open = false
    this.reset()
  }

  private reset() {
    this.session += 1
    this.question = ''
    this.context = null
    this.texts = []
    this.target = null
    this.thread = null
    this.failed = null
    this.chat?.watch(null)
  }

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
    if (view)
      this.target = {
        view,
        at: range?.to ?? 0,
        doc: view.state.doc,
        shows: documentOf(view),
      }
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

  drop() {
    this.context = null
  }

  take(label: string, text: string) {
    this.failed = null
    this.texts = [...this.texts, { kind: 'words', id: crypto.randomUUID(), label, text }]
  }

  refuse(why: string) {
    this.failed = why
  }

  dropText(id: string) {
    this.texts = this.texts.filter((one) => one.id !== id)
  }

  stop() {
    if (this.thread) this.chat?.stopIn(this.thread.id)
  }

  async ask() {
    const question = this.question.trim()
    const texts = this.texts
    if ((!question && !texts.length) || this.running || this.loading || !this.ready) return
    this.question = ''
    this.texts = []

    this.failed = null
    const session = this.session
    const thread = this.thread
    const context = thread ? null : this.context
    if (!thread) this.context = null
    this.loading = true
    const chat = await chatStore().finally(() => (this.loading = false))
    this.chat = chat
    const here = session === this.session
    let asked: Thread
    let ended: Promise<Ended>
    if (thread) {
      asked = thread
      ended = chat.sendIn(thread, question, texts, nothing())
    } else {
      const chips = [...(context?.chips ?? []), ...texts]
      const started = chat.startHere(question, chips, context?.around ?? nothing())
      asked = started.thread
      ended = started.ended
      if (here) {
        this.thread = asked
        chat.watch(asked)
      }
    }
    if (!here) return
    const end = await ended
    if (this.thread !== asked) return
    void chat.saw(asked.id)
    if (end.stop === 'error' && !end.turn && end.error) this.failed = end.error
  }

  async continueInPanel() {
    const thread = this.thread
    if (!thread || !workspace.offers('ask')) return
    this.close()
    const [chat, { revealChat }] = await Promise.all([chatStore(), import('./sidebar/reveal')])
    revealChat()
    await chat.openThread(thread.id)
  }

  async addToNote(text: string) {
    const target = this.target
    if (
      target &&
      !target.view.state.readOnly &&
      target.view.dom.isConnected &&
      documentOf(target.view) === target.shows
    ) {
      const { view } = target
      const doc = view.state.doc.toString()
      const at =
        view.state.doc === target.doc ? target.at : carried(target.doc.toString(), doc, target.at)
      const { from, insert, caret } = insertion(doc, Math.min(at, doc.length), text)
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

function nothing(): Around {
  return { front: null, selection: '', picked: null }
}

export const quick = new Quick()
