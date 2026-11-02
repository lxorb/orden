/** The scratchpad: one note that belongs to no space, for pasting something in and
 *  jotting something down before deciding where it goes.
 *
 *  Drafts opens on a blank page and asks where a thought goes afterwards; Apple's Quick
 *  Note and Raycast's notes are one key away from anywhere and that same key puts them
 *  away. So this is a switch in the bar and a card docked at the window's edge, never a
 *  tab: it is not in a strip, a tab cycle, the closed tabs or the session's tabs, and
 *  opening its file from anywhere shows the card (see `open` in the workspace). Docked
 *  rather than floating, because a web tab's page is a native view that would draw over
 *  a floating card; docked, the page is narrowed instead. It takes turns with the right
 *  side at that edge, never both: up, it goes over the side, and the side is back as it
 *  goes; see workspace/panels.ts. On a phone or a tablet it is the one note on screen
 *  (#206); see ScratchpadCard.svelte.
 *
 *  It lives beside `custom.css` in the app's own folder (`scratchpad_path` in the
 *  crate's themes.rs, which `openable` admits); the browser build keeps it in a dot
 *  folder of its own store. Its words answer the Search panel from every space, and the
 *  quick question puts an answer on its end when no note is in front; see
 *  search/scratchpad.ts and ai/quick.svelte.ts. Whether the card is up is is.svelte.ts,
 *  the column it slides in PadColumn.svelte, the card ScratchpadCard.svelte. */

import type { EditorView } from '@orden/editor'
import { log } from '../log'
import { onDisk } from '../on-disk'
import { applied, type Edit } from '../search/replace'
import { forget, isRecord, isString, keep, stored, storedText } from '../stored'
import { invoke } from '../tauri'
import { workspace } from '../workspace.svelte'
import { writeFile } from '../workspace/write-file'
import { shown } from './is.svelte'
import { difference, joined } from './words'

/** The words the card is writing, until the file has them. A write begun as the page goes
 *  may never land - a browser does not wait for it, and WebKit lost it now and then - and
 *  this is in no session to be written by the next launch, as a note's words are (#446).
 *
 *  Held with what the file may say for them to be written over it: what it said when they
 *  were begun, or any write then on its way. Anything else is somebody's words since, an
 *  append's or another program's, and the two go side by side rather than one over the
 *  other; see `settled`. */
const WRITING = 'nib:scratchpad-writing'

interface Owed {
  words: string
  over: string[]
}

function owedNow(): Owed | null {
  const held = stored(WRITING)
  return isRecord(held) && isString(held.words) && Array.isArray(held.over)
    ? { words: held.words, over: held.over.filter(isString) }
    : null
}

/** Enough to tell two texts apart, without holding a second copy of the words. */
function stamp(text: string): string {
  let hash = 2166136261
  for (let at = 0; at < text.length; at++) {
    hash = Math.imul(hash ^ text.charCodeAt(at), 16777619)
  }
  return `${text.length}:${(hash >>> 0).toString(36)}`
}

/** What the words owed and what the file says come to. */
function settled(owed: Owed, file: string): string {
  if (file === owed.words) return file
  return owed.over.includes(stamp(file)) ? owed.words : joined(file, owed.words)
}

class Scratchpad {
  private asked: Promise<string> | null = null
  /** What the file said when this window last read or wrote it; null before that. */
  private known: string | null = null
  /** The words of the writes on their way. */
  private readonly onTheirWay = new Set<string>()
  /** The card's editor while it is up, which holds the words before the file does. */
  live: EditorView | null = null
  /** The line a search hit asked the card to land on; the card takes it. */
  line: number | null = null

  /** Where it is, made the first time, with what the last run did not get written down
   *  written first. One question per run; a failed one is asked again next time. */
  where(): Promise<string> {
    this.asked ??= invoke<string>('scratchpad_path')
      .then(async (path) => {
        await this.pay(path)
        return path
      })
      .catch((error: unknown) => {
        this.asked = null
        throw error
      })
    return this.asked
  }

