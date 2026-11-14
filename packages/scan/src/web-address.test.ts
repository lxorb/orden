import { describe, expect, test } from 'vitest'
import { webAddress } from './typed'
import { favicon, isWebAddress, keysOf, plainOrigin } from './web-address'

test('the app’s own origins are refused with a trailing dot too', () => {
  for (const url of [
    'http://tauri.localhost./',
    'https://nib.localhost../',
    'http://IPC.localhost./',
  ]) {
    expect(isWebAddress(url), url).toBe(false)
  }
})

describe('what a web tab may open', () => {
  test('takes http and https', () => {
    expect(isWebAddress('https://example.com/a')).toBe(true)
    expect(isWebAddress('http://example.com')).toBe(true)
  })

  test('takes the source of a page it would take', () => {
    expect(isWebAddress('view-source:https://example.com/a')).toBe(true)
    expect(isWebAddress('view-source:file:///C:/notes/Idea.md')).toBe(false)
    expect(isWebAddress('view-source:http://tauri.localhost/')).toBe(false)
    expect(isWebAddress('view-source:view-source:https://example.com/')).toBe(false)
    expect(webAddress('view-source:https://example.com/')).toBe('view-source:https://example.com/')
    expect(plainOrigin('view-source:https://www.example.com/a')).toBe('view-source:example.com')
  })

  test('refuses every other scheme', () => {
    expect(isWebAddress('file:///C:/notes/Idea.md')).toBe(false)
    expect(isWebAddress('javascript:alert(1)')).toBe(false)
    expect(isWebAddress('data:text/html,<p>hi')).toBe(false)
    expect(isWebAddress('mailto:someone@example.com')).toBe(false)
    expect(isWebAddress('orden://open')).toBe(false)
  })

  test('refuses the app itself', () => {
    expect(isWebAddress('http://tauri.localhost/index.html')).toBe(false)
    expect(isWebAddress('https://TAURI.localhost/')).toBe(false)
    expect(isWebAddress('http://ipc.localhost/x')).toBe(false)
    expect(isWebAddress('http://asset.localhost/a.png')).toBe(false)
  })

  test('refuses what is not an address at all', () => {
    expect(isWebAddress('')).toBe(false)
    expect(isWebAddress('example.com')).toBe(false)
  })
})

describe('the origin, plainly', () => {
  test('is the host', () => {
    expect(plainOrigin('https://svelte.dev/docs/introduction')).toBe('svelte.dev')
    expect(plainOrigin('orden://history')).toBe('orden://history')
    expect(plainOrigin('nib://history')).toBe('nib://history')
    expect(plainOrigin('https://docs.example.org:8443/a')).toBe('docs.example.org:8443')
  })

  test('drops www, the way every browser does', () => {
    expect(plainOrigin('https://www.bbc.co.uk/news')).toBe('bbc.co.uk')
  })

  test('says so when the page is not over https', () => {
    expect(plainOrigin('http://example.com/a')).toBe('http://example.com')
  })

  test('answers with what it was given when that is not an address', () => {
    expect(plainOrigin('not an address')).toBe('not an address')
  })
})

test("a site's own picture is looked for at its root, and an address with no root has none", () => {
  expect(favicon('https://pass.proton.me/onboarding?x=1')).toBe(
    'https://pass.proton.me/favicon.ico',
  )
  expect(favicon('pass.proton.me/onboarding')).toBeNull()
  expect(favicon('about:blank')).toBeNull()
})

describe('what a page is kept under', () => {
  test('its origin and path, a query or a fragment being the same page', () => {
    expect(keysOf('https://svelte.dev/docs?x=1#intro')).toEqual([
      'https://svelte.dev/docs',
      'https://svelte.dev',
    ])
    expect(keysOf('https://svelte.dev')).toEqual(['https://svelte.dev/', 'https://svelte.dev'])
  })

  test('and nothing that is not a web page', () => {
    for (const url of [null, undefined, '', 'about:blank', 'file:///C:/a.html', 'nonsense']) {
      expect(keysOf(url), String(url)).toBeNull()
    }
  })
})
