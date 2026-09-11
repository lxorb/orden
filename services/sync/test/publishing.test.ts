/** A published note is the note.
 *
 *  One fixture with every construct nib renders in it - everything.md, which the
 *  browser drive in apps/desktop/test/e2e/publishing.py opens in the reading view
 *  and on a published page side by side - read here through the real routes.
 *
 *  What these hold the page to is the two halves of looking the same: the markup
 *  the renderer was asked for, and a stylesheet that has something to say about
 *  every class in it. The second is the one that catches drift: a construct that
 *  gains a class, or a sheet that stops being served, fails here rather than on
 *  somebody's blog. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { blogStyle } from '../../../scripts/blog-css'
import { COLOURED } from '../src/blog/code'
import { PAGE_CSS, PAGE_CSS_PATH } from '../src/blog/style'
import { call, signIn, testEnv, type TestEnv } from './harness'

const EVERYTHING = readFileSync(fileURLToPath(new URL('everything.md', import.meta.url)), 'utf8')

const OTHER = '# Another note\n\nThe other note itself.\n\n## Why it works\n\nBecause.\n'

const HOST = 'field.nibeditor.com'

let env: TestEnv
let token: string

beforeEach(async () => {
  env = testEnv()
  token = await signIn(env, 'a@b.dev')

  const created = await call(env, '/v1/spaces', { token, body: { name: 'Field notes' } })
  const space = (created.json as { space: { id: string } }).space.id

  for (const [path, content] of [
    ['Everything.md', EVERYTHING],
    ['Another note.md', OTHER],
  ] as const) {
    await call(env, `/v1/spaces/${space}/notes`, { token, body: { path, content } })
  }

  await call(env, `/v1/spaces/${space}/blog`, {
    method: 'PUT',
    token,
    body: { subdomain: 'field' },
  })
})

afterEach(() => env.close())

function published() {
  return call(env, '/everything', { host: HOST })
}

/** The note's own markup, without the page around it. */
function body(html: string): string {
  const at = html.indexOf('<main id="write">')
  return html.slice(at, html.indexOf('</main>', at))
}

/** Every class the page uses, except the ones inside an equation: KaTeX brings a
 *  vocabulary of its own - `mord`, `vlist`, `pstrut` - and its own stylesheet to
 *  colour it with, so those subtrees are cut out before the names are read. */
function classesIn(html: string): string[] {
  const found = new Set<string>()
  for (const [, list] of withoutMaths(html).matchAll(/class="([^"]*)"/g)) {
    for (const name of (list ?? '').trim().split(/\s+/)) if (name) found.add(name)
  }

  return [...found].sort()
}

/** The same HTML with every rendered equation taken out of it. KaTeX writes one
 *  `<span class="katex">` per formula and everything under it is its own, so the
 *  span that opens one is followed until it closes. */
function withoutMaths(html: string): string {
  let out = ''
  let at = 0

  while (at < html.length) {
    const found = /<span class="katex(?:-display)?"/.exec(html.slice(at))
    if (!found) return out + html.slice(at)

    const opens = at + found.index
    out += html.slice(at, opens)

    let depth = 0
    let scan = opens
    while (scan < html.length) {
      const next = /<span\b|<\/span>/.exec(html.slice(scan))
      if (!next) return out
      scan += next.index + next[0].length
      depth += next[0] === '</span>' ? -1 : 1
      if (depth === 0) break
    }

    at = scan
  }

  return out
}

describe('the stylesheet a page is served with', () => {
  test('is the one the generator writes from the themes package', () => {
    const target = fileURLToPath(new URL('../src/blog/style.ts', import.meta.url))
    expect(readFileSync(target, 'utf8')).toBe(blogStyle())
  })

  test('is served from the blog itself, at a path that is its own hash', async () => {
    const answer = await call(env, PAGE_CSS_PATH, { host: HOST })

    expect(answer.status).toBe(200)
    expect(answer.headers.get('content-type')).toContain('text/css')
    expect(answer.headers.get('cache-control')).toContain('immutable')
    expect(answer.text).toBe(PAGE_CSS)
  })

  test('is linked by the page rather than written into it', async () => {
    const answer = await published()

    expect(answer.text).toContain(`<link rel="stylesheet" href="${PAGE_CSS_PATH}">`)
    // Only the sheets; a page carries no rules of its own any more.
    expect(answer.text).not.toContain('<style>')
  })

  test('is base.css and document.css themselves, scoped to #write as they are', () => {
    // One rule from each of the three sheets, so a sheet dropped from the
    // generator is a test failing rather than a page losing its callouts.
    expect(PAGE_CSS).toContain('--callout-warning:')
    expect(PAGE_CSS).toContain('#write blockquote{')
    expect(PAGE_CSS).toContain('#write .task-list-item')
    expect(PAGE_CSS).toContain('#write .chart-svg{')
    expect(PAGE_CSS).toContain('.hl-keyword{')
  })

  test('reads light or dark from the reader rather than from a script', () => {
    expect(PAGE_CSS).toContain('@media (prefers-color-scheme:dark){:root{')
    expect(PAGE_CSS).toContain('@media print{:root{')
    // The page never sets `data-theme`, so the tokens on `:root` are what it
    // gets, and on the open web those are the light ones.
    expect(PAGE_CSS).toContain(':root{color-scheme:light;--bg:#fbfcfd')
  })
})

