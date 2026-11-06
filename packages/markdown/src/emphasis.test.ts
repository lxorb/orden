import { describe, expect, test } from 'vitest'
import { renderMarkdown } from './index'
import { deckOf } from './slides'

describe('emphasis nothing closes', () => {
  const quick = (source: string) => {
    const started = performance.now()
    const html = renderMarkdown(source)
    expect(performance.now() - started).toBeLessThan(1500)
    return html
  }

  test('renders in linear time', () => {
    expect(quick('*a '.repeat(33_000))).not.toContain('<em>')
    expect(quick('_a '.repeat(33_000))).not.toContain('<em>')
    expect(quick('**a '.repeat(25_000))).not.toContain('<strong>')
    quick(`${'*a '.repeat(33_000)}a*`)
    quick(`${'*a '.repeat(16_000)}${'a**b '.repeat(16_000)}`)
    quick('a ~b *j '.repeat(12_000))
  })

  test('nested thousands deep is read to a depth and no further, without throwing', () => {
    const html = quick(`${'*a '.repeat(5000)}${'a* '.repeat(5000)}`)
    expect(html.split('<em>').length - 1).toBe(32)
  })

  test('in a deck, too', () => {
    const started = performance.now()
    deckOf(`+ ${'*a '.repeat(33_000)}\n\n---\n\n+ b`)
    expect(performance.now() - started).toBeLessThan(1500)
  })
})

describe('emphasis that closes', () => {
  test('reads as marked reads it', () => {
    expect(renderMarkdown('*a* **b** ***c*** _d_ __e__')).toBe(
      '<p><em>a</em> <strong>b</strong> <em><strong>c</strong></em> <em>d</em> <strong>e</strong></p>\n',
    )
    expect(renderMarkdown('*a **b** c* and a*b*c but not a_b_c')).toBe(
      '<p><em>a <strong>b</strong> c</em> and a<em>b</em>c but not a_b_c</p>\n',
    )
    expect(renderMarkdown('*a\n*b* c')).toBe('<p>*a\n<em>b</em> c</p>\n')
    expect(renderMarkdown('**a*')).toBe('<p>*<em>a</em></p>\n')
    expect(renderMarkdown('*😀*')).toBe('<p><em>😀</em></p>\n')
  })
})
