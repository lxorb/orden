/** Saying a note instead of typing it.
 *
 *  Two recognisers behind one row. On Android the phone's own
 *  `SpeechRecognizer`, through the bridge, because the web's speech API is
 *  Chrome's and not the webview's; everywhere else the web's own, which is the
 *  same feature where it exists. Neither is nib's: no sound is recorded, nothing
 *  is uploaded, and what comes back is words.
 *
 *  The words land where the caret is, exactly as a paste does, so there is nothing
 *  new on screen. While it is listening the line across the top of the document
 *  sweeps and says so - the same line an export or a stored picture uses - because
 *  a mark somebody has to dismiss is not a quiet one. See Progress.svelte.
 *
 *  Turning it off is the same row again. A recogniser listens in turns and each
 *  one ends when the speaker pauses; the Kotlin side starts the next while
 *  dictation is still on, and the web's `continuous` does the same, so a pause
 *  between two sentences is a pause and not the end. */

import type { EditorView } from '@nib/editor'
import { busy } from '../busy.svelte'
import { t } from '../i18n.svelte'
import { writeAtCaret } from '../insert-picture'
import { log } from '../log'
import { views } from '../views.svelte'
import { workspace } from '../workspace.svelte'
import { answer, method } from './bridge'

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

/** The browser's recogniser, under either of its two names. */
function browsers(): Makes | undefined {
  const held = globalThis as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }
  const found = held.SpeechRecognition ?? held.webkitSpeechRecognition
  return typeof found === 'function' ? (found as Makes) : undefined
}

/** Whether anything can hear at all. Asked before the row is offered, so nobody
 *  presses a row that cannot work. */
export function canDictate(view?: EditorView): boolean {
  if (!view || view.state.readOnly || !workspace.active) return false
  return !!method('dictates')?.() || !!browsers()
}

/** Whether it is listening now, which is what the row says. */
export function dictating(): boolean {
  return listening
}

let listening = false
let release: (() => void) | null = null
let browser: Recogniser | null = null

/** The row: on, or off again. */
export function toggleDictation(view: EditorView): void {
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

  const makes = browsers()
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

export function spaced(previous: string, words: string): string {
  if (!words) return ''

  return previous && !/\s/.test(previous) ? ` ${words}` : words
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
