import { shortcuts } from '../shortcuts.svelte'
import { type Dictates, voice } from './voice.svelte'
import type { Field } from './spot'

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
      if (voice.owner === owner) voice.cancel()
    },
  }
}
