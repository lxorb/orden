import { describe, expect, test } from 'vitest'
import { growth, GROWS_AT_MOST } from '../../../scripts/growth'
import { renderMarkdown } from './index'

function rendered(unit: string): (length: number) => string {
  return (length) => renderMarkdown(`${unit.repeat(Math.ceil(length / unit.length))}x\n`)
}

const count = (html: string, tag: string) => html.split(`<${tag}>`).length - 1

describe('a long run of one mark', () => {
  test('renders in time that grows with its length', () => {
    for (const unit of [
      '*',
      '_',
      '*_',
      '[^',
      '- ',
      '* ',
      '1. ',
      '> ',
      '> - ',
      'see https://a.b/.,',
    ]) {
      expect(growth(rendered(unit), 16_000), unit).toBeLessThan(GROWS_AT_MOST)
    }
  }, 60_000)

  test('reads lists and quotes 100 deep, and the rest of the line as words', () => {
    const list = renderMarkdown(`${'- '.repeat(150)}x\n`)
    expect(count(list, 'li')).toBe(100)
    expect(list).toContain(`<li>${'- '.repeat(50)}x</li>`)
    const quote = renderMarkdown(`${'> '.repeat(150)}x\n`)
    expect(count(quote, 'blockquote')).toBe(100)
    expect(quote).toContain(`<p>${'&gt; '.repeat(50)}x</p>`)
    expect(count(renderMarkdown(`${'- '.repeat(99)}x\n`), 'li')).toBe(99)
  })

  test('still reads emphasis, footnotes and addresses as before', () => {
    expect(renderMarkdown('**a@b.co** and *x*y@z.org')).toBe(
      '<p><strong><a class="url" href="mailto:a@b.co">a@b.co</a></strong> and <em>x</em><a class="url" href="mailto:y@z.org">y@z.org</a></p>\n',
    )
    expect(renderMarkdown(`${'*'.repeat(40)}a@b.co`)).toContain('href="mailto:a@b.co"')
    expect(renderMarkdown('a [^1] b [^two words] c [^]')).toContain('href="#fn-1"')
    expect(renderMarkdown('a [^two words] c [^] d')).not.toContain('footnote-ref')
    expect(renderMarkdown('see www.a.co/x). and https://a.b/(c).')).toBe(
      '<p>see <a class="url" href="http://www.a.co/x">www.a.co/x</a>). and <a class="url" href="https://a.b/(c)">https://a.b/(c)</a>.</p>\n',
    )
  })
})
