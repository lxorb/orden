import { locksHere, locksWork } from './locks'
import { pathKey } from './space-paths'

export interface Said {
  kind: string
  [field: string]: unknown
}

type Hearing = (said: Said) => void

export interface Line {
  postMessage(message: unknown): void
  onmessage: ((event: MessageEvent<unknown>) => void) | null
}

export class Windows {
  readonly me = crypto.randomUUID()
  private readonly hearing = new Map<string, Set<Hearing>>()
  private readonly here = new Set<string>()
  private line: Line | null = null
  private opened = false

  constructor(private readonly open: () => Line | null) {}

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
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => this.post({ kind: 'bye' }))
    }
    return this.line
  }

  get alone(): boolean {
    this.opening()
    return this.here.size === 0
  }

  say(kind: string, what: Record<string, unknown> = {}): void {
    this.post({ ...what, kind })
  }

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

const FILE_TURN_AT_MOST = 3_000

export async function oneWriteAt<T>(path: string, run: () => Promise<T>): Promise<T> {
  const locks = locksHere()
  if (!locks || !(await locksWork(locks))) return run()
  return new Promise<T>((resolve, reject) => {
    let started = false
    const go = () => {
      if (started) return undefined
      started = true
      clearTimeout(timer)
      const running = (async () => run())()
      running.then(resolve, reject)
      return running.then(
        () => undefined,
        () => undefined,
      )
    }
    const timer = setTimeout(() => void go(), FILE_TURN_AT_MOST)
    try {
      locks.request(`nib:file:${pathKey(path)}`, go).catch(go)
    } catch {
      void go()
    }
  })
}
