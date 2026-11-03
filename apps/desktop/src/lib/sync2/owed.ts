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
  what: { kind: 'wrote'; path: string; text: string } | { kind: 'op'; op: FileOp }
}

/** What the engine's window does with one thing owed. A thing said twice, or heard from
 *  the folder's watch first, finds the engine already holding it: a note made twice is
 *  `New 2.md`, which nobody made. */
export async function takeOwed(
  engine: {
    saved(path: string, text: string): Promise<void>
    entryAt(path: string): unknown
  },
  item: Owing,
  follow: (op: OwedOp) => unknown,
): Promise<void> {
  if (item.what.kind === 'wrote') {
    await engine.saved(item.what.path, item.what.text)
    return
  }
  const op = item.what.op
  if (op.op === 'created' && engine.entryAt(op.path)) return
  if (op.op === 'moved' && op.kind !== 'space' && !engine.entryAt(op.from)) return
  if (op.op === 'removed' && op.kind !== 'space' && !engine.entryAt(op.path)) return
  await follow(op)
}

export class Owed {
  private readonly owing: Owing[] = []
  private next = 0

  constructor(private readonly say: (item: Owing) => void) {}

  /** Owes one more, and says it. */
  add(what: Owing['what']): void {
    const item = { id: `${this.next++}`, what }
    this.owing.push(item)
    this.say(item)
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
