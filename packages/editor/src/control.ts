import { type Extension, Prec } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

export function unprintable(text: string): boolean {
  if (!text) return false
  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at)
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)) return false
  }
  return true
}

export function refuseControlCharacters(): Extension {
  return Prec.highest(EditorView.inputHandler.of((_view, _from, _to, typed) => unprintable(typed)))
}
