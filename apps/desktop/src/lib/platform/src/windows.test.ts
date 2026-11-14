// @vitest-environment jsdom
import { expect, test, vi } from 'vitest'
import { type Line, type Said, Windows } from './windows'

interface Asking {
  name: string
  client: number
  grant: () => void
}

class Locks {
  private readonly held = new Map<string, number>()
  private readonly waiting: Asking[] = []

  as(client: number): LockManager {
    const request = (name: string, ...rest: unknown[]) => {
      const run = rest.at(-1) as (lock: { name: string } | null) => unknown
      const options = (rest.length > 1 ? rest[0] : {}) as LockOptions
      if (options.ifAvailable && this.held.has(name)) return Promise.resolve(run(null))
      return new Promise((resolve, reject) => {
        this.waiting.push({
          name,
          client,
          grant: () => {
            this.held.set(name, client)
            Promise.resolve(run({ name }))
              .then(resolve, reject)
              .finally(() => {
                if (this.held.get(name) !== client) return
                this.held.delete(name)
                this.next()
              })
          },
        })
        this.next()
      })
    }
    const query = () =>
      Promise.resolve({
        held: [...this.held.keys()].map((name) => ({ name })),
        pending: this.waiting.map(({ name }) => ({ name })),
      })
    return { request, query } as LockManager
  }

  gone(client: number) {
    for (const [name, holder] of [...this.held]) if (holder === client) this.held.delete(name)
    this.waiting.splice(
      0,
      this.waiting.length,
      ...this.waiting.filter((one) => one.client !== client),
    )
    this.next()
  }

  private next() {
    for (const one of [...this.waiting]) {
      if (this.held.has(one.name)) continue
      this.waiting.splice(this.waiting.indexOf(one), 1)
      one.grant()
    }
  }
}

function hub() {
  const lines = new Set<Line>()
  const line = (): Line => {
    const one: Line = {
      onmessage: null,
      postMessage: (message) => {
        if (!lines.has(one)) return
        for (const other of lines)
          if (other !== one) queueMicrotask(() => other.onmessage?.({ data: message } as never))
      },
    }
    lines.add(one)
    return one
  }
  return { line, cut: (one: Line) => lines.delete(one) }
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 10))

test('a window that dies without a word is let go, as if it had said goodbye', async () => {
  const locks = new Locks()
  const { line, cut } = hub()
  const opened: Line[] = []
  const dying = new Windows(
    () => {
      const one = line()
      opened.push(one)
      return one
    },
    () => locks.as(1),
  )
  const staying = new Windows(line, () => locks.as(2))
  const byes: Said[] = []
  staying.hear('bye', (said) => byes.push(said))
  expect(dying.alone).toBe(true)
  expect(staying.alone).toBe(true)
  await settled()
  expect(staying.alone).toBe(false)
  expect(dying.alone).toBe(false)

  for (const one of opened) cut(one)
  locks.gone(1)

  await vi.waitFor(() => expect(staying.alone).toBe(true))
  expect(byes.map((said) => said.from)).toEqual([dying.me])
})

test('a window still there is kept, however long it says nothing', async () => {
  const locks = new Locks()
  const { line } = hub()
  const one = new Windows(line, () => locks.as(1))
  const other = new Windows(line, () => locks.as(2))
  expect(one.alone && other.alone).toBe(true)
  await settled()
  await settled()

  expect(one.alone).toBe(false)
  expect(other.alone).toBe(false)
})

test('a window back from the page cache says hello again to those that let it go', async () => {
  const { line } = hub()
  const back = new Windows(line, () => undefined)
  const other = new Windows(line, () => undefined)
  expect(back.alone && other.alone).toBe(true)
  await settled()

  window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: true }))
  await settled()
  expect(other.alone).toBe(true)

  window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }))
  await settled()
  expect(other.alone).toBe(false)
})

test('an engine whose locks cannot be asked who waits keeps its windows and throws nothing', async () => {
  const locks = new Locks()
  const { line } = hub()
  const without = (client: number) => {
    const manager: Partial<LockManager> = locks.as(client)
    delete manager.query
    return manager as LockManager
  }
  const thrown: unknown[] = []
  const heard = (event: PromiseRejectionEvent) => thrown.push(event.reason)
  window.addEventListener('unhandledrejection', heard)
  process.on('unhandledRejection', heard)
  try {
    const one = new Windows(line, () => without(1))
    const other = new Windows(line, () => without(2))
    expect(one.alone && other.alone).toBe(true)
    await settled()
    await settled()
    expect(one.alone).toBe(false)
    expect(other.alone).toBe(false)
    expect(thrown).toEqual([])
  } finally {
    window.removeEventListener('unhandledrejection', heard)
    process.off('unhandledRejection', heard)
  }
})
