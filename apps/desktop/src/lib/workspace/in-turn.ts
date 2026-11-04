/** A whole file written in its turn across the windows, and said to them, whose note of it
 *  takes it in the way it takes in one of their own writes (across.ts). What writes a file
 *  another window may have open comes through here: a link rewritten by a rename, a tag, a
 *  task ticked in results, a quick add. Its own module for the link index, which
 *  write-file.ts tells. */

import { invoke } from '../tauri'

/** The windows' bus, behind a door: the first paint writes nothing. */
const others = () => import('../windows')

/** `run` in a file's turn; see `oneWriteAt`. */
export async function inFileTurn<T>(path: string, run: () => Promise<T>): Promise<T> {
  const { oneWriteAt } = await others()
  return oneWriteAt(path, run)
}

/** The write, for a caller that holds the file's turn already, because of what it read
 *  first. */
export async function writeInTurn(path: string, content: string): Promise<void> {
  await invoke('write_note', { path, content })
  const { windows } = await others()
  if (!windows.alone) windows.say('words', { path, text: content })
}

/** The write and the turn. */
export function writeTaking(path: string, content: string): Promise<void> {
  return inFileTurn(path, () => writeInTurn(path, content))
}
