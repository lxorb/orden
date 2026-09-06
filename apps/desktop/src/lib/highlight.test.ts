import { CODE_PALETTES } from '@nib/editor'
import { describe, expect, test } from 'vitest'
import { highlightCode, loadParsers, paletteCss } from './highlight'

describe('loading parsers', () => {
  test('finds a language by name or alias', async () => {
    const parsers = await loadParsers(['ts', 'python', 'JavaScript'])

    expect(parsers.has('ts')).toBe(true)
    expect(parsers.has('python')).toBe(true)
    expect(parsers.has('JavaScript')).toBe(true)
  })

  test('leaves out what it does not know', async () => {
    const parsers = await loadParsers(['no-such-language', ''])
    expect(parsers.size).toBe(0)
  })

  /** The exporter reads the editor's own language list, so a fence that was
   *  coloured on screen is coloured in the file that leaves. */
  test('knows the languages the editor knows', async () => {
    const parsers = await loadParsers(['makefile', 'tf', 'mermaid'])
    expect(parsers.size).toBe(3)
  })
})

describe('highlighting', () => {
  test('wraps tokens in classes and escapes the text', async () => {
    const parsers = await loadParsers(['ts'])
    const html = highlightCode('const a = "x" < 2 // note', parsers.get('ts')!)

    expect(html).toContain('<span class="hl-keyword">const</span>')
    expect(html).toContain('<span class="hl-string">"x"</span>')
    expect(html).toContain('<span class="hl-number">2</span>')
    expect(html).toContain('<span class="hl-comment">// note</span>')
    expect(html).toContain('&lt;')
    expect(html).not.toContain('<span class="hl-punctuation">&lt;</span><')
  })

  /** The two an exported diff used to lose: added and removed carry the
   *  document's own green and red rather than a palette entry, because that is
   *  what the fence means - see code-theme.ts. */
  test('colours a diff added and removed', async () => {
    const parsers = await loadParsers(['diff'])
    const html = highlightCode(
      '--- a/file@@+++ b/file@@-old line@@+new line'.split('@@').join('\n'),
      parsers.get('diff')!,
    )

    expect(html).toContain('<span class="hl-inserted">+new line</span>')
    expect(html).toContain('<span class="hl-deleted">-old line</span>')
  })

  /** The key of a key=value file, which the palette reached past until the
   *  definition tag was painted. */
  test('colours the key of an env fence', async () => {
    const parsers = await loadParsers(['env'])
    const html = highlightCode('API_KEY=secret', parsers.get('env')!)

    expect(html).toContain('<span class="hl-property">API_KEY</span>')
  })

  test('colours a function name', async () => {
    const parsers = await loadParsers(['js'])
    expect(highlightCode('greet(1)', parsers.get('js')!)).toContain(
      '<span class="hl-function">greet</span>',
    )
  })

  test('keeps every character of the source', async () => {
    const parsers = await loadParsers(['py'])
    const source = 'def f(n):\n    return n if n < 2 else f(n - 1)\n'
    const html = highlightCode(source, parsers.get('py')!)

    expect(html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<')).toBe(source)
  })
})

describe('the palette stylesheet', () => {
  test('writes one rule per token class', () => {
    const [follow] = CODE_PALETTES
    if (!follow) throw new Error('the editor ships no code palettes')

    const css = paletteCss(follow)

    expect(css).toContain('#write .hl-keyword { color: var(--accent); }')
    expect(css).toContain('#write .hl-comment { color: var(--muted); }')
    expect(css).toContain('.hl-invalid')
  })
})
