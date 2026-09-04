import { renderMarkdown } from '@nib/markdown'
import { describe, expect, test } from 'vitest'
import { mathCss } from './math-fonts'

/** The families the stylesheet actually ships a face for. */
function faces(css: string): string[] {
  return [...css.matchAll(/@font-face\{[^}]*?font-family:(KaTeX_[\w-]+)/g)].map((match) => match[1])
}

describe('maths in an export', () => {
  test('brings no stylesheet to a page without any', () => {
    expect(mathCss('<p>plain</p>')).toBe('')
  })

  test('carries the faces the page uses, as data', () => {
    const css = mathCss(renderMarkdown('$E = mc^2$'))

    expect(faces(css)).toContain('KaTeX_Main')
    expect(faces(css)).toContain('KaTeX_Math')
    expect(css).toContain('src:url(data:font/woff2;base64,')
    expect(css).not.toContain('url(fonts/')
    expect(css).toContain('.katex{')
  })

  test('leaves out the faces the page does not use', () => {
    const shipped = faces(mathCss(renderMarkdown('$x$')))

    expect(shipped).not.toContain('KaTeX_Fraktur')
    expect(shipped).not.toContain('KaTeX_Script')
    expect(shipped).not.toContain('KaTeX_Typewriter')
    expect(shipped).not.toContain('KaTeX_Size1')
  })

  test('adds a face once its letters appear', () => {
    expect(faces(mathCss(renderMarkdown('$\\mathfrak{F}$')))).toContain('KaTeX_Fraktur')
    expect(faces(mathCss(renderMarkdown('$\\mathcal{L}$')))).toContain('KaTeX_Caligraphic')
  })

  test('keeps the sizes a tall delimiter needs', () => {
    const shipped = faces(mathCss(renderMarkdown('$$\n\\left(\\frac{a}{b}\\right)\n$$')))
    expect(shipped.some((family) => family.startsWith('KaTeX_Size'))).toBe(true)
  })
})
