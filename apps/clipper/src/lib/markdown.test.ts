import { describe, expect, test } from 'vitest'
import { toMarkdown } from './markdown'
import { fill } from './placeholders'

/** The markdown for a fragment, the way a clipped selection arrives: already
 *  cleaned and absolute, straight into the converter. */
const md = (html: string) => toMarkdown(html).markdown

/** What the conversion itself does - which shapes markdown has, what a fence
 *  says, what never reaches a note - is @nib/markdown/from-html's, and is tested
 *  there. Here is only that the clipper goes through it, and the one thing that is
 *  the clipper's own: a picture becomes a placeholder. */
describe('an article as markdown', () => {
  test('comes out as the converter writes it', () => {
    const html =
      '<h1>One</h1><p><b>bold</b> and <code>id</code></p><ul><li>a</li><li>b</li></ul>' +
      '<pre><code class="language-ts">let a = 1</code></pre><script>alert(1)</script>'

    expect(md(html)).toBe('# One\n\n**bold** and `id`\n\n- a\n- b\n\n```ts\nlet a = 1\n```')
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
    // The same answer the converter gives for the same address; see the
    // destination tests in @nib/markdown/from-html. Every bracket that could end
    // the destination is encoded, so what comes out is one picture.
    expect(fill('![a](nib:0)', ['https://x.example/a.png)![](https://evil.example/b.png'])).toBe(
      '![a](https://x.example/a.png%29![]%28https://evil.example/b.png)',
    )
  })

  test('leaves an address that already carries escapes as it is', () => {
    // `absolutise` writes `URL.href`, which is percent-encoded already. This used
    // to encode it a second time and save a picture nobody could fetch.
    expect(fill('![a](nib:0)', ['https://x.example/a%20b.png'])).toBe(
      '![a](https://x.example/a%20b.png)',
    )
    expect(fill('![a](nib:0)', ['https://x.example/caf%C3%A9.png'])).toBe(
      '![a](https://x.example/caf%C3%A9.png)',
    )
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
