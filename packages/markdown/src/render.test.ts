import { describe, expect, test } from 'vitest'
import {
  codeBlocks,
  documentTitle,
  frontMatter,
  frontMatterValue,
  renderMarkdown,
  stripFrontMatter,
} from './index'

describe('front matter', () => {
  test('is not rendered', () => {
    expect(renderMarkdown('---\ntitle: Hi\n---\n\nBody.\n')).not.toContain('title: Hi')
    expect(renderMarkdown('---\ntitle: Hi\n---\n\nBody.\n')).toContain('Body.')
  })

  test('can be read on its own', () => {
    expect(frontMatter('---\ntitle: Hi\n---\n\nBody')).toBe('title: Hi')
    expect(frontMatter('No front matter')).toBeNull()
  })

  test('leaves a document without it alone', () => {
    expect(stripFrontMatter('# Title')).toBe('# Title')
  })

  test('answers a single field', () => {
    const source = '---\ntitle: "Field Notes"\nauthor: Ada\nexport:\n  paper: A5\n---\n\nBody'

    expect(frontMatterValue(source, 'title')).toBe('Field Notes')
    expect(frontMatterValue(source, 'author')).toBe('Ada')
    expect(frontMatterValue(source, 'paper')).toBeNull()
    expect(frontMatterValue(source, 'missing')).toBeNull()
    expect(frontMatterValue('# No matter', 'title')).toBeNull()
  })
})

describe('titles', () => {
  test('reads the first heading', () => {
    expect(documentTitle('---\na: b\n---\n\n# Real title\n\ntext')).toBe('Real title')
  })

  test('is null when there is no heading', () => {
    expect(documentTitle('just text')).toBeNull()
  })
})

describe('GitHub-flavoured basics', () => {
  test('renders headings, emphasis and code', () => {
    const html = renderMarkdown('# H\n\n**b** *i* `c`')
    expect(html).toContain('<h1>H</h1>')
    expect(html).toContain('<strong>b</strong>')
    expect(html).toContain('<em>i</em>')
    expect(html).toContain('<code>c</code>')
  })

  test('renders tables', () => {
    const html = renderMarkdown('| a | b |\n| - | - |\n| 1 | 2 |')
    expect(html).toContain('<table>')
    expect(html).toContain('<td>1</td>')
  })

  test('renders task lists', () => {
    const html = renderMarkdown('- [x] done\n- [ ] open')
    expect(html).toContain('checked')
  })

  test('marks task items so a stylesheet can draw them', () => {
    const html = renderMarkdown('- [x] done\n- [ ] open\n- plain')

    expect(html).toContain('<li class="task-list-item is-done"><input checked=""')
    expect(html).toContain('<li class="task-list-item"><input disabled=""')
    expect(html).toContain('<li>plain</li>')
  })

  test('marks a link whose text is its address', () => {
    const html = renderMarkdown('See <https://a.dev> or https://b.dev or [here](https://c.dev).')

    expect(html).toContain('<a class="url" href="https://a.dev">https://a.dev</a>')
    expect(html).toContain('<a class="url" href="https://b.dev">https://b.dev</a>')
    expect(html).toContain('<a href="https://c.dev">here</a>')
  })
})

describe('headings and the table of contents', () => {
  const SOURCE =
    '# Title\n\n[toc]\n\n## Two words\n\n### Deeper, *with* `code`\n\n## Two words\n\nText'

  test('are plain by default', () => {
    const html = renderMarkdown(SOURCE)
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<p>[toc]</p>')
  })

  test('get ids from their text when asked', () => {
    const html = renderMarkdown(SOURCE, { toc: true })
    expect(html).toContain('<h1 id="title">Title</h1>')
    expect(html).toContain('<h2 id="two-words">Two words</h2>')
    expect(html).toContain('<h3 id="deeper-with-code">Deeper, <em>with</em> <code>code</code></h3>')
  })

  test('keep ids apart when two headings read the same', () => {
    const html = renderMarkdown(SOURCE, { toc: true })
    expect(html).toContain('<h2 id="two-words-1">Two words</h2>')
  })

  test('turn [toc] into nested links', () => {
    const html = renderMarkdown(SOURCE, { toc: true })
    expect(html).not.toContain('[toc]')
    expect(html).toContain('<nav class="toc">')
    expect(html).toContain('<a href="#title">Title</a>')
    expect(html).toContain('<a href="#deeper-with-code">Deeper, with code</a>')
    expect(html).toMatch(
      /<li><a href="#two-words">Two words<\/a>\n?<ul>\n?<li><a href="#deeper-with-code">/,
    )
  })

  test('accept [TOC] in capitals, as Typora does', () => {
    expect(renderMarkdown('# A\n\n[TOC]\n', { toc: true })).toContain('<nav class="toc">')
  })

  test('leave a [toc] in running text alone', () => {
    expect(renderMarkdown('see [toc] here', { toc: true })).toContain('see [toc] here')
  })

  test('render nothing for a [toc] in a document without headings', () => {
    expect(renderMarkdown('[toc]\n\ntext', { toc: true })).not.toContain('<nav')
  })
})

