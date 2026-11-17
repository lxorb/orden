import { describe, expect, test } from 'vitest'
import { patchHtml } from './patch-html'

function host(html: string): HTMLElement {
  const one = document.createElement('div')
  patchHtml(one, html)
  return one
}

describe('drawing an answer over the one drawn before', () => {
  test('ends with exactly what was asked for', () => {
    const steps = [
      '<p>a</p>',
      '<p>a b</p><pre><code>x</code></pre>',
      '<h2>t</h2><p>a b</p>',
      '',
      'text <b>bold</b><ul><li>1</li><li>2</li></ul>',
      '<ul><li>1</li></ul>',
    ]
    const one = document.createElement('div')

    for (const html of steps) {
      patchHtml(one, html)
      expect(one.innerHTML).toBe(html)
    }
  })

  test('keeps every node that did not change, and the groups of code before the last', () => {
    const group = (text: string) => `<span class="code-lines">${text}\n</span>`
    const one = host(
      `<p>Look</p><div class="code"><pre><code>${group('a')}${group('b')}</code></pre></div>`,
    )
    const said = one.querySelector('p')
    const [first, second] = one.querySelectorAll('.code-lines')

    patchHtml(
      one,
      `<p>Look</p><div class="code"><pre><code>${group('a')}${group('b c')}${group('d')}</code></pre></div>`,
    )

    const now = one.querySelectorAll('.code-lines')
    expect(one.querySelector('p')).toBe(said)
    expect(now[0]).toBe(first)
    expect(now[1]).toBe(second)
    expect(now[1]?.textContent).toBe('b c\n')
    expect(now).toHaveLength(3)
  })

  test('draws an element again whose attributes changed', () => {
    const one = host('<a href="#a">x</a>')
    const before = one.firstChild

    patchHtml(one, '<a href="#b">x</a>')

    expect(one.firstChild).not.toBe(before)
    expect(one.innerHTML).toBe('<a href="#b">x</a>')
  })
})
