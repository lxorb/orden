import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { memoryStorage } from '../../../../test/disk'

const SHIPPED = [
  { version: '1.0.0', bugs: 5, added: ['A start'] },
  { version: '1.1.0', bugs: 12, added: ['Tabs', 'Links'] },
  { version: '1.1.1', bugs: 2, added: [] },
  { version: '1.2.0', bugs: 7, added: ['Search'] },
]
let news: typeof import('./news')
const fetched: string[] = []
beforeEach(async () => {
  fetched.length = 0
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('fetch', (url: string) => {
    fetched.push(url)
    return Promise.reject(new Error('offline'))
  })
  vi.resetModules()
  news = await import('./news')
})
afterEach(() => {
  vi.unstubAllGlobals()
})
describe('what came while the reader was away', () => {
  test('adds up every release after the one last run, newest first', () => {
    expect(news.newsOf(SHIPPED, '1.0.0', '1.2.0')).toEqual({
      version: '1.2.0',
      since: '1.0.0',
      bugs: 21,
      added: ['Search', 'Tabs', 'Links'],
      updates: 3,
    })
  })
  test('is one release after one update', () => {
    expect(news.newsOf(SHIPPED, '1.1.1', '1.2.0')).toEqual({
      version: '1.2.0',
      since: '1.1.1',
      bugs: 7,
      added: ['Search'],
      updates: 1,
    })
  })
  test('leaves out releases newer than the one running', () => {
    expect(news.newsOf(SHIPPED, '1.0.0', '1.1.0')?.bugs).toBe(12)
  })
  test('counts the release an unstable build led up to', () => {
    expect(news.newsOf(SHIPPED, '1.1.1-512', '1.2.0')?.updates).toBe(2)
  })
  test('is nothing when the build knows no release in between', () => {
    expect(news.newsOf([], '1.0.0', '1.2.0')).toBeNull()
    expect(news.newsOf(SHIPPED, '1.2.0', '1.2.0')).toBeNull()
  })
})
describe('the face', () => {
  test('is never the one shown last time', () => {
    for (const roll of [0, 0.3, 0.6, 0.999]) {
      const first = news.faceAfter(null, () => roll)
      expect(news.faceAfter(first, () => roll)).not.toBe(first)
    }
  })
})
describe('the first start after an update', () => {
  test('a first start shows nothing and remembers the version it ran', () => {
    expect(news.newsSince('1.2.0', SHIPPED)).toBeNull()
    expect(localStorage.getItem('orden:version-seen')).toBe('1.2.0')
  })
  test('brings what came since the version last run, once', () => {
    localStorage.setItem('orden:version-seen', '1.1.0')
    expect(news.newsSince('1.2.0', SHIPPED)?.bugs).toBe(9)
    expect(news.newsSince('1.2.0', SHIPPED)).toBeNull()
  })
  test('an unstable build brings nothing', () => {
    localStorage.setItem('orden:version-seen', '1.1.0')
    expect(news.newsSince('1.1.1-512', SHIPPED)).toBeNull()
    expect(localStorage.getItem('orden:version-seen')).toBe('1.1.1-512')
  })
  test('asks nothing of the network: what shipped comes with the build', () => {
    localStorage.setItem('orden:version-seen', '1.0.0')
    expect(news.newsSince('1.2.0', SHIPPED)?.updates).toBe(3)
    expect(fetched).toEqual([])
  })
})