describe('code fences', () => {
  test('are listed with their language', () => {
    const blocks = codeBlocks(
      '```js\nlet a\n```\n\n- item\n\n  ```mermaid\n  graph TD\n  ```\n\n```\nplain\n```',
    )

    expect(blocks).toEqual([
      { language: 'js', code: 'let a' },
      { language: 'mermaid', code: 'graph TD' },
      { language: '', code: 'plain' },
    ])
  })

  test('can be taken over by the caller', () => {
    const html = renderMarkdown('```mermaid\ngraph TD\n```\n\n```js\nlet a = 1 < 2\n```', {
      code: (code, language) => (language === 'mermaid' ? `<figure>${code}</figure>` : null),
    })

    expect(html).toContain('<figure>graph TD</figure>')
    expect(html).toContain('<pre><code class="language-js">let a = 1 &lt; 2\n</code></pre>')
  })

  test('renders strikethrough', () => {
    expect(renderMarkdown('~~gone~~')).toContain('<del>gone</del>')
  })
})

describe('Typora extensions', () => {
  test('highlights', () => {
    expect(renderMarkdown('a ==marked== b')).toContain('<mark>marked</mark>')
  })

  test('subscript and superscript', () => {
    const html = renderMarkdown('H~2~O and X^2^')
    expect(html).toContain('<sub>2</sub>')
    expect(html).toContain('<sup>2</sup>')
  })

  test('inline math', () => {
    const html = renderMarkdown('mass $E=mc^2$ here')
    expect(html).toContain('math-inline')
    expect(html).toContain('katex')
  })

  test('block math', () => {
    const html = renderMarkdown('$$\nE = mc^2\n$$\n')
    expect(html).toContain('math-block')
  })

  /** A whole line of `$$…$$` is how a formula is usually typed, and every other
   *  editor reads it that way. It used to come out as an inline formula with a
   *  literal dollar on each side of it. */
  test('block math written on one line', () => {
    const html = renderMarkdown('$$E = mc^2$$\n')

    expect(html).toContain('math-block')
    expect(html).not.toContain('math-inline')
    expect(html).not.toContain('$')
  })

  test('block math on one line among prose', () => {
    const html = renderMarkdown('Before.\n\n$$E = mc^2$$\n\nAfter.\n')

    expect(html).toContain('<p>Before.</p>')
    expect(html).toContain('math-block')
    expect(html).toContain('<p>After.</p>')
  })

  test('a one line block that is not the whole line is left alone', () => {
    // Display maths is a block; `$$` part way along a line is somebody's prose.
    const html = renderMarkdown('The sum $$E = mc^2$$ sits here.\n')

    expect(html).not.toContain('math-block')
  })

  test('an empty pair of double dollars is not a formula', () => {
    expect(renderMarkdown('$$$$\n')).not.toContain('math-block')
  })

  test('renders chemical equations', () => {
    const html = renderMarkdown('$\\ce{H2O}$')
    expect(html).toContain('katex')
    // mhchem splits the formula into atoms and a subscript.
    expect(html).toContain('H')
    expect(html).not.toContain('ParseError')
  })

  test('leaves a lone dollar alone', () => {
    expect(renderMarkdown('costs $5 and $9')).not.toContain('katex')
  })

  /** A formula says how big its own rules and struts are, and a note is not
   *  always the reader's own: one arrives from a share, from a room, or is
   *  published to strangers. Left uncapped, one line of TeX was a box tens of
   *  thousands of ems tall, which is a page nobody can read or scroll. */
  test('a formula cannot ask for a box bigger than the page', () => {
    const html = renderMarkdown('$$\\rule{99999em}{99999em}$$')
    expect(html).toContain('katex')
    expect(html).not.toContain('99999em')
    for (const size of html.matchAll(/(\d+(?:\.\d+)?)em/g)) {
      expect(Number(size[1])).toBeLessThanOrEqual(100)
    }
  })

  test('emoji shortcodes become characters', () => {
    expect(renderMarkdown('ship it :rocket:')).toContain('🚀')
    expect(renderMarkdown('ship it :rocket:')).not.toContain(':rocket:')
  })

  test('a lone colon is left alone', () => {
    expect(renderMarkdown('note: this stays')).toContain('note: this stays')
  })

  test('an unknown shortcode is left as written', () => {
    expect(renderMarkdown(':not_an_emoji_name:')).toContain(':not_an_emoji_name:')
  })

  test('callouts become labelled blocks', () => {
    const html = renderMarkdown('> [!WARNING]\n> Careful.\n')
    expect(html).toContain('data-kind="warning"')
    expect(html).toContain('Careful.')
    expect(html).not.toContain('[!WARNING]')
  })

  test('an ordinary quote stays a quote', () => {
    const html = renderMarkdown('> Just a quote.\n')
    expect(html).toContain('<blockquote>')
    expect(html).not.toContain('callout')
  })

  test('footnotes link both ways', () => {
    const html = renderMarkdown('Text[^1].\n\n[^1]: The note.\n', { footnotes: true })
    expect(html).toContain('id="fnref-1"')
    expect(html).toContain('id="fn-1"')
    expect(html).toContain('<section class="footnotes">')
  })
})

