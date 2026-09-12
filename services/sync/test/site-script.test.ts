import { describe, expect, test } from 'vitest'
import { SITE_JS, SITE_JS_PATH, SITE_JS_SOURCES, THEME_JS, THEME_JS_HASH } from '../src/blog/script'
import { sourceHash } from '../../../scripts/site-js'

/** The script a published page runs is generated from the app's own modules and
 *  committed, so the Worker needs no build step. This is the check that the
 *  committed module is still the one those modules make.
 *
 *  The sources' hash rather than a rebuild: bundling takes a few seconds and a
 *  test suite should not spend them. What it catches is the thing that goes
 *  wrong - somebody edits the site script or the graph and forgets
 *  `pnpm blog:js`. */
describe('the script a site serves', () => {
  test('is the one the app’s modules make', () => {
    expect(SITE_JS_SOURCES, 'run `pnpm blog:js`').toBe(sourceHash())
  })

  test('is served at a path that is its own hash', () => {
    expect(SITE_JS_PATH).toMatch(/^\/s\/[a-f0-9]{16}\.js$/)
  })

  test('and carries the app’s graph rather than a second one', () => {
    // The layout and the painter are the app's, bundled in: a page that drew its
    // own graph would be a second answer to what a space looks like.
    expect(SITE_JS).toContain('requestAnimationFrame')
    expect(SITE_JS.length).toBeGreaterThan(4000)
  })

  test('names the one inline line by its own hash', () => {
    expect(THEME_JS).toContain('nib:site-theme')
    expect(THEME_JS_HASH).toMatch(/^sha256-[A-Za-z0-9+/=]+$/)
  })
})
