/** The other windows of this app, and the one way to speak to them.
 *
 *  Windows of one device share a store, a disk and an origin, and nothing else: each runs
 *  its own page. So what one does that another must hear goes on this channel: what an
 *  autosave wrote, a file moved, an answer still on its way, what the sync engine's
 *  window has to be told (workspace/across.svelte.ts, sync2/runner.svelte.ts,
 *  ai/chat/threads.ts). One channel, because a broadcast keeps one sender's order only
 *  within one: a file moved and then written has to arrive in that order.
 *
 *  Who is here is what `hello`, `here` and `bye` say. A window that crashed never says
 *  `bye`, and all that costs is a write that looks at the disk first. */

/** One thing said. `kind` says what; the rest is that kind's. */
export interface Said {
  kind: string
  [field: string]: unknown
}

type Hearing = (said: Said) => void

/** What the bus needs of a channel, which a test gives it two ends of. */
export interface Line {
  postMessage(message: unknown): void
  onmessage: ((event: MessageEvent<unknown>) => void) | null
}

export class Windows {
  /** This window, for the length of this page. */
  readonly me = crypto.randomUUID()
  private readonly hearing = new Map<string, Set<Hearing>>()
  private readonly here = new Set<string>()
  private line: Line | null

  constructor(line: Line | null) {
    this.line = line
    if (!line) return
    line.onmessage = (event) => this.heard(event.data)
    this.post({ kind: 'hello' })
  }

  /** Whether any other window of this app is open, as far as anyone has said. */
  get alone(): boolean {
    return this.here.size === 0
  }

  /** Says something to every other window. */
  say(kind: string, what: Record<string, unknown> = {}): void {
    this.post({ ...what, kind })
  }

  /** Hears one kind of thing from now on. Answers the way to stop. */
  hear(kind: string, listener: (said: Said) => void): () => void {
    const listeners = this.hearing.get(kind) ?? new Set<Hearing>()
    this.hearing.set(kind, listeners)
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  /** This window is going. */
  leaving(): void {
    this.post({ kind: 'bye' })
  }

  private post(message: Said): void {
    this.line?.postMessage({ ...message, from: this.me })
  }

  private heard(data: unknown): void {
    if (typeof data !== 'object' || data === null) return
    const said = data as Said & { from?: unknown }
    if (typeof said.kind !== 'string' || typeof said.from !== 'string') return
    if (said.from === this.me) return
    if (said.kind === 'bye') this.here.delete(said.from)
    else this.here.add(said.from)
    if (said.kind === 'hello') this.post({ kind: 'here' })
    for (const listener of [...(this.hearing.get(said.kind) ?? [])]) listener(said)
  }
}

function opened(): Line | null {
  return typeof BroadcastChannel === 'function' ? new BroadcastChannel('nib:windows') : null
}

export const windows = new Windows(opened())

if (typeof window !== 'undefined') {
  // A page can come back from this, a close called off or the back and forward cache:
  // the next thing it says is heard as a window being here.
  window.addEventListener('pagehide', () => windows.leaving())
}

/** One write of a file at a time across the windows, with whatever it read first: what
 *  makes the history of a file one line, so a write always knows what it replaces.
 *  Somewhere with no locks, none of that: as it has always been. */
export function oneWriteAt<T>(path: string, run: () => Promise<T>): Promise<T> {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks
  return locks ? (locks.request(`nib:file:${path}`, run) as Promise<T>) : run()
}
