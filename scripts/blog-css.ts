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
 *  `data-theme`; a published page starts from the reader's own system instead.
 *  The light tokens become the default - a page on the open web is read on
 *  paper-white far more often than not - and the dark ones are restated under
 *  `prefers-color-scheme: dark`. A reader who says which they want beats both:
 *  the button in the bar writes the same `data-theme` the app does, and the two
 *  stated schemes are restated after the system's so they outrank it. Print is
 *  light again, because paper is.
 *
 *  The size. The sheets are written to be read, with a paragraph of reasoning
 *  over every rule; what goes over the wire is the rules. Comments go and runs of
 *  whitespace collapse, which is about half of it.
 *
 *  Two modules come out of this: blog/style.ts, which is the sheet above, and
 *  blog/math.ts, which is KaTeX's own sheet with its faces in it. A page with an
 *  equation on it used to fetch that sheet and those faces from a CDN, which told
 *  a third party who was reading what and broke the maths for anybody offline or
 *  behind a blocker. Now the Worker carries both, so everything a reader's browser
 *  asks for while reading a published note comes from the domain the note is on.
 *
 *  Run `pnpm blog:css` after changing any of those sheets, or after the katex
 *  package moves. What it writes is committed, so the Worker needs no build step
 *  of its own, and services/sync/test/publishing.test.ts fails if the two have
 *  drifted. TypeScript rather than the .mjs the other scripts here are, because
 *  that test imports it: the generator and the check on it are one piece of code.
 *  Node runs it as it is.
 */

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = new URL('../', import.meta.url)
const THEMES = new URL('packages/themes/src/', ROOT)
const BLOG = new URL('services/sync/src/blog/', ROOT)

/** KaTeX's own files, in the package the app renders equations with: it is a
 *  dependency of @nib/themes, of the editor and of the markdown renderer, all at
 *  the one version, and it is resolved here rather than named so that the release
 *  a page is dressed in cannot drift from the release that drew the markup. */
const KATEX = new URL(
  '.',
  pathToFileURL(
    createRequire(fileURLToPath(new URL('packages/themes/package.json', ROOT))).resolve(
      'katex/dist/katex.min.css',
    ),
  ),
)

/** Where each generated module goes. */
const STYLE_TARGET = fileURLToPath(new URL('style.ts', BLOG))
const MATH_TARGET = fileURLToPath(new URL('math.ts', BLOG))

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
      // And the reader's own word is the last of all: the button in the bar
      // writes `data-theme` on the root, the way the app does, so the two
      // stated schemes have to outrank the system's - said with the attribute
      // rather than by importance, which nothing after this could override.
      `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) {${dark}} }`,
      `:root[data-theme='dark'] {${dark}}`,
      `:root[data-theme='light'] {${light}}`,
      // Paper is light whatever the screen was.
      `@media print { :root, :root[data-theme='dark'] {${light}} }`,
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

/** What a file is named by: enough of its own contents that two files are never
 *  one name, so a reader can keep it forever and it can never go stale.
 *
 *  A font is read and hashed as latin1 - one character to a byte - so that the
 *  name a face is served under is that file's own bytes rather than a reading of
 *  them, and so that `btoa` has a string it can take. */
function hash(what: string, encoding: 'utf8' | 'latin1'): string {
  return createHash('sha256').update(what, encoding).digest('hex').slice(0, 16)
}

/** Where a sheet is served. */
function pathFor(css: string): string {
  return `/s/${hash(css, 'utf8')}.css`
}

/** The `src` of one `@font-face`, and the woff2 in it. */
const FACE_SRC = /src:[^;}]+/g
const WOFF2 = /url\(fonts\/([^)]+\.woff2)\)/

/** KaTeX's own stylesheet with its faces served from here, and those faces.
 *
 *  woff2 alone of the three formats the package ships: every browser that can
 *  read a page like this one has taken woff2 for ten years, and carrying the woff
 *  and the ttf as well would treble the weight for nobody. The `src` of each face
 *  becomes the one path that face is served at - its own hash, with the file's
 *  name after it so a network panel says which face a page asked for.
 *
 *  The bytes are base64 because a Worker's bundle is its source: there is no build
 *  step here, the module is committed like the sheet above, and a face the Worker
 *  holds is a face no CDN sees a reader ask for. 254kB of them, which is what a
 *  page with an equation on it costs to serve first-party; a page without one
 *  links neither the sheet nor a face. */
function math(): { css: string; fonts: Record<string, string> } {
  const fonts: Record<string, string> = {}

  const css = read(new URL('katex.min.css', KATEX)).replace(FACE_SRC, (src) => {
    const file = WOFF2.exec(src)?.[1]
    if (!file) throw new Error(`a KaTeX face names no woff2 to serve: ${src}`)

    const bytes = readFileSync(fileURLToPath(new URL(`fonts/${file}`, KATEX)), 'latin1')
    const path = `/s/${hash(bytes, 'latin1')}-${file}`
    fonts[path] = btoa(bytes)

    return `src:url(${path}) format("woff2")`
  })

  return { css, fonts }
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

/** The module the Worker serves an equation's dressing from. */
export function blogMath(): string {
  const { css, fonts } = math()

  return `/* Generated by scripts/blog-css.ts from the katex package.
 * Do not edit: run \`pnpm blog:css\`. publishing.test.ts fails if it is stale.
 *
 * KaTeX's own stylesheet and the faces it names, carried by the Worker so that a
 * reader of a page with maths on it fetches nothing from anybody else. Each is
 * served at a path that is its own hash, so a reader keeps it forever and a new
 * release of katex is a different file rather than a stale one. */

export const MATH_CSS = ${JSON.stringify(css)}

export const MATH_CSS_PATH = ${JSON.stringify(pathFor(css))}

/** Every face MATH_CSS asks for, as base64, by the path it asks for it at. */
export const MATH_FONTS: Readonly<Record<string, string>> = ${JSON.stringify(fonts, null, 2)}
`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [target, written] of [
    [STYLE_TARGET, blogStyle()],
    [MATH_TARGET, blogMath()],
  ] as const) {
    writeFileSync(target, written)
    console.log(`wrote ${target} (${(written.length / 1024).toFixed(1)}kB)`)
  }
}
