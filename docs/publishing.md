# Publishing

A published page is the note. Same renderer, same stylesheet, same colours in a
code fence. If it reads one way in the app it reads that way on somebody's blog,
and anything that cannot be that way is written down at the bottom of this page.

## Who renders what

| Where | Renderer | Stylesheet |
| --- | --- | --- |
| Reading view | `packages/markdown` through `apps/desktop/src/lib/reading/render.ts` | tokens.css, base.css, document.css, loaded by the app |
| Exported HTML | `packages/markdown` through `apps/desktop/src/lib/export.ts` | the same three, baked in, plus export.css |
| Published page | `packages/markdown` through `services/sync/src/blog.ts` | the same three, served from the Worker, plus the blog's own page.css |

One renderer, one set of sheets, three surfaces. The note body goes inside
`#write`, which is Typora's name for a rendered note and the id the writing
surface, the reading view and an exported document all carry, so every rule in
the theme lands on all of them at once.

## What was wrong before

Measured on 11.09.2026 against a fixture with every construct in it
(`services/sync/test/everything.md`), rendered three ways and diffed:

- No syntax highlighting at all. The Worker passed no `code` option, so every
  fence came out as plain grey text while the app coloured it.
- The page carried a hand-written stylesheet of about a hundred lines, which was
  a second design that looked a bit like the first. Fifteen callout colours were
  restated in it by hand, and these had no rules in it at all: `figure.code` and
  the caption over a fence, `.footnotes` and `.footnote-ref`, `.task-list-item`
  and its checkbox, `.toc`, `.math-block` and `.math-inline`, `.diagram`,
  `.properties`, `dl`/`dt`/`dd`, `abbr`, `h5`, `h6`, and every `hl-` class.
- `[toc]` was printed as the four characters `[toc]`. No heading had an id, so
  `[[note#heading]]` from another page landed at the top of it.
- The fonts, the sizes, the measure and the spacing were their own numbers rather
  than the theme's tokens, so the page was close to the app but never it.

Everything else already matched: the callouts, the folded one, the footnotes, the
tables, the task lists, the charts, the embedded notes, the media players, the
PDF and canvas cards, the web cards, the definition lists and the maths all came
out of the same renderer and were already the same markup.

## What it is now

- **One renderer.** `serveBlog` asks for what the reading view asks for:
  `footnotes`, `toc`, `escapeHtml`, a `code` fence renderer, and resolvers for
  links and embeds. The structural difference between the two is zero; see below.
- **One stylesheet.** `scripts/blog-css.ts` builds it from
  `packages/themes/src/{tokens,base,document}.css` plus
  `services/sync/src/blog/page.css`, strips the comments, and writes
  `services/sync/src/blog/style.ts`. Run `pnpm blog:css` after changing any of
  those sheets; a test in `services/sync` fails if you forget. The Worker serves
  it at a path that is its own hash, cached forever, so a reader fetches 34kB
  once for a whole blog and every page after that carries no CSS at all.
- **Light or dark from the reader.** The app is dark until you say otherwise and
  says so with `data-theme`; a page has nobody to ask and no script to ask with.
  So the light tokens are the default, the dark ones are restated under
  `prefers-color-scheme: dark`, and print is light again because paper is.
- **Coloured fences, server side.** `services/sync/src/blog/code.ts` carries
  thirteen Lezer grammars - the very parsers the editor loads through
  `@codemirror/lang-*` - and colours a fence with `@nib/markdown/highlight`, the
  module the export uses too. Same `hl-` classes, same tree, character for
  character. The colours are in document.css now, written with `:where(#write)`
  so a reader's chosen palette still wins in the app.
- **No script on the page.** The CSP still says `script-src 'none'`. Highlighting
  is done before the bytes leave the Worker; nothing is coloured in the browser.

## What still differs, and why

- **The front matter.** The reading view draws it as rows because reading a note
  is being in the app looking at it. A page is a page: its metadata became the
  title, the byline and the `<meta>` tags, so it is not also a table at the top.
  Same as an exported document.
- **A mermaid diagram.** Mermaid needs a DOM to measure text in, and a Worker has
  none, so a `mermaid`, `flow` or `sequence` fence stays a code block on the page
  while the app draws it. No Worker-compatible renderer for it exists today.
  Charts are fine: a ` ```chart ` fence is string-built SVG and always was.
- **A web card.** `![](https://youtube.com/watch?v=…)` is the same card in both,
  but in the app pressing it swaps in the frame and on a page it is a link out.
  Nothing may run on a published page, and that is the point of it.
- **Raw HTML.** A note of your own is markup in the app, as Typora does it. A
  published note is authored content served to strangers from a domain shared
  with every other blog, so HTML in it is shown as the characters it is made of.
- **Languages the editor has and the Worker does not.** Shell, SQL, Ruby, Swift
  and the other hundred are stream parsers that only exist inside CodeMirror. A
  fence naming one is a plain fence on a page. Adding a grammar to the table in
  `blog/code.ts` is all it takes for one more.
- **Line numbers** are the editor's gutter, not the renderer's. Neither the
  reading view nor a page has them.
- **KaTeX's own stylesheet** is the one thing a page still fetches from
  elsewhere (jsdelivr). Its fonts are 254kB of woff2, which is a lot to carry in
  a Worker bundle for the notes that have no equation in them. Everything else,
  the page's own type included, is local: the token stacks name Geist and iA
  Writer and fall back to `ui-sans-serif` and `ui-monospace`, so a reader with
  neither installed gets their system's faces rather than a download.

## How to check it

- `python apps/desktop/test/e2e/publishing.py` builds the web app, runs the
  Worker on workerd with the migrations applied, publishes the fixture through
  the real API, opens it in the reading view and as a published page, compares
  the tag and class tree of both, and writes the two pictures beside each other
  under `apps/desktop/test/e2e/shots/publishing/`. It fails on any structural
  difference that is not in the list above.
- `pnpm --filter @nib/sync test` covers the rest: the stylesheet is the one the
  generator writes, it is served and cached, every class the page uses has a rule
  in it, the fences are coloured, the headings have ids, nothing runs.
