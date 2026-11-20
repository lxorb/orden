import { nameFromTitle } from '../../platform/src/api'
import type { NoteDoc } from '../../documents/src/api'
import { sameName, stemOf, titleLine, titleOf } from './title-name'

const settling = new WeakMap<object, () => void>()
export function followTitle(note: NoteDoc, rename: (path: string, name: string, was: string) => void): () => void {
  let watching: { snapshot: string | null; typed: string | null } | null = null
  let known: string | null = null
  let inside = false
  const settle = () => {
    const was = watching
    watching = null
    const path = note.path
    const stem = path === null ? null : stemOf(path)
    const now = titleOf(note.live.text.toString())?.words ?? null
    if (!was?.snapshot || stem === null || now === null || was.typed !== now) return
    const name = nameFromTitle(now)
    if (name !== null && path !== null && sameName(was.snapshot, stem) && !sameName(now, stem)) {
      rename(path, name, was.snapshot)
    }
  }
  settling.set(note, settle)
  return note.live.caret((caret) => {
    const text = note.live.text.toString()
    const words = titleOf(text)?.words ?? null
    const line = titleLine(text)
    const now = caret.focused && caret.head >= line.from && caret.head <= line.to
    if (now && !inside) {
      watching = { snapshot: caret.typed ? known : words, typed: null }
      if (caret.typed) {
        watching.typed = words
        settle()
        watching = { snapshot: words, typed: null }
      }
    } else if (now && caret.typed && watching) watching.typed = words
    else if (!now && watching) {
      if (caret.typed) watching.typed = words
      settle()
    }
    inside = now
    known = words
  })
}
export function settleTitle(note: object): void {
  settling.get(note)?.()
}
