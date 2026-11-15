import type { EditorState } from '@orden/editor'
import { parseQuery } from '@orden/scan/search/query'

const LONGEST = 200

export function selectedWords(state: EditorState): string | null {
  const { from, to, empty } = state.selection.main
  if (empty) return null

  const words = state.sliceDoc(from, to).trim()
  if (!words || words.length > LONGEST || words.includes('\n')) return null

  return words
}

function readsAsItself(token: string): boolean {
  const query = parseQuery(token)
  return query.kind === 'text' && query.text === token
}

export function asWritten(words: string): string {
  return words
    .split(/\s+/)
    .map((token) => (readsAsItself(token) ? token : `"${token.replace(/[\\"]/g, '\\$&')}"`))
    .join(' ')
}
