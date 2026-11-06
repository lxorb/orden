import { describe, expect, test } from 'vitest'
import './eager'
import { renderMarkdown } from './index'
import { dollarMaths, settled, TexDelimiters } from './streamed'

function streamed(text: string, size: number): string {
  const spelling = new TexDelimiters()
  let out = ''
  for (let at = 0; at < text.length; at += size) out += spelling.push(text.slice(at, at + size))
  return out + spelling.end()
}

const SPELLINGS: [string, string][] = [
  ['So \\( x^2 \\) is.', 'So $x^2$ is.'],
  ['So \\(x\\) and \\(y\\).', 'So $x$ and $y$.'],
  ['Where\n\\[\n a + b\n\\]\nthen', 'Where\n$$\n a + b\n$$\nthen'],
  ['\\[ E = mc^2 \\]', '$$\nE = mc^2\n$$'],
  ['Where \\[ a \\] holds', 'Where \n$$\na\n$$\n holds'],
  ['`\\(x\\)` and \\(y\\)', '`\\(x\\)` and $y$'],
  ['```tex\n\\[x\\]\n```\n\\(y\\)', '```tex\n\\[x\\]\n```\n$y$'],
  ['- item\n  ```\n  \\(x\\)\n  ```', '- item\n  ```\n  \\(x\\)\n  ```'],
  [
    '$$\n\\begin{pmatrix} a \\\\[2pt] b \\end{pmatrix}\n$$',
    '$$\n\\begin{pmatrix} a \\\\[2pt] b \\end{pmatrix}\n$$',
  ],
  ['a \\) b \\] c \\* d', 'a \\) b \\] c \\* d'],
  ['Already $x$ and $$y$$.', 'Already $x$ and $$y$$.'],
]

describe('LaTeX delimiters, spelled a note’s way', () => {
  test.each(SPELLINGS)('%j', (written, spelled) => {
    expect(dollarMaths(written)).toBe(spelled)
  })

  test.each(SPELLINGS)('%j the same however it arrives', (written, spelled) => {
    for (const size of [1, 2, 3, 5, 8]) expect(streamed(written, size), `${size}`).toBe(spelled)
  })

  test('holds back no more than it cannot read yet', () => {
    const spelling = new TexDelimiters()
    expect(spelling.push('So \\')).toBe('So ')
    expect(spelling.push('(x')).toBe('$x')
    expect(spelling.push(' \\')).toBe('')
    expect(spelling.push(') is')).toBe('$ is')
    expect(spelling.end()).toBe('')
  })

  test('draws as formulas once spelled', () => {
    const html = renderMarkdown(dollarMaths('So \\( x^2 \\) and\n\\[\n\\frac{1}{2}\n\\]\n'))
    expect(html).toContain('math-inline')
    expect(html).toContain('math-block')
    expect(html).not.toContain('\\(')
  })
})

describe('an answer still arriving', () => {
  test.each([
    ['$$\nx^2 +', '$$\nx^2 +\n$$'],
    ['$$\n', ''],
    ['So\n\n$$x^2', 'So\n\n$$x^2$$'],
    ['so `code', 'so `code`'],
    ['so **bold', 'so **bold**'],
    ['so $x^2 + ', 'so $x^2 +$'],
    ['a **b $x_1', 'a **b $x_1$**'],
    ['costs $5 and', 'costs $5 and'],
    ['```js\nlet a = `x', '```js\nlet a = `x'],
    ['$x$ and **b** done', '$x$ and **b** done'],
  ])('%j is drawn closed', (arriving, closed) => {
    expect(settled(arriving)).toBe(closed)
  })

  test('draws every length of an answer as what it is becoming', () => {
    const answer = [
      '# Heading',
      '',
      'Inline \\(a^2 + b^2\\) and $c^2$.',
      '',
      '\\[',
      '\\int_0^1 x\\,dx = \\frac{1}{2}',
      '\\]',
      '',
      '- [x] done',
      '- [ ] open',
      '',
      '| a | b |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      '> quoted',
      '',
      '```ts',
      'let a = 1',
      '```',
      '',
      'See [it](https://example.com)[^1].',
      '',
      '[^1]: The note.',
    ].join('\n')
    const whole = renderMarkdown(dollarMaths(answer), { footnotes: true })

    let arrived = ''
    const spelling = new TexDelimiters()
    for (const one of answer) {
      arrived += spelling.push(one)
      const html = renderMarkdown(settled(arrived), { footnotes: true })
      expect(html.replace(/<code[\s\S]*?<\/code>/g, '')).not.toMatch(/\$\$|\\\[|\\\(/)
    }
    arrived += spelling.end()
    expect(renderMarkdown(settled(arrived), { footnotes: true })).toBe(whole)

    expect(whole).toContain('<h1>')
    expect(whole).toContain('math-inline')
    expect(whole).toContain('math-block')
    expect(whole).toContain('task-list-item is-done')
    expect(whole).toContain('<table>')
    expect(whole).toContain('<blockquote>')
    expect(whole).toContain('class="language-ts"')
    expect(whole).toContain('href="https://example.com"')
    expect(whole).toContain('class="footnotes"')
  })
})