describe('raw HTML', () => {
  // Typora passes inline HTML through, and so does this - embeds are a feature
  // of a local document.
  test('is preserved for local use', () => {
    expect(renderMarkdown('<u>underlined</u>')).toContain('<u>underlined</u>')
    expect(renderMarkdown('<video src="clip.mp4"></video>')).toContain('<video')
  })

  // A published note is served to strangers, and every blog on the shared
  // domain would otherwise be able to script every other one.
  test('is shown as text when publishing', () => {
    const html = renderMarkdown('<script>alert(1)</script>', { escapeHtml: true })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  test('escapes inline HTML too', () => {
    const html = renderMarkdown('text <img src=x onerror=alert(1)> more', { escapeHtml: true })
    expect(html).not.toContain('onerror=alert(1)>')
    expect(html).toContain('&lt;img')
  })

  test('markdown itself still renders when publishing', () => {
    const html = renderMarkdown('# Title\n\n**bold** and [a link](https://x.dev)', {
      escapeHtml: true,
    })
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('href="https://x.dev"')
  })
})

describe('definition lists', () => {
  test('renders a term and its meaning', () => {
    expect(renderMarkdown('Markdown\n: A way of writing.\n')).toContain('<dt>Markdown</dt>')
    expect(renderMarkdown('Markdown\n: A way of writing.\n')).toContain(
      '<dd>A way of writing.</dd>',
    )
  })

  test('takes several meanings for one term', () => {
    const html = renderMarkdown('Nib\n: A pen tip.\n: This editor.\n')
    expect(html.match(/<dd>/g)).toHaveLength(2)
  })

  test('takes several terms in one list', () => {
    const html = renderMarkdown('One\n: first\n\nTwo\n: second\n')
    expect(html.match(/<dt>/g)).toHaveLength(2)
  })

  test('formats inside a term and a meaning', () => {
    const html = renderMarkdown('**Bold**\n: with *emphasis*\n')
    expect(html).toContain('<dt><strong>Bold</strong></dt>')
    expect(html).toContain('<em>emphasis</em>')
  })

  test('leaves a plain paragraph alone', () => {
    const html = renderMarkdown('Just a line of prose.\n')
    expect(html).not.toContain('<dl>')
  })

  test('leaves a colon in prose alone', () => {
    expect(renderMarkdown('Note: this is prose.\n')).not.toContain('<dl>')
  })
})

describe('abbreviations', () => {
  const SOURCE = '*[HTML]: HyperText Markup Language\n\nI write HTML every day.\n'

  test('expands a defined word', () => {
    expect(renderMarkdown(SOURCE)).toContain('<abbr title="HyperText Markup Language">HTML</abbr>')
  })

  test('does not print the definition itself', () => {
    expect(renderMarkdown(SOURCE)).not.toContain('*[HTML]')
  })

  test('works when the definition comes after the use', () => {
    const html = renderMarkdown('I write HTML.\n\n*[HTML]: HyperText Markup Language\n')
    expect(html).toContain('<abbr title="HyperText Markup Language">HTML</abbr>')
  })

  test('leaves code alone', () => {
    const html = renderMarkdown('*[HTML]: HyperText Markup Language\n\n`HTML` and HTML\n')
    expect(html).toContain('<code>HTML</code>')
    expect(html.match(/<abbr/g)).toHaveLength(1)
  })

  test('does not reach inside an attribute', () => {
    const html = renderMarkdown('*[HTML]: Markup\n\n[link](https://e.com/HTML)\n')
    expect(html).toContain('href="https://e.com/HTML"')
  })

  test('matches whole words only', () => {
    const html = renderMarkdown('*[IT]: Information Technology\n\nlittle bits\n')
    expect(html).not.toContain('<abbr')
  })

  test('prefers the longer of two definitions', () => {
    const html = renderMarkdown('*[HTML]: Markup\n*[HTML5]: Newer markup\n\nHTML5 is here.\n')
    expect(html).toContain('<abbr title="Newer markup">HTML5</abbr>')
  })

  test('escapes what it puts in the title', () => {
    const html = renderMarkdown('*[X]: a "quoted" <thing>\n\nX marks it.\n')
    expect(html).toContain('&quot;quoted&quot;')
    expect(html).not.toContain('<thing>')
  })

  test('a definition inside a fence defines nothing', () => {
    // A note explaining the syntax shows the syntax, and showing it must not
    // also do it - which is the rule the block tokenizer already follows.
    const html = renderMarkdown('```\n*[HTML]: Markup\n```\n\nHTML here.\n')
    expect(html).not.toContain('<abbr')
    expect(html).toContain('*[HTML]: Markup')
  })
})

/** Everything a note contains is written by whoever wrote the note, and a
 *  published one is served to strangers from a domain shared with every other
 *  blog. Escaping raw HTML is not enough on its own: a construct that builds
 *  its own markup out of the source, or writes a target the author chose into
 *  an attribute, is a way straight past it. Each case below was one. */
describe('what a note cannot do to the page around it', () => {
  const published = (source: string) => renderMarkdown(source, { escapeHtml: true })

  test('subscript and superscript are text, not markup', () => {
    expect(published('H~<img src=x onerror=alert(1)>~O')).not.toContain('<img src=x')
    expect(published('X^<img src=x onerror=alert(1)>^')).not.toContain('<img src=x')
    expect(published('a ~</p><script>alert(1)</script>~ b')).not.toContain('<script>')
  })

  test('subscript and superscript still render what they are for', () => {
    const html = published('H~2~O and X^2^')
    expect(html).toContain('<sub>2</sub>')
    expect(html).toContain('<sup>2</sup>')
  })

  /** No element carries an event handler. The name itself may well appear in
   *  the page, as the words of the link a footnote shows; what matters is that
   *  it stays inside the attribute, or inside the text, it was put in. */
  const noHandlers = (html: string) => expect(html).not.toMatch(/<[a-z]+[^>]*\son[a-z]+\s*=/i)

  test('a footnote name cannot break out of the attribute it sits in', () => {
    const html = published('Text[^a"onmouseover=alert(1)].')
    noHandlers(html)
    expect(html).not.toContain('"onmouseover')
  })

  test('a footnote name cannot open a tag of its own', () => {
    expect(published('Text[^<svg/onload=alert(1)>].')).not.toContain('<svg')
    noHandlers(published('T[^x].\n\n[^x"onmouseover=alert(1)]: note\n'))
  })

  test('a footnote still links both ways with an ordinary name', () => {
    const html = renderMarkdown('Text[^note-1].\n\n[^note-1]: The note.\n', { footnotes: true })
    expect(html).toContain('id="fnref-note-1"')
    expect(html).toContain('href="#fn-note-1"')
    expect(html).toContain('id="fn-note-1"')
  })

  test('a link cannot carry a scheme the browser would run', () => {
    for (const target of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'vbscript:msgbox(1)',
      'data:text/html,<script>alert(1)</script>',
    ]) {
      const html = published(`[click](${target})`)
      expect(html, target).not.toContain('href=')
      expect(html).toContain('click')
    }
  })

  test('an entity in a target cannot grow into a scheme', () => {
    // These name no scheme as written, and would name one by the time anyone
    // clicked them. What stops them is the ampersand itself being escaped, so
    // the entity never forms.
    for (const target of ['javascript&colon;alert(1)', '&#106;avascript:alert(1)']) {
      const html = published(`[click](${target})`)
      expect(html, target).toContain('&amp;')
      expect(html, target).not.toMatch(/href="[^"]*javascript:/i)
    }
  })

  test('an image cannot either', () => {
    expect(published('![x](javascript:alert(1))')).not.toContain('src=')
    expect(published('![x](data:text/html,<script>alert(1)</script>)')).not.toContain('src=')
  })

  test('an autolink cannot either', () => {
    expect(published('<javascript:alert(1)>')).not.toContain('href=')
  })

  test('the links people actually write still work', () => {
    expect(published('[a](https://x.dev/p?q=1)')).toContain('href="https://x.dev/p?q=1"')
    expect(published('[a](http://x.dev)')).toContain('href="http://x.dev"')
    expect(published('[a](mailto:me@x.dev)')).toContain('href="mailto:me@x.dev"')
    expect(published('[a](#heading)')).toContain('href="#heading"')
    expect(published('[a](notes/other.md)')).toContain('href="notes/other.md"')
    expect(published('![a](pictures/cat.png)')).toContain('src="pictures/cat.png"')
    expect(published('![a](data:image/png;base64,iVBORw0KGgo=)')).toContain('src="data:image/png')
  })

  test('a link with no target yet is words, not a link to this page', () => {
    // `insertLink` writes `[label]()` and puts the caret in the empty target, so
    // a note saved mid-edit has one. An `href=""` points at the page it is on,
    // which is a worse answer than showing the label.
    const html = published('[label]()')
    expect(html).toContain('label')
    expect(html).not.toContain('href')
  })

  test('an ampersand in a URL is written as one entity', () => {
    const html = published('[a](https://x.dev/?a=1&b=2)')
    expect(html).toContain('href="https://x.dev/?a=1&amp;b=2"')
    expect(html).not.toContain('&amp;amp;')
  })
})

