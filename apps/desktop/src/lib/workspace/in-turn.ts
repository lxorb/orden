import { invoke, log, writeTaking } from '../platform/src/api'
import type { Across } from './across'
import type { NoteDoc } from './documents.svelte'

let across: Across | null = null

export function meetAcross(one: Across | null) {
  across = one
}

let acrossSoon: (() => Promise<Across>) | null = null

export function fetchAcross(fetch: () => Promise<Across>) {
  acrossSoon = fetch
}

export function wroteHere(path: string): void {
  if (across) {
    across.wroteHere(path)
    return
  }
  void acrossSoon?.().then(
    (one) => one.wroteHere(path),
    () => undefined,
  )
}

export function writeEdited(
  note: NoteDoc,
  path: string,
  words: string,
  knew: string | null,
  first: () => Promise<unknown> = () => Promise.resolve(),
): Promise<string | null> {
  const revision = note.revision
  note.onDisk = knew
  note.dirty = true
  const down = (content: string) => invoke('write_note', { path, content })
  let through: Across | null = null
  return first()
    .then(() => across ?? acrossSoon?.().catch(() => null) ?? null)
    .then(async (found) => {
      through = found
      if (found) return found.writing(note, path, down)
      await writeTaking(path, words)
      note.onDisk = words
      return { words, revision }
    })
    .then(
      (written) => {
        if (written === null) return null
        note.dirty = note.revision !== written.revision
        return written.words
      },
      async (error: unknown) => {
        log('error', `save: ${path} - ${String(error)}`)
        if (through) through.owe(note)
        else (await import('../workspace.svelte')).workspace.owedWords(note)
        return null
      },
    )
}
