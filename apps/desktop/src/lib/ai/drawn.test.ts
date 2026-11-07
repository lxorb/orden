import { loadMaths } from '@orden/markdown/engines'
import { TexDelimiters } from '@orden/markdown/streamed'
import { beforeAll, describe, expect, it, test, vi } from 'vitest'
import { answerHtml, inLineGroups, LINES_A_GROUP, withCodeBars } from './drawn'

describe('withCodeBars', () => {
  it('puts a bar with the language and a copy button over a fenced block', () => {
    const html = answerHtml('```ts\nlet a = 1\n```', { copy: 'Copy code' })
    expect(html).toContain('<div class="code"><div class="code-bar"><span>ts</span>')
    expect(html).toContain('aria-label="Copy code"')
    expect(html).toMatch(/<pre><code class="language-ts">[\s\S]*let[\s\S]*<\/code><\/pre><\/div>/)
  })

  it('leaves the language out where the fence names none', () => {
    const html = answerHtml('```\nplain\n```', { copy: 'Copy code' })
    expect(html).toContain('<div class="code-bar"><span></span>')
    expect(html).toContain('<pre><code>plain\n</code></pre></div>')
  })

  it('touches nothing in an answer without code', () => {
    expect(withCodeBars('<p>words</p>', 'Copy code')).toBe('<p>words</p>')
  })

  it('escapes the label it is handed', () => {
    expect(withCodeBars('<pre><code>x</code></pre>', 'a"b')).toContain('title="a&#34;b"')
  })

  it('draws no bar where no label is asked for', () => {
    expect(answerHtml('```\nx\n```')).toBe('<pre><code>x\n</code></pre>\n')
  })
})

