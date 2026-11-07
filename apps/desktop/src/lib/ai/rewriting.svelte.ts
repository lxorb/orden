import type { EditorView } from '@orden/editor'
import { i18n, message, t } from '../i18n.svelte'
import { complete, wasStopped } from './complete'
import { defaultLanguage, nameOfLanguage, rewriteMessages, stillThere, type Verb } from './rewrite'
import { rewriteSheet } from '../surfaces.svelte'
import { ai } from './store.svelte'

class Rewriting {
  open = $state(false)
  verb = $state<Verb | null>(null)
  language = $state('en')
  before = $state('')
  after = $state('')
  running = $state(false)
  trouble = $state<string | null>(null)

  private view: EditorView | null = null
  private place: { from: number; to: number } | null = null
  private stopper: AbortController | null = null

  show(view: EditorView) {
    const range = view.state.selection.main
    if (range.empty || view.state.readOnly) return

    void rewriteSheet.ask()

    this.view = view
    this.place = { from: range.from, to: range.to }
    this.before = view.state.doc.sliceString(range.from, range.to)
    this.after = ''
    this.verb = null
    this.running = false
    this.trouble = null
    this.language = defaultLanguage(i18n.language)
    this.open = true
  }

  run(verb: Verb) {
    const provider = ai.providerFor('rewrite')
    this.verb = verb
    this.after = ''
    this.trouble = null

    if (!provider) {
      this.trouble = t('Add an AI provider in Settings first.')
      return
    }

    this.stopper?.abort()
    const stopper = new AbortController()
    this.stopper = stopper
    this.running = true

    void complete({
      provider,
      model: provider.model,
      messages: rewriteMessages(verb, nameOfLanguage(this.language), this.before),
      stream: (piece) => {
        if (this.stopper === stopper) this.after += piece
      },
      signal: stopper.signal,
    })
      .catch((error: unknown) => {
        if (this.stopper !== stopper || wasStopped(error)) return
        this.trouble = message(error, t('The model did not answer.'))
      })
      .finally(() => {
        if (this.stopper === stopper) this.running = false
      })
  }

  accept() {
    const view = this.view
    const place = this.place
    const text = this.after.trim()
    if (!view || !place || !text) return
    const now =
      view.dom.isConnected && !view.state.readOnly
        ? stillThere(view.state.doc.toString(), place, this.before)
        : null
    if (!now) {
      this.trouble = t('The words chosen are no longer in the note, so nothing was replaced.')
      return
    }

    view.dispatch({
      changes: { from: now.from, to: now.to, insert: text },
      selection: { anchor: now.from, head: now.from + text.length },
    })
    view.focus()
    this.close()
  }

  close() {
    this.stopper?.abort()
    this.stopper = null
    this.open = false
    this.view = null
    this.place = null
    this.before = ''
    this.after = ''
    this.verb = null
    this.running = false
    this.trouble = null
  }
}

export const rewriting = new Rewriting()
