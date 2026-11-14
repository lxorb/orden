import type { EditorView } from '@orden/editor'
import { speechRecogniser } from '../dictation/recogniser'
import { workspace } from '../workspace.svelte'
import { method } from '../platform/src/api'

export { speechRecogniser }

export function canDictate(view?: EditorView): boolean {
  if (!view || view.state.readOnly || !workspace.active) return false
  return !!method('dictates')?.() || !!speechRecogniser()
}

let woken: typeof import('./dictating') | null = null

export function dictating(): boolean {
  return woken?.dictating() ?? false
}

export async function toggleDictation(view: EditorView): Promise<void> {
  woken ??= await import('./dictating')
  woken.toggle(view)
}

export function spaced(previous: string, words: string): string {
  if (!words) return ''

  return previous && !/\s/.test(previous) ? ` ${words}` : words
}
