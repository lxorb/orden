import { describe, expect, test } from 'vitest'
import {
  buildHtml,
  localSources,
  PANDOC_FORMATS,
  prepareFences,
  renderNote,
  titleOf,
} from './export'

/** One of everything the renderer knows. */
const NOTE = `---
title: Meta
author: Ada Lovelace
lang: de
export:
  footer: \${title} - \${date}
---

# Handbook

[toc]

Prose with **strong**, ==marked==, H~2~O, $E=mc^2$, a [link](https://nib.dev) and <https://bare.dev>.

## Lists

- one
  - nested
- [x] done
- [ ] open

## Table

| a | b |
| - | - |
| 1 | 2 |

## Code

\`\`\`ts
const answer = 42
\`\`\`

\`\`\`mermaid
graph TD; A-->B
\`\`\`

> [!NOTE]
> Careful.

$$
\\int_0^1 x\\,dx
$$

<div style="page-break-after: always;"></div>

![Picture](assets/pic.png)

Footnote[^1].

[^1]: The note.
`

describe('a styled export', () => {
  const html = buildHtml(NOTE, 'Handbook.md', { date: '2026-09-04' })

  test('is a complete document', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('</html>')
    expect(html).toContain('<meta charset="utf-8">')
  })

  test('takes title, author and language from the front matter', () => {
    expect(html).toContain('<title>Meta</title>')
    expect(html).toContain('<meta name="author" content="Ada Lovelace">')
    expect(html).toContain('<html lang="de"')
  })

  test('is light unless asked otherwise', () => {
    expect(html).toContain('data-theme="light"')
    expect(buildHtml(NOTE, 'Handbook.md', { scheme: 'dark' })).toContain('data-theme="dark"')
  })

  test('carries the theme, the export sheet and the accent with it', () => {
    expect(html).toContain('--bg:')
    expect(html).toContain('#write')
    expect(html).toContain('@media print')
    expect(html).toContain('--accent: #5b4be0')
    expect(buildHtml(NOTE, 'x.md', { accent: 'teal' })).toContain('--accent: #0f9b8e')
  })

  test('needs no network to render maths', () => {
    expect(html).toContain('class="katex')
    expect(html).toContain('src:url(data:font/woff2;base64,')
    expect(html).not.toContain('url(fonts/')
    expect(html).not.toContain('cdn.jsdelivr')
    expect(html).not.toContain('<script')
  })

  test('leaves the maths stylesheet out of a note without any', () => {
    expect(buildHtml('# Plain\n\ntext', 'p.md')).not.toContain('font-family:KaTeX')
  })

  test('renders every construct', () => {
    expect(html).toContain('<strong>strong</strong>')
    expect(html).toContain('<mark>marked</mark>')
    expect(html).toContain('<sub>2</sub>')
    expect(html).toContain('data-kind="note"')
    expect(html).toContain('<table>')
    expect(html).toContain('class="footnotes"')
    expect(html).toContain('<li class="task-list-item is-done">')
    expect(html).toContain('<div style="page-break-after: always;"></div>')
  })

  test('links the table of contents to the headings', () => {
    expect(html).toContain('<nav class="toc">')
    expect(html).toContain('<a href="#lists">Lists</a>')
    expect(html).toContain('<h2 id="lists">Lists</h2>')
    expect(html).not.toContain('[toc]')
  })

  test('tells a bare link from a worded one', () => {
    expect(html).toContain('<a class="url" href="https://bare.dev">')
    expect(html).toContain('<a href="https://nib.dev">link</a>')
  })

  test('leaves front matter out', () => {
    expect(html).not.toContain('title: Meta')
    expect(html).not.toContain('Ada Lovelace</p>')
  })

  test('carries the paper and the running text', () => {
    expect(html).toContain('@page { size: A4 portrait; margin: 20mm; }')
    expect(html).toContain('<div class="running-footer">Meta - 2026-09-04</div>')
    expect(buildHtml('# Plain', 'p.md')).not.toContain('class="sheet"')
  })

  test('takes the paper from the settings when the note says nothing', () => {
    const page = { paper: 'Letter', orientation: 'landscape', margin: '1in', header: '', footer: '' } as const
    expect(buildHtml('# Plain', 'p.md', { page })).toContain('@page { size: Letter landscape; margin: 1in; }')
  })

  test('writes the code palette in', () => {
    expect(html).toContain('#write .hl-keyword { color: var(--accent); }')
    expect(buildHtml(NOTE, 'x.md', { codeTheme: 'github' })).toContain('#write .hl-keyword { color: #cf222e; }')
  })

  test('lets a theme file and custom css sit on top', () => {
    const styled = buildHtml(NOTE, 'x.md', { css: '#write { --custom: 1; }' })
    expect(styled.indexOf('--custom: 1')).toBeGreaterThan(styled.indexOf('@media print'))
  })

  test('leaves a fence as code until told otherwise', () => {
    expect(html).toContain('<pre><code class="language-mermaid">graph TD; A--&gt;B\n</code></pre>')
  })

  test('uses fences the caller prepared', () => {
    const styled = buildHtml(NOTE, 'x.md', {
      fence: (code, language) => (language === 'mermaid' ? `<figure class="diagram">${code}</figure>` : null),
    })
    expect(styled).toContain('<figure class="diagram">graph TD; A-->B</figure>')
  })
})

