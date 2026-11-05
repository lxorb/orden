/** Dictation's keys in a field that takes it (#1128), as a Svelte action on the field.
 *
 *  - The dictation key (`field.dictate`, Alt+V unless the reader moved it): a tap starts
 *    and a second tap finishes, and a key held past `HOLD` is push-to-talk - letting go
 *    finishes. The button beside the field reads a press the same way (DictateButton).
 *  - Escape, while dictating, cancels: the microphone closes and the field is put back.
 *  - Enter, while dictating, finishes first and then is Enter: the final words go in,
 *    and the field does with them what it does with Enter. The press is handed back to
 *    the field once the words are there, so its host's own send is the one that runs.
 *
 *  On the field itself rather than in each host's key handler, so the three hosts read
 *  the same keys the same way, and ahead of them: a key spent here never reaches them. */

import { shortcuts } from '../shortcuts.svelte'
import { type Dictates, voice } from './voice.svelte'
import type { Field } from './spot'

/** How long a press is held before it is push-to-talk rather than a tap. */
export const HOLD = 350

export function dictating(field: Field, owner: Dictates) {
  let held: { at: number; started: boolean } | null = null

  const down = (event: KeyboardEvent) => {
    if (event.isComposing) return
    const now = voice.of(owner)
    if (shortcuts.pressed('field.dictate', event)) {
      event.preventDefault()
      event.stopPropagation()
      if (event.repeat) return
      held = { at: performance.now(), started: now === 'idle' }
      void (now === 'idle' ? voice.start(owner) : voice.finish())
      return
    }
    if (now === 'idle') return

    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      voice.cancel()
      return
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      event.stopPropagation()
      const again = {
        key: 'Enter',
        code: 'Enter',
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
      }
      void voice.finish().then(() => {
        field.dispatchEvent(
          new KeyboardEvent('keydown', { ...again, bubbles: true, cancelable: true }),
        )
      })
    }
  }

  const up = () => {
    const was = held
    held = null
    if (was?.started && performance.now() - was.at >= HOLD) void voice.finish()
  }

  // As an element: the union of the two field types has no one overload to call.
  const element: HTMLElement = field
  element.addEventListener('keydown', down)
  element.addEventListener('keyup', up)

  return {
    update(next: Dictates) {
      owner = next
    },
    destroy() {
      element.removeEventListener('keydown', down)
      element.removeEventListener('keyup', up)
      // A field going away takes its dictation with it: there is nowhere left to write.
      if (voice.owner === owner) voice.cancel()
    },
  }
}
