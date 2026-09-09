import { describe, expect, test } from 'vitest'
import { htmlToMarkdown, NEVER } from './from-html'

describe('a page as markdown', () => {
  test('headings and emphasis become markdown', () => {
    expect(htmlToMarkdown('<h2>Title</h2><p><strong>bold</strong> and <em>italic</em></p>')).toBe(
      '## Title\n\n**bold** and *italic*',
    )
  })

  test('links keep their target', () => {
    expect(htmlToMarkdown('<a href="https://x.dev">site</a>')).toBe('[site](https://x.dev)')
  })

  /** The markers are the editor's own: one space after a bullet, not three. Both
   *  converters used to have their own opinion about this, and a page pasted into
   *  a note came out differently from the same page clipped into one. */
  test('lists get the markers the editor itself writes', () => {
    expect(htmlToMarkdown('<ul><li>one</li><li>two</li></ul>')).toBe('- one\n- two')
  })

  test('a numbered list keeps the number it started on', () => {
    expect(htmlToMarkdown('<ol start="3"><li>three</li><li>four</li></ol>')).toBe(
      '3. three\n4. four',
    )
  })

  test('nested lines line up under the text above them', () => {
    expect(htmlToMarkdown('<ul><li>one<ul><li>under</li></ul></li></ul>')).toBe('- one\n  - under')
  })

  test('a ticked item keeps one space between its box and its words', () => {
    expect(htmlToMarkdown('<ul><li><input type="checkbox" checked>done</li></ul>')).toBe(
      '- [x] done',
    )
  })

  test('code blocks keep their fence and the language the page named', () => {
    const markdown = htmlToMarkdown('<pre><code class="language-ts">let x = 1</code></pre>')
    expect(markdown).toBe('```ts\nlet x = 1\n```')
  })

  test('a fence long enough to hold code that is itself full of backticks', () => {
    const markdown = htmlToMarkdown('<pre><code>a ``` b</code></pre>')
    expect(markdown).toBe('````\na ``` b\n````')
  })

  test('a preformatted block with no code element inside it still fences', () => {
    expect(htmlToMarkdown('<pre>  indented\n  lines</pre>')).toBe('```\n  indented\n  lines\n```')
  })

  test('tables survive, via the GFM rules', () => {
    const markdown = htmlToMarkdown(
      '<table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
    )
    expect(markdown).toContain('| a | b |')
    expect(markdown).toContain('| 1 | 2 |')
  })

  test('strikethrough comes back as the two tildes GitHub uses', () => {
    expect(htmlToMarkdown('<del>gone</del>')).toBe('~~gone~~')
  })

  test('highlighted text keeps its markdown form', () => {
    expect(htmlToMarkdown('<mark>kept</mark>')).toBe('==kept==')
  })

  test('underline has no markdown, so the tag stays', () => {
    expect(htmlToMarkdown('<u>under</u>')).toBe('<u>under</u>')
  })

  test('scripts, styles and a page title are dropped', () => {
    const markdown = htmlToMarkdown(
      '<title>Tab</title><p>text</p><script>window.x = 1</script><style>p{}</style>',
    )
    expect(markdown).toBe('text')
  })

  /** Five of them cannot be given words to lose: an HTML parser moves what the head
   *  holds out of the body before any converter sees it, and `embed` is void, so
   *  words written after it are the paragraph's rather than its own. The head is
   *  answered by the test above instead. */
  test('every element on the list is refused', () => {
    const childless = new Set(['head', 'meta', 'link', 'title', 'embed'])

    for (const tag of NEVER) {
      if (childless.has(tag)) continue
      expect(htmlToMarkdown(`<p>kept</p><${tag}>gone</${tag}>`), tag).toBe('kept')
    }
  })

  test('images become markdown images', () => {
    expect(htmlToMarkdown('<img src="a.png" alt="alt">')).toBe('![alt](a.png)')
  })

  test('alt text cannot break out of its own brackets', () => {
    expect(htmlToMarkdown('<img src="a.png" alt="a [b] c">')).toBe('![a \\[b\\] c](a.png)')
  })

  /** The backslash was the way out of the brackets that was left. Escaping only
   *  the brackets, alt text ending in one escaped the escape instead: the words
   *  closed early, the address the picture came with became the text after them,
   *  and the picture in the note pointed at the host the alt text named. */
  test('a backslash in alt text cannot escape the escaping', () => {
    expect(
      htmlToMarkdown('<img src="https://x.test/ok.png" alt="a\\](https://evil.test/b.png)![b">'),
    ).toBe('![a\\\\\\](https://evil.test/b.png)!\\[b](https://x.test/ok.png)')
  })

  test('an image with no address is nothing to point at', () => {
    expect(htmlToMarkdown('<p>before<img alt="none">after</p>')).toBe('beforeafter')
  })

  /** A page's own words are words, and a page showing what a tag looks like is
   *  the commonest thing anyone copies. Left alone, the `<` came through as
   *  markup: the note then held a tag its writer never wrote, and the reading
   *  view, an export and a canvas card all render a note's own HTML. So a `<`
   *  that would open a tag arrives escaped, which is how markdown writes one. */
  test('text that looks like a tag stays text', () => {
    expect(htmlToMarkdown('<p>a &lt;img src=q onerror=alert(1)&gt; b</p>')).toBe(
      'a \\<img src=q onerror=alert(1)> b',
    )
    expect(htmlToMarkdown('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')).toBe(
      '\\<script>alert(1)\\</script>',
    )
    expect(htmlToMarkdown('<h1>&lt;b&gt;shout&lt;/b&gt;</h1>')).toBe('# \\<b>shout\\</b>')
  })

  /** Only a `<` that would open something. `a < b` is arithmetic, and escaping
   *  it would put a backslash in front of every comparison a note quotes. */
  test('a lone angle bracket is left as it was typed', () => {
    expect(htmlToMarkdown('<p>1 &lt; 2 and 3 &gt; 2</p>')).toBe('1 < 2 and 3 > 2')
  })

  /** Code says what it says. Turndown hands a fence its own text rather than the
   *  escaped kind, and the fence keeps it that way. */
  test('a tag inside code keeps its brackets', () => {
    expect(htmlToMarkdown('<pre><code>&lt;img src=q&gt;</code></pre>')).toBe(
      '```\n<img src=q>\n```',
    )
  })

  /** The address is the other way text reached the page as markup: a `)` ends the
   *  destination early, and whatever followed it in the attribute was written
   *  into the note as its own markdown - a second picture, pointing at a host the
   *  pasted HTML chose. Percent encoded, the whole attribute is one address. */
  test('an address cannot break out of its own brackets', () => {
    expect(
      htmlToMarkdown('<img alt="a" src="https://x.test/a.png)![](https://evil.test/b.png">'),
    ).toBe('![a](https://x.test/a.png%29![]%28https://evil.test/b.png)')

    expect(htmlToMarkdown('<img alt="a" src="x)<img src=q onerror=alert(1)>">')).toBe(
      '![a](x%29%3Cimg%20src=q%20onerror=alert%281%29%3E)',
    )
  })

  /** Escaping the brackets left the escape itself: a `\` the page put in the
   *  address escaped the backslash that was protecting the bracket, and the
   *  bracket ended the destination after all. */
  test('a backslash in an address cannot escape the escaping', () => {
    expect(
      htmlToMarkdown('<img alt="a" src="https://x.test/a.png\\)![](https://evil.test/b.png">'),
    ).toBe('![a](https://x.test/a.png%5C%29![]%28https://evil.test/b.png)')
  })

  /** An address with brackets in it is ordinary rather than adversarial -
   *  Wikipedia writes them - and the note has to hold it as the one address it
   *  is. Encoded rather than escaped, because what is being written is a URL and
   *  a URL says the same thing either way. */
  test('the brackets an ordinary address carries survive as one address', () => {
    expect(htmlToMarkdown('<img alt="a" src="https://x.test/File_(1).png">')).toBe(
      '![a](https://x.test/File_%281%29.png)',
    )
  })

  /** And an address with a space in it is one address, not an address and a
   *  title: written bare it used to leave the picture as four words of prose. A
   *  tab or a control character ends a destination the same way. */
  test('a blank in an address cannot end it', () => {
    expect(htmlToMarkdown('<img alt="a" src="my picture.png">')).toBe('![a](my%20picture.png)')
    expect(htmlToMarkdown('<img alt="a" src="a&#9;b.png">')).toBe('![a](a%09b.png)')
  })

  /** An address that already carries escapes is left as the address it was: the
   *  percent is not encoded again, so `a%20b.png` stays one file rather than
   *  becoming a name with `%2520` in it. */
  test('an address that is already encoded is not encoded twice', () => {
    expect(htmlToMarkdown('<img alt="a" src="https://x.test/a%20b.png">')).toBe(
      '![a](https://x.test/a%20b.png)',
    )
  })

  test('an address a caller chose is encoded the same way', () => {
    expect(htmlToMarkdown('<img alt="a" src="a.png">', { image: () => 'one two.png' })).toBe(
      '![a](one%20two.png)',
    )
  })

  /** A picture says two things here and no more. A title would be a third string
   *  to break out of, and the quote that opens it is on any page that quotes
   *  somebody; it would also sit between the brackets the clipper fills its
   *  numbers in by. So the page's own is dropped. */
  test('a title is not markdown a page can write', () => {
    expect(
      htmlToMarkdown('<img alt="a" src="a.png" title="he said &quot;hi&quot;) ![](b.png">'),
    ).toBe('![a](a.png)')
  })

  /** What the clipper needs: the bytes are still on the site when the conversion
   *  runs, so it numbers the pictures and fills the addresses in afterwards. */
  test('a caller can say what a picture becomes', () => {
    const seen: string[] = []
    const markdown = htmlToMarkdown(
      '<p><img src="a.png" alt="one"></p><p><img src="b.png" alt="two"></p>',
      { image: (source) => `nib:${seen.push(source) - 1}` },
    )

    expect(markdown).toBe('![one](nib:0)\n\n![two](nib:1)')
    expect(seen).toEqual(['a.png', 'b.png'])
  })

  test('nothing in, nothing out', () => {
    expect(htmlToMarkdown('')).toBe('')
    expect(htmlToMarkdown('   \n  ')).toBe('')
  })

  test('runs of blank lines are one blank line', () => {
    expect(htmlToMarkdown('<p>one</p><p></p><p></p><p>two</p>')).toBe('one\n\ntwo')
  })
})