/** The classes no stylesheet anywhere in nib says anything about, on a page or in
 *  the app: a name for what a thing is, which takes its look from what it is
 *  inside. `language-ts` is on a fence for anybody reading the markup, a chart's
 *  bars and a web card's name are coloured by attributes the renderer writes, and
 *  a bare address, a wikilink and the arrow out of a footnote are links. Named
 *  here so the test below is about what a page is missing rather than these. */
const UNDRESSED = /^(?:language-|chart-bar$|embed-name$|footnote-back$|url$|wikilink$)/

describe('a published note', () => {
  test('is the note, in the element every sheet of the app is written for', async () => {
    const answer = await published()

    expect(answer.status).toBe(200)
    expect(answer.text).toContain('<main id="write">')
  })

  test('has something in the stylesheet for every class it uses', async () => {
    const answer = await published()
    const missing = classesIn(body(answer.text)).filter(
      (name) => !PAGE_CSS.includes(`.${name}`) && !UNDRESSED.test(name),
    )

    expect(missing).toEqual([])
  })

  test('colours every fence whose language the Worker carries', async () => {
    const answer = await published()

    expect(answer.text).toContain('<span class="hl-keyword">export</span>')
    expect(answer.text).toContain('<span class="hl-keyword">def</span>')
    expect(answer.text).toContain('<span class="hl-comment">')
    expect(answer.text).toContain('<pre><code class="language-css">')
  })

  test('leaves a fence it has no grammar for as plain code', async () => {
    const answer = await published()
    const fence = answer.text.slice(answer.text.indexOf('<code class="language-mermaid">'))

    expect(fence.slice(0, fence.indexOf('</code>'))).not.toContain('<span')
  })

  test('names the languages the editor spells the same way', () => {
    // A handful the editor matches through `SPELLINGS`; the whole table is
    // src/blog/code.ts, and a language missing from it is a plain fence.
    for (const word of ['ts', 'tsx', 'py', 'rs', 'golang', 'yml', 'scss', 'h++']) {
      expect(COLOURED).toContain(word)
    }
  })

  test('gathers a table of contents and gives every heading an id', async () => {
    const answer = await published()

    expect(answer.text).toContain('<nav class="toc">')
    expect(answer.text).toContain('<h2 id="a-table">')
    // So that `[[note#heading]]` from another page lands on the heading.
    expect(answer.text).toContain('href="#a-table"')
  })

  test('renders maths, a chart and every callout without a script', async () => {
    const answer = await published()

    expect(answer.text).toContain('class="katex"')
    expect(answer.text).toContain('class="katex-display"')
    expect(answer.text).toContain('<figure class="chart" data-kind="bar">')
    expect(answer.text).toContain('<svg class="chart-svg"')
    // The thirteen Obsidian has, the two nib had first, and one nobody registered.
    expect(answer.text.match(/class="callout callout-/g)).toHaveLength(15)
    expect(answer.text).toContain('data-callout="recipe"')
    expect(answer.text).toContain('<details class="callout callout-caution"')
    expect(answer.headers.get('content-security-policy')).toContain("script-src 'none'")
  })

  test('shows what it embeds and says what it cannot show', async () => {
    const answer = await published()

    expect(answer.text).toContain('The other note itself.')
    expect(answer.text).toContain('<audio class="embed-media"')
    expect(answer.text).toContain('<video class="embed-media"')
    expect(answer.text).toContain('data-kind="pdf"')
    expect(answer.text).toContain('data-kind="canvas"')
    // A page from the web is a card that is a link, since nothing may run here.
    expect(answer.text).toContain('<a class="embed-play"')
  })

  test('keeps the note to itself: no front matter, no comments', async () => {
    const answer = await published()

    expect(answer.text).not.toContain('Nobody reads this one')
    expect(answer.text).not.toContain('Nor this one')
    // The metadata is what the page's own title and byline were built from.
    expect(answer.text).not.toContain('class="properties"')
    expect(answer.text).toContain('<title>Everything</title>')
  })
})
