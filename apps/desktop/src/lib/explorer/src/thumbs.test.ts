import { afterEach, expect, test, vi } from 'vitest'
import type { Peek } from './commands'
import { Thumbs } from './thumbs'

const revoked: string[] = []
vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url: string) => {
  revoked.push(url)
})

afterEach(() => {
  revoked.length = 0
})

function held() {
  const asked: string[] = []
  const waiting = new Map<string, () => void>()
  const read = (path: string): Promise<Peek> => {
    asked.push(path)
    return new Promise((done) =>
      waiting.set(path, () => done({ bytes: new Uint8Array([1]), cut: false })),
    )
  }
  const thumbs = new Thumbs(read, (name) => Promise.resolve(`small:${name}`))
  const answer = async (path: string) => {
    waiting.get(path)?.()
    waiting.delete(path)
    for (let turn = 0; turn < 10; turn++) await Promise.resolve()
  }
  return { thumbs, asked, answer }
}

const pictures = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, at) => ({
    path: `/f/${from + at}.jpg`,
    name: `${from + at}.jpg`,
  }))

test('a few pictures are read at once, however many tiles are drawn', async () => {
  const { thumbs, asked, answer } = held()
  thumbs.want('/f', pictures(0, 100))
  expect(asked).toHaveLength(4)
  await answer('/f/0.jpg')
  expect(asked).toHaveLength(5)
  expect(thumbs.shown.get('/f/0.jpg')).toBe('small:0.jpg')
})

test('tiles scrolled away before their turn are not read', async () => {
  const { thumbs, asked, answer } = held()
  thumbs.want('/f', pictures(0, 100))
  thumbs.want('/f', pictures(500, 510))
  for (const one of asked) await answer(one)
  expect(asked).toEqual([...pictures(0, 4), ...pictures(500, 510)].map((one) => one.path))
})

test('another folder lets go of every picture of the last, and of those still coming', async () => {
  const { thumbs, answer } = held()
  thumbs.want('/f', pictures(0, 2))
  await answer('/f/0.jpg')
  thumbs.want('/g', [])
  expect(revoked).toEqual(['small:0.jpg'])
  await answer('/f/1.jpg')
  expect(revoked).toEqual(['small:0.jpg', 'small:1.jpg'])
  expect(thumbs.shown.size).toBe(0)
})

test('only so many small pictures are kept, never those still drawn', async () => {
  const { thumbs, asked, answer } = held()
  for (let from = 0; from < 1000; from += 50) {
    thumbs.want('/f', pictures(from, from + 50))
    while (asked.length > 0) {
      const one = asked.shift()
      if (one) await answer(one)
    }
  }
  expect(thumbs.shown.size).toBeLessThanOrEqual(400)
  for (const one of pictures(950, 1000)) expect(thumbs.shown.has(one.path)).toBe(true)
})

test('a picture changed on disk is drawn again, its old small picture let go once the new one is in', async () => {
  const asked: string[] = []
  let made = 0
  const thumbs = new Thumbs(
    (path) => {
      asked.push(path)
      return Promise.resolve({ bytes: new Uint8Array([1]), cut: false })
    },
    () => Promise.resolve(`small:${++made}`),
  )
  const settle = async () => {
    for (let turn = 0; turn < 10; turn++) await Promise.resolve()
  }
  const one = (stamp: string) => [{ path: '/f/a.jpg', name: 'a.jpg', stamp }]

  thumbs.want('/f', one('1:1'))
  await settle()
  thumbs.want('/f', one('1:1'))
  await settle()
  expect(asked).toHaveLength(1)
  expect(thumbs.shown.get('/f/a.jpg')).toBe('small:1')

  thumbs.want('/f', one('2:5'))
  expect(thumbs.shown.get('/f/a.jpg')).toBe('small:1')
  await settle()
  expect(asked).toHaveLength(2)
  expect(thumbs.shown.get('/f/a.jpg')).toBe('small:2')
  expect(revoked).toEqual(['small:1'])
})
