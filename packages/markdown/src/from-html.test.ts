import katex from 'katex'
import { describe, expect, test } from 'vitest'
import { linearly } from './growth'
import { loadFor } from './engines'
import { htmlToMarkdown, NEVER, workDone } from './from-html'
import { renderMarkdown } from './index'

describe('a page as markdown', () => {
  test('headings and emphasis become markdown', () => {
    expect(htmlToMarkdown('<h2>Title</h2><p><strong>bold</strong> and <em>italic</em></p>')).toBe(
      '## Title\n\n**bold** and *italic*',
    )
  })

  test('links keep their target', () => {
    expect(htmlToMarkdown('<a href="https://x.dev">site</a>')).toBe('[site](https://x.dev)')
  })

  test('a tag comes back as the tag, whichever element drew it', () => {
    const read = renderMarkdown('Filed #work/nib and #reading', { tagHref: (tag) => `#${tag}` })
    expect(htmlToMarkdown(read)).toBe('Filed #work/nib and #reading')
    expect(htmlToMarkdown(renderMarkdown('#first words'))).toBe('#first words')
    expect(htmlToMarkdown('<p><a href="#idea" class="tag" target="_blank">#idea</a></p>')).toBe(
      '#idea',
    )
  })

  test('a tag class on anything else is left to the other rules', () => {
    expect(htmlToMarkdown('<a class="tag" href="https://x.dev/v1">v1.2 notes</a>')).toBe(
      '[v1.2 notes](https://x.dev/v1)',
    )
  })

  test('a target no surface would follow is not written down', () => {
    expect(htmlToMarkdown('<a href="javascript:alert(1)">click</a>')).toBe('click')
    expect(htmlToMarkdown('<a href="data:text/html,<b>hi">click</a>')).toBe('click')
    expect(htmlToMarkdown('<a href="vbscript:msgbox">click</a>')).toBe('click')
    expect(htmlToMarkdown('<a href="java&#9;script:alert(1)">click</a>')).toBe('click')
  })

  describe('a link into the app the note came from', () => {
    test('is words for a clip and a paste, which have no app to point back at', () => {
      expect(htmlToMarkdown('<a href="applenotes:note/ideas">Ideas</a>')).toBe('Ideas')
    })

    test('and stays a link for an import, exactly as it was written', () => {
      const kept = { appTargets: true }

      expect(htmlToMarkdown('<a href="applenotes:note/ideas">Ideas</a>', kept)).toBe(
        '[Ideas](applenotes:note/ideas)',
      )
      expect(htmlToMarkdown('<a href="bear://x-callback-url/open-note?id=1">Plan</a>', kept)).toBe(
        '[Plan](bear://x-callback-url/open-note?id=1)',
      )
      expect(htmlToMarkdown('<a href="evernote:///view/1/s1/abc/abc/">Note</a>', kept)).toBe(
        '[Note](evernote:///view/1/s1/abc/abc/)',
      )
    })

    test('and never one that runs code, whoever is asking', () => {
      const kept = { appTargets: true }

      expect(htmlToMarkdown('<a href="javascript:alert(1)">click</a>', kept)).toBe('click')
      expect(htmlToMarkdown('<a href="vbscript:msgbox">click</a>', kept)).toBe('click')
      expect(htmlToMarkdown('<a href="data:text/html,<b>hi">click</a>', kept)).toBe('click')
      expect(htmlToMarkdown('<a href="blob:https://x.dev/abc">click</a>', kept)).toBe('click')
      expect(htmlToMarkdown('<a href="java&#9;script:alert(1)">click</a>', kept)).toBe('click')
    })

    test('and a picture is still only ever a picture', () => {
      expect(
        htmlToMarkdown('<img src="applenotes:note/ideas" alt="a">', { appTargets: true }),
      ).toBe('')
    })

    test('while http, a path and a fragment are what they always were', () => {
      const kept = { appTargets: true }

      expect(htmlToMarkdown('<a href="https://x.dev">site</a>', kept)).toBe('[site](https://x.dev)')
      expect(htmlToMarkdown('<a href="notes/plan.md">plan</a>', kept)).toBe('[plan](notes/plan.md)')
      expect(htmlToMarkdown('<a href="#later">later</a>', kept)).toBe('[later](#later)')
    })
  })

  test('and neither is a picture that is a document rather than a picture', () => {
    expect(htmlToMarkdown('<img src="data:image/svg+xml,<svg onload=x>" alt="a">')).toBe('')
    expect(htmlToMarkdown('<img src="javascript:alert(1)" alt="a">')).toBe('')

    expect(htmlToMarkdown('<img src="data:image/png;base64,AAA" alt="a">')).toBe(
      '![a](data:image/png;base64,AAA)',
    )
  })

  test('and a file on the old machine survives for the caller that resolves one', () => {
    const html = '<p><img src="file:///Users/emil/photo.png"></p>'

    expect(htmlToMarkdown(html)).toBe('')
    expect(htmlToMarkdown(html, { fileTargets: true })).toBe('![](file:///Users/emil/photo.png)')

    const link = '<a href="file:///Users/emil/Notes/Other.html">other</a>'
    expect(htmlToMarkdown(link)).toBe('other')
    expect(htmlToMarkdown(link, { fileTargets: true })).toBe(
      '[other](file:///Users/emil/Notes/Other.html)',
    )
  })

  test('and a video, a recording or an embedded file is a link for the caller that keeps them', () => {
    const html = [
      '<p>Before</p>',
      '<video src="media/clip.mp4" controls>No player</video>',
      '<audio controls><source src="media/Voice%20memo.m4a"></audio>',
      '<embed src="media/paper.pdf">',
      '<object data="media/sheet.pdf"></object>',
      '<iframe src="media/page.html"></iframe>',
      '<video src="javascript:alert(1)"></video>',
    ].join('')

    expect(htmlToMarkdown(html)).toBe('Before')
    expect(htmlToMarkdown(html, { mediaLinks: true })).toBe(
      [
        'Before',
        '[clip.mp4](media/clip.mp4)',
        '[Voice memo.m4a](media/Voice%20memo.m4a)',
        '[paper.pdf](media/paper.pdf)',
        '[sheet.pdf](media/sheet.pdf)',
        '[page.html](media/page.html)',
      ].join('\n\n'),
    )
  })

  test('and the name such a link shows opens no markup and breaks no line', () => {
    const html =
      '<video src="media/%3Cstyle%3E*%7Bdisplay:none%7D%3C%2Fstyle%3E%0A%0A%23 x.mp4"></video>'
    const written = htmlToMarkdown(html, { mediaLinks: true })

    expect(written).not.toMatch(/(?<!\\)<(?=[A-Za-z/])/)
    expect(written).not.toContain('\n')
    expect(written).toMatch(/^\[.*\]\(media\/.*\)$/)
  })

  test('while that caller still gets no target a note could never follow', () => {
    expect(htmlToMarkdown('<a href="javascript:alert(1)">x</a>', { fileTargets: true })).toBe('x')
    expect(
      htmlToMarkdown('<img src="data:image/svg+xml,<svg>" alt="a">', { fileTargets: true }),
    ).toBe('')
  })

  test('while the ones a note is full of are', () => {
    expect(htmlToMarkdown('<a href="mailto:a@b.dev">mail</a>')).toBe('[mail](mailto:a@b.dev)')
    expect(htmlToMarkdown('<a href="/notes/Plan.md">plan</a>')).toBe('[plan](/notes/Plan.md)')
    expect(htmlToMarkdown('<a href="tel:+41000">ring</a>')).toBe('[ring](tel:+41000)')
  })

  test('an address cannot write a link of its own', () => {
    expect(htmlToMarkdown('<a href="https://x.test/a\\)[click](https://evil.test)">text</a>')).toBe(
      '[text](https://x.test/a%5C%29[click]%28https://evil.test%29)',
    )

    expect(htmlToMarkdown('<a href="https://x.test/a)[click](https://evil.test)">text</a>')).toBe(
      '[text](https://x.test/a%29[click]%28https://evil.test%29)',
    )
  })

  test("an address as a link's own text is drawn as its characters", () => {
    const cases = [
      'https://github.com/x/y/blob/main/pkg/__init__.py',
      'https://a.test/~al/~bo',
      'https://a.test/x/_y_/z',
      'https://a.test/?a=$x$',
    ]
    for (const address of cases) {
      const link = htmlToMarkdown(`<p><a href="${address}">${address}</a></p>`)
      const shown = address.replace(/&/g, '&amp;')
      expect(renderMarkdown(link)).toBe(`<p><a class="url" href="${shown}">${shown}</a></p>\n`)
    }
    expect(htmlToMarkdown('<a href="https://a.test/~al/~bo">https://a.test/~al/~bo</a>')).toBe(
      '[https://a.test/\\~al/\\~bo](https://a.test/~al/~bo)',
    )
  })

  test('a bare address beside a link is still kept as it was written', () => {
    const page = htmlToMarkdown(
      '<p>See <a href="https://x.test/">the site</a> or https://a.test/~al/_y_/ here</p>',
    )
    expect(page).toBe('See [the site](https://x.test/) or https://a.test/~al/_y_/ here')
    expect(renderMarkdown(page)).toBe(
      '<p>See <a href="https://x.test/">the site</a> or ' +
        '<a class="url" href="https://a.test/~al/_y_/">https://a.test/~al/_y_/</a> here</p>\n',
    )
  })

  test('an address as a link text cannot close its brackets', () => {
    const link = htmlToMarkdown(
      '<a href="https://x.test/ok">https://a.test/](https://evil.test)[b</a>',
    )
    expect(link).toBe('[https://a.test/\\](https://evil.test)\\[b](https://x.test/ok)')
    expect(renderMarkdown(link)).toBe(
      '<p><a href="https://x.test/ok">https://a.test/](https://evil.test)[b</a></p>\n',
    )
  })

  test('a backslash in a link text cannot close its brackets', () => {
    expect(htmlToMarkdown('<a href="https://x.test/ok">a\\](https://evil.test)[b</a>')).toBe(
      '[a\\\\\\](https://evil.test)\\[b](https://x.test/ok)',
    )
  })

  test('the brackets an ordinary address carries stay in the link', () => {
    expect(htmlToMarkdown('<a href="https://x.test/File_(1).html">t</a>')).toBe(
      '[t](https://x.test/File_%281%29.html)',
    )
  })

  test("a link's address is not encoded twice either", () => {
    expect(htmlToMarkdown('<a href="https://x.test/a%20b.html">t</a>')).toBe(
      '[t](https://x.test/a%20b.html)',
    )
  })

  test('a title cannot end its own quotes', () => {
    expect(htmlToMarkdown('<a href="https://x.test/ok" title="he said &quot;hi&quot;">t</a>')).toBe(
      '[t](https://x.test/ok "he said \\"hi\\"")',
    )

    expect(htmlToMarkdown('<a href="https://x.test/ok" title="ends in a\\">t</a>')).toBe(
      '[t](https://x.test/ok "ends in a\\\\")',
    )
  })

  test('lists get the markers the editor itself writes', () => {
    expect(htmlToMarkdown('<ul><li>one</li><li>two</li></ul>')).toBe('- one\n- two')
  })

  test('a numbered list keeps the number it started on', () => {
    expect(htmlToMarkdown('<ol start="3"><li>three</li><li>four</li></ol>')).toBe(
      '3. three\n4. four',
    )
  })

  test('a list of five thousand items is numbered without a pass each', () => {
    const items = 5000
    const html = `<ol>${Array.from({ length: items }, (_, at) => `<li>item ${at}</li>`).join('')}</ol>`

    workDone()
    const lines = htmlToMarkdown(html).split('\n')
    const work = workDone()

    expect(lines).toHaveLength(items)
    expect(lines[0]).toBe('1. item 0')
    expect(lines.at(-1)).toBe(`${items}. item ${items - 1}`)

    expect(work.lists).toBe(1)
    expect(work.items).toBe(items)
    expect(work.walked).toBe(items)
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

  test('the older spelling of the language class reads too, and either half may carry it', () => {
    expect(htmlToMarkdown('<pre><code class="lang-py">x = 1</code></pre>')).toBe(
      '```py\nx = 1\n```',
    )
    expect(htmlToMarkdown('<pre class="language-go"><code>x := 1</code></pre>')).toBe(
      '```go\nx := 1\n```',
    )
  })

  test('the attribute the highlighters name the language in reads as well', () => {
    expect(
      htmlToMarkdown('<pre data-language="js" class="shiki"><code>let x = 1</code></pre>'),
    ).toBe('```js\nlet x = 1\n```')

    expect(htmlToMarkdown('<pre><code data-lang="rust">let x = 1;</code></pre>')).toBe(
      '```rust\nlet x = 1;\n```',
    )
  })

  test('a language of the app’s own is not a page’s to choose', () => {
    expect(htmlToMarkdown('<pre data-language="query"><code>path:Salary</code></pre>')).toBe(
      '```\npath:Salary\n```',
    )
    expect(htmlToMarkdown('<pre class="language-ai"><code>Summarise @note</code></pre>')).toBe(
      '```\nSummarise @note\n```',
    )
    expect(htmlToMarkdown('<pre data-lang="QUERY"><code>x</code></pre>')).toBe('```\nx\n```')
  })

  test('while the languages a page really is written in are kept', () => {
    for (const [language, kept] of [
      ['js', '```js'],
      ['mermaid', '```mermaid'],
      ['c++', '```c++'],
      ['c#', '```c#'],
      ['objective-c', '```objective-c'],
    ] as const) {
      expect(htmlToMarkdown(`<pre data-language="${language}"><code>x</code></pre>`)).toBe(
        `${kept}\nx\n\`\`\``,
      )
    }
  })

  test('and a language that is not a word at all is no language', () => {
    const smuggled = '<pre class="language-x&quot;&gt;&lt;img src=x&gt;"><code>hi</code></pre>'
    expect(htmlToMarkdown(smuggled)).toBe('```\nhi\n```')

    expect(htmlToMarkdown(`<pre data-language="${'a'.repeat(25)}"><code>x</code></pre>`)).toBe(
      '```\nx\n```',
    )
  })

  test('an attribute holding nothing leaves the class to say it', () => {
    expect(
      htmlToMarkdown('<pre data-language="" class="language-go"><code>x := 1</code></pre>'),
    ).toBe('```go\nx := 1\n```')
  })

  test('a table with no headings becomes a table rather than the page markup', () => {
    const html =
      '<table class="layout"><tr><td>1</td><td>2</td></tr><tr><td>3</td><td>4</td></tr></table>'

    expect(htmlToMarkdown(html)).toBe('|  |  |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |')
  })

  test('nothing of the page is kept as markup', () => {
    const html =
      '<table><tr><td onmouseover="run()"><img src="x" onerror="run()"></td></tr></table>'

    expect(htmlToMarkdown(html)).not.toContain('onerror')
    expect(htmlToMarkdown(html)).not.toContain('<td')
  })

  test('nor from a table whose rows sit in a tbody of their own', () => {
    const html =
      '<table class="layout"><tbody></tbody><tbody><tr><th>Col</th></tr>' +
      '<tr><td>cell<img src="https://elsewhere.example/b.png" onerror="run()"></td></tr>' +
      '</tbody></table>'
    const markdown = htmlToMarkdown(html)

    expect(markdown).not.toContain('<table')
    expect(markdown).not.toContain('onerror')
    expect(markdown).toBe('|  |\n| --- |\n| Col |\n| cell![](https://elsewhere.example/b.png) |')
  })

  test('and a headed table keeps the heading row it already had', () => {
    for (const html of [
      '<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>c</td></tr></tbody></table>',
      '<table><tr><th>H</th></tr><tr><td>c</td></tr></table>',
      '<table><tbody><tr><th>H</th></tr><tr><td>c</td></tr></tbody></table>',
      '<table><thead></thead><tbody><tr><th>H</th></tr><tr><td>c</td></tr></tbody></table>',
    ]) {
      expect(htmlToMarkdown(html)).toBe('| H |\n| --- |\n| c |')
    }
  })

  test('a cell is one line, whatever the page put inside it', () => {
    const html = '<table><tr><td><p>one</p><p>two</p></td><td>a | b</td></tr></table>'

    expect(htmlToMarkdown(html)).toBe('|  |  |\n| --- | --- |\n| one two | a \\| b |')
  })

  test('raised and lowered text keep their markers', () => {
    expect(htmlToMarkdown('<p>x<sup>2</sup> and H<sub>2</sub>O</p>')).toBe('x^2^ and H~2~O')
  })

  test('a bare web address stays a link to where it says', () => {
    const page = htmlToMarkdown(
      '<p>See https://www.cs.cmu.edu/~bob/ and https://ex.com/page#:~:text=hi or https://ex.com/_next/x?b=[1].</p>',
    )
    expect(page).toBe(
      'See https://www.cs.cmu.edu/~bob/ and https://ex.com/page#:~:text=hi or https://ex.com/_next/x?b=\\[1\\].',
    )
    expect(renderMarkdown(page)).toBe(
      '<p>See <a class="url" href="https://www.cs.cmu.edu/~bob/">https://www.cs.cmu.edu/~bob/</a>' +
        ' and <a class="url" href="https://ex.com/page#:~:text=hi">https://ex.com/page#:~:text=hi</a>' +
        ' or <a class="url" href="https://ex.com/_next/x?b=%5B1%5D">https://ex.com/_next/x?b=[1]</a>.</p>\n',
    )
  })

  test('an escape right after a bare web address stays out of the link', () => {
    const page = htmlToMarkdown('<p>(see https://a.test/a_b_) and *https://a.test/x*</p>')
    expect(page).toBe('(see https://a.test/a_b\\_) and \\*https://a.test/x\\*')
    expect(renderMarkdown(page)).toBe(
      '<p>(see <a class="url" href="https://a.test/a_b">https://a.test/a_b</a>_) and ' +
        '*<a class="url" href="https://a.test/x">https://a.test/x</a>*</p>\n',
    )
  })

  test('two equals signs in words mark nothing', () => {
    const code = htmlToMarkdown('<p>if a==b or c==d then, and **x==y** too</p>')
    expect(code).toBe('if a=\\=b or c=\\=d then, and \\*\\*x=\\=y\\*\\* too')
    expect(renderMarkdown(code)).toBe('<p>if a==b or c==d then, and **x==y** too</p>\n')
    const struck = htmlToMarkdown('<p>a ~~b~~ c</p>')
    expect(renderMarkdown(struck)).toBe('<p>a ~~b~~ c</p>\n')
  })

  test('two percent signs in words hide nothing as a comment', () => {
    const code = htmlToMarkdown('<p>printf("%%d") and then printf("%%s") again</p>')
    expect(code).toBe('printf("%\\%d") and then printf("%\\%s") again')
    expect(renderMarkdown(code)).toBe(
      '<p>printf(&quot;%%d&quot;) and then printf(&quot;%%s&quot;) again</p>\n',
    )
  })

  test('dollars in words draw no maths', () => {
    const prices = htmlToMarkdown('<p>Tickets cost $5-$10 each</p>')
    expect(prices).toBe('Tickets cost \\$5-\\$10 each')
    expect(renderMarkdown(prices)).toBe('<p>Tickets cost $5-$10 each</p>\n')
  })

  test('a formula between dollars in words stays a formula', () => {
    const both = htmlToMarkdown('<p>$5 for <math alttext="x^2"><mi>x</mi></math> or $10</p>')
    expect(both).toBe('\\$5 for $x^2$ or \\$10')
    const drawn = renderMarkdown(both)
    expect(drawn).toContain('<span class="math-inline" data-tex="x^2">')
    expect(drawn.match(/math-inline/g)).toHaveLength(1)
    expect(drawn).toMatch(/^<p>\$5 for <span/)
    expect(drawn).toMatch(/<\/span> or \$10<\/p>\n$/)
  })

  test('a tilde or a caret in words opens no lowered or raised text', () => {
    const about = htmlToMarkdown('<p>It takes ~5 min or ~10 min.</p>')
    expect(about).toBe('It takes \\~5 min or \\~10 min.')
    expect(renderMarkdown(about)).toBe('<p>It takes ~5 min or ~10 min.</p>\n')

    const powers = htmlToMarkdown('<p>2^10 and 3^4</p>')
    expect(powers).toBe('2\\^10 and 3\\^4')
    expect(renderMarkdown(powers)).toBe('<p>2^10 and 3^4</p>\n')

    const doubled = htmlToMarkdown('<p>~~kept~~ and a ~ b</p>')
    expect(doubled).toBe('\\~\\~kept\\~~ and a ~ b')
    expect(renderMarkdown(doubled)).toBe('<p>~~kept~~ and a ~ b</p>\n')
  })

  test('a body the marker cannot hold keeps the tag instead', () => {
    expect(htmlToMarkdown('<p>a<sup>b^c</sup></p>')).toBe('a<sup>b\\^c</sup>')
    expect(htmlToMarkdown('<p>a<sub>b~c</sub></p>')).toBe('a<sub>b\\~c</sub>')
  })

  test('a raised footnote mark keeps the link it wraps', () => {
    expect(htmlToMarkdown('<p>said<sup><a href="https://x.dev#n1">[1]</a></sup></p>')).toBe(
      'said^[\\[1\\]](https://x.dev#n1)^',
    )
  })

  test('a formula arrives as the TeX the page built it from', () => {
    const html =
      '<p>the equality <math alttext="e^{i\\pi}+1=0"><semantics>' +
      '<annotation encoding="application/x-tex">e^{i\\pi}+1=0</annotation>' +
      '</semantics></math> where</p>'

    expect(htmlToMarkdown(html)).toBe('the equality $e^{i\\pi}+1=0$ where')
  })

  test('the element says the TeX when nothing inside it does', () => {
    expect(htmlToMarkdown('<p>a <math alttext="x^2"><mi>x</mi></math> b</p>')).toBe('a $x^2$ b')
  })

  test('a formula alone in its block is written as a block', () => {
    const html = '<p>words</p><p><math alttext="e^{i\\pi}+1=0"><mi>e</mi></math></p><p>after</p>'

    expect(htmlToMarkdown(html)).toBe('words\n\n$$\ne^{i\\pi}+1=0\n$$\n\nafter')
  })

  test('a formula in a heading stays inside the heading', () => {
    expect(htmlToMarkdown('<h2><math alttext="x=1"><mi>x</mi></math></h2>')).toBe('## $x=1$')
  })

  test('a dollar inside a formula cannot close it early', () => {
    expect(htmlToMarkdown('<p>a <math alttext="x=$5"><mi>x</mi></math> b</p>')).toBe('a $x=\\$5$ b')

    expect(htmlToMarkdown('<p>a <math alttext="x=\\$5"><mi>x</mi></math> b</p>')).toBe(
      'a $x=\\$5$ b',
    )
  })

  test('a tag inside a formula is written as TeX rather than as a tag', () => {
    const html =
      '<p>see <math alttext="<a href=javascript:run()>click</a> \\"><mi>q</mi></math> ok</p>'
    const markdown = htmlToMarkdown(html)

    expect(markdown).not.toContain('<a')
    expect(markdown).not.toContain('</a>')
    expect(markdown).toContain('\\lt ')
  })

  test('and a comparison in a formula still draws as one', () => {
    expect(htmlToMarkdown('<p>a <math alttext="x<y"><mi>x</mi></math> b</p>')).toBe('a $x\\lt y$ b')
  })

  test('a formula that says no TeX keeps the letters it was made of', () => {
    expect(htmlToMarkdown('<p>a <math><mi>x</mi></math> b</p>')).toBe('a x b')
  })

  describe('a formula that has been drawn', () => {
    const TEX = String.raw`B_r(x) = B(x, r) := \left\{ y \in \mathbb{R}^n \;\middle|\; \|x - y\| < r \right\}`
    const KEPT = TEX.replace('<', String.raw`\lt `)

    test('arrives as the TeX it was drawn from, and never as the glyphs it drew', () => {
      const drawn = katex.renderToString(TEX, { displayMode: true, throwOnError: false })
      const markdown = htmlToMarkdown(drawn)

      expect(markdown).toBe(`$$\n${KEPT}\n$$`)
      expect(markdown).not.toContain('∈')
    })

    test('and one a sentence runs through is part of the sentence', () => {
      const drawn = katex.renderToString('x^2', { throwOnError: false })

      expect(htmlToMarkdown(`<p>the square ${drawn} of it</p>`)).toBe('the square $x^2$ of it')
    })

    test('and one a lecture page sets between two paragraphs is a block of its own', () => {
      const drawn = katex.renderToString('x^2', { displayMode: true, throwOnError: false })

      expect(htmlToMarkdown(`<p>Sei</p><div>${drawn}</div><p>Dann</p>`)).toBe(
        'Sei\n\n$$\nx^2\n$$\n\nDann',
      )
    })

    test('and a formula this app drew pastes back into a note as itself', async () => {
      const note = `$$${TEX}$$`
      await loadFor(note)

      expect(htmlToMarkdown(renderMarkdown(note))).toBe(`$$\n${KEPT}\n$$`)
    })

    test('an inline one too, still inside its sentence', async () => {
      const note = 'the square $x^2$ of it'
      await loadFor(note)

      expect(htmlToMarkdown(renderMarkdown(note))).toBe(note)
    })
  })

  test('a page that hides something from a reader still says what it says', () => {
    expect(htmlToMarkdown('<p><span aria-hidden="true">Kapitel</span> eins</p>')).toBe(
      'Kapitel eins',
    )
  })

  test('a block holding nothing is nothing to fence', () => {
    expect(htmlToMarkdown('<pre>  </pre>')).toBe('')
  })

  test('code inside a sentence stays inside it', () => {
    expect(htmlToMarkdown('<p>the <code>id</code> field</p>')).toBe('the `id` field')
  })

  test('a rule and a quotation come out as the editor writes them', () => {
    expect(htmlToMarkdown('<p>a</p><hr><p>b</p>')).toBe('a\n\n---\n\nb')
    expect(htmlToMarkdown('<blockquote><p>said</p></blockquote>')).toBe('> said')
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

  test('a coloured highlight comes back as the colour it was', () => {
    expect(htmlToMarkdown('<mark class="tone-1">kept</mark>')).toBe('==\u{1F534} kept==')
    expect(htmlToMarkdown('<mark class="tone-6">kept</mark>')).toBe('==\u{1F7E3} kept==')
  })

  test('a mark from anywhere else is a highlight with no colour of its own', () => {
    expect(htmlToMarkdown('<mark class="hljs-thing">kept</mark>')).toBe('==kept==')
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

  test('a backslash in alt text cannot escape the escaping', () => {
    expect(
      htmlToMarkdown('<img src="https://x.test/ok.png" alt="a\\](https://evil.test/b.png)![b">'),
    ).toBe('![a\\\\\\](https://evil.test/b.png)!\\[b](https://x.test/ok.png)')
  })

  test('an image with no address is nothing to point at', () => {
    expect(htmlToMarkdown('<p>before<img alt="none">after</p>')).toBe('beforeafter')
  })

  test('text that looks like a tag stays text', () => {
    expect(htmlToMarkdown('<p>a &lt;img src=q onerror=alert(1)&gt; b</p>')).toBe(
      'a \\<img src=q onerror=alert(1)> b',
    )
    expect(htmlToMarkdown('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')).toBe(
      '\\<script>alert(1)\\</script>',
    )
    expect(htmlToMarkdown('<h1>&lt;b&gt;shout&lt;/b&gt;</h1>')).toBe('# \\<b>shout\\</b>')
  })

  test('a lone angle bracket is left as it was typed', () => {
    expect(htmlToMarkdown('<p>1 &lt; 2 and 3 &gt; 2</p>')).toBe('1 < 2 and 3 > 2')
  })

  describe('a page whose own words are markdown', () => {
    test('a doubled marker around plain words is kept, and reads as markdown', () => {
      expect(htmlToMarkdown('<p>dann überfliegen Sie **kurz** das Dokument</p>')).toBe(
        'dann überfliegen Sie **kurz** das Dokument',
      )
      expect(htmlToMarkdown('<p>ganz __fett__ gesagt</p>')).toBe('ganz __fett__ gesagt')
    })

    test('and so is a code span', () => {
      expect(htmlToMarkdown('<p>run `npm run dev` first</p>')).toBe('run `npm run dev` first')
    })

    test('and an escape no reader would have needed is not written at all', () => {
      expect(htmlToMarkdown('<p>plt.savefig("./cx_out/pic.png")</p>')).toBe(
        'plt.savefig("./cx_out/pic.png")',
      )
      expect(htmlToMarkdown('<p>2 * 3 = 6</p>')).toBe('2 * 3 = 6')
      expect(htmlToMarkdown('<p>C:\\Users\\me\\notes</p>')).toBe('C:\\Users\\me\\notes')
    })

    test('a marker that would open a block of its own is still escaped', () => {
      expect(htmlToMarkdown('<p>+ Lesen und üben Sie die Aufgaben</p>')).toBe(
        '\\+ Lesen und üben Sie die Aufgaben',
      )
      expect(htmlToMarkdown('<p># 1 der Liste</p>')).toBe('\\# 1 der Liste')
      expect(htmlToMarkdown('<p>&gt; sagte sie</p>')).toBe('\\> sagte sie')
    })

    test('a single marker is prose, and keeps its escape', () => {
      expect(htmlToMarkdown('<p>rename *.md to *.txt</p>')).toBe('rename \\*.md to \\*.txt')
      expect(htmlToMarkdown('<p>the _config_ file</p>')).toBe('the \\_config\\_ file')
    })

    test('and never a run with markup inside it', () => {
      expect(htmlToMarkdown('<p>**&lt;img src=q onerror=alert(1)&gt;**</p>')).toBe(
        '\\*\\*\\<img src=q onerror=alert(1)>\\*\\*',
      )
      expect(htmlToMarkdown('<p>**[a](javascript:alert(1))**</p>')).toBe(
        '\\*\\*\\[a\\](javascript:alert(1))\\*\\*',
      )
    })

    test('and a page that means emphasis still gets it from its tags', () => {
      expect(htmlToMarkdown('<p><strong>kurz</strong> und <em>gut</em></p>')).toBe(
        '**kurz** und *gut*',
      )
    })

    test('and the section it was reported from arrives as the note it should be', () => {
      const page = [
        '<h3><a href="https://moodle.test/section.php?id=1">Vor der Ersten Vorlesung</a></h3>',
        '<p>+ Schauen Sie sich das Cheatsheet an und überfliegen Sie **kurz** das Dokument.</p>',
        '<ol><li>in CodeExpert zu arbeiten;</li><li>oder nur mit IPython.</li></ol>',
        '<p>in CodeExpert braucht man plt.savefig("./cx_out/pic.png") statt plt.show()</p>',
      ].join('')

      expect(htmlToMarkdown(page)).toBe(
        [
          '### [Vor der Ersten Vorlesung](https://moodle.test/section.php?id=1)',
          '',
          '\\+ Schauen Sie sich das Cheatsheet an und überfliegen Sie **kurz** das Dokument.',
          '',
          '1. in CodeExpert zu arbeiten;',
          '2. oder nur mit IPython.',
          '',
          'in CodeExpert braucht man plt.savefig("./cx_out/pic.png") statt plt.show()',
        ].join('\n'),
      )
    })
  })

  test('a tag inside code keeps its brackets', () => {
    expect(htmlToMarkdown('<pre><code>&lt;img src=q&gt;</code></pre>')).toBe(
      '```\n<img src=q>\n```',
    )
  })

  test('an address cannot break out of its own brackets', () => {
    expect(
      htmlToMarkdown('<img alt="a" src="https://x.test/a.png)![](https://evil.test/b.png">'),
    ).toBe('![a](https://x.test/a.png%29![]%28https://evil.test/b.png)')

    expect(htmlToMarkdown('<img alt="a" src="x)<img src=q onerror=alert(1)>">')).toBe(
      '![a](x%29%3Cimg%20src=q%20onerror=alert%281%29%3E)',
    )
  })

  test('a backslash in an address cannot escape the escaping', () => {
    expect(
      htmlToMarkdown('<img alt="a" src="https://x.test/a.png\\)![](https://evil.test/b.png">'),
    ).toBe('![a](https://x.test/a.png%5C%29![]%28https://evil.test/b.png)')
  })

  test('the brackets an ordinary address carries survive as one address', () => {
    expect(htmlToMarkdown('<img alt="a" src="https://x.test/File_(1).png">')).toBe(
      '![a](https://x.test/File_%281%29.png)',
    )
  })

  test('a blank in an address cannot end it', () => {
    expect(htmlToMarkdown('<img alt="a" src="my picture.png">')).toBe('![a](my%20picture.png)')
    expect(htmlToMarkdown('<img alt="a" src="a&#9;b.png">')).toBe('![a](a%09b.png)')
  })

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

  test('a title is not markdown a page can write', () => {
    expect(
      htmlToMarkdown('<img alt="a" src="a.png" title="he said &quot;hi&quot;) ![](b.png">'),
    ).toBe('![a](a.png)')
  })

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

  test('the blank lines and trailing blanks inside code are left as they were', () => {
    const code = 'one  \n\n\n\ntwo\t\n   \nthree'

    expect(htmlToMarkdown(`<pre><code>${code}</code></pre>`)).toBe(`\`\`\`\n${code}\n\`\`\``)
    expect(htmlToMarkdown(`<p>before</p><pre><code>${code}</code></pre><p>after</p>`)).toBe(
      `before\n\n\`\`\`\n${code}\n\`\`\`\n\nafter`,
    )
  })

  test('a line break inside a paragraph is still a line break', () => {
    expect(htmlToMarkdown('<p>line one<br>line two</p>')).toBe('line one  \nline two')
  })
})

describe('a checked list item', () => {
  test('reads none of its words as a field of the task', async () => {
    const { readTask } = await import('./task-line')
    const html =
      '<ul><li><input type="checkbox">task 📅 2026-11-01 ⏫ 🔁 every week #tag [due:: 2026-01-01]</li></ul>'
    const line = htmlToMarkdown(html, { plainTasks: true }).trim()
    const task = readTask(line)

    expect(task).toMatchObject({ tags: [] })
    expect(task?.due).toBeUndefined()
    expect(task?.recurrence).toBeUndefined()
    expect(task?.priority).toBe(readTask('- [ ] task')?.priority)
    expect(task?.fields).toEqual({})
  })
})

test('a to-do keeps its code as it was written', () => {
  const html =
    '<ul><li><input type="checkbox"> use <code>std::move</code> on <code>x #b</code></li></ul>'

  expect(htmlToMarkdown(html).trim()).toBe('- [ ] use `std::move` on `x #b`')
})

describe('a rendered task list pasted back', () => {
  test('keeps its tags, dates, priority and fields', async () => {
    const { readTask } = await import('./task-line')
    const source = [
      '- [ ] Pay rent #home 📅 2026-11-01',
      '- [x] Call [due:: 2026-10-01] ⏫',
      '- [ ] Keep \\[a:: b\\](see) words',
    ]
    const html = renderMarkdown(source.join('\n'), { tagHref: (tag) => `#${tag}` })
    const lines = htmlToMarkdown(html).split('\n')
    for (const [at, line] of source.entries()) {
      const before = readTask(line)
      const after = readTask(lines[at] ?? '')
      expect(after?.tags).toEqual(before?.tags)
      expect(after?.due).toBe(before?.due)
      expect(after?.priority).toBe(before?.priority)
      expect(after?.fields).toEqual(before?.fields)
    }
    expect(lines[2]).toContain('\\[a:: b\\](see)')
  })
})

describe('a paste from Google Docs', () => {
  const docs = (inner: string) =>
    `<meta charset="utf-8"><b style="font-weight:normal" id="docs-internal-guid-1">${inner}</b>`

  test('writes no marks for the wrapper around the whole of it', () => {
    const said = htmlToMarkdown(docs('<p dir="ltr"><span>one</span></p><p><span>two</span></p>'))
    expect(said).toBe('one\n\ntwo')
    expect(htmlToMarkdown(docs('<span>just words</span>'))).toBe('just words')
  })

  test('reads bold and italic off the spans', () => {
    const said = htmlToMarkdown(
      docs(
        '<p><span style="font-weight:700">B</span> <span style="font-style:italic">I</span> <span style="font-weight:400">n</span> <span style="font-weight:700;font-style:italic">both </span>x</p>',
      ),
    )
    expect(said).toBe('**B** *I* n ***both*** x')
  })

  test('a heading is not bold on top of being a heading, and code keeps its characters', () => {
    expect(htmlToMarkdown('<h2><span style="font-weight:700">t</span></h2>')).toBe('## t')
    expect(htmlToMarkdown('<code><span style="font-weight:700">t</span></code>')).toBe('`t`')
  })

  test('strong or em around blocks write no marks', () => {
    expect(htmlToMarkdown('<strong><p>a</p><p>b</p></strong>')).toBe('a\n\nb')
    expect(htmlToMarkdown('<em><div>a</div></em>')).toBe('a')
  })
})

describe('a link around blocks', () => {
  test('goes inside the heading', () => {
    expect(htmlToMarkdown('<a href="https://u.co"><h2>t</h2></a>')).toBe('## [t](https://u.co)')
  })

  test('links each block rather than writing brackets around blank lines', () => {
    const said = htmlToMarkdown('<a href="https://u.co"><div>x</div><div>y</div></a>')
    expect(said).toBe('[x](https://u.co)\n\n[y](https://u.co)')
    expect(renderMarkdown(said)).not.toContain('](')
  })

  test('leaves what a link cannot hold unlinked', () => {
    const said = htmlToMarkdown('<a href="https://u.co"><pre>code</pre><p>y</p></a>')
    expect(said).toBe('```\ncode\n```\n\n[y](https://u.co)')
  })

  test('a link in a line stays one', () => {
    expect(htmlToMarkdown('<p>a <a href="https://u.co">b <b>c</b></a> d</p>')).toBe(
      'a [b **c**](https://u.co) d',
    )
  })
})

describe('preformatted text with line breaks in tags', () => {
  test('a br is a new line, as JetBrains IDEs copy code', () => {
    expect(htmlToMarkdown('<pre><span>a</span><br><span>  b</span><br></pre>')).toBe(
      '```\na\n  b\n```',
    )
  })

  test('holds beside real newlines and comments', () => {
    expect(htmlToMarkdown('<pre>a\nb<!-- c --><br>d</pre>')).toBe('```\na\nb\nd\n```')
  })
})

describe('a heading cell across two columns', () => {
  test('pads the row, so the rows under it keep their cells', () => {
    const said = htmlToMarkdown(
      '<table><thead><tr><th colspan="2">a</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
    )
    expect(said).toBe('| a |  |\n| --- | --- |\n| 1 | 2 |')
    expect(renderMarkdown(said)).toContain('2')
  })

  test('in a row of a table that has no heading row', () => {
    const said = htmlToMarkdown(
      '<table><tr><td colspan="2">a</td></tr><tr><td>1</td><td>2</td></tr></table>',
    )
    expect(said).toBe('|  |  |\n| --- | --- |\n| a |  |\n| 1 | 2 |')
  })

  test('a colspan nothing could mean is one', () => {
    const said = htmlToMarkdown('<table><tr><th colspan="0">a</th></tr></table>')
    expect(said).toBe('| a |\n| --- |')
  })
})

describe('a loose task list', () => {
  test('keeps the box of an item whose words sit in a paragraph', () => {
    expect(
      htmlToMarkdown(
        '<ul><li><p><input type="checkbox"> x</p></li><li><p><input type="checkbox" checked> y</p></li></ul>',
      ),
    ).toMatch(/^- \[ \] x\n+- \[x\] y$/u)
  })
})

describe('marks and what stands beside them', () => {
  test('a heading holds its line break as a space', () => {
    expect(htmlToMarkdown('<h1>a<br>b</h1>')).toBe('# a b')
  })

  test('marks that could not close write no stars', () => {
    expect(renderMarkdown(htmlToMarkdown('<p><b>"x"</b>y</p>'))).not.toContain('*')
    expect(renderMarkdown(htmlToMarkdown('<p>y<i>"x"</i></p>'))).not.toContain('*')
    expect(htmlToMarkdown('<p><b>"x"</b> y</p>')).toBe('**"x"** y')
    expect(htmlToMarkdown('<p><b>x</b>y</p>')).toBe('**x**y')
  })

  test('a linked picture with a bracket in its words stays a linked picture', () => {
    const html = renderMarkdown(
      htmlToMarkdown('<a href="https://u.co"><img src="https://u.co/a.png" alt="p]q"></a>'),
    )
    expect(html).toContain('<img')
    expect(html).not.toContain('](')
  })
})

describe('marks beside marks', () => {
  test('bold beside bold is one run', () => {
    expect(htmlToMarkdown('<p><b>foo</b><b>bar</b></p>')).toBe('**foobar**')
    expect(
      htmlToMarkdown(
        '<p><span style="font-weight:700">foo</span><span style="font-weight:700">bar</span> x</p>',
      ),
    ).toBe('**foobar** x')
    expect(htmlToMarkdown('<p><b>foo</b> <b>bar</b></p>')).toBe('**foo** **bar**')
    expect(htmlToMarkdown('<p><i>a</i><i>b</i><b>c</b></p>')).toContain('*ab*')
  })

  test('a line break stays outside them', () => {
    expect(htmlToMarkdown('<p><b>a<br></b>b</p>')).toBe('**a**  \nb')
    expect(renderMarkdown(htmlToMarkdown('<p><b>a<br></b>b</p>'))).not.toContain('*')
  })
})

describe('a table with two heading rows', () => {
  test('has one line of dashes', () => {
    const said = htmlToMarkdown(
      '<table><thead><tr><th>a</th></tr><tr><th>b</th></tr></thead><tbody><tr><td>c</td></tr></tbody></table>',
    )
    expect(said).toBe('| a |\n| --- |\n| b |\n| c |')
  })
})

describe('a link around a task list', () => {
  test('goes inside the item, past its box', () => {
    const said = htmlToMarkdown(
      '<a href="https://u.co"><ul><li><input type="checkbox"> x</li></ul></a>',
    )
    expect(said).toBe('- [ ] [x](https://u.co)')
  })
})

describe('alt ending in a backslash, in a link', () => {
  test('stays a picture', () => {
    const html = renderMarkdown(
      htmlToMarkdown('<a href="https://u.co"><img src="https://u.co/a.png" alt="p\\"></a>'),
    )
    expect(html).toContain('<img')
    expect(html).not.toContain('](')
  })
})

describe('a table with a cell over several rows', () => {
  test('a cell that spans rows leaves its column empty below, so no cell shifts', () => {
    const markdown = htmlToMarkdown(
      '<table><tr><th>a</th><th>b</th><th>c</th></tr>' +
        '<tr><td rowspan="2">1</td><td>2</td><td>3</td></tr>' +
        '<tr><td>4</td><td>5</td></tr>' +
        '<tr><td>6</td><td rowspan="2">7</td><td>8</td></tr>' +
        '<tr><td>9</td><td>10</td></tr></table>',
    )
    expect(markdown).toBe(
      '| a | b | c |\n| --- | --- | --- |\n| 1 | 2 | 3 |\n|  | 4 | 5 |\n| 6 | 7 | 8 |\n| 9 |  | 10 |',
    )
  })
})

describe('a form', () => {
  test('its words are kept and its controls are not', () => {
    const said = htmlToMarkdown('<p>intro</p><form><p>body</p><button>Send</button></form>')
    expect(said).toContain('intro')
    expect(said).toContain('body')
    expect(said).not.toContain('Send')
  })

  test('with nothing but controls and what names them is nothing', () => {
    expect(
      htmlToMarkdown(
        '<p>intro</p><form><label>Mail</label><input><select><option>a</option></select></form>',
      ),
    ).toBe('intro')
  })
})

describe('a form that asks for something', () => {
  const said = (form: string) => htmlToMarkdown(`<p>intro</p>${form}`)

  test('is no words of the page', () => {
    for (const form of [
      '<form><p>Sign in to read more</p><label>Email</label><input type="email"><a href="/x">Forgot your password?</a></form>',
      '<form><p>Search this site</p><input type="search"></form>',
      '<form><p>Subscribe to our newsletter for the latest news and offers every week.</p><input type="email"><button>Go</button></form>',
      '<form><h3>Leave a Reply</h3><p>Your email address will not be published. Required fields are marked.</p><label>Comment</label><textarea></textarea><label>Name</label><input><label>Email</label><input><input type="checkbox"><label>Save my name, email, and website in this browser for the next time I comment.</label><input type="submit" value="Post"></form>',
    ]) {
      expect(said(form)).toBe('intro')
    }
  })

  test('a page in one is the page, a field or not', () => {
    const results = Array.from({ length: 12 }, (_, at) => `<li>Result ${at} about something</li>`)
    const page = said(
      `<form><input type="hidden"><input type="search"><ul>${results.join('')}</ul></form>`,
    )
    expect(page).toContain('Result 11')
    expect(said('<form><input type="hidden"><p>body</p></form>')).toContain('body')
  })
})

describe('what Orden draws itself, pasted back', () => {
  const back = (markdown: string) => htmlToMarkdown(renderMarkdown(markdown))

  test.each([
    '> [!note] Title\n> body of the callout',
    '> [!tip]- Folded away\n> hidden words',
    '> [!warning]+\n> open by default',
    '> [!note]\n> - one\n> - two\n>\n> a paragraph',
    '> [!quote] A *literal* title\n> body',
    '> [!note] Outer\n> > [!tip] Inner\n> > inner body',
    'A mark[^1] and another[^two].\n\n[^1]: The note.\n[^two]: Second **bold**.',
    'Term\n: Definition\n\nOther\n: First\n: Second',
  ])('stays what was written: %s', (markdown) => {
    expect(back(markdown)).toBe(markdown)
  })
})

describe('what GitHub draws, pasted', () => {
  test('an alert is a callout', () => {
    const html =
      '<div class="markdown-alert markdown-alert-warning" dir="auto"><p class="markdown-alert-title" dir="auto"><svg class="octicon"><path d="M0"></path></svg>Warning</p><p dir="auto">Careful here.</p></div>'
    expect(htmlToMarkdown(html)).toBe('> [!warning]\n> Careful here.')
  })

  test('footnotes are footnotes, without the heading GitHub hides or the way back', () => {
    const html = `<p>Text<sup><a href="#user-content-fn-note-1" id="user-content-fnref-note-1" data-footnote-ref="" aria-describedby="footnote-label">1</a></sup>.</p>
<section data-footnotes="" class="footnotes"><h2 id="footnote-label" class="sr-only" dir="auto">Footnotes</h2>
<ol dir="auto"><li id="user-content-fn-note-1"><p dir="auto">The words. <a href="#user-content-fnref-note-1" data-footnote-backref="" aria-label="Back to reference 1" class="data-footnote-backref">↩</a></p></li></ol></section>`
    expect(htmlToMarkdown(html)).toBe('Text[^note-1].\n\n[^note-1]: The words.')
  })

  test('a superscript link that is no footnote is still a link', () => {
    expect(htmlToMarkdown('<p>x<sup><a href="#top">up</a></sup></p>')).toBe('x^[up](#top)^')
  })
})

describe('a long paste', () => {
  test('of one paragraph of thousands of marks is read in time that grows with its length', () => {
    const words = (count: number) =>
      Array.from({ length: count }, (_, at) => `<b>w${at}</b> `).join('')
    const markdown = linearly((count) => htmlToMarkdown(`<p>${words(count)}</p>`), 8_000)
    expect(markdown.startsWith('**w0** **w1** ')).toBe(true)
    expect(markdown.endsWith('**w7999**')).toBe(true)
  }, 60_000)

  test('of thousands of paragraphs keeps one blank line between them', () => {
    const paragraphs = (count: number) =>
      Array.from({ length: count }, (_, at) => `<p>p${at}</p>\n`).join('')
    const markdown = linearly((count) => htmlToMarkdown(paragraphs(count)), 8_000)
    expect(markdown.split('\n\n')).toHaveLength(8_000)
  }, 60_000)
})
