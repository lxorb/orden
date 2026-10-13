import { describe, expect, test } from 'vitest'
import { dotCom, favicon, isWebAddress, plainOrigin, webAddress } from './address'

/** Ctrl+Enter in the address field, which every browser has had for thirty years. */
describe('the dot-com press', () => {
  test('makes one word a site', () => {
    expect(dotCom('svelte')).toBe('https://www.svelte.com')
    expect(dotCom('  example  ')).toBe('https://www.example.com')
  })

  test('leaves anything that already reads as an address to the ordinary press', () => {
    expect(dotCom('svelte.dev')).toBe(null)
    expect(dotCom('https://svelte.dev')).toBe(null)
    expect(dotCom('localhost:1425')).toBe(null)
    expect(dotCom('svelte docs')).toBe(null)
    expect(dotCom('a/b')).toBe(null)
    expect(dotCom('')).toBe(null)
  })
})

describe('what a web tab may open', () => {
  test('takes http and https', () => {
    expect(isWebAddress('https://example.com/a')).toBe(true)
    expect(isWebAddress('http://example.com')).toBe(true)
  })

  /** Chrome's "View page source", which the page's own menu asks for as a window. */
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
    expect(isWebAddress('nib://open')).toBe(false)
  })

  /** A tab holding nib inside nib is a page whose script sits beside the app's. The
   *  crate says the same thing again on every navigation; see web_tabs.rs. */
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

describe('what somebody typed', () => {
  test('nothing means nothing', () => {
    expect(webAddress('')).toBeNull()
    expect(webAddress('   ')).toBeNull()
  })

  test('an address is taken as written', () => {
    expect(webAddress('https://svelte.dev/docs')).toBe('https://svelte.dev/docs')
    expect(webAddress('http://localhost:5173/')).toBe('http://localhost:5173/')
  })

  test('a scheme no tab opens means nothing rather than a search', () => {
    expect(webAddress('javascript:alert(1)')).toBeNull()
    expect(webAddress('file:///etc/passwd')).toBeNull()
  })

  test('a host is given https', () => {
    expect(webAddress('svelte.dev')).toBe('https://svelte.dev')
    expect(webAddress('svelte.dev/docs?a=1#b')).toBe('https://svelte.dev/docs?a=1#b')
    expect(webAddress('//svelte.dev')).toBe('https://svelte.dev')
    expect(webAddress('example.com:443/a')).toBe('https://example.com:443/a')
  })

  /** Emil, 2026-10-13 (#235): `localhost:8765` was tried over https alone. Chrome goes to
   *  this machine and the network it is on over plain http, and to a port of its own. */
  test('this machine, the network and a port of its own are given http', () => {
    expect(webAddress('localhost:8765')).toBe('http://localhost:8765')
    expect(webAddress('localhost')).toBe('http://localhost')
    expect(webAddress('localhost/a?b')).toBe('http://localhost/a?b')
    expect(webAddress('app.localhost:5173')).toBe('http://app.localhost:5173')
    expect(webAddress('127.0.0.1:8765')).toBe('http://127.0.0.1:8765')
    expect(webAddress('127.0.0.1')).toBe('http://127.0.0.1')
    expect(webAddress('[::1]:3000')).toBe('http://[::1]:3000')
    expect(webAddress('192.168.1.1')).toBe('http://192.168.1.1')
    expect(webAddress('10.0.0.5/admin')).toBe('http://10.0.0.5/admin')
    expect(webAddress('172.20.3.4:9000')).toBe('http://172.20.3.4:9000')
    expect(webAddress('printer.local')).toBe('http://printer.local')
    expect(webAddress('router.lan')).toBe('http://router.lan')
    expect(webAddress('nas:5000')).toBe('http://nas:5000')
    expect(webAddress('example.com:8080')).toBe('http://example.com:8080')
    expect(webAddress('//localhost:8765')).toBe('http://localhost:8765')
  })

  test('a public address is given https', () => {
    expect(webAddress('8.8.8.8')).toBe('https://8.8.8.8')
    expect(webAddress('172.32.0.1')).toBe('https://172.32.0.1')
  })

  test('a scheme typed is kept as typed', () => {
    expect(webAddress('http://example.com')).toBe('http://example.com')
    expect(webAddress('https://localhost:8765')).toBe('https://localhost:8765')
  })

  test('a word with digits after it is a host only when it is not a scheme', () => {
    expect(webAddress('tel:123')).toBeNull()
    expect(webAddress('nas')).toBe('https://www.google.com/search?q=nas')
  })

  test('words are a search', () => {
    expect(webAddress('svelte docs')).toBe('https://www.google.com/search?q=svelte%20docs')
    // One word with no dot is a word: a browser searches for `svelte` too.
    expect(webAddress('svelte')).toBe('https://www.google.com/search?q=svelte')
  })

  test('on the engine the reader chose', () => {
    expect(webAddress('a & b', 'https://duckduckgo.com/?q=%s')).toBe(
      'https://duckduckgo.com/?q=a%20%26%20b',
    )
    // An address is an address whichever engine searches words.
    expect(webAddress('svelte.dev', 'https://duckduckgo.com/?q=%s')).toBe('https://svelte.dev')
    expect(webAddress('javascript:alert(1)', 'https://duckduckgo.com/?q=%s')).toBeNull()
  })
})

describe('the origin, plainly', () => {
  test('is the host', () => {
    expect(plainOrigin('https://svelte.dev/docs/introduction')).toBe('svelte.dev')
    expect(plainOrigin('https://docs.example.org:8443/a')).toBe('docs.example.org:8443')
  })

  test('drops www, the way every browser does', () => {
    expect(plainOrigin('https://www.bbc.co.uk/news')).toBe('bbc.co.uk')
  })

  /** The one thing about an address worth warning somebody about. */
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
  // What a tab can hold before its page is an address, which once threw in the pane.
  expect(favicon('pass.proton.me/onboarding')).toBeNull()
  expect(favicon('about:blank')).toBeNull()
})
