import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

const PAGE = readFileSync(new URL('../../../../home.html', import.meta.url), 'utf8')
const policy = () => /http-equiv="Content-Security-Policy"\s*content="([^"]*)"/.exec(PAGE)?.[1] ?? ''
describe('the home page file', () => {
  test('names its one inline script by hash, and allows nothing else to run', () => {
    const inline = [...PAGE.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((found) =>
      createHash('sha256')
        .update(found[1] ?? '')
        .digest('base64'),
    )
    expect(inline).toHaveLength(1)
    const script = policy()
      .split('; ')
      .find((one) => one.startsWith('script-src '))
    expect(script).toBe(`script-src 'self' 'sha256-${inline[0] ?? ''}'`)
    expect(policy()).toContain("frame-src 'self' https://app.orden.so;")
    expect(policy()).toContain("font-src 'self';")
    expect(policy()).toContain("connect-src 'self' https://api.github.com;")
    expect(policy()).not.toContain('unsafe')
  })
  test('sets its theme before the first paint, from the system', () => {
    const head = PAGE.slice(0, PAGE.indexOf('</head>'))
    expect(head).toContain("matchMedia('(prefers-color-scheme: light)')")
    expect(head.indexOf('dataset.theme')).toBeLessThan(head.indexOf('type="module"'))
  })
  test('loads no image and no font file', () => {
    expect(PAGE).not.toMatch(/<img|\.woff|\.jpe?g|\.webp/)
  })
  test('carries no middle dot or bullet between words', () => {
    const between = new RegExp(`[${String.fromCharCode(0xb7, 0x2022, 0x2014)}]`)
    expect(PAGE).not.toMatch(between)
  })
})
