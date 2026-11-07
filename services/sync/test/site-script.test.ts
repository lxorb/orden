import { describe, expect, test } from 'vitest'
import { SITE_JS, SITE_JS_PATH, SITE_JS_SOURCES, THEME_JS, THEME_JS_HASH } from '../src/blog/script'
import { sourceHash } from '../../../scripts/site-sources'

describe('the script a site serves', () => {
  test('is the one the app’s modules make', () => {
    expect(SITE_JS_SOURCES, 'run `pnpm blog:js`').toBe(sourceHash())
  })

  test('is served at a path that is its own hash', () => {
    expect(SITE_JS_PATH).toMatch(/^\/s\/[a-f0-9]{16}\.js$/)
  })

  test('and carries the app’s graph rather than a second one', () => {
    expect(SITE_JS).toContain('requestAnimationFrame')
    expect(SITE_JS.length).toBeGreaterThan(4000)
  })

  test('names the one inline line by its own hash', () => {
    expect(THEME_JS).toContain('orden:site-theme')
    expect(THEME_JS).toContain('nib:site-theme')
    expect(THEME_JS_HASH).toMatch(/^sha256-[A-Za-z0-9+/=]+$/)
  })
})
