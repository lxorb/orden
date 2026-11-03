/** What a window with no engine owes the window that runs it.
 *
 *  One engine per device: `leadSync` elects a window, and what any other window does -
 *  an autosave, a file operation - has to reach it, or the account never hears. So each is
 *  said on the channel and kept until the engine's window answers that it has taken it
 *  (`done`, once what it did is in the store). A leader that crashed answered nothing: what
 *  it did not answer is said again to the next one (`resend`), or run here if this window
 *  is the next one (`drain`). Nothing is lost, and a thing said twice meets an engine that
 *  already holds it, which `forwarded` in the runner sees to. */

import type { FileOp } from '../workspace/file-ops'

type OwedOp = FileOp

export interface Owing {
  id: string
  what:
    | { kind: 'wrote'; path: string; text: string }
    /** `entry` is the note the operation was about, by its id, where it had one. */
    | { kind: 'op'; op: FileOp; entry?: string }
}

/** The most anybody owes: an engine's window that has not answered this many has not been
 *  there for a long time, and what is dropped is an old autosave, whose words are on the
 *  disk for the engine's own look at the folder to find. */
const MOST_OWED = 1_000

/** What the engine's window does with one thing owed. A thing said twice, or heard from
 *  the folder's watch first, finds the engine already holding it: a note made twice is
 *  `New 2.md`, which nobody made. */
export async function takeOwed(
  engine: {
    saved(path: string, text: string): Promise<void>
    entryAt(path: string): { id: string } | null | undefined
  },
  item: Owing,
  follow: (op: OwedOp) => unknown,
): Promise<void> {
  if (item.what.kind === 'wrote') {
    await engine.saved(item.what.path, item.what.text)
    return
  }
  const op = item.what.op
  if (op.op === 'created') {
    if (engine.entryAt(op.path)) return
  } else if (op.kind !== 'space') {
    // Said again over a new note that has since come to the same path: not that note.
    const there = engine.entryAt(op.op === 'moved' ? op.from : op.path)
    if (!there || (item.what.entry !== undefined && there.id !== item.what.entry)) return
  }
  await follow(op)
}

export class Owed {
  private readonly owing: Owing[] = []
  private next = 0

  constructor(private readonly say: (item: Owing) => void) {}

  /** Owes one more, and says it. */
  add(what: Owing['what']): void {
    // One note's later save says all an earlier one did, unless a move came between.
    if (what.kind === 'wrote') {
      const last = this.owing.map((one) => one.what.kind).lastIndexOf('op')
      const at = this.owing.findIndex(
        (one, index) => index > last && one.what.kind === 'wrote' && one.what.path === what.path,
      )
      if (at >= 0) this.owing.splice(at, 1)
    }
    if (this.owing.length >= MOST_OWED) {
      const old = this.owing.findIndex((one) => one.what.kind === 'wrote')
      this.owing.splice(Math.max(old, 0), 1)
    }
    const item = { id: `${this.next++}`, what }
    this.owing.push(item)
    this.say(item)
  }

  /** Everything, for an account that has gone. */
  clear(): void {
    this.owing.length = 0
  }

  /** The engine's window has it. */
  done(id: string): void {
    const at = this.owing.findIndex((one) => one.id === id)
    if (at >= 0) this.owing.splice(at, 1)
  }

  /** A new engine's window: everything it has not answered, in order. */
  resend(): void {
    for (const item of this.owing) this.say(item)
  }

  /** This window is the engine's now: everything owed, for it to run, in order. */
  drain(): Owing[] {
    return this.owing.splice(0)
  }

  get size(): number {
    return this.owing.length
  }
}
