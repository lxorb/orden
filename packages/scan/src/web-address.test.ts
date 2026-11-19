import { describe, expect, test } from 'vitest'
import { webAddress } from './typed'
import { droppedAddress, favicon, isWebAddress, keysOf, plainOrigin } from './web-address'

test('the app’s own origins are refused with a trailing dot too', () => {
  for (const url of ['http://tauri.localhost./', 'https://orden.localhost../', 'http://IPC.localhost./']) {
    expect(isWebAddress(url), url).toBe(false)
  }
})
describe('what a web tab may open', () => {
  test('takes the source of a page it would take', () => {
    expect(isWebAddress('view-source:https://example.com/a')).toBe(true)
    expect(isWebAddress('view-source:file:///C:/notes/Idea.md')).toBe(false)
    expect(isWebAddress('view-source:http://tauri.localhost/')).toBe(false)
    expect(isWebAddress('view-source:view-source:https://example.com/')).toBe(false)
    expect(webAddress('view-source:https://example.com/')).toBe('view-source:https://example.com/')
    expect(plainOrigin('view-source:https://www.example.com/a')).toBe('view-source:example.com')
  })
})
test("a site's own picture is looked for at its root, and an address with no root has none", () => {
  expect(favicon('https://pass.proton.me/onboarding?x=1')).toBe('https://pass.proton.me/favicon.ico')
  expect(favicon('pass.proton.me/onboarding')).toBeNull()
  expect(favicon('about:blank')).toBeNull()
})
describe('what a page is kept under', () => {
  test('its origin and path, a query or a fragment being the same page', () => {
    expect(keysOf('https://svelte.dev/docs?x=1#intro')).toEqual(['https://svelte.dev/docs', 'https://svelte.dev'])
    expect(keysOf('https://svelte.dev')).toEqual(['https://svelte.dev/', 'https://svelte.dev'])
  })
  test('and nothing that is not a web page', () => {
    for (const url of [null, undefined, '', 'about:blank', 'file:///C:/a.html', 'nonsense']) {
      expect(keysOf(url), String(url)).toBeNull()
    }
  })
})
describe('a link dragged onto the strip from another app', () => {
  const drop = (data: Record<string, string>) => (type: string) => data[type] ?? ''
  test('opens the first address the list holds, past its comments', () => {
    const read = drop({ 'text/uri-list': '# from a page\r\nhttps://svelte.dev/docs\r\n' })
    expect(droppedAddress(read)).toBe('https://svelte.dev/docs')
  })
  test('opens an address written as plain text', () => {
    expect(droppedAddress(drop({ 'text/plain': '  https://example.com/a  ' }))).toBe('https://example.com/a')
  })
  test('opens nothing that is not a page on the web', () => {
    expect(droppedAddress(drop({ 'text/plain': 'a sentence out of a note' }))).toBeNull()
    expect(droppedAddress(drop({ 'text/uri-list': 'file:///C:/notes/a.md' }))).toBeNull()
    expect(droppedAddress(drop({ 'text/plain': 'javascript:alert(1)' }))).toBeNull()
  })
})
test.each<[unknown, ...Parameters<typeof isWebAddress>]>([
  [true, 'https://example.com/a'],
  [true, 'http://example.com'],
  [false, 'file:///C:/notes/Idea.md'],
  [false, 'javascript:alert(1)'],
  [false, 'data:text/html,<p>hi'],
  [false, 'mailto:someone@example.com'],
  [false, 'orden://open'],
  [false, 'http://tauri.localhost/index.html'],
  [false, 'https://TAURI.localhost/'],
  [false, 'http://ipc.localhost/x'],
  [false, 'http://asset.localhost/a.png'],
  [false, ''],
  [false, 'example.com'],
])('%j from %j', (expected, ...args) => {
  expect(isWebAddress(...args)).toBe(expected)
})
test.each<[unknown, ...Parameters<typeof plainOrigin>]>([
  ['svelte.dev', 'https://svelte.dev/docs/introduction'],
  ['orden://history', 'orden://history'],
  ['nib://history', 'nib://history'],
  ['docs.example.org:8443', 'https://docs.example.org:8443/a'],
  ['bbc.co.uk', 'https://www.bbc.co.uk/news'],
  ['http://example.com', 'http://example.com/a'],
  ['not an address', 'not an address'],
])('%j from %j', (expected, ...args) => {
  expect(plainOrigin(...args)).toBe(expected)
})
