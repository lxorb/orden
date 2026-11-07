import { describe, expect, test, vi } from 'vitest'
import { linearly } from '../../../scripts/growth'
import { renderMarkdown } from './index'
import { deckOf } from './slides'

describe('emphasis nothing closes', () => {
  const quick = (source: (size: number) => string, size: number) =>
    linearly((one) => renderMarkdown(source(one)), size)

  test('renders in linear time', () => {
    expect(quick((n) => '*a '.repeat(n), 8_000)).not.toContain('<em>')
    expect(quick((n) => '_a '.repeat(n), 8_000)).not.toContain('<em>')
    expect(quick((n) => '**a '.repeat(n), 6_000)).not.toContain('<strong>')
    quick((n) => `${'*a '.repeat(n)}a*`, 8_000)
    quick((n) => `${'*a '.repeat(n)}${'a**b '.repeat(n)}`, 4_000)
    quick((n) => 'a ~b *j '.repeat(n), 3_000)
  }, 60_000)

  test('nested thousands deep is read to a depth and no further, without throwing', () => {
    const html = renderMarkdown(`${'*a '.repeat(5000)}${'a* '.repeat(5000)}`)
    expect(html.split('<em>').length - 1).toBe(32)
  })

  test('in a deck, too', () => {
    linearly((n) => deckOf(`+ ${'*a '.repeat(n)}\n\n---\n\n+ b`), 8_000)
  }, 60_000)
})

describe('emphasis that closes, again and again', () => {
  test('renders in linear time, each emphasis holding nothing for the rest of the paragraph', () => {
    expect(linearly((n) => renderMarkdown('a *b* '.repeat(n)), 8_000)).toContain('<em>b</em>')
    linearly((n) => renderMarkdown('a **b** ==c== d@e.fg #h '.repeat(n)), 2_000)
  }, 120_000)

  test('holds nothing aside in a weak map for each emphasis it reads', () => {
    const set = WeakMap.prototype.set
    const keys = new Map<object, Set<object>>()
    let kept = 0
    const spy = vi.spyOn(WeakMap.prototype, 'set').mockImplementation(function (
      this: WeakMap<object, unknown>,
      key: object,
      value: unknown,
    ) {
      const mine = keys.get(this) ?? new Set<object>()
      keys.set(this, mine)
      if (!mine.has(key)) kept++
      mine.add(key)
      return set.call(this, key, value)
    })
    try {
      renderMarkdown('a *b* ==c== '.repeat(1_000))
    } finally {
      spy.mockRestore()
    }
    expect(kept).toBeLessThan(100)
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
