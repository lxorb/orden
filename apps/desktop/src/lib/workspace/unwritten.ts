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
  /** Whether the folder of the path's space answers; see `reachable` in across.ts. */
  reachable(path: string): Promise<boolean>
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
    if (base === null || !(await asks.reachable(draft.path))) return onFile(true, base)
    return asDraft()
  }

  const disk = unixLines(read)
  if (disk === words) return onFile(false, disk)
  if (base === null) {
    // Nothing to go by, so nothing to merge: what is there is kept, as across.ts keeps it.
    await asks.keepVersion(draft.path, read).catch(() => undefined)
    return onFile(true, null)
  }
  if (disk === base) {
    // Words that never landed, or that landed unheard and were taken out again, which reads
    // the same from here: what goes under them stays in the note's versions.
    await asks.keepVersion(draft.path, read).catch(() => undefined)
    return onFile(true, base)
  }
  // The plugin carries no merge: it has one window and nothing writing beside it.
  if (draft.kind !== 'note' || __EVEN_PLUGIN__) return asDraft()

  const merged = await mergedOver(base, words, disk)
  return onFile(merged !== disk, disk, merged)
}

/** How much of the words around a change is looked for with it, unless all of them are. A
 *  few characters are there by chance: `# To` is in `## To do`. */
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
    if (
      disk.includes(left + typed.insert + right) ||
      (left.length === AROUND && disk.includes(left + typed.insert)) ||
      (right.length === AROUND && disk.includes(typed.insert + right))
    )
      return disk
  }
  if (__EVEN_PLUGIN__) return words
  const { mergedOn } = await import('@orden/sync-core/merge3')
  return mergedOn(base, words, disk)
}

/** A draft's words brought onto the words of the file's open document, or null where they do
 *  not merge: no version they were typed on, or a kind whose words are not text. */
export async function wordsOnto(
  draft: Draft,
  kind: Draft['kind'],
  holds: string,
): Promise<string | null> {
  if (draft.base === undefined || draft.kind !== 'note' || kind !== 'note') return null
  if (__EVEN_PLUGIN__) return null
  return mergedOver(unixLines(draft.base), unixLines(draft.doc), holds)
}