describe('a bare export', () => {
  const html = buildHtml(NOTE, 'Handbook.md', { bare: true })

  test('carries no styles', () => {
    expect(html).not.toContain('<style>')
    expect(html).not.toContain('--bg')
  })

  test('still carries the content and the metadata', () => {
    expect(html).toContain('<h1 id="handbook">Handbook</h1>')
    expect(html).toContain('<strong>strong</strong>')
    expect(html).toContain('<nav class="toc">')
    expect(html).toContain('<title>Meta</title>')
    expect(html).toContain('<meta name="author" content="Ada Lovelace">')
  })
})

describe('preparing fences', () => {
  const draw = async (code: string, language: string, scheme: string) =>
    `<svg data-language="${language}" data-scheme="${scheme}">${code}</svg>`

  test('draws diagrams and colours code', async () => {
    const fence = await prepareFences(NOTE, 'light', {}, draw)

    expect(fence('graph TD; A-->B', 'mermaid')).toBe(
      '<figure class="diagram" data-language="mermaid"><svg data-language="mermaid" data-scheme="light">graph TD; A-->B</svg></figure>\n',
    )
    expect(fence('const answer = 42', 'ts')).toContain('<span class="hl-keyword">const</span>')
    expect(fence('const answer = 42', 'ts')).toMatch(/^<pre><code class="language-ts">/)
  })

  test('leaves plain what it cannot draw or colour', async () => {
    const fence = await prepareFences(NOTE, 'light', {}, async () => {
      throw new Error('no browser here')
    })

    expect(fence('graph TD; A-->B', 'mermaid')).toBeNull()
    expect(fence('x', 'no-such-language')).toBeNull()
    expect(fence('x', '')).toBeNull()
  })

  test('skips colouring when asked, and still draws', async () => {
    const fence = await prepareFences(NOTE, 'dark', { highlight: false }, draw)

    expect(fence('const answer = 42', 'ts')).toBeNull()
    expect(fence('graph TD; A-->B', 'mermaid')).toContain('data-scheme="dark"')
  })
})

describe('rendering a whole note', () => {
  test('brings drawn fences and coloured code into the page', async () => {
    const html = await renderNote('```ts\nlet x = 1\n```', 'n.md')
    expect(html).toContain('<span class="hl-keyword">let</span>')
  })

  test('keeps a bare export free of colouring', async () => {
    const html = await renderNote('```ts\nlet x = 1\n```', 'n.md', { bare: true })
    expect(html).toContain('<pre><code class="language-ts">let x = 1\n</code></pre>')
  })
})

describe('naming the document', () => {
  test('prefers the front matter, then the first heading, then the file', () => {
    expect(titleOf('---\ntitle: Meta\n---\n# Head', 'file.md')).toBe('Meta')
    expect(titleOf('# Head\n', 'file.md')).toBe('Head')
    expect(titleOf('text', 'file.md')).toBe('file')
  })
})

describe('pandoc formats', () => {
  test('cover what Typora offers', () => {
    const ids = PANDOC_FORMATS.map((format) => format.id)
    for (const expected of ['docx', 'odt', 'rtf', 'epub', 'latex', 'mediawiki', 'rst', 'textile', 'opml', 'revealjs']) {
      expect(ids).toContain(expected)
    }
  })

  test('each names the file extension it produces', () => {
    for (const format of PANDOC_FORMATS) {
      expect(format.extension).toMatch(/^[a-z]+$/)
    }
  })
})

describe('finding local images', () => {
  test('picks out the paths that are files', () => {
    const html =
      '<img src="a.png"><img src="assets/b.jpg" alt="x"><img src="https://e.com/c.png">' +
      '<img src="data:image/png;base64,AAA"><img src="//e.com/d.png">'

    expect(localSources(html)).toEqual(['a.png', 'assets/b.jpg'])
  })

  test('lists each path once', () => {
    expect(localSources('<img src="a.png"><img src="a.png">')).toEqual(['a.png'])
  })

  test('finds nothing in a page without images', () => {
    expect(localSources('<p>text</p>')).toEqual([])
  })
})
