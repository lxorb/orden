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
    const parsers = await loadParsers(['mermaid', 'no-such-language', ''])
    expect(parsers.size).toBe(0)
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

  test('colours a function name', async () => {
    const parsers = await loadParsers(['js'])
    expect(highlightCode('greet(1)', parsers.get('js')!)).toContain('<span class="hl-function">greet</span>')
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
    const css = paletteCss(CODE_PALETTES[0])

    expect(css).toContain('#write .hl-keyword { color: var(--accent); }')
    expect(css).toContain('#write .hl-comment { color: var(--muted); }')
    expect(css).toContain('.hl-invalid')
  })
})