/** Every construct that can put a target or a piece of markup into the page,
 *  each with something hostile in it, and one check applied to all of them. A
 *  sweep rather than a case: it says nothing about what the output looks like,
 *  only that nothing in it can run. New constructs belong on this list. */
const HOSTILE = [
  '[a](javascript:alert(1))',
  '[a](  javascript:alert(1))',
  '[a](JAVASCRIPT:alert(1))',
  '[a](vbscript:msgbox(1))',
  '[a](data:text/html,BODY)',
  '<javascript:alert(1)>',
  '![a](javascript:alert(1))',
  '![a"onerror=alert(1)](x.png)',
  '![a](x.png "t\\"onerror=alert(1)")',
  '[a](x.md "t\\"onmouseover=alert(1)")',
  'H~IMG~O',
  'X^IMG^',
  '==IMG==',
  'a[^IMG]b',
  'a[^x"onmouseover=alert(1)]b',
  '[^x"onmouseover=alert(1)]: note',
  '# a"onmouseover=alert(1) b',
  '[toc]\n\n# a"onmouseover=alert(1) b',
  '*[X]: a"onmouseover=alert(1)\n\nX here.\n',
  'Term\n: IMG\n',
  '> [!note]\n> IMG\n',
  '$\\href{javascript:alert(1)}{x}$',
  '$\\htmlId{a"onmouseover=alert(1)}{x}$',
  '| a | b |\n| - | - |\n| IMG | x |',
  ':IMG:',
]

