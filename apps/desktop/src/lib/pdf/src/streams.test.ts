import { describe, expect, test } from 'vitest'
import { streamsIterate } from './streams'

function engineWithout() {
  class Stream {
    cancelled = false
    released = false

    constructor(private readonly parts: unknown[]) {}

    getReader() {
      return {
        read: () =>
          Promise.resolve(
            this.parts.length ? { done: false, value: this.parts.shift() } : { done: true },
          ),
        cancel: () => {
          this.cancelled = true
          return Promise.resolve()
        },
        releaseLock: () => {
          this.released = true
        },
      }
    }
  }
  return { ReadableStream: Stream }
}

describe('a stream read with for await, as pdf.js reads a page’s text', () => {
  test('can be on an engine that never learnt it, as Safari before 26', async () => {
    const scope = engineWithout()
    streamsIterate(scope)
    const stream = new scope.ReadableStream(['one', 'two'])
    const read: unknown[] = []

    for await (const part of stream as unknown as AsyncIterable<unknown>) read.push(part)

    expect(read).toEqual(['one', 'two'])
    expect(stream.released).toBe(true)
    expect(stream.cancelled).toBe(false)
  })

  test('left early, it is let go of', async () => {
    const scope = engineWithout()
    streamsIterate(scope)
    const stream = new scope.ReadableStream(['one', 'two'])

    for await (const part of stream as unknown as AsyncIterable<unknown>) {
      expect(part).toBe('one')
      break
    }

    expect(stream.cancelled).toBe(true)
    expect(stream.released).toBe(true)
  })

  test('an engine that knows it keeps its own', () => {
    const own = async function* () {
      yield await Promise.resolve(null)
    }
    const scope = engineWithout()
    Object.defineProperty(scope.ReadableStream.prototype, Symbol.asyncIterator, { value: own })
    streamsIterate(scope)

    expect(Reflect.get(scope.ReadableStream.prototype, Symbol.asyncIterator)).toBe(own)
  })
})
