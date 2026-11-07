import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import { DECK_LAYOUT_SCRIPT } from '@orden/markdown/deck'
import { CSP, META_CSP } from '../src/csp'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

const pagePolicies = () => Object.values(PAGES).map(metaPolicy)

const TAURI = JSON.parse(read('../src-tauri/tauri.conf.json')) as {
  app: {
    security: {
      csp: string | null
      dangerousDisableAssetCspModification?: string[]
    }
  }
}

const INDEX = read('../index.html')

const PAGES: Record<string, string> = {
  'index.html': INDEX,
  'presenter.html': read('../presenter.html'),
  'quick-add.html': read('../quick-add.html'),
  'even.html': read('../even.html'),
  'handoff.html': read('../handoff.html'),
  'pass.html': read('../pass.html'),
}

const VITE = read('../vite.config.ts')

function line(policy: string, directive: string): string {
  return policy.split('; ').find((one) => one.startsWith(`${directive} `)) ?? ''
}

function metaPolicy(html: string): string {
  const found = /http-equiv="Content-Security-Policy"\s*\n?\s*content="([^"]*)"/.exec(html)
  return (found?.[1] ?? '').replace(/\s+/g, ' ').trim()
}

describe('the content policy', () => {
  test('is the same string in every place, each in the form it can carry', () => {
    expect(TAURI.app.security.csp).toBe(META_CSP)
    for (const [name, page] of Object.entries(PAGES)) expect(metaPolicy(page), name).toBe(META_CSP)
    expect(CSP.startsWith(`${META_CSP}; `)).toBe(true)
  })

  test('never names frame-ancestors where a browser cannot honour it', () => {
    expect(META_CSP).not.toContain('frame-ancestors')
    expect(TAURI.app.security.csp).not.toContain('frame-ancestors')
    for (const [name, page] of Object.entries(PAGES)) {
      expect(metaPolicy(page), name).not.toContain('frame-ancestors')
    }
  })

  test('and says it where a browser can, which is a header', () => {
    expect(CSP).toContain("frame-ancestors 'none'")
    expect(VITE).toContain("'Content-Security-Policy': CSP")
    expect(VITE).not.toContain('META_CSP')
  })

  test('is before anything a page loads, so it governs all of it', () => {
    for (const [name, page] of Object.entries(PAGES)) {
      const at = page.indexOf('Content-Security-Policy')
      expect(at, name).toBeGreaterThan(0)
      for (const tag of ['<script', '<link', '<style']) {
        if (page.includes(tag)) expect(at, `${name} ${tag}`).toBeLessThan(page.indexOf(tag))
      }
    }
  })

  test('runs no script written inline, on any engine', () => {
    for (const policy of [CSP, META_CSP, TAURI.app.security.csp ?? '']) {
      for (const directive of ['script-src', 'script-src-attr', 'default-src']) {
        expect(line(policy, directive), directive).not.toContain("'unsafe-inline'")
      }
      expect(line(policy, 'script-src-elem')).toBe('')
    }
  })

  test('names every inline script by its hash, and nothing else', () => {
    const hashOf = (text: string) =>
      `'sha256-${createHash('sha256').update(text.replace(/\r\n?/g, '\n')).digest('base64')}'`
    const frames = hashOf(read('../../../packages/editor/src/frame-script.js'))
    const deck = hashOf(DECK_LAYOUT_SCRIPT)
    const pages = Object.values(PAGES).flatMap((page) =>
      [...page.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((found) =>
        hashOf(found[1] ?? ''),
      ),
    )
    expect(pages.length).toBeGreaterThan(0)

    const named = line(META_CSP, 'script-src')
      .split(' ')
      .filter((one) => one.startsWith("'sha256-"))
    expect(named.sort()).toEqual([...new Set([...pages, frames, deck])].sort())
  })

  test('carries a frame script that stays one element', () => {
    const script = read('../../../packages/editor/src/frame-script.js')
    expect(script).not.toMatch(/<\/script|<!--/i)
  })

  test('lets no element on any page carry an event handler', () => {
    expect(CSP).toContain("script-src-attr 'none'")
  })

  test('and loads no code from anywhere but this app', () => {
    for (const directive of ['script-src', 'worker-src']) {
      const line = CSP.split('; ').find((one) => one.startsWith(`${directive} `)) ?? ''
      expect(line, directive).toContain("'self'")
      expect(line, directive).not.toContain('http:')
      expect(line, directive).not.toContain('https:')
      expect(line, directive).not.toContain('data:')
    }
  })

  test('and keeps the styles a running editor writes', () => {
    expect(CSP).toContain("style-src 'self' 'unsafe-inline'")
    expect(CSP).not.toContain('nonce-')
  })

  test('and says the four things that fall back to nothing useful', () => {
    for (const said of [
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ]) {
      expect(CSP).toContain(said)
    }

    for (const said of ["object-src 'none'", "base-uri 'none'", "form-action 'none'"]) {
      expect(META_CSP).toContain(said)
    }
  })

  test('and lets Tauri talk to its own back end', () => {
    const connect = CSP.split('; ').find((one) => one.startsWith('connect-src ')) ?? ''
    expect(connect).toContain('ipc:')
    expect(connect).toContain('http://ipc.localhost')
  })

  test('and reaches this machine by address as well as by name', () => {
    const connect = CSP.split('; ').find((one) => one.startsWith('connect-src ')) ?? ''

    for (const host of ['localhost', '127.0.0.1']) {
      expect(connect, host).toContain(`http://${host}:*`)
      expect(connect, host).toContain(`ws://${host}:*`)
    }

    expect(META_CSP).toContain('http://127.0.0.1:*')
    expect(TAURI.app.security.csp).toContain('http://127.0.0.1:*')
    expect(metaPolicy(INDEX)).toContain('http://127.0.0.1:*')
  })

  test('and says nothing a browser will reject out loud', () => {
    for (const policy of [CSP, META_CSP, TAURI.app.security.csp ?? '', ...pagePolicies()]) {
      expect(policy).not.toContain('[::1]')
      expect(policy).not.toMatch(/\[[0-9a-f:]*]/i)
    }
  })

  test('and lets plain http nowhere but this machine', () => {
    const connect = CSP.split('; ').find((one) => one.startsWith('connect-src ')) ?? ''
    const hosts = connect.split(' ').filter((one) => one.startsWith('http://'))

    expect(hosts).not.toContain('http:')
    for (const host of hosts) {
      expect(host, host).toMatch(/^http:\/\/(localhost|127\.0\.0\.1|[a-z]+\.localhost)(:\*)?$/)
    }
  })

  test('leaves style-src alone, or the editor loses the stylesheet it mounts', () => {
    const untouched = TAURI.app.security.dangerousDisableAssetCspModification
    expect(untouched, 'the bundler must not add a nonce to style-src').toContain('style-src')

    expect(TAURI.app.security.csp ?? '').toContain("style-src 'self' 'unsafe-inline'")
  })
})
