import { beforeEach, expect, test, vi } from 'vitest'

const seen = { most: 0, now: 0, sent: [] as number[] }
let able = true
let broken = false

class Away {
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  postMessage(said: { id: number; file: Blob }) {
    structuredClone(said)
    seen.sent.push(said.id)
    seen.now++
    seen.most = Math.max(seen.most, seen.now)
    setTimeout(() => {
      seen.now--
      if (broken) this.onerror?.()
      else
        this.onmessage?.({
          data: able
            ? { id: said.id, dataUrl: `data:image/png;base64,${String(said.id)}` }
            : { id: said.id, unable: true },
        } as MessageEvent)
    }, 5)
  }
  terminate() {
    return undefined
  }
}

vi.stubGlobal('Worker', Away)

beforeEach(() => {
  vi.resetModules()
  seen.most = 0
  seen.now = 0
  seen.sent = []
  able = true
  broken = false
})

test('pictures are drawn off the window’s thread, one at a time however many come', async () => {
  const { pictureOf } = await import('./pictures-away')
  const pictures = await Promise.all(
    Array.from({ length: 12 }, () => pictureOf(new Blob(['x'], { type: 'image/png' }))),
  )
  expect(seen.sent).toHaveLength(12)
  expect(seen.most).toBe(1)
  expect(pictures.map((one) => one?.dataUrl)).toEqual(
    seen.sent.map((id) => `data:image/png;base64,${String(id)}`),
  )
  expect(new Set(pictures.map((one) => one?.id)).size).toBe(12)
})

test('a worker that cannot draw is asked once, and the page draws from then on', async () => {
  able = false
  const { pictureOf } = await import('./pictures-away')
  expect(await pictureOf(new Blob(['x'], { type: 'image/png' }))).toBeNull()
  expect(await pictureOf(new Blob(['y'], { type: 'image/png' }))).toBeNull()
  expect(seen.sent).toHaveLength(1)
})

test('a worker that stops leaves what it held to the page, and the next comes in turn', async () => {
  broken = true
  const { pictureOf } = await import('./pictures-away')
  const both = await Promise.all([
    pictureOf(new Blob(['x'], { type: 'image/png' })),
    pictureOf(new Blob(['y'], { type: 'image/png' })),
  ])
  expect(both).toEqual([null, null])
  expect(seen.sent).toHaveLength(1)
})

test('a drawing given is used as it is, in the same turn', async () => {
  const { pictureOf } = await import('./pictures-away')
  const picture = await pictureOf(new Blob(['x'], { type: 'image/png' }), {
    open: () => Promise.resolve({ width: 10, height: 10 }),
    write: (_width, _height, type) => Promise.resolve(new Blob(['ab'], { type })),
    close: () => undefined,
  })
  expect(picture?.dataUrl).toBe(`data:image/png;base64,${btoa('ab')}`)
  expect(seen.sent).toEqual([])
})