describe('an answer, drawn as a note is', () => {
  beforeAll(async () => {
    await loadMaths()
  })

  const CONSTRUCTS: [string, string, RegExp][] = [
    ['inline maths in dollars', 'So $x^2$ is.', /class="math-inline"[^>]*><span class="katex"/],
    [
      'inline maths in LaTeX’s spelling',
      'So \\(x^2\\) is.',
      /class="math-inline"[^>]*><span class="katex"/,
    ],
    [
      'display maths in dollars',
      '$$\n\\frac{1}{2}\n$$',
      /class="math-block"[^>]*><span class="katex-display"/,
    ],
    [
      'display maths in LaTeX’s spelling',
      '\\[\n\\frac{1}{2}\n\\]',
      /class="math-block"[^>]*><span class="katex-display"/,
    ],
    [
      'display maths on one line',
      '\\[ \\frac{1}{2} \\]',
      /class="math-block"[^>]*><span class="katex-display"/,
    ],
    ['a heading', '## Part', /<h2>Part<\/h2>/],
    ['a list', '- one\n- two', /<ul>\n<li>one<\/li>\n<li>two<\/li>/],
    ['a numbered list', '1. one\n2. two', /<ol>\n<li>one<\/li>/],
    [
      'a task list',
      '- [x] done\n- [ ] open',
      /<li class="task-list-item is-done"><input[^>]*checked/,
    ],
    ['a table', '| a | b |\n|---|---|\n| 1 | 2 |', /<table>[\s\S]*<td>1<\/td>/],
    ['a quote', '> quoted', /<blockquote>\n<p>quoted<\/p>/],
    ['a link', '[it](https://example.com)', /<a href="https:\/\/example.com">it<\/a>/],
    ['a footnote', 'Said[^1].\n\n[^1]: Where.', /class="footnotes"[\s\S]*id="fn-1"/],
    ['a callout', '> [!note]\n> Mind it.', /callout/],
  ]

  test.each(CONSTRUCTS)('%s', (_, markdown, drawn) => {
    expect(answerHtml(markdown)).toMatch(drawn)
  })

  test.each(CONSTRUCTS)('%s, while it arrives', (_, markdown, drawn) => {
    const spelling = new TexDelimiters()
    let arrived = ''
    for (const one of markdown) {
      arrived += spelling.push(one)
      const html = answerHtml(arrived, { live: true })
      expect(html.replace(/<code[\s\S]*?<\/code>|data-tex="[^"]*"/g, '')).not.toMatch(
        /\$\$|\\\[|\\\(/,
      )
    }
    arrived += spelling.end()
    expect(answerHtml(arrived, { live: true })).toMatch(drawn)
    expect(answerHtml(arrived, { live: true })).toBe(answerHtml(markdown))
  })

  test('a code block is coloured as a note’s is, once its grammar has landed', async () => {
    const markdown = '```js\nconst a = "x"\n```'
    await vi.waitFor(() => expect(answerHtml(markdown)).toContain('class="hl-keyword"'), {
      timeout: 20000,
    })
    expect(answerHtml(markdown, { copy: 'Copy code' })).toContain('<div class="code-bar">')
  })

  test('an unclosed fence is code to the end while it arrives', () => {
    const html = answerHtml('Look:\n\n```py\nprint(1)\n$x$', { live: true })
    expect(html).toContain('<code class="language-py">')
    expect(html).not.toContain('math-inline')
  })

  test('a picture of the reader’s own is drawn, one from elsewhere is held until asked', () => {
    expect(answerHtml('![a dot](data:image/png;base64,AAAA)')).toContain(
      '<img src="data:image/png;base64,AAAA" alt="a dot">',
    )
    const held = answerHtml('![a cat](https://example.com/cat.png?q=1)')
    expect(held).not.toContain('<img')
    expect(held).toContain('class="picture-held" data-picture="https://example.com/cat.png?q=1"')
    expect(held).toContain('<span>a cat</span>')
    const shown = answerHtml('![a cat](https://example.com/cat.png?q=1)', {
      shown: new Set(['https://example.com/cat.png?q=1']),
    })
    expect(shown).toContain('<img src="https://example.com/cat.png?q=1" alt="a cat">')
  })

  test('raw HTML the model wrote is its characters, and frames are taken out', () => {
    const html = answerHtml('<b>bold</b>\n\n<iframe src="https://example.com"></iframe>')
    expect(html).not.toContain('<b>')
    expect(html).not.toContain('<iframe')
  })
})

describe('a long block of code while it arrives', () => {
  const lines = (count: number) =>
    Array.from({ length: count }, (_, at) => `line ${at} & more`).join('\n')

  test('is drawn in groups of lines, so a line more touches only the last group', () => {
    const html = answerHtml(`\`\`\`\n${lines(LINES_A_GROUP * 2 + 3)}`, { live: true })

    expect(html.match(/<span class="code-lines">/g)).toHaveLength(3)
    expect(html.replace(/<\/?span[^>]*>/g, '')).toBe(
      answerHtml(`\`\`\`\n${lines(LINES_A_GROUP * 2 + 3)}\n\`\`\``),
    )
  })

  test('is one piece while it is short, and once it has arrived', () => {
    expect(answerHtml(`\`\`\`\n${lines(LINES_A_GROUP - 1)}`, { live: true })).not.toContain(
      'code-lines',
    )
    expect(answerHtml(`\`\`\`\n${lines(LINES_A_GROUP * 3)}\n\`\`\``)).not.toContain('code-lines')
  })

  test('closes a token that runs across groups and opens it again after', () => {
    const comment = `<span class="hl-comment">/*${'\n'.repeat(LINES_A_GROUP + 4)}*/</span>`
    const code = `<pre><code>a\n${comment}\n</code></pre>`

    const grouped = inLineGroups(code)
    const [first = '', second = ''] = grouped.split('<span class="code-lines">').slice(1)

    expect(first.endsWith('</span></span>')).toBe(true)
    expect(second.startsWith('<span class="hl-comment">')).toBe(true)
    expect(grouped.replace(/<[^>]+>/g, '')).toBe(code.replace(/<[^>]+>/g, ''))
  })
})
