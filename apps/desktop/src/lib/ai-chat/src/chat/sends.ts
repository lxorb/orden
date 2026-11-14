import { runs } from '../../../parting'
import type { Engine, Thread } from '../../../ai-providers/src/api'

interface Send {
  thread: string
  held: Thread | null
  provider: string
  from: number
  to: number | null
}

const KEPT = 500

const sends: Send[] = []
runs(() => sends.some((send) => send.to === null))

const starting = new Set<(thread: string) => void>()

const ending = new Set<(thread: string) => void>()

export function onSend(listener: (thread: string) => void): () => void {
  starting.add(listener)
  return () => starting.delete(listener)
}

export function onSent(listener: (thread: string) => void): () => void {
  ending.add(listener)
  return () => ending.delete(listener)
}

function began(thread: Thread): () => void {
  const send: Send = {
    thread: thread.id,
    held: thread,
    provider: thread.provider,
    from: Date.now(),
    to: null,
  }
  sends.push(send)
  if (sends.length > KEPT) sends.splice(0, sends.length - KEPT)
  for (const listener of starting) listener(thread.id)
  return () => {
    send.to = Date.now()
    send.held = null
    for (const listener of ending) listener(thread.id)
  }
}

export function answeringAt(provider: string, at: number): string | null {
  for (let index = sends.length - 1; index >= 0; index--) {
    const send = sends[index]
    if (send?.provider === provider && send.from <= at && (send.to === null || at <= send.to))
      return send.thread
  }
  return null
}

export function answering(): Thread[] {
  const threads = sends.flatMap((send) => (send.to === null && send.held ? [send.held] : []))
  return [...new Set(threads)]
}

const watched = new WeakMap<Engine, Engine>()

export function watching(engine: Engine): Engine {
  const held = watched.get(engine)
  if (held) return held
  const made = Object.assign(Object.create(engine) as Engine, {
    async send(...[thread, message, on, signal]: Parameters<Engine['send']>) {
      const ended = began(thread)
      try {
        await engine.send(thread, message, on, signal)
      } finally {
        ended()
      }
    },
  })
  watched.set(engine, made)
  return made
}
