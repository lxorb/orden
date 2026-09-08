import { describe, expect, test } from 'vitest'
import { toMarkdown } from './markdown'
import { fill } from './placeholders'

/** The markdown for a fragment, the way a clipped selection arrives: already
 *  cleaned and absolute, straight into the converter. */
const md = (html: string) => toMarkdown(html).markdown

describe('the shapes markdown has', () => {
  test('writes headings as hashes', () => {
    expect(md('<h1>One</h1><h3>Three</h3>')).toBe('# One\n\n### Three')
  })

  test('writes the emphasis the editor writes', () => {
    expect(md('<p><b>bold</b> and <i>italic</i></p>')).toBe('**bold** and *italic*')
  })

  test('writes a strikethrough the way GitHub spells it', () => {
    expect(md('<p><del>gone</del></p>')).toBe('~~gone~~')
  })

  test('writes a bullet with one space after the marker', () => {
    expect(md('<ul><li>one</li><li>two</li></ul>')).toBe('- one\n- two')
  })

  test('numbers an ordered list from where it says it starts', () => {
    expect(md('<ol start="3"><li>three</li><li>four</li></ol>')).toBe('3. three\n4. four')
  })

  test('lines a nested list up under the text above it', () => {
    expect(md('<ul><li>outer<ul><li>inner</li></ul></li></ul>')).toBe('- outer\n  - inner')
  })

  test('keeps a task list ticked', () => {
    const html =
      '<ul><li><input type="checkbox" checked> done</li><li><input type="checkbox"> todo</li></ul>'

    expect(md(html)).toBe('- [x] done\n- [ ] todo')
  })

  test('writes a table as a pipe table', () => {
    const html = '<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>'
    expect(md(html)).toContain('| a | b |')
    expect(md(html)).toContain('| 1 | 2 |')
  })

  test('writes a rule the way the tokens do', () => {
    expect(md('<p>a</p><hr><p>b</p>')).toBe('a\n\n---\n\nb')
  })

  test('marks a quotation', () => {
    expect(md('<blockquote><p>said</p></blockquote>')).toBe('> said')
  })
})

describe('code', () => {
  test('fences a block with the language its class names', () => {
    expect(md('<pre><code class="language-ts">const a = 1</code></pre>')).toBe(
      '```ts\nconst a = 1\n```',
    )
  })

  test('reads the older spelling of that class', () => {
    expect(md('<pre><code class="lang-py">x = 1</code></pre>')).toBe('```py\nx = 1\n```')
  })

  test('reads the class off the block when the code carries none', () => {
    expect(md('<pre class="language-go"><code>x := 1</code></pre>')).toBe('```go\nx := 1\n```')
  })

  test('fences a preformatted block with no code element in it', () => {
    expect(md('<pre>$ ls\nfile</pre>')).toBe('```\n$ ls\nfile\n```')
  })

  test('opens a longer fence than the code closes', () => {
    expect(md('<pre><code>a ``` b</code></pre>')).toBe('````\na ``` b\n````')
  })

  test('leaves an empty block out', () => {
    expect(md('<pre>  </pre>')).toBe('')
  })

  test('keeps inline code inline', () => {
    expect(md('<p>the <code>id</code> field</p>')).toBe('the `id` field')
  })
})

describe('pictures', () => {
  test('numbers each one and says where it is', () => {
    const { markdown, images } = toMarkdown(
      '<p><img src="https://a.example/one.png" alt="One"></p>',
    )

    expect(markdown).toBe('![One](nib:0)')
    expect(images).toEqual(['https://a.example/one.png'])
  })

  test('gives the same picture twice the same number', () => {
    const html =
      '<p><img src="https://a.example/x.png"></p><p><img src="https://a.example/x.png"></p>'
    const { markdown, images } = toMarkdown(html)

    expect(images).toEqual(['https://a.example/x.png'])
    expect(markdown).toBe('![](nib:0)\n\n![](nib:0)')
  })

  test('leaves a picture with nowhere to point out', () => {
    expect(md('<p>before<img alt="none">after</p>')).toBe('beforeafter')
  })

  test('cannot let alt text break out of its own brackets', () => {
    const { markdown } = toMarkdown('<img src="https://a.example/x.png" alt="a ] b [ c">')
    expect(markdown).toBe('![a \\] b \\[ c](nib:0)')
  })

  test('flattens alt text onto one line', () => {
    const { markdown } = toMarkdown('<img src="https://a.example/x.png" alt="two\n  lines">')
    expect(markdown).toBe('![two lines](nib:0)')
  })
})

describe('filling the numbers in', () => {
  test('puts each address where its number was', () => {
    expect(
      fill('![a](nib:0) and ![b](nib:1)', ['https://x.example/a.png', 'https://x.example/b.png']),
    ).toBe('![a](https://x.example/a.png) and ![b](https://x.example/b.png)')
  })

  test('leaves a number nobody has an address for alone', () => {
    expect(fill('![a](nib:7)', ['https://x.example/a.png'])).toBe('![a](nib:7)')
  })

  test('encodes an address with a space in it', () => {
    expect(fill('![a](nib:0)', ['https://x.example/a b.png'])).toBe(
      '![a](https://x.example/a%20b.png)',
    )
  })

  test('leaves the same shape in prose alone', () => {
    expect(fill('the token nib:0 is not a link', ['https://x.example/a.png'])).toBe(
      'the token nib:0 is not a link',
    )
  })

  // Wikipedia writes them, so this is an ordinary address rather than an
  // adversarial one; unescaped, the link ends at the first bracket and the rest
  // of the address turns into prose.
  test('encodes the brackets that would end the link', () => {
    expect(fill('![a](nib:0)', ['https://x.example/File_(1).png'])).toBe(
      '![a](https://x.example/File_%281%29.png)',
    )
  })

  test('cannot have markdown of its own put after the link', () => {
    expect(fill('![a](nib:0)', ['https://x.example/a.png)![](https://evil.example/b.png'])).toBe(
      '![a](https://x.example/a.png%29!%5B%5D%28https://evil.example/b.png)',
    )
  })
})

describe('what never reaches a note', () => {
  test('a script, even one the cleaning missed', () => {
    expect(md('<p>a</p><script>alert(1)</script>')).toBe('a')
  })

  test('a stylesheet', () => {
    expect(md('<style>p{color:red}</style><p>a</p>')).toBe('a')
  })

  test('an embedded player', () => {
    expect(md('<p>a</p><iframe src="https://player.example"></iframe>')).toBe('a')
  })
})

describe('tidying up', () => {
  test('never leaves more than one blank line', () => {
    expect(md('<p>a</p><div></div><div></div><p>b</p>')).toBe('a\n\nb')
  })

  test('answers nothing for nothing', () => {
    expect(toMarkdown('')).toEqual({ markdown: '', images: [] })
    expect(toMarkdown('   ')).toEqual({ markdown: '', images: [] })
  })
})
