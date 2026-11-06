import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ANSWERS_WITHIN, LATE, fetchInTime } from './api'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function hanging(after: 'headers' | 'body') {
  vi.stubGlobal('fetch', (_request: Request, init: RequestInit) => {
    const signal = init.signal
    if (after === 'headers') {
      return new Promise((_done, refuse) => {
        signal?.addEventListener('abort', () => refuse(new DOMException('aborted', 'AbortError')))
      })
    }
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"half":'))
        signal?.addEventListener('abort', () =>
          controller.error(new DOMException('aborted', 'AbortError')),
        )
      },
    })
    return Promise.resolve(new Response(body, { status: 200 }))
  })
}

describe('a request to the account', () => {
  test.each(['headers', 'body'] as const)(
    'that never finishes its %s is given up, as a network that is not there',
    async (after) => {
      hanging(after)
      const asked = fetchInTime('https://orden.so/v2/spaces')
      const failed = expect(asked).rejects.toThrow(new TypeError(LATE))
      await vi.advanceTimersByTimeAsync(ANSWERS_WITHIN + 1)
      await failed
    },
  )

  test('that answers is read whole, status and headers too', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve(
        new Response('{"ok":true}', { status: 201, headers: { 'x-nib-cursor': '7' } }),
      ),
    )
    const response = await fetchInTime(new Request('https://orden.so/v2/spaces'))
    expect(response.status).toBe(201)
    expect(response.headers.get('x-nib-cursor')).toBe('7')
    expect(await response.json()).toEqual({ ok: true })
  })

  test('that answers with no body keeps none', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response(null, { status: 204 })))
    const response = await fetchInTime(new Request('https://orden.so/v2/spaces'))
    expect(response.status).toBe(204)
  })
})
