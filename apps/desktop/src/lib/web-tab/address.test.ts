import { describe, expect, test } from 'vitest'
import { favicon, isWebAddress, originKey, plainOrigin } from './address'
import { meantBy, shownSite, shownUrl } from './idn'
import { webAddress } from './typed'

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

describe('a name that could pass for another', () => {
  const ascii = (name: string) => new URL(`https://${name}/`).hostname

  test.each([
    ['gıthub.com'],
    ['\u0237query.com'],
    ['\u0138ey.com'],
    ['faß.de'],
    ['ɡoogle.com'],
    ['ςιτι.com'],
    ['gòogle.com'],
    ['pаypal.com'],
    ['pàypal.com'],
    ['microsöft.com'],
    ['gi\u0307thub.com'],
    ['goo\u0323gle.com'],
    ['gøogle.com'],
  ])('%s stays punycode', (name) => {
    const host = ascii(name)
    expect(host).toContain('xn--')
    expect(plainOrigin(`https://${host}/`)).toBe(host)
  })

  test.each([['münchen.de'], ['zürich.ch'], ['españa.es'], ['việtnam.vn'], ['şişli.tr']])(
    '%s reads as itself',
    (name) => {
      expect(plainOrigin(`https://${ascii(name)}/`)).toBe(name)
    },
  )
})

describe('the key of a site', () => {
  test('is the spelling that does not change', () => {
    expect(originKey('https://www.xn--mnchen-3ya.de/a')).toBe('xn--mnchen-3ya.de')
    expect(originKey('http://xn--mnchen-3ya.de/')).toBe('http://xn--mnchen-3ya.de')
    expect(originKey('https://example.com:8443/')).toBe('example.com:8443')
    expect(originKey('view-source:https://xn--mnchen-3ya.de/')).toBe(
      'view-source:xn--mnchen-3ya.de',
    )
  })

  test('is read as the name it is only where it is shown', () => {
    expect(shownSite('xn--mnchen-3ya.de')).toBe('münchen.de')
    expect(shownSite('http://xn--mnchen-3ya.de')).toBe('http://münchen.de')
    expect(shownSite('')).toBe('')
  })
})

describe('Enter on a bar nobody typed in', () => {
  test('goes to the page itself', () => {
    const url = 'https://xn--mnchen-3ya.de/a'
    expect(meantBy('https://münchen.de/a', url)).toBe(url)
  })

  test('takes anything else as what was typed', () => {
    expect(meantBy('https://münchen.de/b', 'https://xn--mnchen-3ya.de/a')).toBe(
      'https://münchen.de/b',
    )
    expect(meantBy('words', null)).toBe('words')
  })
})

describe('a name that is not ASCII', () => {
  test.each([
    ['https://xn--mnchen-3ya.de/a', 'münchen.de'],
    ['https://www.xn--mnchen-3ya.de/', 'münchen.de'],
    ['https://xn--mnchen-3ya.de:8443/', 'münchen.de:8443'],
    ['http://xn--mnchen-3ya.de/', 'http://münchen.de'],
    ['https://xn--wgv71a119e.jp/', '日本語.jp'],
    ['https://xn--e1afmkfd.xn--p1ai/', 'пример.рф'],
    ['https://xn--fsqu00a.xn--0zwm56d/', '例子.测试'],
  ])('%s reads as %s', (url, shown) => {
    expect(plainOrigin(url)).toBe(shown)
  })

  test.each([
    ['https://xn--pple-43d.com/', 'xn--pple-43d.com'],
    ['https://xn--80ak6aa92e.com/', 'xn--80ak6aa92e.com'],
    ['https://xn--pple-zld.com/', 'xn--pple-zld.com'],
    ['https://xn--n3h.com/', 'xn--n3h.com'],
  ])('%s stays as it is', (url, shown) => {
    expect(plainOrigin(url)).toBe(shown)
  })

  test('judges each label by itself', () => {
    expect(plainOrigin('https://xn--pple-43d.xn--mnchen-3ya.de/')).toBe('xn--pple-43d.münchen.de')
  })

  test('Latin beside the writing systems that are written with it', () => {
    expect(plainOrigin('https://xn--abc-7k4bocn.jp/')).toBe('abcテスト.jp')
    expect(plainOrigin('https://xn--abc-u68do18h.cn/')).toBe('中文abc.cn')
  })

  test('Cyrillic that looks Latin reads as itself under a Cyrillic ending', () => {
    expect(plainOrigin('https://xn--80ak6aa92e.xn--p1ai/')).toBe('аррӏе.рф')
    expect(plainOrigin('https://xn--80ak6aa92e.ru/')).toBe('аррӏе.ru')
  })

  test('the whole address, for the field', () => {
    expect(shownUrl('https://xn--mnchen-3ya.de/a?b=c#d')).toBe('https://münchen.de/a?b=c#d')
    expect(shownUrl('https://example.com/a')).toBe('https://example.com/a')
    expect(shownUrl('https://xn--pple-43d.com/')).toBe('https://xn--pple-43d.com/')
    expect(shownUrl('view-source:https://xn--mnchen-3ya.de/')).toBe(
      'view-source:https://münchen.de/',
    )
    expect(shownUrl('not an address')).toBe('not an address')
    expect(shownUrl('https://google.com@xn--mnchen-3ya.de/')).toBe(
      'https://google.com@xn--mnchen-3ya.de/',
    )
  })
})
