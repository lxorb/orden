import { describe, expect, it } from 'vitest'
import type { MatchRule } from './types'
import { hostOf, isSecurePage, matches, normalizeUrl, rank, siteOf } from './urls'

const site = (url: string, match: MatchRule = 'domain') => ({ url, match })

describe('normalizeUrl', () => {
  it('adds https and keeps only web addresses', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com/')
    expect(normalizeUrl(' HTTP://Example.COM/a?b#c ')).toBe('http://example.com/a?b#c')
    expect(normalizeUrl('localhost:3000')).toBe('https://localhost:3000/')
    for (const bad of ['', 'ftp://x.y', 'javascript:alert(1)', 'mailto:a@b.c', 'https://', 'a b'])
      expect(normalizeUrl(bad)).toBeNull()
  })
})

describe('hostOf and siteOf', () => {
  it('finds the registrable domain', () => {
    expect(hostOf('https://a.b.example.com/x')).toBe('a.b.example.com')
    expect(siteOf('https://a.b.example.com/x')).toBe('example.com')
    expect(siteOf('https://www.bbc.co.uk')).toBe('bbc.co.uk')
    expect(siteOf('https://me.github.io/page')).toBe('me.github.io')
    expect(siteOf('http://192.168.1.1:8080')).toBe('192.168.1.1')
    expect(siteOf('http://[::1]:3000/')).toBe('[::1]')
    expect(hostOf('http://[::1]:3000/')).toBe('[::1]')
    expect(siteOf('localhost:3000')).toBe('localhost')
    expect(hostOf('https://bücher.de')).toBe('xn--bcher-kva.de')
    expect(siteOf('https://shop.bücher.de')).toBe('xn--bcher-kva.de')
    expect(siteOf('nonsense://')).toBeNull()
  })
})

describe('matches', () => {
  it('matches the site and its subdomains by default', () => {
    expect(matches(site('https://example.com'), 'https://login.example.com/a')).toBe(true)
    expect(matches(site('https://login.example.com'), 'https://example.com')).toBe(true)
    expect(matches(site('https://example.com'), 'https://example.com.evil.com')).toBe(false)
    expect(matches(site('https://example.com'), 'https://notexample.com')).toBe(false)
  })

  it('keeps sites under a public suffix apart', () => {
    expect(matches(site('https://a.co.uk'), 'https://b.co.uk')).toBe(false)
    expect(matches(site('https://www.bbc.co.uk'), 'https://account.bbc.co.uk')).toBe(true)
    expect(matches(site('https://me.github.io'), 'https://you.github.io')).toBe(false)
    expect(matches(site('https://me.github.io'), 'https://me.github.io/x')).toBe(true)
  })

  it('matches addresses by IP exactly', () => {
    expect(matches(site('http://192.168.1.1'), 'http://192.168.1.1/admin')).toBe(true)
    expect(matches(site('http://192.168.1.1'), 'http://192.168.1.2/')).toBe(false)
    expect(matches(site('http://[::1]'), 'http://[::1]/')).toBe(true)
  })

  it('needs the same port', () => {
    expect(matches(site('localhost:3000'), 'https://localhost:3000/x')).toBe(true)
    expect(matches(site('http://localhost:3000'), 'http://localhost:4000/x')).toBe(false)
    expect(matches(site('https://example.com:8443'), 'https://example.com')).toBe(false)
  })

  it('never offers an https login on an http page', () => {
    expect(matches(site('https://example.com'), 'http://example.com')).toBe(false)
    expect(matches(site('http://example.com'), 'https://example.com')).toBe(true)
  })

  it('reads internationalised names', () => {
    expect(matches(site('https://bücher.de'), 'https://www.xn--bcher-kva.de/')).toBe(true)
  })

  it('follows the host, exact, prefix and never rules', () => {
    expect(matches(site('https://a.example.com', 'host'), 'https://a.example.com/x')).toBe(true)
    expect(matches(site('https://a.example.com', 'host'), 'https://b.example.com')).toBe(false)
    expect(matches(site('https://e.com/login/', 'exact'), 'https://e.com/login?x=1#y')).toBe(true)
    expect(matches(site('https://e.com/login', 'exact'), 'https://e.com/login/more')).toBe(false)
    expect(matches(site('https://e.com/app', 'prefix'), 'https://e.com/app/x')).toBe(true)
    expect(matches(site('https://e.com/app', 'prefix'), 'https://e.com/other')).toBe(false)
    expect(matches(site('https://e.com', 'never'), 'https://e.com')).toBe(false)
  })

  it('refuses addresses it cannot read', () => {
    expect(matches(site(''), 'https://e.com')).toBe(false)
    expect(matches(site('https://e.com'), 'about:blank')).toBe(false)
  })
})

describe('rank', () => {
  it('ranks the closer rule higher', () => {
    const page = 'https://a.example.com/login'
    expect(rank(site('https://a.example.com/login', 'exact'), page)).toBe(5)
    expect(rank(site('https://a.example.com/', 'prefix'), page)).toBe(4)
    expect(rank(site('https://a.example.com', 'host'), page)).toBe(3)
    expect(rank(site('https://a.example.com'), page)).toBe(2)
    expect(rank(site('https://example.com'), page)).toBe(1)
    expect(rank(site('https://other.com'), page)).toBe(0)
    expect(rank(site('https://a.example.com', 'never'), page)).toBe(0)
  })
})

describe('isSecurePage', () => {
  it('trusts https and the machine itself', () => {
    expect(isSecurePage('https://e.com')).toBe(true)
    expect(isSecurePage('http://localhost:3000')).toBe(true)
    expect(isSecurePage('http://app.localhost')).toBe(true)
    expect(isSecurePage('http://127.0.0.1:8080')).toBe(true)
    expect(isSecurePage('http://[::1]/')).toBe(true)
    expect(isSecurePage('http://e.com')).toBe(false)
    expect(isSecurePage('http://127.0.0.2')).toBe(false)
    expect(isSecurePage('file:///etc/passwd')).toBe(false)
    expect(isSecurePage('nonsense')).toBe(false)
  })
})
