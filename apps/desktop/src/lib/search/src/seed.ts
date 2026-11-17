import type { EditorState } from '@orden/editor'

const LONGEST = 200

export function selectedWords(state: EditorState): string | null {
  const { from, to, empty } = state.selection.main
  if (empty) return null

  const words = state.sliceDoc(from, to).trim()
  if (!words || words.length > LONGEST || words.includes('\n')) return null

  return words
}