/** What `IMG` in the list above stands for. Written as a placeholder so the
 *  list can also be run through the trusting renderer, which passes raw HTML
 *  through on purpose - a source that carries a tag proves nothing there. */
const IMG = '<img src=x onerror=alert(1)>'

/** No element carries an event handler, and no target names a scheme a browser
 *  would run. */
function running(html: string): string[] {
  const found: string[] = []
  if (/<[a-z]+[^>]*\son[a-z]+\s*=/i.test(html)) found.push('an element with an event handler')
  if (/(?:href|src)="[^"]*(?:javascript|vbscript|data:text|svg\+xml)/i.test(html)) {
    found.push('a target that would run')
  }
  return found
}

describe('the whole sweep', () => {
  test('nothing a note writes can run, when publishing', () => {
    for (const source of HOSTILE) {
      const html = renderMarkdown(source.replaceAll('IMG', IMG), {
        escapeHtml: true,
        footnotes: true,
        toc: true,
      })
      expect(running(html), source).toEqual([])
    }
  })

  test('nor when rendering for a local export, raw HTML aside', () => {
    // Raw HTML passes through here by design, so `IMG` stands for words instead:
    // what is left under test is every construct that builds its own markup, and
    // none of those has raw HTML as an excuse.
    for (const source of HOSTILE) {
      const html = renderMarkdown(source.replaceAll('IMG', 'plain words'), {
        footnotes: true,
        toc: true,
      })
      expect(running(html), source).toEqual([])
    }
  })
})
