// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import { renderMarkdown } from './index'

/** Someone else's words, where `escapeHtml` says they are words: a room, a shared space, a
 *  chat, an answer, a published page. Marked keeps a tag it does not accept as text, and
 *  after an inline `<kbd>`, `<pre>`, `<code>` or `<script>` it takes text to be escaped
 *  already; a browser accepts more than marked does, so the tag was live. Read here by a
 *  real parser, since no string check knows what a browser will make of the page. */

/** What opens a run of text: the tags marked counts, and what a browser reads otherwise. */
const OPENERS = [
  '<kbd>',
  '<pre>',
  '<code>',
  '<script>',
  '<KBD>',
  '<pre x="y">',
  '</kbd>',
  '<a href="https://x.dev">',
  '<textarea>',
  '<title>',
  '<xmp>',
  '<noscript>',
  '<iframe>',
  '<iframe src="https://x.dev">',
  '<svg>',
  '<math>',
  '<style>',
  '<![CDATA[',
  '<!-- ',
  '<!x ',
  '<?x ',
  '<kbd',
  '',
]

/** Tags marked turns away and a browser takes, closed or not. */
const PAYLOADS = [
  '<img src=x onerror=alert(1) "">',
  '<a href="javascript:alert(1)" ">x</a>',
  '<script src=/assets/x.js "">',
  '<iframe src=x "">',
  '<style x=y "">a{color:red}</style>',
  '<input "">',
  '<svg onload=alert(1) "">',
  '<math href="javascript:alert(1)" "">',
  '<textarea "">',
  '<form action=x ""><button "">go</button>',
  '<meta http-equiv=refresh content=0 "">',
  '<link rel=stylesheet href=x "">',
  '<img src=x onerror=alert(1) ',
  '<base href=x ',
  ']]><img src=x onerror=alert(1)>',
  '--><img src=x onerror=alert(1)>',
]

const PLACES: ((words: string) => string)[] = [
  (words) => `x ${words}\n`,
  (words) => `# x ${words}\n`,
  (words) => `- x ${words}\n- y\n`,
  (words) => `- [ ] x ${words}\n`,
  (words) => `> x ${words}\n`,
  (words) => `> [!note] x ${words}\n> y\n`,
  (words) => `| a |\n| - |\n| x ${words} |\n`,
  (words) => `*x ${words}*\n`,
  (words) => `==x ${words}==\n`,
  (words) => `[x ${words}](https://x.dev)\n`,
  (words) => `![x ${words}](https://x.dev/a.png)\n`,
  (words) => `[[x ${words}]]\n`,
  (words) => `a[^1]\n\n[^1]: x ${words}\n`,
  (words) => `Term\n: x ${words}\n`,
  (words) => `HTML ${words}\n\n*[HTML]: x ${words}\n`,
  (words) => `---\ncover: ${words}\n---\nx ${words}\n`,
  (words) => `x\n${words}\n`,
  (words) => `${words}\n`,
]

const OPTIONS = [
  { escapeHtml: true },
  { escapeHtml: true, blockAnchors: true },
  { escapeHtml: true, toc: true, footnotes: true, cover: true, properties: 'properties' as const },
]

/** The markup the renderer writes itself. */
const OURS = new Set(
  (
    'A ABBR ASIDE B BLOCKQUOTE BR BUTTON CODE COL DD DEL DIV DL DT EM FIGCAPTION FIGURE H1 H2 H3 H4 H5 ' +
    'H6 HR I IMG INPUT LI MARK NAV OL P PRE SECTION SPAN STRONG SUB SUP TABLE TBODY TD TH THEAD TR UL'
  ).split(' '),
)

/** What a page drew that the renderer did not write. */
function live(html: string): string[] {
  const holder = document.createElement('div')
  holder.innerHTML = html
  const out: string[] = []
  for (const element of holder.querySelectorAll('*')) {
    // A callout's icon, a web card's, and a cover's place in its frame, checked in cover.ts.
    if (element.closest('.callout svg, [class*="embed"] svg')) continue
    const cover = element.closest('.nib-cover') !== null
    if (!OURS.has(element.tagName)) out.push(element.tagName)
    if (element.tagName === 'INPUT' && element.getAttribute('type') !== 'checkbox')
      out.push('INPUT')
    if (element.tagName === 'BUTTON' && !element.closest('[class*="embed"]')) out.push('BUTTON')
    for (const { name, value } of element.attributes) {
      if (/^on/i.test(name) || (name === 'style' && !cover) || name === 'srcdoc')
        out.push(`@${name}`)
      if (/^\s*(?:java|vb)script:/i.test(value)) out.push(`@${name}=${value}`)
    }
  }
  return out
}

describe('the words of someone else', () => {
  test('stay words after an inline tag marked reads as raw', () => {
    for (const tag of ['kbd', 'pre', 'code', 'script']) {
      const html = renderMarkdown(`x <${tag}> <img src=x onerror=alert(1) "">\n`, {
        escapeHtml: true,
      })
      expect(html, tag).toContain('&lt;img')
      expect(live(html), tag).toEqual([])
    }
  })

  test('are read by a browser as words, whatever came before them and wherever', () => {
    const wrong: string[] = []
    for (const opener of OPENERS) {
      for (const payload of PAYLOADS) {
        for (const place of PLACES) {
          const source = place(`${opener} ${payload}`)
          for (const options of OPTIONS) {
            const drew = live(renderMarkdown(source, options))
            if (drew.length) wrong.push(`${JSON.stringify(source)}: ${drew.join(' ')}`)
          }
        }
      }
    }
    expect(wrong.slice(0, 12)).toEqual([])
    expect(wrong).toHaveLength(0)
  }, 120_000)

  test('keep their entities, and their own markdown', () => {
    const html = renderMarkdown('<kbd>a &amp; *b* <c</kbd>\n', { escapeHtml: true })
    expect(html).toContain('a &amp; <em>b</em> &lt;c')
  })
})

describe('in a note of the reader’s own', () => {
  test('a tag the renderer never saw is no way past what it holds back', () => {
    const html = renderMarkdown('x <kbd>k</kbd> <kbd> <iframe src=javascript:alert(1) "">\n')
    expect(html).toContain('<kbd>k</kbd>')
    expect(live(html.replace(/<\/?kbd>/g, ''))).toEqual([])
  })
})
