/** A tab that comes back with words its file never got, against what the file says now.
 *
 *  A window killed before the pause, a tab closed a moment after its last keystroke: the
 *  session has the words, and writing them is what bringing them back has always meant. But
 *  the file may have gone on since, another window's writes, an agent's, a pull, and those
 *  words written over it took everything newer off the note without a word.
 *
 *  So a draft with unwritten words also says which version of the file they were typed on
 *  (`base`), and they are treated as a write across windows treats them (across.ts): what
 *  lies between that version and the file is taken in, and a meeting keeps both. A plane's
 *  words do not merge and a file gone does not come back: the file stays as it is and the
 *  words become a draft of their own. Nothing is replaced and nothing is dropped.
 *
 *  Fetched by a restore that has such a tab. */

import { fold } from '@orden/rooms/fold'
import { unixLines } from './documents.svelte'
import type { Draft } from './session'

/** What this needs of the app. */
export interface Asks {
  read(path: string): Promise<string | null>
  exists(path: string): Promise<boolean>
  keepVersion(path: string, text: string): Promise<unknown>
  /** The space a file there would be in, for its words as a draft. */
  spaceOf(path: string): string | null
}

/** What the document is made from. */
export interface Back {
  path: string | null
  text: string
  dirty: boolean
  onDisk: string | null
  home: string | null
}

export async function cameBack(draft: Draft & { path: string }, asks: Asks): Promise<Back> {
  const words = unixLines(draft.doc)
  const base = draft.base === undefined ? null : unixLines(draft.base)
  const onFile = (dirty: boolean, onDisk: string | null, text = words): Back => ({
    path: draft.path,
    text,
    dirty,
    onDisk,
    home: null,
  })
  const asDraft = (): Back => ({
    path: null,
    text: words,
    dirty: true,
    onDisk: null,
    home: asks.spaceOf(draft.path),
  })

  const read = await asks.read(draft.path)
  if (read === null) {
    // Not read is not gone: the words wait on it, and a write says what is wrong.
    if (await asks.exists(draft.path)) return onFile(true, base)
    return base === null ? onFile(true, null) : asDraft()
  }

  const disk = unixLines(read)
  if (disk === words) return onFile(false, disk)
  if (base === null) {
    // Nothing to go by, so nothing to merge: what is there is kept, as across.ts keeps it.
    await asks.keepVersion(draft.path, read).catch(() => undefined)
    return onFile(true, null)
  }
  if (disk === base) return onFile(true, base)
  if (draft.kind !== 'note') return asDraft()

  const merged = await mergedOver(base, words, disk)
  return onFile(merged !== disk, disk, merged)
}

/** How much of the words around a change is looked for with it. */
const AROUND = 40

/** Words typed on `base`, brought onto a file that has gone on since. A file that went on
 *  with them in it is what happens to a write that did land, and is not a meeting: a merge
 *  would keep both copies. So the typing is looked for first, with what it was typed
 *  beside: words alone may be there for any reason. */
export async function mergedOver(base: string, words: string, disk: string): Promise<string> {
  const typed = fold(base, words)
  if (typed?.insert) {
    const left = base.slice(Math.max(0, typed.from - AROUND), typed.from)
    const right = base.slice(typed.to, typed.to + AROUND)
    if (disk.includes(left + typed.insert) && (left !== '' || disk.includes(typed.insert + right)))
      return disk
  }
  const { merge3 } = await import('@orden/sync-core/merge3')
  return merge3(base, words, disk).text
}
