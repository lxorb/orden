import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { DEMO_LOOP_SCENES } from './demo-cue'

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
  test('loads no font file and no picture but the posters of its displays', () => {
    expect(PAGE).not.toMatch(/\.woff|\.jpe?g/)
    const pictures = [...PAGE.matchAll(/(?:src|srcset)="([^"]+)"/g)]
      .map((found) => found[1] ?? '')
      .filter((one) => !one.endsWith('.ts'))
    expect(pictures.length).toBe(DEMO_LOOP_SCENES.length * 4)
    for (const one of pictures)
      expect(one).toMatch(/^\.\/src\/lib\/showcase\/posters\/[a-z]+-(?:desktop|phone)-(?:light|dark)\.webp$/)
  })
  test('gives every display a poster for each width and theme, and every poster is on disk', () => {
    for (const scene of DEMO_LOOP_SCENES) {
      const figure = new RegExp(`data-scene="${scene}"[\\s\\S]*?</figure>`).exec(PAGE)?.[0] ?? ''
      for (const device of ['desktop', 'phone'])
        for (const theme of ['light', 'dark']) {
          const name = `${scene}-${device}-${theme}.webp`
          expect(figure, name).toContain(`posters/${name}`)
          expect(existsSync(new URL(`../posters/${name}`, import.meta.url)), name).toBe(true)
        }
      expect(figure).toMatch(scene === 'flow' ? /fetchpriority="high"/ : /loading="lazy"/)
    }
  })
  test('carries no middle dot or bullet between words', () => {
    const between = new RegExp(`[${String.fromCharCode(0xb7, 0x2022, 0x2014)}]`)
    expect(PAGE).not.toMatch(between)
  })
  test('marks Download and Try it out with their glyphs, hidden from screen readers', () => {
    const buttons = [...PAGE.matchAll(/<a\s+class="orden-button[^"]*"\s+data-(download|app)[^>]*>([\s\S]*?)<\/a\s*>/g)]
    expect(buttons).toHaveLength(4)
    for (const [, kind, inside] of buttons) {
      expect(inside, kind).toMatch(/<svg\s+class="button-glyph"[^>]*aria-hidden="true"/)
      expect(inside, kind).toMatch(
        kind === 'download' ? /<span data-label>\s*Download\s*<\/span>/ : /<span>\s*Try it out\s*<\/span>/,
      )
    }
  })
})
