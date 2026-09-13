/** Saying a note instead of typing it - the row, and what it is called.
 *
 *  Two recognisers behind it: on Android the phone's own `SpeechRecognizer`, through
 *  the bridge, because the web's speech API is Chrome's and not the webview's;
 *  everywhere else the web's own, which is the same feature where it exists. Both of
 *  them, and the turn-taking and the words on their way into the note, are next door in
 *  dictating.ts and are fetched by the first press.
 *
 *  What is left here is what a menu has to answer before anything is fetched: whether
 *  anything on this device can hear, which is a property read, and what the row says,
 *  which is false until something has pressed it - nothing can be listening before the
 *  thing that listens has arrived. A capability rather than a build: one bundle, and a
 *  desktop with no recogniser simply never offers the row. */

import type { EditorView } from '@nib/editor'
import { workspace } from '../workspace.svelte'
import { method } from './bridge'

/** The browser's recogniser, under either of its two names, or nothing where the
 *  browser has none. Answered as the constructor rather than as a boolean because
 *  dictating.ts builds one from it: one place knows the two spellings. */
export function speechRecogniser(): unknown {
  const held = globalThis as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }
  const found = held.SpeechRecognition ?? held.webkitSpeechRecognition

  return typeof found === 'function' ? found : undefined
}

/** Whether anything can hear at all. Asked before the row is offered, so nobody
 *  presses a row that cannot work. */
export function canDictate(view?: EditorView): boolean {
  if (!view || view.state.readOnly || !workspace.active) return false
  return !!method('dictates')?.() || !!speechRecogniser()
}

/** The recogniser once a press has woken it. Nothing is listening before that, which
 *  is what lets the row be named without any of it. */
let woken: typeof import('./dictating') | null = null

/** Whether it is listening now, which is what the row says. */
export function dictating(): boolean {
  return woken?.dictating() ?? false
}

/** The row: on, or off again. */
export async function toggleDictation(view: EditorView): Promise<void> {
  woken ??= await import('./dictating')
  woken.toggle(view)
}

/** A space in front of a heard sentence where the words would otherwise be glued onto
 *  the last one, which is what a dictated sentence after a dictated sentence would be.
 *  Here rather than next door because it is the one part of this anybody tests. */
export function spaced(previous: string, words: string): string {
  if (!words) return ''

  return previous && !/\s/.test(previous) ? ` ${words}` : words
}
