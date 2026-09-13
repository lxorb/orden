/** Two recognisers behind one row, and everything either of them needs.
 *
 *  Fetched by the first press rather than carried: a row that says "Dictate" has to
 *  know whether anything can hear, and that is a property read - which is all that is
 *  left in dictation.ts. What is here is the turn-taking, the words on their way into
 *  the note, and the line across the top that says it is listening.
 *
 *  On Android the phone's own `SpeechRecognizer`, through the bridge, because the web's
 *  speech API is Chrome's and not the webview's; everywhere else the web's own, which
 *  is the same feature where it exists. Neither is nib's: no sound is recorded, nothing
 *  is uploaded, and what comes back is words. */

import type { EditorView } from '@nib/editor'
import { busy } from '../busy.svelte'
import { t } from '../i18n.svelte'
import { writeAtCaret } from '../insert-picture'
import { log } from '../log'
import { views } from '../views.svelte'
import { workspace } from '../workspace.svelte'
import { answer, method } from './bridge'
import { spaced, speechRecogniser } from './dictation'

/** One thing a recogniser heard, as the web hands it over. Written out rather
 *  than taken from the DOM library, which has no types for the webkit spelling
 *  half the browsers still answer to. */
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

/** Whether it is listening now, which is what the row says. Read through the door,
 *  which answers false while this module has not been fetched - and nothing can be
 *  listening before something pressed the row. */
export function dictating(): boolean {
  return listening
}

/** The row: on, or off again. */
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
    // False where the microphone has still to be asked for; the answer arrives
    // through `__nibHeard` either way.
    phone(true)
    return
  }

  const makes = speechRecogniser() as Makes | undefined
  if (!makes) return

  const one = new makes()
  one.continuous = true
  // Only what it is sure of. A half-heard word written into the note and taken
  // back out again is the caret jumping about while somebody is talking.
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

  // Both ends are the same end: whatever it was, nothing is listening now.
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
    phone(false)
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

/** What the activity heard, or what it is doing about it. */
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
  // Refused, or a recogniser that gave up: the row goes back to saying "dictate".
  if (held.state === 'off' || held.state === 'refused') stop()
}

/** One heard sentence, into the note. A space in front where the words would
 *  otherwise be glued onto the last one, which is what a dictated sentence after
 *  a dictated sentence would be. */
function put(view: EditorView, words: string): void {
  const one = views.of(workspace.panes.focusedId) ?? view
  if (one.state.readOnly) return

  writeAtCaret(one, spaced(before(one), words.trim()))
}

/** The character in front of the caret, or the empty string at the very start. */
function before(view: EditorView): string {
  const at = view.state.selection.main.from

  return at > 0 ? view.state.doc.sliceString(at - 1, at) : ''
}

/** The line across the top, sweeping while it listens. Held open by a promise
 *  that resolves when dictation stops, because that is what `busy` counts. */
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
