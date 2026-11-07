import { afterEach, expect, test, vi } from 'vitest'

const sent: unknown[] = []

class Away {
  static failing = false
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  postMessage(said: { id: number; picture: { width: number } }, moved: unknown[]) {
    sent.push({ id: said.id, moved: moved.length })
    queueMicrotask(() => {
      if (Away.failing) this.onerror?.()
      else
        this.onmessage?.({
          data: { id: said.id, png: `data:image/png;base64,${said.picture.width}` },
        } as MessageEvent)
    })
  }
  terminate() {
    sent.push('ended')
  }
}

vi.stubGlobal('Worker', Away)
vi.stubGlobal('OffscreenCanvas', Object)
vi.stubGlobal('createImageBitmap', (canvas: { width: number }) =>
  Promise.resolve({ width: canvas.width }),
)

const { pngData } = await import('./png-off')

function canvas(width: number) {
  return {
    width,
    toBlob: (done: (png: Blob) => void) =>
      done(new Blob([new Uint8Array([1, 2])], { type: 'image/png' })),
  } as unknown as HTMLCanvasElement
}

afterEach(() => {
  sent.length = 0
})

test('the picture is handed to the worker and its PNG comes back', async () => {
  expect(await pngData(canvas(7))).toBe('data:image/png;base64,7')
  expect(sent).toEqual([{ id: 1, moved: 1 }])
})

test('a worker that fails leaves the picture to be encoded here, and later ones too', async () => {
  Away.failing = true
  expect(await pngData(canvas(3))).toBe('data:image/png;base64,AQI=')
  expect(sent).toEqual([{ id: 2, moved: 1 }, 'ended'])
  expect(await pngData(canvas(4))).toBe('data:image/png;base64,AQI=')
  expect(sent).toHaveLength(2)
})