  /** What is owed, written. A disk that will not take it or a file that will not read
   *  costs nothing: it stays owed, and the card opens on it; see `editable`. */
  private async pay(path: string): Promise<void> {
    const owed = owedNow()
    if (!owed) return

    try {
      const file = await workspace.noteText(path)
      if (file === null && (await onDisk(path))) return
      const words = settled(owed, file ?? '')
      if (words !== file) await writeFile(path, words)
      this.known = words
      forget(WRITING)
    } catch (error) {
      log('warn', `scratchpad: what the last run owed is not written yet: ${String(error)}`)
    }
  }

  /** The card's words to the file, held until they are there. Storage too full to hold
   *  them leaves nothing older in their place, which the next launch would write. */
  async writeDown(path: string, words: string): Promise<void> {
    const mine = JSON.stringify({ words, over: this.mayBe() } satisfies Owed)
    if (!keep(WRITING, mine)) {
      forget(WRITING)
      keep(WRITING, mine)
    }

    await this.landed(path, words)
    if (storedText(WRITING) === mine) forget(WRITING)
  }

  /** What the file may say now, as far as this window can tell. */
  private mayBe(): string[] {
    const known = this.known === null ? [] : [this.known]
    return [...known, ...this.onTheirWay].map(stamp)
  }

  /** Every write of the file goes through here, so `known` stays what it says. */
  private async landed(path: string, words: string): Promise<void> {
    this.onTheirWay.add(words)
    try {
      await writeFile(path, words)
      this.known = words
    } finally {
      this.onTheirWay.delete(words)
    }
  }

  /** The card up, with the keyboard in it unless asked not to, at a line when one is
   *  given. */
  show(line: number | null = null, take = true) {
    this.line = line
    shown.show(take)
  }

  /** What it says now: the card's words while it is up, else the file's. */
  async text(): Promise<string> {
    if (this.live) return this.live.state.doc.toString()
    return (await workspace.noteText(await this.where())) ?? ''
  }

  /** Puts words on the end of it, with a blank line before them, without showing it.
   *  A card that is up takes them as an edit - its caret stays put - and the file is
   *  written in the same breath. */
  async append(words: string): Promise<void> {
    await this.write((before) => joined(before, words))
  }

  /** An agent's edits, worked out against `before`, put in the same way: through the
   *  card while it is up, so the reader's caret is carried, and into the file. False
   *  when the words are no longer `before` - the reader wrote meanwhile - and the
   *  edits have to be worked out again. See agents/docs. */
  async replace(before: string, edits: readonly Edit[]): Promise<boolean> {
    const path = await this.where()
    const live = this.live
    const now = live ? live.state.doc.toString() : await this.toChange(path)
    if (now.replace(/\r\n?/g, '\n') !== before) return false

    live?.dispatch({ changes: [...edits] })
    await this.written(path, applied(before, edits))
    return true
  }

  /** What the card opens on: the file's words, or nothing where there is no file
   *  yet. Throws where the file is there and will not read, since a card opened empty
   *  on it saved over everything it held at the first keystroke. */
  async editable(): Promise<string> {
    const text = await this.toChange(await this.where())
    this.known = text
    const owed = owedNow()
    return owed ? settled(owed, text) : text
  }

  /** What a write changes: the card's words while it is up, else the file's, and
   *  nothing where there is no file yet. A file that is there and will not read -
   *  another encoding, a lock - reads as nothing too, and a write worked out against
   *  nothing emptied it; so that refuses instead. */
  private async toChange(path: string): Promise<string> {
    if (this.live) return this.live.state.doc.toString()
    const words = await workspace.noteText(path)
    if (words !== null) return words
    if (await onDisk(path)) throw new Error(`${path} is there and would not read`)
    return ''
  }

  private async write(change: (before: string) => string): Promise<void> {
    const path = await this.where()
    const before = await this.toChange(path)
    const after = change(before)
    if (after === before) return

    this.live?.dispatch({ changes: difference(before, after) })
    await this.written(path, after)
  }

  /** An edit, written. The card's words have what is owed in them, so with the card up it
   *  is done with; with the card away it is not, and goes beside these next launch. */
  private async written(path: string, words: string): Promise<void> {
    const held = storedText(WRITING)
    const within = this.live !== null
    await this.landed(path, words)
    if (within && storedText(WRITING) === held) forget(WRITING)
  }
}

export const scratchpad = new Scratchpad()
