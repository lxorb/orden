import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { memoryStorage } from '../../../../test/disk'

const asked: string[] = []
let answer: () => Promise<Response> = () => Promise.reject(new Error('offline'))

let newsSince: (typeof import('./news'))['newsSince']

beforeEach(async () => {
  asked.length = 0
  answer = () => Promise.reject(new Error('offline'))
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('fetch', (url: string) => {
    asked.push(url)
    return answer()
  })
  vi.resetModules()
  newsSince = (await import('./news')).newsSince
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const release = (body: unknown) => () =>
  Promise.resolve(new Response(JSON.stringify({ body }), { status: 200 }))

test('a first start shows nothing and remembers the version it ran', async () => {
  expect(await newsSince('1.2.0')).toBeNull()
  expect(asked).toEqual([])
  expect(localStorage.getItem('orden:version-seen')).toBe('1.2.0')
})

test('the first start after an update brings that release’s notes, once', async () => {
  localStorage.setItem('orden:version-seen', '1.1.0')
  answer = release('**12 bugs fixed** since v1.1.0.')

  expect(await newsSince('1.2.0')).toEqual({
    version: '1.2.0',
    notes: '**12 bugs fixed** since v1.1.0.',
  })
  expect(asked).toEqual(['https://api.github.com/repos/lxorb/orden/releases/tags/v1.2.0'])

  expect(await newsSince('1.2.0')).toBeNull()
  expect(asked).toHaveLength(1)
})

test('an unstable build brings nothing and asks nothing', async () => {
  localStorage.setItem('orden:version-seen', '1.1.0')
  expect(await newsSince('1.1.1-512')).toBeNull()
  expect(asked).toEqual([])
  expect(localStorage.getItem('orden:version-seen')).toBe('1.1.1-512')
})

test('offline, the notes are asked for again on the next start', async () => {
  localStorage.setItem('orden:version-seen', '1.1.0')
  expect(await newsSince('1.2.0')).toBeNull()
  expect(localStorage.getItem('orden:version-seen')).toBe('1.1.0')

  answer = release('Faster.')
  expect(await newsSince('1.2.0')).toEqual({ version: '1.2.0', notes: 'Faster.' })
})

test('a release without notes, or a missing one, brings nothing and is not asked for again', async () => {
  localStorage.setItem('orden:version-seen', '1.1.0')
  answer = release(null)
  expect(await newsSince('1.2.0')).toBeNull()
  expect(localStorage.getItem('orden:version-seen')).toBe('1.2.0')

  answer = () => Promise.resolve(new Response('', { status: 404 }))
  expect(await newsSince('1.3.0')).toBeNull()
  expect(localStorage.getItem('orden:version-seen')).toBe('1.3.0')
})
