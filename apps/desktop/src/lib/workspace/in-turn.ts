import { log } from '../log'
import { invoke } from '../tauri'
import type { Across } from './across'
import type { NoteDoc } from './documents.svelte'

const others = () => import('../windows')

export async function inFileTurn<T>(path: string, run: () => Promise<T>): Promise<T> {
  const { oneWriteAt } = await others()
  return oneWriteAt(path, run)
}

export async function writeInTurn(path: string, content: string, arrived = false): Promise<void> {
  await invoke('write_note', arrived ? { path, content, arrived } : { path, content })
  const { windows } = await others()
  if (!windows.alone) windows.say('words', { path, text: content })
}

export function writeTaking(path: string, content: string, arrived = false): Promise<void> {
  return inFileTurn(path, () => writeInTurn(path, content, arrived))
}

let across: Across | null = null

export function meetAcross(one: Across | null) {
  across = one
}

let acrossSoon: (() => Promise<Across>) | null = null

export function fetchAcross(fetch: () => Promise<Across>) {
  acrossSoon = fetch
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
