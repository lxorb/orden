import type { EditorView } from '@orden/editor'
import { busy } from '../busy.svelte'
import { t } from '../i18n.svelte'
import { writeAtCaret } from '../insert-picture'
import { log } from '../log'
import { views } from '../views.svelte'
import { workspace } from '../workspace.svelte'
import { answer, frameWord, method } from './bridge'
import { spaced, speechRecogniser } from './dictation'

interface Alternative {
  transcript: string
}

interface Result {
  isFinal: boolean
  0?: Alternative
}

interface Heard {
  resultIndex: number
  results: ArrayLike<Result | undefined>
}

interface Recogniser {
  continuous: boolean
  interimResults: boolean
  lang: string
  onresult: ((event: Heard) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}

type Makes = new () => Recogniser

let listening = false
let release: (() => void) | null = null
let browser: Recogniser | null = null

export function dictating(): boolean {
  return listening
}

export function toggle(view: EditorView): void {
  if (listening) stop()
  else start(view)
}

function start(view: EditorView): void {
  if (listening) return

  const phone = method('listen')
  if (phone) {
    listening = true
    hold()
    answer('__nibHeard', (json: string) => said(json, view))
    void frameWord().then((word) => {
      if (!listening) return
      if (word) phone(word, true)
      else stop()
    })
    return
  }

  const makes = speechRecogniser() as Makes | undefined
  if (!makes) return

  const one = new makes()
  one.continuous = true
  one.interimResults = false
  one.lang = document.documentElement.lang || 'en'

  one.onresult = (event: Heard) => {
    for (let at = event.resultIndex; at < event.results.length; at++) {
      const result = event.results[at]
      if (!result?.isFinal) continue

      const words = result[0]?.transcript ?? ''
      if (words.trim()) put(view, words)
    }
  }

  one.onerror = () => stop()
  one.onend = () => {
    if (listening) stop()
  }

  try {
    one.start()
  } catch (error) {
    log('error', `dictation: ${error instanceof Error ? error.message : String(error)}`)
    return
  }

  browser = one
  listening = true
  hold()
}

function stop(): void {
  listening = false

  const phone = method('listen')
  if (phone) {
    void frameWord().then((word) => phone(word, false))
    answer('__nibHeard', undefined)
  }

  if (browser) {
    const one = browser
    browser = null
    one.onend = null
    one.onerror = null
    one.onresult = null
    try {
      one.stop()
    } catch {
      // A recogniser that had already stopped is already where this wanted it.
    }
  }

  letGo()
}

function said(json: string, view: EditorView): void {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return
  }

  if (typeof parsed !== 'object' || parsed === null) return
  const held = parsed as Record<string, unknown>
  const words = typeof held.text === 'string' ? held.text : ''

  if (words.trim()) put(view, words)
  if (held.state === 'off' || held.state === 'refused') stop()
}

function put(view: EditorView, words: string): void {
  const one = views.of(workspace.panes.focusedId) ?? view
  if (one.state.readOnly) return

  writeAtCaret(one, spaced(before(one), words.trim()))
}

function before(view: EditorView): string {
  const at = view.state.selection.main.from

  return at > 0 ? view.state.doc.sliceString(at - 1, at) : ''
}

function hold(): void {
  busy.start(
    t('Listening'),
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      }),
  )
}

function letGo(): void {
  release?.()
  release = null
}
