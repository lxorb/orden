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

import { locksHere } from './locks'

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
  private line: Line | null = null
  private opened = false

  /** `open` runs at the first use: a page that never asks after another window (a package
   *  with no second window, say) carries none of this. */
  constructor(private readonly open: () => Line | null) {}

  /** The channel, once it is asked for. */
  private opening(): Line | null {
    if (this.opened) return this.line
    this.opened = true
    try {
      this.line = this.open()
    } catch {
      this.line = null
    }
    if (!this.line) return null
    this.line.onmessage = (event) => this.heard(event.data)
    this.post({ kind: 'hello' })
    // A page can come back from this, a close called off or the back and forward cache:
    // the next thing it says is heard as a window being here.
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => this.post({ kind: 'bye' }))
    }
    return this.line
  }

  /** Whether any other window of this app is open, as far as anyone has said. */
  get alone(): boolean {
    this.opening()
    return this.here.size === 0
  }

  /** Says something to every other window. */
  say(kind: string, what: Record<string, unknown> = {}): void {
    this.post({ ...what, kind })
  }

  /** Hears one kind of thing from now on. Answers the way to stop. */
  hear(kind: string, listener: (said: Said) => void): () => void {
    this.opening()
    const listeners = this.hearing.get(kind) ?? new Set<Hearing>()
    this.hearing.set(kind, listeners)
    listeners.add(listener)
    return () => listeners.delete(listener)
  }

  private post(message: Said): void {
    try {
      this.opening()?.postMessage({ ...message, from: this.me })
    } catch {
      // A channel gone with the page says nothing, and a window alone has nobody to tell.
    }
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

export const windows = /* @__PURE__ */ new Windows(() =>
  typeof BroadcastChannel === 'function' ? new BroadcastChannel('nib:windows') : null,
)

/** How long a file's turn is waited for: a write on a share that has stalled holds it, and
 *  a window must not stop writing for that, or for locks that never answer. */
const FILE_TURN_AT_MOST = 3_000

/** One write of a file at a time across the windows, with whatever it read first: what
 *  makes the history of a file one line, so a write always knows what it replaces.
 *  `run` runs once whatever the locks do: with them where they work, and where they are
 *  missing, refuse or do not answer, without them, as it has always been. */
export function oneWriteAt<T>(path: string, run: () => Promise<T>): Promise<T> {
  const locks = locksHere()
  if (!locks) return run()
  return new Promise<T>((resolve, reject) => {
    let started = false
    const go = () => {
      if (started) return undefined
      started = true
      clearTimeout(timer)
      const running = run()
      running.then(resolve, reject)
      return running.then(
        () => undefined,
        () => undefined,
      )
    }
    const timer = setTimeout(go, FILE_TURN_AT_MOST)
    try {
      locks.request(`nib:file:${path}`, go).catch(go)
    } catch {
      void go()
    }
  })
}
