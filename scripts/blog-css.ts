/** The stylesheet a published note is served with, built from the themes package.
 *
 *  A published page is the same page as the reading view and as an exported
 *  document, so it carries the same three sheets: tokens.css for the colours,
 *  base.css for the prose, document.css for the constructs only the renderer
 *  makes. On top of those, the blog's own page.css, which is the difference
 *  between a page and an app.
 *
 *  Two things are decided here rather than in the sheets:
 *
 *  The scheme. The app is dark until a reader says otherwise and says so with
 *  `data-theme`; a published page has nobody to ask and no script to ask with, so
 *  the reader's own system decides. The light tokens become the default - a page
 *  on the open web is read on paper-white far more often than not - and the dark
 *  ones are restated under `prefers-color-scheme: dark`. Print is light again,
 *  because paper is.
 *
 *  The size. The sheets are written to be read, with a paragraph of reasoning
 *  over every rule; what goes over the wire is the rules. Comments go and runs of
 *  whitespace collapse, which is about half of it.
 *
 *  Run `pnpm blog:css` after changing any of those sheets. What it writes is
 *  committed, so the Worker needs no build step of its own, and
 *  services/sync/test/publishing.test.ts fails if the two have drifted. TypeScript
 *  rather than the .mjs the other scripts here are, because that test imports it:
 *  the generator and the check on it are one piece of code. Node runs it as it is.
 */

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = new URL('../', import.meta.url)
const THEMES = new URL('packages/themes/src/', ROOT)
const BLOG = new URL('services/sync/src/blog/', ROOT)

/** Where the generated module goes. */
const TARGET = fileURLToPath(new URL('style.ts', BLOG))

function read(where: URL): string {
  return readFileSync(fileURLToPath(where), 'utf8')
}

/** A token block's declarations, by the selector that opens it. Thrown for rather
 *  than skipped: a missing block would mean a page with no colours in it, and
 *  finding that out on the page is finding it out too late. */
function tokenBlock(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`)
  if (at === -1) throw new Error(`tokens.css no longer has a \`${selector}\` block`)

  const opened = at + selector.length + 2
  const closed = css.indexOf('\n}', opened)
  if (closed === -1) throw new Error(`the \`${selector}\` block in tokens.css does not close`)

  return css.slice(opened, closed)
}

/** CSS with the reasoning taken out: comments gone, whitespace collapsed, and the
 *  space either side of the punctuation that never needs one gone too.
 *
 *  Quoted strings are copied through untouched - base.css draws a dropdown's
 *  arrow with an SVG in a `url()`, and a comment marker inside one of those would
 *  otherwise eat the rest of the sheet. */
export function tighten(css: string): string {
  let out = ''
  let at = 0

  while (at < css.length) {
    const character = css.charAt(at)

    if (character === '"' || character === "'") {
      const end = css.indexOf(character, at + 1)
      const to = end === -1 ? css.length : end + 1
      out += css.slice(at, to)
      at = to
      continue
    }

    if (character === '/' && css.charAt(at + 1) === '*') {
      const end = css.indexOf('*/', at + 2)
      at = end === -1 ? css.length : end + 2
      continue
    }

    if (/\s/.test(character)) {
      out += ' '
      while (at < css.length && /\s/.test(css.charAt(at))) at++
      continue
    }

    out += character
    at++
  }

  return out
    .replace(/ ?([{};,>]) ?/g, '$1')
    .replace(/;}/g, '}')
    .replace(/([:(]) /g, '$1')
    .trim()
}

/** The sheet a published page links. */
function pageCss(): string {
  const tokens = read(new URL('tokens.css', THEMES))
  const light = tokenBlock(tokens, "[data-theme='light']")
  const dark = tokenBlock(tokens, ":root,\n[data-theme='dark']")

  return tighten(
    [
      tokens,
      // A page on the web is light unless the reader's system says otherwise.
      // Last word over the blocks above, which are the app's way round.
      `:root {${light}}`,
      `@media (prefers-color-scheme: dark) { :root {${dark}} }`,
      `@media print { :root {${light}} }`,
      read(new URL('base.css', THEMES)),
      read(new URL('document.css', THEMES)),
      read(new URL('page.css', BLOG)),
    ].join('\n'),
  )
}

/** The stage a published deck is read on, on top of the sheet above. */
function slidesCss(): string {
  return tighten(read(new URL('slides.css', THEMES)))
}

/** Where a sheet is served: its own contents, so a reader can keep it forever
 *  and it can never go stale. */
function pathFor(css: string): string {
  return `/s/${createHash('sha256').update(css).digest('hex').slice(0, 16)}.css`
}

/** The module the Worker imports. */
export function blogStyle(): string {
  const page = pageCss()
  const slides = slidesCss()

  return `/* Generated by scripts/blog-css.ts from packages/themes and page.css.
 * Do not edit: run \`pnpm blog:css\`. publishing.test.ts fails if it is stale.
 *
 * The stylesheet a published note is served with - the same tokens.css, base.css
 * and document.css the reading view loads - and the stage a published deck is
 * read on. Each is served at a path that is its own hash, so a reader keeps it
 * forever and a change to it is a different file rather than a stale one. */

export const PAGE_CSS = ${JSON.stringify(page)}

export const PAGE_CSS_PATH = ${JSON.stringify(pathFor(page))}

export const SLIDES_CSS = ${JSON.stringify(slides)}

export const SLIDES_CSS_PATH = ${JSON.stringify(pathFor(slides))}
`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const written = blogStyle()
  writeFileSync(TARGET, written)
  console.log(`wrote ${TARGET} (${(written.length / 1024).toFixed(1)}kB)`)
}
