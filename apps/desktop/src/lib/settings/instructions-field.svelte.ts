/** What the field for a space's AGENTS.md holds, and when it writes.
 *
 *  The hover card's road (preview-card.ts): a file nobody has open, read when the field
 *  comes up and written through the one path a note nobody has open is written by, so a
 *  version is kept, the words reach a pane that happens to hold the note, and a space
 *  shared to be read refuses. Only typing writes: opening the settings makes no file, and
 *  a file that is there and would not read is left alone rather than saved over.
 *
 *  Cleared on purpose the file stays, empty. It is what `/memory`, agents and the setup
 *  read the same as no file at all, it is the same write as any other, a version keeps
 *  what it said, and another device hears an edit rather than a delete that an edit there
 *  would bring back. */

/** How long the typing rests before the file is written: the hover card's. */
export const SETTLES_AFTER = 900

/** How long one write may hold up the ones after it. A disk that does not answer leaves
 *  the words owed, and the next pause or leaving the field tries again. */
export const GIVES_UP_AFTER = 10_000

export interface FieldHands {
  /** Whether the space the file is at the top of is still there. `write_note` makes the
   *  folders it is asked for, so a file made after a space went would bring it back. */
  space(path: string): Promise<boolean>
  /** What the file says, with whatever is unsaved in a pane; null where it would not
   *  read or is not there. */
  read(path: string): Promise<string | null>
  /** Whether there is a file there at all, for a read that came back with nothing. */
  there(path: string): Promise<boolean>
  /** The note's write path. `first`: the first of this sitting, which keeps a version;
   *  every pause in the typing keeping one would push out the versions before it. */
  write(path: string, before: string, after: string, first: boolean): Promise<void>
  /** The file made, from nothing. */
  make(path: string, text: string): Promise<void>
}

/** Both sides of a write that crossed the typing, losing neither: the merge sync's
 *  classifier reads. Fetched with the first that does. */
async function merged(base: string, mine: string, theirs: string): Promise<string> {
  const { merge3 } = await import('@orden/sync-core/merge3')
  return merge3(base, mine, theirs).text
}

export class InstructionsField {
  text = $state('')
  loaded = $state(false)
  /** A file there that would not read: nothing here may write over it. */
  unreadable = $state(false)
  /** Words typed that the file does not hold yet. */
  dirty = $state(false)
  /** The space went from under the field: its words stay on screen and go nowhere. */
  orphaned = $state(false)

  /** What the file said when the typing started, which a merge is measured from. */
  private base = ''
  private wrote = false
  private timer: ReturnType<typeof setTimeout> | undefined
  /** The write in the air; a second waits for it. */
  private writing: Promise<void> = Promise.resolve()

  constructor(
    readonly path: string,
    private readonly hands: FieldHands,
    /** Whether the reader may only read, asked each time: a role can arrive late. */
    private readonly reading: () => boolean = () => false,
  ) {}

  get locked(): boolean {
    return this.unreadable || this.orphaned || this.reading()
  }

  async load() {
    const words = await this.hands.read(this.path)
    if (words === null && (await this.hands.there(this.path))) this.unreadable = true
    if (!this.dirty) {
      this.text = words ?? ''
      this.base = this.text
    }
    this.loaded = true
  }

  /** The file read again, where something other than the app's own writes may have
   *  written it: a CLI, while the window was elsewhere. */
  async look() {
    if (this.dirty) return
    const words = await this.hands.read(this.path)
    if (words !== null) this.heard(words)
  }

  type(words: string) {
    if (this.locked || !this.loaded) return
    this.text = words
    this.dirty = words !== this.base
    clearTimeout(this.timer)
    if (this.dirty) this.timer = setTimeout(() => void this.flush(), SETTLES_AFTER)
  }

  /** The file written by something else: sync, an agent, a pane. It simply appears, and
   *  while somebody is typing it waits for the write, which takes in both. */
  heard(words: string) {
    if (this.dirty) return
    this.text = words
    this.base = words
    this.unreadable = false
  }

  /** Whatever is unwritten, now. What leaving the field and closing the pane ask. */
  flush(): Promise<void> {
    clearTimeout(this.timer)
    this.writing = this.writing.then(() => this.bounded())
    return this.writing
  }

  private async bounded() {
    let timer: ReturnType<typeof setTimeout> | undefined
    const gives = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, GIVES_UP_AFTER)
    })
    await Promise.race([this.write(), gives])
    clearTimeout(timer)
  }

  private async write() {
    if (!this.dirty || this.locked) return

    const after = this.text
    try {
      const before = await this.hands.read(this.path)
      if (before === null) {
        if (await this.hands.there(this.path)) {
          this.unreadable = true
          return
        }
        if (!(await this.hands.space(this.path))) {
          this.orphaned = true
          return
        }
        if (after) await this.hands.make(this.path, after)
        this.settled(after, after)
        return
      }

      const crossed = before !== this.base
      const words = crossed ? await merged(this.base, after, before) : after
      if (words !== before) {
        await this.hands.write(this.path, before, words, crossed || !this.wrote)
        this.wrote = true
      }
      this.settled(after, words)
    } catch {
      // Still owed, and still in the field; leaving it or the next pause tries again.
    }
  }

  /** The file holds `words`, written for what the field said when the write began. Typed
   *  on since, it is still owed. */
  private settled(typed: string, words: string) {
    this.base = words
    if (this.text === typed) {
      this.text = words
      this.dirty = false
    } else {
      this.dirty = this.text !== words
    }
  }
}
