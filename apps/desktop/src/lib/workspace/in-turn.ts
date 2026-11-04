/** A whole file written in its turn across the windows, and said to them, whose note of it
 *  takes it in the way it takes in one of their own writes (across.ts). What writes a file
 *  another window may have open comes through here: a link rewritten by a rename, a tag, a
 *  task ticked in results, a quick add. The turn orders the writes and nothing else, so
 *  words worked out from a file are worked out inside it: read, then write, then let go.
 *  Its own module for the link index, which write-file.ts tells. */

import { log } from '../log'
import { invoke } from '../tauri'
import type { Across } from './across'
import type { NoteDoc } from './documents.svelte'

/** The windows' bus, behind a door: the first paint writes nothing. */
const others = () => import('../windows')

/** `run` in a file's turn; see `oneWriteAt`. */
export async function inFileTurn<T>(path: string, run: () => Promise<T>): Promise<T> {
  const { oneWriteAt } = await others()
  return oneWriteAt(path, run)
}

/** The write, for a caller that holds the file's turn already, because of what it read
 *  first. `arrived`: the words came from elsewhere; see `write_note`. */
export async function writeInTurn(path: string, content: string, arrived = false): Promise<void> {
  await invoke('write_note', arrived ? { path, content, arrived } : { path, content })
  const { windows } = await others()
  if (!windows.alone) windows.say('words', { path, text: content })
}

/** The write and the turn. */
export function writeTaking(path: string, content: string, arrived = false): Promise<void> {
  return inFileTurn(path, () => writeInTurn(path, content, arrived))
}

/** The other windows, once this one has met them. */
let across: Across | null = null

export function meetAcross(one: Across | null) {
  across = one
}

/** The way to fetch them for a write before that; see `acrossSoon` in saving.svelte.ts. */
let acrossSoon: (() => Promise<Across>) | null = null

export function fetchAcross(fetch: () => Promise<Across>) {
  acrossSoon = fetch
}

/** An open note whose words were changed in place just now, on their way to its file: the
 *  words go down, and what was written is answered, or null where nothing was and they are
 *  owed. `knew` is what the note knew the file to hold before the change.
 *
 *  Its words may be on the disk unheard, another window's or another program's, so these go
 *  the way an autosave goes (across.ts), alone as well. In the same breath as the change,
 *  before anything waits: the note says what the file held, which is what news heard meanwhile
 *  merges against. A store with nothing to go through writes straight down, and a write
 *  refused is owed either way. `first` is what comes before the write: a version kept. */
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
  return first()
    .then(() => across ?? acrossSoon?.().catch(() => null) ?? null)
    .then(async (through) => {
      if (through) return through.writing(note, path, down)
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
        const { workspace } = await import('../workspace.svelte')
        workspace.owedWords(note)
        return null
      },
    )
}
