import { describe, expect, test } from 'vitest'
import { emojiTable, loadFor, mathsEngine, onEngines } from './engines'
import { renderMarkdown } from './index'

describe('before either engine has arrived', () => {
  test('neither is here to begin with', () => {
    expect(mathsEngine()).toBeNull()
    expect(emojiTable()).toBeNull()
  })

  test('a formula renders as its own source rather than as nothing', () => {
    const html = renderMarkdown('mass $E=mc^2$ here')

    expect(html).toContain('E=mc^2')
    expect(html).not.toContain('katex')
    expect(html).toContain('mass')
    expect(html).toContain('here')
  })

  test('a shortcode stays the characters it was written with', () => {
    expect(renderMarkdown('ship it :rocket:')).toContain(':rocket:')
  })

  test('and rendering without one has asked for it, so the next render is right', async () => {
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
    await expect(loadFor('Just some words, note: none of them.')).resolves.toBeUndefined()
  })

  test('a listener hears an engine land, and can stop listening', async () => {
    let heard = 0
    const stop = onEngines(() => {
      heard += 1
    })

    await loadFor('$x$ and :rocket:')
    expect(heard).toBe(0)
    stop()
  })
})
