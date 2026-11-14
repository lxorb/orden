import { chorded, type Keystroke } from './ui-kit/src/api'
import { takesWords } from './typing-pointer'

export function kindOfLetter<Kind extends { letter: string }>(
  kinds: readonly Kind[],
  event: Keystroke & { repeat?: boolean },
): Kind | null {
  if (chorded(event) || event.repeat || event.isComposing || event.key.length !== 1) return null

  const letter = event.key.toLowerCase()
  return kinds.find((one) => one.letter === letter) ?? null
}

export function letterIsOurs(at: Element | null, pane: Element | null): boolean {
  if (at === null || at === document.body || at === document.documentElement) return true
  if (takesWords(at)) return false

  return pane?.contains(at) ?? false
}
