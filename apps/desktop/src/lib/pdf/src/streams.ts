interface Readable {
  getReader(): {
    read(): Promise<{ done: boolean; value?: unknown }>
    cancel(reason?: unknown): Promise<void>
    releaseLock(): void
  }
}

async function* values(this: Readable): AsyncGenerator<unknown, void, undefined> {
  const reader = this.getReader()
  let done = false
  try {
    for (;;) {
      const step = await reader.read()
      if (step.done) {
        done = true
        return
      }
      yield step.value
    }
  } finally {
    if (!done) await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

export function streamsIterate(scope: object = globalThis): void {
  const stream: unknown = Reflect.get(scope, 'ReadableStream')
  if (typeof stream !== 'function') return
  const shape: unknown = Reflect.get(stream, 'prototype')
  if (typeof shape !== 'object' || shape === null) return
  if (typeof Reflect.get(shape, Symbol.asyncIterator) === 'function') return

  Object.defineProperty(shape, Symbol.asyncIterator, {
    configurable: true,
    writable: true,
    value: values,
  })
  if (typeof Reflect.get(shape, 'values') !== 'function') {
    Object.defineProperty(shape, 'values', { configurable: true, writable: true, value: values })
  }
}
