import { beforeEach, expect, test, vi } from 'vitest'
import { memoryStorage } from '../../../../test/disk'

vi.stubGlobal('localStorage', memoryStorage())

const { grants, siteOf } = await import('./permissions.svelte')

beforeEach(() => {
  for (const site of ['a.example', 'b.example']) grants.forget(site)
  grants.leftPrivate()
})

test('a grant is about one site and one thing', () => {
  grants.remember('a.example', 'camera', 'allow')

  expect(grants.said('a.example', 'camera')).toBe('allow')
  expect(grants.said('b.example', 'camera')).toBe(null)
  expect(grants.said('a.example', 'microphone')).toBe(null)
})

test('resetting a site forgets everything it was told', () => {
  grants.remember('a.example', 'camera', 'allow')
  grants.remember('a.example', 'location', 'block')

  expect(Object.keys(grants.of('a.example'))).toHaveLength(2)

  grants.forget('a.example')

  expect(grants.of('a.example')).toEqual({})
  expect(grants.said('a.example', 'camera')).toBe(null)
})

test('what is written down survives being read back', () => {
  grants.remember('a.example', 'notifications', 'block')

  const kept = localStorage.getItem('orden:web-grants')
  expect(kept).toContain('a.example')
  expect(kept).toContain('block')
})

test('the site is the host as the bar shows it', () => {
  expect(siteOf('https://www.a.example/page?a=1')).toBe('a.example')
  expect(siteOf(null)).toBe('')
  expect(siteOf('https://xn--mnchen-3ya.de/')).toBe('xn--mnchen-3ya.de')
})

test("a private tab's answer is kept nowhere and never answers a normal tab", () => {
  grants.remember('a.example', 'camera', 'allow', true)

  expect(localStorage.getItem('orden:web-grants') ?? '').not.toContain('a.example')
  expect(grants.of('a.example')).toEqual({})
  expect(grants.said('a.example', 'camera', true)).toBe('allow')
})

test('the private session keeps its answers until the last private tab closes', () => {
  grants.remember('a.example', 'camera', 'allow', true)

  grants.leftPrivate()

  expect(grants.said('a.example', 'camera', true)).toBe(null)
})

test('a private tab carries over what a normal tab blocked, and not what it allowed', () => {
  grants.remember('a.example', 'camera', 'allow')
  grants.remember('a.example', 'location', 'block')

  expect(grants.of('a.example', true)).toEqual({ location: 'block' })
})

test("a private tab's site info changes and resets only the private session", () => {
  grants.remember('a.example', 'camera', 'allow')

  grants.remember('a.example', 'camera', 'block', true)
  expect(grants.said('a.example', 'camera', true)).toBe('block')
  expect(grants.said('a.example', 'camera')).toBe('allow')

  grants.forget('a.example', true)
  expect(grants.said('a.example', 'camera', true)).toBe(null)
  expect(grants.said('a.example', 'camera')).toBe('allow')
})
