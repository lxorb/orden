import {
  asking,
  type Engine,
  type EngineEvents,
  type Held,
  type HeldAnswer,
  type HeldNotes,
} from '../src/asking.svelte'
import type { Answers, LogRow, Query, SpaceRow } from '../src/store'

class FakeHeld implements HeldNotes {
  notes = $state<Held[]>([])
  answered: [string, HeldAnswer][] = []
  failing: Error | null = null

  answer(id: string, answer: HeldAnswer): Promise<string | undefined> {
    this.answered.push([id, answer])
    const failing = this.failing
    this.failing = null
    if (failing) return Promise.reject(failing)

    const note = this.notes.find((one) => one.id === id)
    this.notes = this.notes.filter((one) => one.id !== id)
    if (answer !== 'both' || !note) return Promise.resolve(undefined)

    return Promise.resolve(note.path.replace(/(\.[^.\\/]+)?$/, ` (${note.mine.device})$1`))
  }
}

type Listeners = { [T in keyof EngineEvents]: ((event: EngineEvents[T]) => void)[] }

class FakeEngine implements Engine {
  readonly held = new FakeHeld()
  log: LogRow[] = []
  spaces: SpaceRow[] = []

  private readonly listeners: Listeners = {
    resurrected: [],
    pass: [],
    unsynced: [],
    file: [],
    placed: [],
  }

  readonly store = {
    read: <const Q extends readonly Query[]>(queries: Q): Promise<Answers<Q>> =>
      Promise.resolve(
        queries.map((query) => {
          if (query.t === 'get') return null
          if (query.table === 'log') return this.log
          return query.table === 'spaces' ? this.spaces : []
        }) as Answers<Q>,
      ),
  }

  on<T extends keyof EngineEvents>(
    type: T,
    listener: (event: EngineEvents[T]) => void,
  ): () => void {
    const listening: ((event: EngineEvents[T]) => void)[] = this.listeners[type]
    listening.push(listener)
    return () => {
      const at = listening.indexOf(listener)
      if (at >= 0) listening.splice(at, 1)
    }
  }

  emit<T extends keyof EngineEvents>(type: T, event: EngineEvents[T]) {
    if (type === 'pass') this.log = [...this.log, event as LogRow]
    const listening: ((event: EngineEvents[T]) => void)[] = this.listeners[type]
    for (const listener of [...listening]) listener(event)
  }
}

export function connectFake(notes: Held[] = []): { engine: FakeEngine; stop: () => void } {
  const engine = new FakeEngine()
  engine.held.notes = notes
  return { engine, stop: asking.connect(engine) }
}
