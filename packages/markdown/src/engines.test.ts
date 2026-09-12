import { describe, expect, test } from 'vitest'
import { emojiTable, loadFor, mathsEngine, onEngines } from './engines'
import { renderMarkdown } from './index'

/** What a note looks like before the two heavy libraries arrive, and after.
 *
 *  KaTeX with its chemistry pack and the emoji table are three quarters of a megabyte
 *  between them, and they used to be in front of the app's first paint because this
 *  package's entry point imported both. Now they are loaded when a note turns out to
 *  want one. This is the promise that makes that safe: a caller that awaits `loadFor`
 *  gets exactly what it always got, and one that cannot wait gets the source of the
 *  formula rather than nothing at all.
 *
 *  This file must not import `./eager`, and nothing it imports may either: the whole
 *  point is the state before either engine is here. render.test.ts is the other half,
 *  and does import it. */

describe('before either engine has arrived', () => {
  test('neither is here to begin with', () => {
    expect(mathsEngine()).toBeNull()
    expect(emojiTable()).toBeNull()
  })

  test('a formula renders as its own source rather than as nothing', () => {
    const html = renderMarkdown('mass $E=mc^2$ here')

    expect(html).toContain('E=mc^2')
    expect(html).not.toContain('katex')
    // The words around it are the words around it, whatever happened to the formula.
    expect(html).toContain('mass')
    expect(html).toContain('here')
  })

  test('a shortcode stays the characters it was written with', () => {
    expect(renderMarkdown('ship it :rocket:')).toContain(':rocket:')
  })

  test('and rendering without one has asked for it, so the next render is right', async () => {
    // The two renders above are what asked. Nothing is awaited in them - they are
    // what the clipboard's HTML flavour does - so the promise is only that the fetch
    // was started, and this is where it is collected.
    await loadFor('$x$ and :rocket:')

    expect(mathsEngine()).not.toBeNull()
    expect(emojiTable()).not.toBeNull()
  })
})

describe('once what a note needs has been waited for', () => {
  test('a formula is set', async () => {
    await loadFor('mass $E=mc^2$ here')

    expect(mathsEngine()).not.toBeNull()
    expect(renderMarkdown('mass $E=mc^2$ here')).toContain('katex')
  })

  test('the chemistry pack came with it', async () => {
    await loadFor('$\\ce{H2O}$')

    const html = renderMarkdown('$\\ce{H2O}$')
    expect(html).toContain('katex')
    expect(html).not.toContain('ParseError')
  })

  test('and then a shortcode is a character', async () => {
    await loadFor('ship it :rocket:')

    expect(emojiTable()).not.toBeNull()
    expect(renderMarkdown('ship it :rocket:')).toContain('🚀')
  })
})

describe('what is asked for', () => {
  test('a note with neither in it asks for neither', async () => {
    // Both are already here by now, so the observable claim is the scan: a source
    // with no dollar and no `:name:` in it wants nothing, whatever is loaded.
    await expect(loadFor('Just some words, note: none of them.')).resolves.toBeUndefined()
  })

  test('a listener hears an engine land, and can stop listening', async () => {
    let heard = 0
    const stop = onEngines(() => {
      heard += 1
    })

    // Already loaded by the tests above, so nothing new lands and nothing is heard;
    // what this holds is that the arrival is announced at most once per engine and
    // that letting go of the listener works.
    await loadFor('$x$ and :rocket:')
    expect(heard).toBe(0)
    stop()
  })
})
