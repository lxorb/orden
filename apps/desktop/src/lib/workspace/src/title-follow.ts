import { nameFromTitle } from '../../platform/src/api'
import { lineOf, sameName, stemOf, titleOf } from './title-name'

interface Caret {
  head: number
  focused: boolean
  typed: boolean
}
export interface Titled {
  readonly path: string | null
  readonly live: {
    readonly text: { toString(): string }
    caret(listener: (caret: Caret) => void): () => void
  }
}
const settling = new WeakMap<object, () => void>()
export function followTitle(note: Titled, rename: (path: string, name: string) => void): () => void {
  let watching: { snapshot: string; typed: string | null } | null = null
  const settle = () => {
    const was = watching
    watching = null
    const path = note.path
    const stem = path === null ? null : stemOf(path)
    const now = titleOf(note.live.text.toString())?.words ?? null
    if (!was || path === null || stem === null || now === null || was.typed !== now) return
    const name = nameFromTitle(now)
    if (name !== null && sameName(was.snapshot, stem) && !sameName(now, stem)) rename(path, name)
  }
  settling.set(note, settle)
  return note.live.caret((caret) => {
    const text = note.live.text.toString()
    const title = titleOf(text)
    const line = title && lineOf(text, title)
    const inside = caret.focused && line !== null && caret.head >= line.from && caret.head <= line.to
    if (inside && title) {
      watching ??= { snapshot: title.words, typed: null }
      if (caret.typed) watching.typed = title.words
      return
    }
    if (!watching) return
    if (caret.typed && title) watching.typed = title.words
    settle()
  })
}
export function settleTitle(note: object): void {
  settling.get(note)?.()
}
