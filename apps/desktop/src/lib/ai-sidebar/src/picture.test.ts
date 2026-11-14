import { expect, test } from 'vitest'
import type { Drawing } from '../../feedback-pictures'
import { chatPicture } from './picture'

function drawing(size: { width: number; height: number } | null, asked: string[] = []): Drawing {
  return {
    open: () => (size ? Promise.resolve(size) : Promise.reject(new Error('not a picture'))),
    write: (width, height, type) => {
      asked.push(`${String(width)}x${String(height)} ${type}`)
      return Promise.resolve(new Blob([new Uint8Array(4_000)], { type }))
    },
    close: () => undefined,
  }
}

test('a large photograph goes to the model drawn smaller, as the picture type it says', async () => {
  const asked: string[] = []
  const picture = await chatPicture(
    new Blob([new Uint8Array(30_000_000)], { type: 'image/jpeg' }),
    drawing({ width: 6000, height: 4000 }, asked),
  )
  expect(asked).toEqual(['2400x1600 image/jpeg'])
  expect(picture?.mime).toBe('image/jpeg')
  expect(atob(picture?.data ?? '').length).toBe(4_000)
})

test('a picture of a kind no model reads goes as a PNG', async () => {
  const picture = await chatPicture(
    new Blob(['<svg/>'], { type: 'image/svg+xml' }),
    drawing({ width: 64, height: 64 }),
  )
  expect(picture?.mime).toBe('image/png')
})

test('what cannot be drawn is not sent at all', async () => {
  expect(await chatPicture(new Blob(['x'], { type: 'image/tiff' }), drawing(null))).toBeNull()
})
